import type { Issue } from "../github/issues.ts";
import { defaultGh, type GhRunner } from "../github/issues.ts";
import {
  findTicketPR,
  formatTicketBranch,
  getModifiedFiles,
  prepareDeliveryBranch,
  type GitRunner,
  type ModifiedFile,
  type PRInfo,
} from "../git.ts";
import { herdrErrorMessage, type HerdrCall } from "../herdr.ts";
import type { SiblingAgent } from "../sibling.ts";
import { getModelForTicketKind, type ModelResolutionOptions } from "./models.ts";

export type DeliveryStepStatus = "pending" | "running" | "completed" | "failed";

export interface DeliveryStep {
  id: "branch" | "clear" | "model" | "implement" | "pr";
  title: string;
  status: DeliveryStepStatus;
  error?: string;
}

export interface DeliveryState {
  issue: Issue;
  branchName: string;
  isStarted: boolean;
  isFinished: boolean;
  alreadyDelivered: boolean;
  existingPR?: PRInfo;
  steps: DeliveryStep[];
  currentStepId?: string;
  modifiedFiles: ModifiedFile[];
  agentMessage?: string;
  pr?: PRInfo;
  error?: string;
}

export interface DeliveryStepOptions extends ModelResolutionOptions {
  model?: string;
}

export function createInitialDeliverySteps(
  issue: Issue,
  branchName: string,
  options?: DeliveryStepOptions,
): DeliveryStep[] {
  const model = options?.model ?? getModelForTicketKind("delivery", options);
  return [
    {
      id: "branch",
      title: `Switch to branch ${branchName} (from main)`,
      status: "pending",
    },
    {
      id: "clear",
      title: "Clear agent session (/clear)",
      status: "pending",
    },
    {
      id: "model",
      title: `Set model to low effort (/model ${model})`,
      status: "pending",
    },
    {
      id: "implement",
      title: `Implement ticket (/implement ${issue.number}, ask no questions)`,
      status: "pending",
    },
    {
      id: "pr",
      title: `Create PR (/commit-push-pr ticket ${issue.number})`,
      status: "pending",
    },
  ];
}

export function createInitialDeliveryState(
  issue: Issue,
  existingPR?: PRInfo | null,
  options?: DeliveryStepOptions,
): DeliveryState {
  const branchName = formatTicketBranch(issue.number, issue.title);
  const alreadyDelivered = existingPR !== null && existingPR !== undefined;

  return {
    issue,
    branchName,
    isStarted: false,
    isFinished: alreadyDelivered,
    alreadyDelivered,
    existingPR: existingPR ?? undefined,
    steps: createInitialDeliverySteps(issue, branchName, options),
    modifiedFiles: [],
  };
}

export interface DeliveryWorkflowOptions extends ModelResolutionOptions {
  cwd: string;
  issue: Issue;
  sibling: SiblingAgent;
  client: (args: string[]) => Promise<HerdrCall>;
  model?: string;
  runGit?: GitRunner;
  runGh?: GhRunner;
  onUpdate?: (state: DeliveryState) => void;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  startupGraceMs?: number;
}

export async function waitForAgentIdle(
  target: string,
  client: (args: string[]) => Promise<HerdrCall>,
  maxWaitMs?: number,
  pollIntervalMs = 500,
  onPoll?: (status: string | undefined, message: string | undefined) => void | Promise<void>,
): Promise<{ ok: boolean; status?: string; message?: string; error?: string }> {
  const start = Date.now();
  let lastStatus: string | undefined;
  let lastMessage: string | undefined;

  while (maxWaitMs === undefined || Date.now() - start < maxWaitMs) {
    const res = await client(["agent", "get", target]);
    if (res.ok && res.json && typeof res.json === "object") {
      const agentInfo = (res.json as { result?: { agent?: { agent_status?: string; title?: string } } }).result?.agent;
      const status = agentInfo?.agent_status;
      const message = agentInfo?.title;
      lastStatus = status;
      lastMessage = message;

      if (onPoll) {
        await onPoll(status, message);
      }

      if (status === "idle" || status === "done") {
        return { ok: true, status, message };
      }

      if (status === "blocked") {
        return {
          ok: false,
          status,
          message,
          error: `Agent is blocked${message ? `: ${message}` : ""}`,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    ok: false,
    status: lastStatus ?? "unknown",
    message: lastMessage,
    error: `Agent is busy (${lastStatus ?? "unknown"})`,
  };
}

export async function checkAgentSettled(
  target: string,
  client: (args: string[]) => Promise<HerdrCall>,
  maxWaitMs?: number,
  pollIntervalMs = 500,
  onPoll?: (status: string | undefined, message: string | undefined) => void | Promise<void>,
  startupGraceMs?: number,
): Promise<{ ok: boolean; status?: string; message?: string; error?: string }> {
  const start = Date.now();
  let seenWorking = false;
  let lastStatus: string | undefined;
  let lastMessage: string | undefined;
  const effectiveGraceMs =
    startupGraceMs ?? Math.min(1500, Math.max(pollIntervalMs * 2, 20));

  while (maxWaitMs === undefined || Date.now() - start < maxWaitMs) {
    const res = await client(["agent", "get", target]);
    if (res.ok && res.json && typeof res.json === "object") {
      const agentInfo = (res.json as { result?: { agent?: { agent_status?: string; title?: string } } }).result?.agent;
      const status = agentInfo?.agent_status;
      const message = agentInfo?.title;
      lastStatus = status;
      lastMessage = message;

      if (onPoll) {
        await onPoll(status, message);
      }

      if (status === "blocked") {
        return {
          ok: false,
          status,
          message,
          error: `Agent is blocked${message ? `: ${message}` : ""}`,
        };
      }

      if (status === "working") {
        seenWorking = true;
      }

      if (seenWorking) {
        if (status === "idle" || status === "done") {
          return { ok: true, status, message };
        }
      } else {
        if (Date.now() - start >= effectiveGraceMs) {
          if (status === "idle" || status === "done") {
            return { ok: true, status, message };
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (lastStatus === "idle" || lastStatus === "done") {
    return { ok: true, status: lastStatus, message: lastMessage };
  }

  return {
    ok: false,
    status: lastStatus ?? "unknown",
    message: lastMessage,
    error: `Timed out waiting for agent (status: ${lastStatus ?? "unknown"})`,
  };
}

export async function runDeliveryWorkflow(
  options: DeliveryWorkflowOptions,
): Promise<DeliveryState> {
  const {
    cwd,
    issue,
    sibling,
    client,
    runGit,
    runGh = defaultGh,
    onUpdate,
    pollIntervalMs = 500,
    startupGraceMs,
  } = options;

  const target = sibling.paneId ?? sibling.agent;
  const branchName = formatTicketBranch(issue.number, issue.title);

  let state: DeliveryState = {
    issue,
    branchName,
    isStarted: true,
    isFinished: false,
    alreadyDelivered: false,
    steps: createInitialDeliverySteps(issue, branchName),
    modifiedFiles: [],
  };

  const update = (patch: Partial<DeliveryState>) => {
    state = { ...state, ...patch };
    onUpdate?.(state);
  };

  const setStepStatus = (
    stepId: DeliveryStep["id"],
    status: DeliveryStepStatus,
    error?: string,
  ) => {
    const nextSteps = state.steps.map((step) =>
      step.id === stepId ? { ...step, status, error } : step,
    );
    update({
      steps: nextSteps,
      currentStepId: status === "running" ? stepId : state.currentStepId,
    });
  };

  if (!target) {
    update({ error: "No sibling agent target found", isFinished: true });
    return state;
  }

  // --- Step 1: Create & switch to branch from main ---
  setStepStatus("branch", "running");
  const branchResult = await prepareDeliveryBranch(cwd, branchName, runGit);
  if (!branchResult.ok) {
    const errorMsg = branchResult.error ?? "Failed to prepare delivery branch";
    setStepStatus("branch", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }
  setStepStatus("branch", "completed");

  // --- Step 2: Clear agent session ---
  setStepStatus("clear", "running");
  const idleBeforeClear = await waitForAgentIdle(target, client, options.maxWaitMs, pollIntervalMs);
  if (!idleBeforeClear.ok) {
    const errorMsg = `Agent is not idle before clear: ${idleBeforeClear.error ?? "busy"}`;
    setStepStatus("clear", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  const clearCall = await client(["agent", "prompt", target, "/clear"]);
  if (!clearCall.ok) {
    const errorMsg = `Failed to clear session: ${herdrErrorMessage(clearCall)}`;
    setStepStatus("clear", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }
  const clearWait = await checkAgentSettled(target, client, options.maxWaitMs, pollIntervalMs, undefined, startupGraceMs);
  if (!clearWait.ok) {
    const errorMsg = clearWait.error ?? "Failed waiting for session clear to complete";
    setStepStatus("clear", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }
  setStepStatus("clear", "completed");

  // --- Step 3: Set agent model to low effort ---
  setStepStatus("model", "running");
  const idleBeforeModel = await waitForAgentIdle(target, client, options.maxWaitMs, pollIntervalMs);
  if (!idleBeforeModel.ok) {
    const errorMsg = `Agent is not idle before setting model: ${idleBeforeModel.error ?? "busy"}`;
    setStepStatus("model", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  const model =
    options.model ??
    getModelForTicketKind("delivery", { ...options, agent: options.agent ?? options.sibling.agent });
  const modelCall = await client(["agent", "prompt", target, `/model ${model}`]);
  if (!modelCall.ok) {
    const errorMsg = `Failed to set model: ${herdrErrorMessage(modelCall)}`;
    setStepStatus("model", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }
  const modelWait = await checkAgentSettled(target, client, options.maxWaitMs, pollIntervalMs, undefined, startupGraceMs);
  if (!modelWait.ok) {
    const errorMsg = modelWait.error ?? "Failed waiting for model change to complete";
    setStepStatus("model", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }
  setStepStatus("model", "completed");

  // --- Step 4: Implement ticket ---
  setStepStatus("implement", "running");
  const idleBeforeImplement = await waitForAgentIdle(target, client, options.maxWaitMs, pollIntervalMs);
  if (!idleBeforeImplement.ok) {
    const errorMsg = `Agent is not idle before implementation: ${idleBeforeImplement.error ?? "busy"}`;
    setStepStatus("implement", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  const implementPrompt = `/implement ${issue.number}, ask no questions`;
  const implementCall = await client(["agent", "prompt", target, implementPrompt]);
  if (!implementCall.ok) {
    const errorMsg = `Failed to send implement prompt: ${herdrErrorMessage(implementCall)}`;
    setStepStatus("implement", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  // Poll for implementation progress until agent completes and settles to idle
  const implementWait = await checkAgentSettled(
    target,
    client,
    options.maxWaitMs,
    pollIntervalMs,
    async (_status, message) => {
      const files = await getModifiedFiles(cwd, runGit);
      update({ modifiedFiles: files, agentMessage: message });
    },
    startupGraceMs,
  );

  if (!implementWait.ok) {
    const errorMsg = implementWait.error ?? "Failed waiting for implementation to complete";
    setStepStatus("implement", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  // Final modified files fetch
  const finalFiles = await getModifiedFiles(cwd, runGit);
  update({ modifiedFiles: finalFiles });
  setStepStatus("implement", "completed");

  // --- Step 5: Create PR (only after implement is done and agent is idle) ---
  setStepStatus("pr", "running");
  const idleBeforePR = await waitForAgentIdle(target, client, options.maxWaitMs, pollIntervalMs);
  if (!idleBeforePR.ok) {
    const errorMsg = `Agent is not idle before PR creation: ${idleBeforePR.error ?? "busy"}`;
    setStepStatus("pr", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  const prPrompt = `/commit-push-pr ticket ${issue.number}`;
  const prCall = await client(["agent", "prompt", target, prPrompt]);
  if (!prCall.ok) {
    const errorMsg = `Failed to send commit-push-pr prompt: ${herdrErrorMessage(prCall)}`;
    setStepStatus("pr", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  // Poll for PR completion
  const prWait = await checkAgentSettled(
    target,
    client,
    options.maxWaitMs,
    pollIntervalMs,
    (_status, message) => {
      update({ agentMessage: message });
    },
    startupGraceMs,
  );

  if (!prWait.ok) {
    const errorMsg = prWait.error ?? "Failed waiting for PR creation to complete";
    setStepStatus("pr", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  // Fetch created PR
  const createdPR = await findTicketPR(cwd, issue.number, branchName, runGh);
  setStepStatus("pr", "completed");

  update({
    isFinished: true,
    pr: createdPR ?? {
      number: 0,
      title: `PR for #${issue.number}`,
      url: `https://github.com/pulls`,
      state: "open",
    },
    currentStepId: undefined,
  });

  return state;
}
