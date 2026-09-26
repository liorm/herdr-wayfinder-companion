import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  findCompanionPaneInWorkspace,
  registerWorkspacePane,
  unregisterWorkspacePane,
  readWorkspaceInstances,
} from "../src/workspace.ts";
import type { PluginRuntime } from "../src/runtime.ts";
import type { HerdrCall } from "../src/herdr.ts";

describe("workspace instance guard", () => {
  const tempDir = path.join(os.tmpdir(), `wayfinder-ws-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseRuntime: PluginRuntime = {
    pluginId: "wayfinder.companion",
    binPath: "herdr",
    stateDir: tempDir,
    workspaceId: "ws-1",
    context: {
      workspaceId: "ws-1",
      raw: {},
    },
  };

  test("registers and unregisters workspace pane", () => {
    registerWorkspacePane("ws-1", "pane-123", tempDir);
    let instances = readWorkspaceInstances(tempDir);
    expect(instances["ws-1"]?.paneId).toBe("pane-123");

    unregisterWorkspacePane("ws-1", "pane-123", tempDir);
    instances = readWorkspaceInstances(tempDir);
    expect(instances["ws-1"]).toBeUndefined();
  });

  test("finds companion pane if recorded and active in workspace", async () => {
    registerWorkspacePane("ws-1", "pane-123", tempDir);

    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      if (args[0] === "pane" && args[1] === "list") {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: {
            result: {
              panes: [
                { pane_id: "pane-123", workspace_id: "ws-1", title: "Wayfinder Companion" },
                { pane_id: "pane-456", workspace_id: "ws-2" },
              ],
            },
          },
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const found = await findCompanionPaneInWorkspace("ws-1", baseRuntime, mockHerdr);
    expect(found).toBe("pane-123");
  });

  test("cleans up stale recorded pane if not in workspace pane list", async () => {
    registerWorkspacePane("ws-1", "pane-stale", tempDir);

    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      if (args[0] === "pane" && args[1] === "list") {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: {
            result: {
              panes: [{ pane_id: "pane-other", workspace_id: "ws-1" }],
            },
          },
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const found = await findCompanionPaneInWorkspace("ws-1", baseRuntime, mockHerdr);
    expect(found).toBeUndefined();

    const instances = readWorkspaceInstances(tempDir);
    expect(instances["ws-1"]).toBeUndefined();
  });

  test("finds companion pane by token if unrecorded", async () => {
    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      if (args[0] === "pane" && args[1] === "list") {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: {
            result: {
              panes: [
                {
                  pane_id: "pane-tokened",
                  workspace_id: "ws-1",
                  tokens: { wayfinder: "1" },
                },
              ],
            },
          },
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const found = await findCompanionPaneInWorkspace("ws-1", baseRuntime, mockHerdr);
    expect(found).toBe("pane-tokened");

    // Should have saved to instances
    const instances = readWorkspaceInstances(tempDir);
    expect(instances["ws-1"]?.paneId).toBe("pane-tokened");
  });
});
