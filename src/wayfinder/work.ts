import type { Issue } from "../github/issues.ts";
import { herdrErrorMessage, type HerdrCall } from "../herdr.ts";
import type { SiblingAgent } from "../sibling.ts";
import { getOpenBlockers, isIssueBlocked, ticketKind } from "./board.ts";
import {
	getModelForTicketKind,
	type ModelResolutionOptions,
} from "./models.ts";

export interface WorkResult {
	ok: boolean;
	message: string;
	notImplemented?: boolean;
}

export interface WorkOptions extends ModelResolutionOptions {
	model?: string;
	allIssues?: Issue[];
	cwd?: string;
	runGit?: import("../git.ts").GitRunner;
	runGh?: import("../github/issues.ts").GhRunner;
	onUpdate?: (state: import("./delivery.ts").DeliveryState) => void;
	pollIntervalMs?: number;
	startupGraceMs?: number;
	maxWaitMs?: number;
}

export async function handleWorkMap(
	issue: Issue,
	sibling: SiblingAgent,
	client: (args: string[]) => Promise<HerdrCall>,
	options?: WorkOptions,
): Promise<WorkResult> {
	const target = sibling.paneId ?? sibling.agent;
	if (!target) {
		return { ok: false, message: "No sibling agent target found" };
	}

	const model =
		options?.model ??
		getModelForTicketKind("map", {
			...options,
			agent: options?.agent ?? sibling.agent,
		});

	const clearCall = await client(["agent", "prompt", target, "/clear"]);
	if (!clearCall.ok) {
		return {
			ok: false,
			message: `Failed to clear session: ${herdrErrorMessage(clearCall)}`,
		};
	}

	const modelCall = await client([
		"agent",
		"prompt",
		target,
		`/model ${model}`,
	]);
	if (!modelCall.ok) {
		return {
			ok: false,
			message: `Failed to set model: ${herdrErrorMessage(modelCall)}`,
		};
	}

	const promptCall = await client([
		"agent",
		"prompt",
		target,
		`/wayfinder ${issue.number}`,
	]);
	if (!promptCall.ok) {
		return {
			ok: false,
			message: `Failed to start wayfinder: ${herdrErrorMessage(promptCall)}`,
		};
	}

	return {
		ok: true,
		message: `Started work on map #${issue.number}`,
	};
}

export async function handleWorkGrilling(
	_issue: Issue,
	_sibling: SiblingAgent,
	_client: (args: string[]) => Promise<HerdrCall>,
	_options?: WorkOptions,
): Promise<WorkResult> {
	return {
		ok: false,
		notImplemented: true,
		message: "Work for grilling tickets is not implemented yet",
	};
}

export async function handleWorkResearch(
	_issue: Issue,
	_sibling: SiblingAgent,
	_client: (args: string[]) => Promise<HerdrCall>,
	_options?: WorkOptions,
): Promise<WorkResult> {
	return {
		ok: false,
		notImplemented: true,
		message: "Work for research tickets is not implemented yet",
	};
}

export async function handleWorkPrototype(
	_issue: Issue,
	_sibling: SiblingAgent,
	_client: (args: string[]) => Promise<HerdrCall>,
	_options?: WorkOptions,
): Promise<WorkResult> {
	return {
		ok: false,
		notImplemented: true,
		message: "Work for prototype tickets is not implemented yet",
	};
}

export async function handleWorkTask(
	_issue: Issue,
	_sibling: SiblingAgent,
	_client: (args: string[]) => Promise<HerdrCall>,
	_options?: WorkOptions,
): Promise<WorkResult> {
	return {
		ok: false,
		notImplemented: true,
		message: "Work for task tickets is not implemented yet",
	};
}

export async function handleWorkDelivery(
	issue: Issue,
	sibling: SiblingAgent,
	client: (args: string[]) => Promise<HerdrCall>,
	options?: WorkOptions,
): Promise<WorkResult> {
	const target = sibling.paneId ?? sibling.agent;
	if (!target) {
		return { ok: false, message: "No sibling agent target found" };
	}

	if (options?.allIssues && isIssueBlocked(issue, options.allIssues)) {
		const blockers = getOpenBlockers(issue, options.allIssues);
		const blockerList =
			blockers.length > 0 ? ` (blocked by #${blockers.join(", #")})` : "";
		return {
			ok: false,
			message: `Ticket #${issue.number} is blocked${blockerList}. Delivery cannot proceed.`,
		};
	}

	const { runDeliveryWorkflow } = await import("./delivery.ts");
	const cwd = options?.cwd ?? sibling.cwd ?? process.cwd();
	const res = await runDeliveryWorkflow({
		cwd,
		issue,
		sibling,
		client,
		allIssues: options?.allIssues,
		agent: options?.agent ?? sibling.agent,
		model: options?.model,
		configDir: options?.configDir,
		customModels: options?.customModels,
		runGit: options?.runGit,
		runGh: options?.runGh,
		onUpdate: options?.onUpdate,
		pollIntervalMs: options?.pollIntervalMs,
		startupGraceMs: options?.startupGraceMs,
		maxWaitMs: options?.maxWaitMs,
	});

	if (res.error) {
		return { ok: false, message: res.error };
	}

	return {
		ok: true,
		message: res.pr
			? `Delivery PR created: ${res.pr.url}`
			: `Started delivery work on #${issue.number}`,
	};
}

export async function handleWorkOther(
	_issue: Issue,
	_sibling: SiblingAgent,
	_client: (args: string[]) => Promise<HerdrCall>,
	_options?: WorkOptions,
): Promise<WorkResult> {
	return {
		ok: false,
		notImplemented: true,
		message: "Work for other tickets is not implemented yet",
	};
}

export async function dispatchWork(
	issue: Issue,
	sibling: SiblingAgent,
	client: (args: string[]) => Promise<HerdrCall>,
	options?: WorkOptions,
): Promise<WorkResult> {
	if (sibling.status !== "idle") {
		const status = sibling.status ? `(${sibling.status})` : "(unavailable)";
		return { ok: false, message: `Agent is not idle ${status}` };
	}

	if (options?.allIssues && isIssueBlocked(issue, options.allIssues)) {
		const blockers = getOpenBlockers(issue, options.allIssues);
		const blockerList =
			blockers.length > 0 ? ` (blocked by #${blockers.join(", #")})` : "";
		return {
			ok: false,
			message: `Ticket #${issue.number} is blocked${blockerList}.`,
		};
	}

	const kind = ticketKind(issue.labels);
	switch (kind) {
		case "map":
			return handleWorkMap(issue, sibling, client, options);
		case "grilling":
			return handleWorkGrilling(issue, sibling, client, options);
		case "research":
			return handleWorkResearch(issue, sibling, client, options);
		case "prototype":
			return handleWorkPrototype(issue, sibling, client, options);
		case "task":
			return handleWorkTask(issue, sibling, client, options);
		case "delivery":
			return handleWorkDelivery(issue, sibling, client, options);
		default:
			return handleWorkOther(issue, sibling, client, options);
	}
}
