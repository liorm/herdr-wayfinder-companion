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

export function createInitialDeliverySteps(issue: Issue, branchName: string): DeliveryStep[] {
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
      title: "Set model to low effort (/model Grok 4.7 low)",
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
    steps: createInitialDeliverySteps(issue, branchName),
    modifiedFiles: [],
  };
}

export interface DeliveryWorkflowOptions {
  cwd: string;
  issue: Issue;
  sibling: SiblingAgent;
  client: (args: string[]) => Promise<HerdrCall>;
  runGit?: GitRunner;
  runGh?: GhRunner;
  onUpdate?: (state: DeliveryState) => void;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export async function checkAgentSettled(
  target: string,
  client: (args: string[]) => Promise<HerdrCall>,
  maxWaitMs = 15000,
  pollIntervalMs = 500,
  onPoll?: (status: string | undefined, message: string | undefined) => void,
): Promise<{ ok: boolean; status?: string; message?: string }> {
  const start = Date.now();
  let seenWorking = false;

  while (Date.now() - start < maxWaitMs) {
    const res = await client(["agent", "get", target]);
    if (res.ok && res.json && typeof res.json === "object") {
      const agentInfo = (res.json as { result?: { agent?: { agent_status?: string; title?: string } } }).result?.agent;
      const status = agentInfo?.agent_status;
      const message = agentInfo?.title;
      if (onPoll) {
        onPoll(status, message);
      }

      if (status === "working") {
        seenWorking = true;
      }

      if (status === "idle" || status === "done") {
        return { ok: true, status, message };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { ok: seenWorking, status: "idle" };
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
  const clearCall = await client(["agent", "prompt", target, "/clear"]);
  if (!clearCall.ok) {
    const errorMsg = `Failed to clear session: ${herdrErrorMessage(clearCall)}`;
    setStepStatus("clear", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }
  await checkAgentSettled(target, client, 5000, 300);
  setStepStatus("clear", "completed");

  // --- Step 3: Set agent model to low effort ---
  setStepStatus("model", "running");
  const modelCall = await client(["agent", "prompt", target, "/model Grok 4.7 low"]);
  if (!modelCall.ok) {
    const errorMsg = `Failed to set model: ${herdrErrorMessage(modelCall)}`;
    setStepStatus("model", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }
  await checkAgentSettled(target, client, 5000, 300);
  setStepStatus("model", "completed");

  // --- Step 4: Implement ticket ---
  setStepStatus("implement", "running");
  const implementPrompt = `/implement ${issue.number}, ask no questions`;
  const implementCall = await client(["agent", "prompt", target, implementPrompt]);
  if (!implementCall.ok) {
    const errorMsg = `Failed to send implement prompt: ${herdrErrorMessage(implementCall)}`;
    setStepStatus("implement", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  // Poll for implementation progress
  let implementFinished = false;
  const startImplementTime = Date.now();
  const maxImplementTimeMs = 300_000; // 5 min timeout

  while (!implementFinished && Date.now() - startImplementTime < maxImplementTimeMs) {
    // 1. Check modified files
    const files = await getModifiedFiles(cwd, runGit);
    update({ modifiedFiles: files });

    // 2. Check agent status
    const agentCall = await client(["agent", "get", target]);
    if (agentCall.ok && agentCall.json && typeof agentCall.json === "object") {
      const agentObj = (agentCall.json as { result?: { agent?: { agent_status?: string; title?: string } } }).result?.agent;
      const status = agentObj?.agent_status;
      const message = agentObj?.title;
      update({ agentMessage: message });

      if (status === "idle" || status === "done") {
        // Double-check if agent stayed idle
        implementFinished = true;
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Final modified files fetch
  const finalFiles = await getModifiedFiles(cwd, runGit);
  update({ modifiedFiles: finalFiles });
  setStepStatus("implement", "completed");

  // --- Step 5: Create PR ---
  setStepStatus("pr", "running");
  const prPrompt = `/commit-push-pr ticket ${issue.number}`;
  const prCall = await client(["agent", "prompt", target, prPrompt]);
  if (!prCall.ok) {
    const errorMsg = `Failed to send commit-push-pr prompt: ${herdrErrorMessage(prCall)}`;
    setStepStatus("pr", "failed", errorMsg);
    update({ error: errorMsg, isFinished: true });
    return state;
  }

  // Poll for PR completion
  let prFinished = false;
  const startPrTime = Date.now();
  const maxPrTimeMs = 180_000; // 3 min timeout

  while (!prFinished && Date.now() - startPrTime < maxPrTimeMs) {
    const agentCall = await client(["agent", "get", target]);
    if (agentCall.ok && agentCall.json && typeof agentCall.json === "object") {
      const agentObj = (agentCall.json as { result?: { agent?: { agent_status?: string; title?: string } } }).result?.agent;
      const status = agentObj?.agent_status;
      const message = agentObj?.title;
      update({ agentMessage: message });

      if (status === "idle" || status === "done") {
        prFinished = true;
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
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
