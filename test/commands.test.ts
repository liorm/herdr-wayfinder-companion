import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	registerWorkspacePane,
	readWorkspaceInstances,
} from "../src/workspace.ts";
import type { HerdrCall } from "../src/herdr.ts";

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

	test("open targets sibling agent pane", async () => {
		const { open } = await import("../src/commands.ts");
		const runtime = {
			pluginId: "wayfinder.companion",
			binPath: "herdr",
			workspaceId: "ws-test",
			tabId: "ws-test:tab1",
			stateDir: tempDir,
			context: {
				raw: {},
				workspaceId: "ws-test",
				workspaceCwd: "/workspace/root",
			},
		};

		let executedArgs: string[] = [];
		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			executedArgs = args;
			const cmd = args.join(" ");
			if (cmd.includes("pane list")) {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: {
						result: {
							panes: [
								{
									pane_id: "ws-test:pane-sibling",
									tab_id: "ws-test:tab1",
									workspace_id: "ws-test",
									agent: "grok",
									agent_status: "idle",
									foreground_cwd: "/workspace/sibling/worktree",
								},
							],
						},
					},
				};
			}
			if (cmd.includes("agent list")) {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: { result: { agents: [] } },
				};
			}
			if (cmd.includes("plugin pane open")) {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: {
						result: {
							plugin_pane: {
								pane: {
									pane_id: "ws-test:pane-board",
								},
							},
						},
					},
				};
			}
			return { ok: false, status: 1, stdout: "", stderr: "", json: null };
		};

		const code = await open(runtime, mockHerdr);
		expect(code).toBe(0);
		expect(executedArgs).toContain("--target-pane");
		const targetIndex = executedArgs.indexOf("--target-pane");
		expect(executedArgs[targetIndex + 1]).toBe("ws-test:pane-sibling");
	});

	test("ui switches process cwd to sibling agent cwd", async () => {
		const { ui } = await import("../src/commands.ts");
		const originalCwd = process.cwd();
		const targetDir = tempDir;

		const runtime = {
			pluginId: "wayfinder.companion",
			binPath: "herdr",
			workspaceId: "ws-test",
			tabId: "ws-test:tab1",
			paneId: "ws-test:pane-board",
			entrypointId: "board",
			stateDir: tempDir,
			context: {
				raw: {},
				workspaceId: "ws-test",
			},
		};

		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			const cmd = args.join(" ");
			if (cmd.includes("pane list")) {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: {
						result: {
							panes: [
								{
									pane_id: "ws-test:pane-sibling",
									tab_id: "ws-test:tab1",
									workspace_id: "ws-test",
									agent: "grok",
									agent_status: "idle",
									foreground_cwd: targetDir,
								},
							],
						},
					},
				};
			}
			if (cmd.includes("agent list")) {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: { result: { agents: [] } },
				};
			}
			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		const origStdinIsTTY = process.stdin.isTTY;
		const origStdoutIsTTY = process.stdout.isTTY;
		try {
			(process.stdin as unknown as { isTTY?: boolean }).isTTY = false;
			(process.stdout as unknown as { isTTY?: boolean }).isTTY = false;
			await ui(runtime, mockHerdr);
			expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(targetDir));
		} finally {
			(process.stdin as unknown as { isTTY?: boolean }).isTTY = origStdinIsTTY;
			(process.stdout as unknown as { isTTY?: boolean }).isTTY =
				origStdoutIsTTY;
			process.chdir(originalCwd);
		}
	});
});
