import { createClient, type HerdrCall } from "./herdr.ts";
import type { PluginRuntime } from "./runtime.ts";

export interface SiblingAgent {
  paneId?: string;
  agent?: string;
  status?: string;
  lastMessage?: string;
  cwd?: string;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanTerminalTitle(title: string | undefined, agent?: string): string | undefined {
  if (!title) return undefined;
  let cleaned = title.trim();
  if (agent) {
    if (cleaned.toLowerCase() === agent.toLowerCase()) {
      return undefined;
    }
    const suffixRegex = new RegExp(`\\s*[-–—|•·]\\s*${escapeRegex(agent)}$`, "i");
    cleaned = cleaned.replace(suffixRegex, "").trim();
  }
  // Strip braille spinner or symbol prefixes
  cleaned = cleaned.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏•◦■*›❯]\s*/, "").trim();
  if (!cleaned) return undefined;
  if (agent && cleaned.toLowerCase() === agent.toLowerCase()) return undefined;
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
  cwd?: string;
  foreground_cwd?: string;
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
  cwd?: string;
  foreground_cwd?: string;
}

export async function resolveSiblingAgent(
  runtime: PluginRuntime,
  client?: (args: string[]) => Promise<HerdrCall>,
): Promise<SiblingAgent | undefined> {
  const herdr = client ?? createClient(runtime.binPath);

  // 1. Fetch pane list and agent list to discover panes and agents
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
  const selfPaneId = runtime.paneId;

  // Filter panes in the current tab, excluding the board pane itself
  const tabPanes = currentTabId
    ? panes.filter((p) => p.tab_id === currentTabId && p.pane_id !== selfPaneId)
    : panes.filter((p) => p.pane_id !== selfPaneId);

  let candidatePaneId: string | undefined;
  let candidateAgentName: string | undefined;

  // 2. Identify the first agent in the current tab (regardless of pane location)
  for (const pane of tabPanes) {
    const matchingAgent = agents.find((a) => a.pane_id && a.pane_id === pane.pane_id);
    const agentName = pane.agent ?? matchingAgent?.agent;
    if (agentName || matchingAgent || pane.agent_status) {
      candidatePaneId = pane.pane_id;
      candidateAgentName = agentName;
      break;
    }
  }

  // 3. If not found, check agent list for any agent matching the tab
  if (!candidatePaneId && currentTabId) {
    const matchingAgent = agents.find((a) => {
      if (!a.pane_id || a.pane_id === selfPaneId) return false;
      const pane = panes.find((p) => p.pane_id === a.pane_id);
      return pane?.tab_id === currentTabId;
    });
    if (matchingAgent?.pane_id) {
      candidatePaneId = matchingAgent.pane_id;
      candidateAgentName = matchingAgent.agent;
    }
  }

  // 4. If still not found, check context for focusedPaneAgent
  if (!candidatePaneId && runtime.context.focusedPaneAgent) {
    candidatePaneId = runtime.context.paneId ?? (runtime.context.raw.focused_pane_id as string | undefined);
    candidateAgentName = runtime.context.focusedPaneAgent;
  }

  // 5. If still not found, check neighbor to the left (if self pane is known)
  if (!candidatePaneId && selfPaneId) {
    const neighborCall = await herdr(["pane", "neighbor", "--direction", "left", "--pane", selfPaneId]);
    if (neighborCall.ok && neighborCall.json && typeof neighborCall.json === "object") {
      const res = (neighborCall.json as { result?: { neighbor?: { neighbor_pane_id?: string } } }).result;
      if (res?.neighbor?.neighbor_pane_id && res.neighbor.neighbor_pane_id !== selfPaneId) {
        candidatePaneId = res.neighbor.neighbor_pane_id;
      }
    }
  }

  // 6. Fallback to first non-self pane in current tab
  if (!candidatePaneId && tabPanes.length > 0) {
    candidatePaneId = tabPanes[0]?.pane_id;
  }

  if (candidatePaneId && selfPaneId && candidatePaneId === selfPaneId) {
    candidatePaneId = undefined;
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
    candidateAgentName ??
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
    lastMessage = cleanTerminalTitle(explicitTitle, agentName);
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

  // Resolve cwd
  const cwd =
    paneObj?.foreground_cwd ??
    paneObj?.cwd ??
    agentObj?.foreground_cwd ??
    agentObj?.cwd ??
    runtime.context.focusedPaneCwd ??
    runtime.context.workspaceCwd;

  return {
    paneId: candidatePaneId,
    agent: agentName,
    status,
    lastMessage,
    cwd,
  };
}

export async function findAgentPaneInCurrentTab(
  runtime: PluginRuntime,
  client?: (args: string[]) => Promise<HerdrCall>,
): Promise<string | undefined> {
  const sibling = await resolveSiblingAgent(runtime, client);
  return sibling?.paneId;
}
