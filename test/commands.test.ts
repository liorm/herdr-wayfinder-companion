import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerWorkspacePane, readWorkspaceInstances } from "../src/workspace.ts";

describe("commands singleton behavior", () => {
  const tempDir = path.join(os.tmpdir(), `wayfinder-cmd-test-${Date.now()}`);
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.HERDR_PLUGIN_STATE_DIR = tempDir;
    process.env.HERDR_WORKSPACE_ID = "ws-test";
    process.env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify({
      workspace_id: "ws-test",
      workspace_cwd: tempDir,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("readWorkspaceInstances tracks stateDir", () => {
    registerWorkspacePane("ws-test", "pane-999", tempDir);
    const instances = readWorkspaceInstances(tempDir);
    expect(instances["ws-test"]?.paneId).toBe("pane-999");
  });
});
