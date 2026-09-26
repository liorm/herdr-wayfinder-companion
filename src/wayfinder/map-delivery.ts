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
import { parentMapNumber, sortChildren, ticketKind } from "./board.ts";
import {
  runDeliveryWorkflow,
  type DeliveryState,
} from "./delivery.ts";
import type { ModelResolutionOptions } from "./models.ts";

export type MapDeliveryStepStatus = "pending" | "running" | "completed" | "failed";

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
    (issue) => issue.number !== mapIssue.number && parentMapNumber(issue.body) === mapIssue.number,
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
 * 1. Runs delivery workflow for the subticket (shares exact delivery work code).
 * 2. Squashes the created PR via GitHub CLI.
 * 3. Waits until the ticket is confirmed closed on GitHub before moving to next.
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

  for (let i = 0; i < state.steps.length; i++) {
    const step = state.steps[i]!;
    if (step.status === "completed") {
      continue;
    }

    state.steps = state.steps.map((s, idx) =>
      idx === i ? { ...s, status: "running" } : s,
    );
    update({
      currentStepIndex: i,
      currentIssue: step.issue,
      agentMessage: `Starting delivery for #${step.issue.number}...`,
    });

    const deliveryResult = await runDeliveryWorkflow({
      cwd,
      issue: step.issue,
      sibling,
      client,
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
        state.steps = state.steps.map((s, idx) =>
          idx === i ? { ...s, deliveryState: dState } : s,
        );
        update({
          modifiedFiles: dState.modifiedFiles,
          agentMessage: dState.agentMessage,
        });
      },
    });

    if (deliveryResult.error || !deliveryResult.pr) {
      const errorMsg =
        deliveryResult.error ??
        `Delivery workflow failed for ticket #${step.issue.number}`;
      state.steps = state.steps.map((s, idx) =>
        idx === i ? { ...s, status: "failed", error: errorMsg, deliveryState: deliveryResult } : s,
      );
      update({
        error: errorMsg,
        isFinished: true,
        currentStepIndex: undefined,
        currentIssue: undefined,
      });
      return state;
    }

    const pr = deliveryResult.pr;
    state.steps = state.steps.map((s, idx) =>
      idx === i ? { ...s, pr, deliveryState: deliveryResult } : s,
    );

    // Squash PR
    update({
      agentMessage: `Squashing PR #${pr.number} for ticket #${step.issue.number}...`,
    });
    const squashResult = await squashPullRequest(cwd, pr.number, runGh);
    if (!squashResult.ok) {
      const errorMsg =
        squashResult.error ??
        `Failed to squash PR #${pr.number} for ticket #${step.issue.number}`;
      state.steps = state.steps.map((s, idx) =>
        idx === i ? { ...s, status: "failed", error: errorMsg } : s,
      );
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
      agentMessage: `Waiting for ticket #${step.issue.number} to be closed on GitHub...`,
    });
    const closed = await waitForTicketClosed(
      cwd,
      step.issue.number,
      runGh,
      closeMaxWaitMs,
      pollIntervalMs,
      () => {
        update({
          agentMessage: `Waiting for ticket #${step.issue.number} to be closed on GitHub...`,
        });
      },
    );

    if (!closed) {
      const errorMsg = `Ticket #${step.issue.number} was not closed on GitHub after squashing PR #${pr.number}`;
      state.steps = state.steps.map((s, idx) =>
        idx === i ? { ...s, status: "failed", error: errorMsg } : s,
      );
      update({
        error: errorMsg,
        isFinished: true,
        currentStepIndex: undefined,
        currentIssue: undefined,
      });
      return state;
    }

    // Step completed!
    state.steps = state.steps.map((s, idx) =>
      idx === i ? { ...s, status: "completed", error: undefined } : s,
    );
    update({
      agentMessage: `Ticket #${step.issue.number} squashed and closed.`,
      modifiedFiles: [],
    });
  }

  update({
    isFinished: true,
    currentStepIndex: undefined,
    currentIssue: undefined,
    agentMessage: undefined,
    modifiedFiles: [],
  });

  return state;
}
