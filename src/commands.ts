import {
	PLUGIN_ID,
	readRuntime,
	repoDirectory,
	type PluginRuntime,
} from "./runtime.ts";
import { createClient, type HerdrCall } from "./herdr.ts";
import { runIssuePane } from "./ui/issues.tsx";
import { resolveSiblingAgent, type SiblingAgent } from "./sibling.ts";
import {
	findCompanionPaneInWorkspace,
	registerWorkspacePane,
	unregisterWorkspacePane,
} from "./workspace.ts";

export interface StatusReport {
	pluginId: string;
	actionId?: string;
	entrypointId?: string;
	workspaceId?: string;
	tabId?: string;
	paneId?: string;
	context: PluginRuntime["context"];
	sibling?: SiblingAgent;
	calls: {
		workspaceList: HerdrCall;
		agentList: HerdrCall;
	};
}

export async function collectStatus(
	runtime: PluginRuntime = readRuntime(),
	client?: (args: string[]) => Promise<HerdrCall>,
): Promise<StatusReport> {
	const herdr = client ?? createClient(runtime.binPath);
	const [workspaceList, agentList, sibling] = await Promise.all([
		herdr(["workspace", "list"]),
		herdr(["agent", "list"]),
		resolveSiblingAgent(runtime, herdr),
	]);

	return {
		pluginId: runtime.pluginId,
		actionId: runtime.actionId,
		entrypointId: runtime.entrypointId,
		workspaceId: runtime.workspaceId ?? runtime.context.workspaceId,
		tabId: runtime.tabId ?? runtime.context.tabId,
		paneId: runtime.paneId ?? runtime.context.paneId,
		context: runtime.context,
		sibling,
		calls: { workspaceList, agentList },
	};
}

export async function status(): Promise<number> {
	const report = await collectStatus();
	console.log(JSON.stringify(report, null, 2));
	const failed = !report.calls.workspaceList.ok || !report.calls.agentList.ok;
	return failed ? 1 : 0;
}

export async function open(
	runtime: PluginRuntime = readRuntime(),
	client?: (args: string[]) => Promise<HerdrCall>,
): Promise<number> {
	const herdr = client ?? createClient(runtime.binPath);
	const workspaceId = runtime.workspaceId ?? runtime.context.workspaceId;

	if (workspaceId) {
		const existingPaneId = await findCompanionPaneInWorkspace(
			workspaceId,
			runtime,
			herdr,
		);
		if (existingPaneId) {
			const focusCall = await herdr([
				"plugin",
				"pane",
				"focus",
				existingPaneId,
			]);
			if (focusCall.ok) {
				return 0;
			}
			const fallbackFocus = await herdr([
				"pane",
				"focus",
				"--pane",
				existingPaneId,
			]);
			if (fallbackFocus.ok) {
				return 0;
			}
		}
	}

	const sibling = await resolveSiblingAgent(runtime, herdr);
	const targetPaneId = sibling?.paneId;

	const openArgs = [
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
	];
	if (targetPaneId) {
		openArgs.push("--target-pane", targetPaneId);
	}

	const call = await herdr(openArgs);
	if (!call.ok) {
		console.error(
			call.stderr.trim() || call.stdout.trim() || `herdr exited ${call.status}`,
		);
		return call.status || 1;
	}

	if (workspaceId && call.json && typeof call.json === "object") {
		const res = call.json as {
			result?: { plugin_pane?: { pane?: { pane_id?: string } } };
		};
		const newPaneId = res.result?.plugin_pane?.pane?.pane_id;
		if (newPaneId) {
			registerWorkspacePane(workspaceId, newPaneId, runtime.stateDir, {
				siblingPaneId: targetPaneId,
				siblingAgent: sibling?.agent,
			});
		}
	}

	process.stdout.write(call.stdout);
	return 0;
}

export async function ui(
	runtime: PluginRuntime = readRuntime(),
	client?: (args: string[]) => Promise<HerdrCall>,
): Promise<number> {
	// Only the board entrypoint owns its pane. A test or shell that inherits
	// HERDR_PANE_ID from this session must not close that pane on quit.
	const paneId = runtime.entrypointId === "board" ? runtime.paneId : undefined;
	const workspaceId = runtime.workspaceId ?? runtime.context.workspaceId;
	const herdr = client ?? createClient(runtime.binPath);

	if (workspaceId && paneId) {
		const existingPaneId = await findCompanionPaneInWorkspace(
			workspaceId,
			runtime,
			herdr,
		);
		if (existingPaneId && existingPaneId !== paneId) {
			// Another instance is already running in this workspace; focus it and close this one
			await herdr(["plugin", "pane", "focus", existingPaneId]);
			await herdr(["pane", "close", paneId]);
			return 0;
		}
		registerWorkspacePane(workspaceId, paneId, runtime.stateDir);
		await herdr([
			"pane",
			"report-metadata",
			paneId,
			"--source",
			runtime.pluginId,
			"--token",
			"wayfinder=1",
		]).catch(() => {});
	}

	const sibling = await resolveSiblingAgent(runtime, herdr).catch(
		() => undefined,
	);
	const targetCwd = sibling?.cwd ?? repoDirectory(runtime.context);

	if (targetCwd) {
		try {
			process.chdir(targetCwd);
		} catch {
			// Best-effort
		}
	}

	return runIssuePane(targetCwd, {
		runtime,
		onClose: paneId
			? async () => {
					if (workspaceId) {
						unregisterWorkspacePane(workspaceId, paneId, runtime.stateDir);
					}
					await herdr(["pane", "close", paneId]);
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
