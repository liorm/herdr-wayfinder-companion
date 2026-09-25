export const PLUGIN_ID = "wayfinder.companion";

export interface PluginContext {
  workspaceId?: string;
  workspaceLabel?: string;
  tabId?: string;
  tabLabel?: string;
  paneId?: string;
  focusedPaneAgent?: string;
  focusedPaneStatus?: string;
  focusedPaneCwd?: string;
  workspaceCwd?: string;
  selectedText?: string;
  clickedUrl?: string;
  linkHandlerId?: string;
  invocationSource?: string;
  raw: Record<string, unknown>;
}

export interface PluginRuntime {
  pluginId: string;
  root?: string;
  configDir?: string;
  stateDir?: string;
  binPath: string;
  socketPath?: string;
  workspaceId?: string;
  tabId?: string;
  paneId?: string;
  actionId?: string;
  event?: string;
  entrypointId?: string;
  context: PluginContext;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function envString(name: string): string | undefined {
  return optionalString(process.env[name]);
}

export function parseContext(raw: string | undefined): PluginContext {
  if (!raw) return { raw: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { raw: {} };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { raw: {} };
  }

  const record = parsed as Record<string, unknown>;
  return {
    workspaceId: optionalString(record.workspace_id),
    workspaceLabel: optionalString(record.workspace_label),
    tabId: optionalString(record.tab_id),
    tabLabel: optionalString(record.tab_label),
    paneId: optionalString(record.pane_id) ?? optionalString(record.focused_pane_id),
    focusedPaneAgent: optionalString(record.focused_pane_agent) ?? optionalString(record.agent),
    focusedPaneStatus:
      optionalString(record.focused_pane_status) ?? optionalString(record.agent_status),
    focusedPaneCwd: optionalString(record.focused_pane_cwd),
    workspaceCwd: optionalString(record.workspace_cwd),
    selectedText: optionalString(record.selected_text),
    clickedUrl: optionalString(record.clicked_url) ?? envString("HERDR_PLUGIN_CLICKED_URL"),
    linkHandlerId:
      optionalString(record.link_handler_id) ?? envString("HERDR_PLUGIN_LINK_HANDLER_ID"),
    invocationSource: optionalString(record.invocation_source),
    raw: record,
  };
}

export function repoDirectory(context: PluginContext): string | undefined {
  return context.focusedPaneCwd ?? context.workspaceCwd;
}

export function readRuntime(): PluginRuntime {
  return {
    pluginId: envString("HERDR_PLUGIN_ID") ?? PLUGIN_ID,
    root: envString("HERDR_PLUGIN_ROOT"),
    configDir: envString("HERDR_PLUGIN_CONFIG_DIR"),
    stateDir: envString("HERDR_PLUGIN_STATE_DIR"),
    binPath: envString("HERDR_BIN_PATH") ?? "herdr",
    socketPath: envString("HERDR_SOCKET_PATH"),
    workspaceId: envString("HERDR_WORKSPACE_ID"),
    tabId: envString("HERDR_TAB_ID"),
    paneId: envString("HERDR_PANE_ID"),
    actionId: envString("HERDR_PLUGIN_ACTION_ID"),
    event: envString("HERDR_PLUGIN_EVENT"),
    entrypointId: envString("HERDR_PLUGIN_ENTRYPOINT_ID"),
    context: parseContext(process.env.HERDR_PLUGIN_CONTEXT_JSON),
  };
}
