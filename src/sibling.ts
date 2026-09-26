import { createClient, type HerdrCall } from "./herdr.ts";
import type { PluginRuntime } from "./runtime.ts";

export interface SiblingAgent {
  paneId?: string;
  agent?: string;
  status?: string;
  lastMessage?: string;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanTerminalTitle(title: string | undefined, agent?: string): string | undefined {
  if (!title) return undefined;
  let cleaned = title.trim();
  if (agent) {
    const suffixRegex = new RegExp(`\\s*[-–—|•·]\\s*${escapeRegex(agent)}$`, "i");
    cleaned = cleaned.replace(suffixRegex, "").trim();
  }
  // Strip braille spinner or symbol prefixes
  cleaned = cleaned.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏•◦■*›❯]\s*/, "").trim();
  if (!cleaned) return undefined;
  // Ignore bare shell command names
  if (/^(bash|zsh|sh|fish|tcsh|csh)$/i.test(cleaned)) return undefined;
  // Ignore shell prompts like user@host:~/dir
  if (/^\w+@[\w.-]+:.*[$#%]\s*$/i.test(cleaned)) return undefined;
  return cleaned;
}

export function extractAgentMessageFromOutput(output: string): string | undefined {
  if (!output) return undefined;
  const rawLines = output.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (const line of rawLines) {
    const strippedAnsi = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    const strippedBorder = strippedAnsi
      .replace(/^[\u2500-\u257f\u2580-\u259f│┃╭╰┌└─═\s]+/, "")
      .replace(/[\u2500-\u257f\u2580-\u259f│┃╭╰┌└─═\s]+$/, "")
      .trim();
    if (strippedBorder) {
      cleanedLines.push(strippedBorder);
    }
  }

  const noisePatterns = [
    /^(Shift\+|Ctrl\+|Alt\+|esc to|\[stop\])/i,
    /^[❯›$#%]\s*$/,
    /^(worked for|\d+[smh] elapsed)/i,
    /^◆?\s*(recap|summary):?\s*$/i,
    /(always-approve|shortcuts|context left)/i,
  ];

  const collected: string[] = [];
  for (let i = cleanedLines.length - 1; i >= 0; i--) {
    const l = cleanedLines[i];
    if (!l) continue;
    if (noisePatterns.some((pattern) => pattern.test(l))) {
      if (collected.length > 0) break;
      continue;
    }
    collected.unshift(l);
    if (collected.length >= 4) break;
  }

  if (collected.length === 0) return undefined;
  const combined = collected.join(" ").replace(/\s+/g, " ").trim();
  return combined || undefined;
}

interface RawPaneInfo {
  pane_id?: string;
  tab_id?: string;
  workspace_id?: string;
  agent?: string;
  agent_status?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  state_labels?: Record<string, string>;
  tokens?: Record<string, string>;
}

interface RawAgentInfo {
  pane_id?: string;
  agent?: string;
  agent_status?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  state_labels?: Record<string, string>;
  tokens?: Record<string, string>;
}

export async function resolveSiblingAgent(
  runtime: PluginRuntime,
  client?: (args: string[]) => Promise<HerdrCall>,
): Promise<SiblingAgent | undefined> {
  const herdr = client ?? createClient(runtime.binPath);

  let candidatePaneId: string | undefined;

  // 1. If runtime.paneId is known (e.g. running inside the board pane), query neighbor to the left
  if (runtime.paneId) {
    const neighborCall = await herdr(["pane", "neighbor", "--direction", "left", "--pane", runtime.paneId]);
    if (neighborCall.ok && neighborCall.json && typeof neighborCall.json === "object") {
      const res = (neighborCall.json as { result?: { neighbor?: { neighbor_pane_id?: string } } }).result;
      candidatePaneId = res?.neighbor?.neighbor_pane_id;
    }
  }

  // Fallback candidate from context if not set
  if (!candidatePaneId) {
    candidatePaneId = runtime.context.paneId ?? (runtime.context.raw.focused_pane_id as string | undefined);
  }

  // 2. Fetch pane list and agent list to discover or enrich the sibling pane
  const [paneListCall, agentListCall] = await Promise.all([
    herdr(["pane", "list"]),
    herdr(["agent", "list"]),
  ]);

  const panes: RawPaneInfo[] =
    paneListCall.ok && paneListCall.json && typeof paneListCall.json === "object"
      ? ((paneListCall.json as { result?: { panes?: RawPaneInfo[] } }).result?.panes ?? [])
      : [];

  const agents: RawAgentInfo[] =
    agentListCall.ok && agentListCall.json && typeof agentListCall.json === "object"
      ? ((agentListCall.json as { result?: { agents?: RawAgentInfo[] } }).result?.agents ?? [])
      : [];

  const currentTabId = runtime.tabId ?? runtime.context.tabId;

  // If candidatePaneId is the pane itself, clear it
  if (candidatePaneId && runtime.paneId && candidatePaneId === runtime.paneId) {
    candidatePaneId = undefined;
  }

  // If candidatePaneId is still not found, search panes in the same tab, preferring one with an agent
  if (!candidatePaneId && currentTabId) {
    const tabPanes = panes.filter((p) => p.tab_id === currentTabId && p.pane_id !== runtime.paneId);
    const withAgent = tabPanes.find((p) => Boolean(p.agent));
    candidatePaneId = withAgent?.pane_id ?? tabPanes[0]?.pane_id;
  }

  // If still not found, look for any agent in the same tab or workspace
  if (!candidatePaneId && currentTabId) {
    const matchingAgent = agents.find((a) => a.pane_id && a.pane_id !== runtime.paneId);
    candidatePaneId = matchingAgent?.pane_id;
  }

  let paneObj = panes.find((p) => p.pane_id === candidatePaneId);
  const agentObj = agents.find((a) => a.pane_id === candidatePaneId);

  // If pane not found in list but candidatePaneId is known, try pane get
  if (!paneObj && candidatePaneId) {
    const paneGetCall = await herdr(["pane", "get", candidatePaneId]);
    if (paneGetCall.ok && paneGetCall.json && typeof paneGetCall.json === "object") {
      paneObj = (paneGetCall.json as { result?: { pane?: RawPaneInfo } }).result?.pane;
    }
  }

  const agentName =
    paneObj?.agent ??
    agentObj?.agent ??
    runtime.context.focusedPaneAgent ??
    (runtime.context.raw.agent as string | undefined);

  const status =
    paneObj?.agent_status ??
    agentObj?.agent_status ??
    runtime.context.focusedPaneStatus ??
    (runtime.context.raw.agent_status as string | undefined);

  // Resolve last message
  const stateLabels = paneObj?.state_labels ?? agentObj?.state_labels;
  const tokens = paneObj?.tokens ?? agentObj?.tokens;

  let lastMessage: string | undefined;

  if (stateLabels) {
    lastMessage = stateLabels.message ?? stateLabels.last_message ?? (status ? stateLabels[status] : undefined);
  }
  if (!lastMessage && tokens) {
    lastMessage = tokens.message ?? tokens.last_message;
  }
  if (!lastMessage) {
    const explicitTitle = paneObj?.title ?? agentObj?.title;
    if (explicitTitle && explicitTitle.trim().length > 0) {
      lastMessage = explicitTitle.trim();
    }
  }
  if (!lastMessage) {
    const termTitle =
      paneObj?.terminal_title_stripped ??
      paneObj?.terminal_title ??
      agentObj?.terminal_title_stripped ??
      agentObj?.terminal_title;
    lastMessage = cleanTerminalTitle(termTitle, agentName);
  }

  // Fallback to reading the terminal buffer if candidatePaneId exists and no message was found yet
  if (!lastMessage && candidatePaneId) {
    const readCall = await herdr(["pane", "read", candidatePaneId, "--source", "recent-unwrapped", "--lines", "30"]);
    if (readCall.ok && readCall.stdout) {
      lastMessage = extractAgentMessageFromOutput(readCall.stdout);
    }
  }

  // Context raw fallback
  if (!lastMessage) {
    lastMessage =
      (runtime.context.raw.message as string | undefined) ??
      (runtime.context.raw.agent_message as string | undefined) ??
      (runtime.context.raw.last_message as string | undefined);
  }

  if (!candidatePaneId && !agentName && !status && !lastMessage) {
    return undefined;
  }

  return {
    paneId: candidatePaneId,
    agent: agentName,
    status,
    lastMessage,
  };
}
