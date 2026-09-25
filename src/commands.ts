import { PLUGIN_ID, readRuntime, repoDirectory, type PluginRuntime } from "./runtime.ts";
import { createClient, type HerdrCall } from "./herdr.ts";
import { runIssuePane } from "./ui/issues.ts";

export interface StatusReport {
  pluginId: string;
  actionId?: string;
  entrypointId?: string;
  workspaceId?: string;
  tabId?: string;
  paneId?: string;
  context: PluginRuntime["context"];
  calls: {
    workspaceList: HerdrCall;
    agentList: HerdrCall;
  };
}

export async function collectStatus(runtime: PluginRuntime = readRuntime()): Promise<StatusReport> {
  const herdr = createClient(runtime.binPath);
  const [workspaceList, agentList] = await Promise.all([
    herdr(["workspace", "list"]),
    herdr(["agent", "list"]),
  ]);

  return {
    pluginId: runtime.pluginId,
    actionId: runtime.actionId,
    entrypointId: runtime.entrypointId,
    workspaceId: runtime.workspaceId ?? runtime.context.workspaceId,
    tabId: runtime.tabId ?? runtime.context.tabId,
    paneId: runtime.paneId ?? runtime.context.paneId,
    context: runtime.context,
    calls: { workspaceList, agentList },
  };
}

export async function status(): Promise<number> {
  const report = await collectStatus();
  console.log(JSON.stringify(report, null, 2));
  const failed = !report.calls.workspaceList.ok || !report.calls.agentList.ok;
  return failed ? 1 : 0;
}

export async function open(): Promise<number> {
  const runtime = readRuntime();
  const herdr = createClient(runtime.binPath);
  const call = await herdr([
    "plugin",
    "pane",
    "open",
    "--plugin",
    runtime.pluginId,
    "--entrypoint",
    "board",
    "--placement",
    "split",
    "--direction",
    "right",
    "--focus",
  ]);
  if (!call.ok) {
    console.error(call.stderr.trim() || call.stdout.trim() || `herdr exited ${call.status}`);
    return call.status || 1;
  }
  process.stdout.write(call.stdout);
  return 0;
}

export async function ui(): Promise<number> {
  const runtime = readRuntime();
  // Only the board entrypoint owns its pane. A test or shell that inherits
  // HERDR_PANE_ID from this session must not close that pane on quit.
  const paneId = runtime.entrypointId === "board" ? runtime.paneId : undefined;
  return runIssuePane(repoDirectory(runtime.context), {
    onClose: paneId
      ? async () => {
          await createClient(runtime.binPath)(["pane", "close", paneId]);
        }
      : undefined,
  });
}

export function help(): void {
  console.log(`Wayfinder Companion (${PLUGIN_ID})

Commands:
  status    Print session context and Herdr workspace/agent lists as JSON
  open      Open the GitHub issues pane for the current workspace
  ui        Render the issues pane (Herdr pane entrypoint)
`);
}
