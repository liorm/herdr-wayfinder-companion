import type { Issue } from "../github/issues.ts";
import { herdrErrorMessage, type HerdrCall } from "../herdr.ts";
import type { SiblingAgent } from "../sibling.ts";
import { ticketKind } from "./board.ts";

export interface WorkResult {
  ok: boolean;
  message: string;
}

export async function handleWorkMap(
  issue: Issue,
  sibling: SiblingAgent,
  client: (args: string[]) => Promise<HerdrCall>,
): Promise<WorkResult> {
  const target = sibling.paneId ?? sibling.agent;
  if (!target) {
    return { ok: false, message: "No sibling agent target found" };
  }

  const clearCall = await client(["agent", "prompt", target, "/clear"]);
  if (!clearCall.ok) {
    return { ok: false, message: `Failed to clear session: ${herdrErrorMessage(clearCall)}` };
  }

  const modelCall = await client(["agent", "prompt", target, "/model Grok 4.7 medium"]);
  if (!modelCall.ok) {
    return { ok: false, message: `Failed to set model: ${herdrErrorMessage(modelCall)}` };
  }

  const promptCall = await client(["agent", "prompt", target, `/wayfinder ${issue.number}`]);
  if (!promptCall.ok) {
    return { ok: false, message: `Failed to start wayfinder: ${herdrErrorMessage(promptCall)}` };
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
): Promise<WorkResult> {
  return { ok: false, message: "Work for grilling tickets is not implemented yet" };
}

export async function handleWorkResearch(
  _issue: Issue,
  _sibling: SiblingAgent,
  _client: (args: string[]) => Promise<HerdrCall>,
): Promise<WorkResult> {
  return { ok: false, message: "Work for research tickets is not implemented yet" };
}

export async function handleWorkPrototype(
  _issue: Issue,
  _sibling: SiblingAgent,
  _client: (args: string[]) => Promise<HerdrCall>,
): Promise<WorkResult> {
  return { ok: false, message: "Work for prototype tickets is not implemented yet" };
}

export async function handleWorkTask(
  _issue: Issue,
  _sibling: SiblingAgent,
  _client: (args: string[]) => Promise<HerdrCall>,
): Promise<WorkResult> {
  return { ok: false, message: "Work for task tickets is not implemented yet" };
}

export async function handleWorkDelivery(
  _issue: Issue,
  _sibling: SiblingAgent,
  _client: (args: string[]) => Promise<HerdrCall>,
): Promise<WorkResult> {
  return { ok: false, message: "Work for delivery tickets is not implemented yet" };
}

export async function handleWorkOther(
  _issue: Issue,
  _sibling: SiblingAgent,
  _client: (args: string[]) => Promise<HerdrCall>,
): Promise<WorkResult> {
  return { ok: false, message: "Work for other tickets is not implemented yet" };
}

export async function dispatchWork(
  issue: Issue,
  sibling: SiblingAgent,
  client: (args: string[]) => Promise<HerdrCall>,
): Promise<WorkResult> {
  if (sibling.status !== "idle") {
    const status = sibling.status ? `(${sibling.status})` : "(unavailable)";
    return { ok: false, message: `Agent is not idle ${status}` };
  }

  const kind = ticketKind(issue.labels);
  switch (kind) {
    case "map":
      return handleWorkMap(issue, sibling, client);
    case "grilling":
      return handleWorkGrilling(issue, sibling, client);
    case "research":
      return handleWorkResearch(issue, sibling, client);
    case "prototype":
      return handleWorkPrototype(issue, sibling, client);
    case "task":
      return handleWorkTask(issue, sibling, client);
    case "delivery":
      return handleWorkDelivery(issue, sibling, client);
    case "other":
    default:
      return handleWorkOther(issue, sibling, client);
  }
}
