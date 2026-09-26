import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { HerdrCall } from "./herdr.ts";
import type { PluginRuntime } from "./runtime.ts";

export interface WorkspaceInstance {
  paneId: string;
  siblingPaneId?: string;
  siblingAgent?: string;
  pid?: number;
  updatedAt: string;
}

export type WorkspaceInstancesMap = Record<string, WorkspaceInstance>;

export function getInstancesFilePath(stateDir?: string): string {
  const dir =
    stateDir && stateDir.trim().length > 0
      ? stateDir
      : process.env.XDG_STATE_HOME
      ? path.join(process.env.XDG_STATE_HOME, "wayfinder-companion")
      : path.join(os.homedir(), ".local", "state", "wayfinder-companion");
  return path.join(dir, "instances.json");
}

export function readWorkspaceInstances(stateDir?: string): WorkspaceInstancesMap {
  try {
    const file = getInstancesFilePath(stateDir);
    if (!fs.existsSync(file)) return {};
    const content = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(content) as WorkspaceInstancesMap;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function registerWorkspacePane(
  workspaceId: string,
  paneId: string,
  stateDir?: string,
  extra?: { siblingPaneId?: string; siblingAgent?: string },
): void {
  try {
    const file = getInstancesFilePath(stateDir);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const instances = readWorkspaceInstances(stateDir);
    const prev = instances[workspaceId];
    instances[workspaceId] = {
      paneId,
      siblingPaneId: extra?.siblingPaneId ?? prev?.siblingPaneId,
      siblingAgent: extra?.siblingAgent ?? prev?.siblingAgent,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(instances, null, 2), "utf-8");
  } catch {
    // Best-effort
  }
}

export function unregisterWorkspacePane(
  workspaceId: string,
  paneId?: string,
  stateDir?: string,
): void {
  try {
    const instances = readWorkspaceInstances(stateDir);
    const current = instances[workspaceId];
    if (current && (!paneId || current.paneId === paneId)) {
      delete instances[workspaceId];
      const file = getInstancesFilePath(stateDir);
      fs.writeFileSync(file, JSON.stringify(instances, null, 2), "utf-8");
    }
  } catch {
    // Best-effort
  }
}

interface RawPaneInfo {
  pane_id?: string;
  tab_id?: string;
  workspace_id?: string;
  tokens?: Record<string, string>;
  title?: string;
}

export async function findCompanionPaneInWorkspace(
  workspaceId: string,
  runtime: PluginRuntime,
  herdr: (args: string[]) => Promise<HerdrCall>,
): Promise<string | undefined> {
  const instances = readWorkspaceInstances(runtime.stateDir);
  const recorded = instances[workspaceId]?.paneId;

  // Query pane list to verify live panes
  const paneListCall = await herdr(["pane", "list"]);
  const panes: RawPaneInfo[] =
    paneListCall.ok && paneListCall.json && typeof paneListCall.json === "object"
      ? ((paneListCall.json as { result?: { panes?: RawPaneInfo[] } }).result?.panes ?? [])
      : [];

  const workspacePanes = panes.filter((p) => p.workspace_id === workspaceId);

  // 1. Check if the recorded pane is still active in the workspace
  if (recorded) {
    const matchingRecorded = workspacePanes.find((p) => p.pane_id === recorded);
    if (matchingRecorded && matchingRecorded.pane_id) {
      return matchingRecorded.pane_id;
    }
    // Clean up stale record
    unregisterWorkspacePane(workspaceId, recorded, runtime.stateDir);
  }

  // 2. Check if any workspace pane has wayfinder tokens or title
  const matchingToken = workspacePanes.find(
    (p) =>
      p.tokens?.["wayfinder"] === "1" ||
      p.tokens?.["wayfinder.companion"] === "1" ||
      p.title === "Wayfinder Companion",
  );

  if (matchingToken && matchingToken.pane_id) {
    // Record it for future lookups
    registerWorkspacePane(workspaceId, matchingToken.pane_id, runtime.stateDir);
    return matchingToken.pane_id;
  }

  return undefined;
}
