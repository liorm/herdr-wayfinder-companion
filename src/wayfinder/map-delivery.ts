import type { Issue } from "../github/issues.ts";
import { defaultGh, type GhRunner } from "../github/issues.ts";
import {
	defaultGit,
	squashPullRequest,
	waitForTicketClosed,
	type GitRunner,
	type ModifiedFile,
	type PRInfo,
} from "../git.ts";
import type { HerdrCall } from "../herdr.ts";
import type { SiblingAgent } from "../sibling.ts";
import {
	getOpenBlockers,
	isIssueBlocked,
	parentMapNumber,
	sortChildren,
	ticketKind,
} from "./board.ts";
import { runDeliveryWorkflow, type DeliveryState } from "./delivery.ts";
import type { ModelResolutionOptions } from "./models.ts";

export type MapDeliveryStepStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed";

export interface MapDeliveryStep {
	issue: Issue;
	status: MapDeliveryStepStatus;
	deliveryState?: DeliveryState;
	pr?: PRInfo;
	error?: string;
}

export interface MapDeliveryState {
	mapIssue: Issue;
	steps: MapDeliveryStep[];
	isStarted: boolean;
	isFinished: boolean;
	currentStepIndex?: number;
	currentIssue?: Issue;
	modifiedFiles: ModifiedFile[];
	agentMessage?: string;
	error?: string;
}

/**
 * Returns all subtickets that belong to the given map ticket,
 * sorted topologically by dependencies and issue number.
 */
export function getMapSubtickets(mapIssue: Issue, allIssues: Issue[]): Issue[] {
	const children = allIssues.filter(
		(issue) =>
			issue.number !== mapIssue.number &&
			parentMapNumber(issue.body) === mapIssue.number,
	);
	return sortChildren(children, allIssues);
}

/**
 * Checks if a map ticket is eligible for sequential delivery workflow:
 * - Must be a map ticket
 * - Must have subtickets
 * - All subtickets must be in delivery state (`ready-for-agent` / `delivery`) or closed
 * - Must have at least one open subticket
 */
export function canDeliverMap(
	mapIssue: Issue,
	allIssues: Issue[],
): { canDeliver: boolean; reason?: string; subtickets: Issue[] } {
	if (ticketKind(mapIssue.labels) !== "map") {
		return {
			canDeliver: false,
			reason: `Issue #${mapIssue.number} is not a map ticket.`,
			subtickets: [],
		};
	}

	const subtickets = getMapSubtickets(mapIssue, allIssues);
	if (subtickets.length === 0) {
		return {
			canDeliver: false,
			reason: `Map #${mapIssue.number} has no subtickets.`,
			subtickets: [],
		};
	}

	const nonDelivery = subtickets.filter(
		(sub) => !sub.closed && ticketKind(sub.labels) !== "delivery",
	);
	if (nonDelivery.length > 0) {
		const list = nonDelivery
			.map((i) => `#${i.number} (${ticketKind(i.labels)})`)
			.join(", ");
		return {
			canDeliver: false,
			reason: `Not all subtickets are in delivery state. Found non-delivery subtickets: ${list}`,
			subtickets,
		};
	}

	const openDelivery = subtickets.filter((sub) => !sub.closed);
	if (openDelivery.length === 0) {
		return {
			canDeliver: false,
			reason: `All subtickets of Map #${mapIssue.number} are already closed.`,
			subtickets,
		};
	}

	return {
		canDeliver: true,
		subtickets,
	};
}

export function createInitialMapDeliveryState(
	mapIssue: Issue,
	subtickets: Issue[],
): MapDeliveryState {
	const steps: MapDeliveryStep[] = subtickets.map((sub) => ({
		issue: sub,
		status: sub.closed ? "completed" : "pending",
	}));

	const allAlreadyClosed = steps.every((s) => s.status === "completed");

	return {
		mapIssue,
		steps,
		isStarted: false,
		isFinished: allAlreadyClosed,
		modifiedFiles: [],
	};
}

export interface MapDeliveryWorkflowOptions extends ModelResolutionOptions {
	cwd: string;
	mapIssue: Issue;
	subtickets: Issue[];
	sibling: SiblingAgent;
	client: (args: string[]) => Promise<HerdrCall>;
	allIssues?: Issue[];
	model?: string;
	runGit?: GitRunner;
	runGh?: GhRunner;
	onUpdate?: (state: MapDeliveryState) => void;
	pollIntervalMs?: number;
	maxWaitMs?: number;
	startupGraceMs?: number;
	prMaxWaitMs?: number;
	closeMaxWaitMs?: number;
}

/**
 * Executes delivery sequentially for each subticket:
 * 1. Dynamically recalculates the DAG among remaining open subtickets to pick the next unblocked ticket.
 * 2. Gates against blocked tickets: NEVER implements a blocked ticket.
 * 3. Runs delivery workflow for the subticket (shares exact delivery work code).
 * 4. Squashes the created PR via GitHub CLI.
 * 5. Waits until the ticket is confirmed closed on GitHub before moving to next.
 */
export async function runMapDeliveryWorkflow(
	options: MapDeliveryWorkflowOptions,
): Promise<MapDeliveryState> {
	const {
		cwd,
		mapIssue,
		subtickets,
		sibling,
		client,
		runGit = defaultGit,
		runGh = defaultGh,
		onUpdate,
		pollIntervalMs = 500,
		startupGraceMs,
		maxWaitMs,
		prMaxWaitMs,
		closeMaxWaitMs = 30_000,
	} = options;

	// Build a working set of issues to track closed state dynamically
	const issueMap = new Map<number, Issue>();
	for (const item of options.allIssues ?? []) {
		issueMap.set(item.number, item);
	}
	for (const item of subtickets) {
		issueMap.set(item.number, item);
	}
	let currentIssues = [...issueMap.values()];

	let state: MapDeliveryState = {
		mapIssue,
		steps: subtickets.map((sub) => ({
			issue: sub,
			status: sub.closed ? "completed" : "pending",
		})),
		isStarted: true,
		isFinished: false,
		modifiedFiles: [],
	};

	const update = (patch: Partial<MapDeliveryState>) => {
		state = { ...state, ...patch };
		onUpdate?.(state);
	};

	while (true) {
		// Find all remaining open subtickets
		const openSubtickets = currentIssues.filter(
			(issue) =>
				subtickets.some((sub) => sub.number === issue.number) && !issue.closed,
		);

		if (openSubtickets.length === 0) {
			break;
		}

		// Recalculate DAG for remaining open subtickets based on current closed states
		const sortedOpen = sortChildren(openSubtickets, currentIssues);
		const nextCandidate = sortedOpen[0];
		if (!nextCandidate) break;

		// Gate: NEVER implement a blocked ticket
		if (isIssueBlocked(nextCandidate, currentIssues)) {
			const blockers = getOpenBlockers(nextCandidate, currentIssues);
			const blockerList =
				blockers.length > 0 ? ` (blocked by #${blockers.join(", #")})` : "";
			const errorMsg = `Ticket #${nextCandidate.number} is blocked${blockerList}. Sequential delivery stopped.`;

			const stepIdx = state.steps.findIndex(
				(s) => s.issue.number === nextCandidate.number,
			);
			if (stepIdx >= 0) {
				state.steps = state.steps.map((s, idx) =>
					idx === stepIdx ? { ...s, status: "failed", error: errorMsg } : s,
				);
			}
			update({
				error: errorMsg,
				isFinished: true,
				currentStepIndex: undefined,
				currentIssue: undefined,
			});
			return state;
		}

		const stepIdx = state.steps.findIndex(
			(s) => s.issue.number === nextCandidate.number,
		);
		if (stepIdx >= 0) {
			state.steps = state.steps.map((s, idx) =>
				idx === stepIdx ? { ...s, status: "running" } : s,
			);
		}
		update({
			currentStepIndex: stepIdx >= 0 ? stepIdx : undefined,
			currentIssue: nextCandidate,
			agentMessage: `Starting delivery for #${nextCandidate.number}...`,
		});

		const deliveryResult = await runDeliveryWorkflow({
			cwd,
			issue: nextCandidate,
			sibling,
			client,
			allIssues: currentIssues,
			agent: options.agent ?? sibling.agent,
			model: options.model,
			configDir: options.configDir,
			customModels: options.customModels,
			runGit,
			runGh,
			pollIntervalMs,
			maxWaitMs,
			startupGraceMs,
			prMaxWaitMs,
			onUpdate: (dState) => {
				if (stepIdx >= 0) {
					state.steps = state.steps.map((s, idx) =>
						idx === stepIdx ? { ...s, deliveryState: dState } : s,
					);
				}
				update({
					modifiedFiles: dState.modifiedFiles,
					agentMessage: dState.agentMessage,
				});
			},
		});

		if (deliveryResult.error || !deliveryResult.pr) {
			const errorMsg =
				deliveryResult.error ??
				`Delivery workflow failed for ticket #${nextCandidate.number}`;
			if (stepIdx >= 0) {
				state.steps = state.steps.map((s, idx) =>
					idx === stepIdx
						? {
								...s,
								status: "failed",
								error: errorMsg,
								deliveryState: deliveryResult,
							}
						: s,
				);
			}
			update({
				error: errorMsg,
				isFinished: true,
				currentStepIndex: undefined,
				currentIssue: undefined,
			});
			return state;
		}

		const pr = deliveryResult.pr;
		if (stepIdx >= 0) {
			state.steps = state.steps.map((s, idx) =>
				idx === stepIdx ? { ...s, pr, deliveryState: deliveryResult } : s,
			);
		}

		// Squash PR
		update({
			agentMessage: `Squashing PR #${pr.number} for ticket #${nextCandidate.number}...`,
		});
		const squashResult = await squashPullRequest(cwd, pr.number, runGh);
		if (!squashResult.ok) {
			const errorMsg =
				squashResult.error ??
				`Failed to squash PR #${pr.number} for ticket #${nextCandidate.number}`;
			if (stepIdx >= 0) {
				state.steps = state.steps.map((s, idx) =>
					idx === stepIdx ? { ...s, status: "failed", error: errorMsg } : s,
				);
			}
			update({
				error: errorMsg,
				isFinished: true,
				currentStepIndex: undefined,
				currentIssue: undefined,
			});
			return state;
		}

		// Wait for ticket to be closed on GitHub
		update({
			agentMessage: `Waiting for ticket #${nextCandidate.number} to be closed on GitHub...`,
		});
		const closed = await waitForTicketClosed(
			cwd,
			nextCandidate.number,
			runGh,
			closeMaxWaitMs,
			pollIntervalMs,
			() => {
				update({
					agentMessage: `Waiting for ticket #${nextCandidate.number} to be closed on GitHub...`,
				});
			},
		);

		if (!closed) {
			const errorMsg = `Ticket #${nextCandidate.number} was not closed on GitHub after squashing PR #${pr.number}`;
			if (stepIdx >= 0) {
				state.steps = state.steps.map((s, idx) =>
					idx === stepIdx ? { ...s, status: "failed", error: errorMsg } : s,
				);
			}
			update({
				error: errorMsg,
				isFinished: true,
				currentStepIndex: undefined,
				currentIssue: undefined,
			});
			return state;
		}

		// Mark closed in currentIssues so subsequent DAG recalculations reflect this!
		currentIssues = currentIssues.map((item) =>
			item.number === nextCandidate.number ? { ...item, closed: true } : item,
		);

		// Step completed!
		if (stepIdx >= 0) {
			state.steps = state.steps.map((s, idx) =>
				idx === stepIdx ? { ...s, status: "completed", error: undefined } : s,
			);
		}
		update({
			agentMessage: `Ticket #${nextCandidate.number} squashed and closed.`,
			modifiedFiles: [],
		});
	}

	update({
		isFinished: true,
		currentStepIndex: undefined,
		modifiedFiles: [],
	});

	return state;
}
