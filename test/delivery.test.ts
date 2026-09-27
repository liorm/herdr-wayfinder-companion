import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github/issues.ts";
import type { HerdrCall } from "../src/herdr.ts";
import type { SiblingAgent } from "../src/sibling.ts";
import {
	createInitialDeliveryState,
	createInitialDeliverySteps,
	runDeliveryWorkflow,
} from "../src/wayfinder/delivery.ts";
import type { GitRunner } from "../src/git.ts";
import type { GhRunner } from "../src/github/issues.ts";

const sampleDeliveryIssue: Issue = {
	number: 55,
	title: "Add payment gateway integration",
	url: "https://github.com/example/repo/issues/55",
	labels: ["ready-for-agent"],
	assignees: [],
	closed: false,
};

const idleSibling: SiblingAgent = {
	paneId: "w1:pA",
	agent: "grok",
	status: "idle",
};

describe("createInitialDeliverySteps", () => {
	test("creates the 5 required steps in pending state", () => {
		const steps = createInitialDeliverySteps(
			sampleDeliveryIssue,
			"55-add-payment-gateway-integration",
		);
		expect(steps).toHaveLength(5);
		expect(steps.map((s) => s.id)).toEqual([
			"branch",
			"clear",
			"model",
			"implement",
			"pr",
		]);
		expect(steps.every((s) => s.status === "pending")).toBe(true);
		expect(steps[0]?.title).toContain("55-add-payment-gateway-integration");
		expect(steps[2]?.title).toContain("/model Grok 4.7 low");
		expect(steps[3]?.title).toContain("/implement 55, ask no questions");
		expect(steps[4]?.title).toContain("/commit-push-pr ticket 55");
	});

	test("uses custom model in step title when provided", () => {
		const steps = createInitialDeliverySteps(
			sampleDeliveryIssue,
			"55-add-payment-gateway-integration",
			{
				model: "Claude 3.7 Sonnet high",
			},
		);
		expect(steps[2]?.title).toContain("/model Claude 3.7 Sonnet high");
	});
});

describe("createInitialDeliveryState", () => {
	test("creates pending state when no existing PR", () => {
		const state = createInitialDeliveryState(sampleDeliveryIssue, null);
		expect(state.isStarted).toBe(false);
		expect(state.isFinished).toBe(false);
		expect(state.alreadyDelivered).toBe(false);
		expect(state.branchName).toBe("55-add-payment-gateway-integration");
	});

	test("marks as already delivered when existing PR is provided", () => {
		const existingPR = {
			number: 99,
			title: "Add payment gateway",
			url: "https://github.com/example/repo/pull/99",
			state: "open",
		};
		const state = createInitialDeliveryState(sampleDeliveryIssue, existingPR);
		expect(state.alreadyDelivered).toBe(true);
		expect(state.isFinished).toBe(true);
		expect(state.existingPR).toEqual(existingPR);
	});
});

describe("runDeliveryWorkflow", () => {
	test("runs all 5 steps sequentially and discovers created PR", async () => {
		const executedHerdr: string[][] = [];
		const executedGit: string[][] = [];

		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			executedHerdr.push(args);
			if (args[0] === "agent" && args[1] === "get") {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: {
						result: { agent: { agent_status: "idle", title: "Working on it" } },
					},
				};
			}
			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		let branchPrepared = false;
		const mockGit: GitRunner = async (args) => {
			executedGit.push(args);
			if (args[0] === "status") {
				if (!branchPrepared) {
					return { status: 0, stdout: "", stderr: "" };
				}
				return {
					status: 0,
					stdout: " M src/payments.ts\n?? src/gateway.ts\n",
					stderr: "",
				};
			}
			if (args[0] === "checkout") {
				branchPrepared = true;
			}
			return { status: 0, stdout: "", stderr: "" };
		};

		const mockGh: GhRunner = async () => {
			return {
				status: 0,
				stdout: JSON.stringify([
					{
						number: 100,
						title: "Implement #55",
						url: "https://github.com/example/repo/pull/100",
						state: "OPEN",
						headRefName: "55-add-payment-gateway-integration",
					},
				]),
				stderr: "",
			};
		};

		const finalState = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockGit,
			runGh: mockGh,
			pollIntervalMs: 10,
		});

		expect(finalState.isStarted).toBe(true);
		expect(finalState.isFinished).toBe(true);
		expect(finalState.error).toBeUndefined();
		expect(finalState.steps.every((s) => s.status === "completed")).toBe(true);
		expect(finalState.modifiedFiles).toHaveLength(2);
		expect(finalState.pr?.number).toBe(100);
		expect(finalState.pr?.url).toBe("https://github.com/example/repo/pull/100");

		expect(executedHerdr).toContainEqual([
			"agent",
			"prompt",
			"w1:pA",
			"/clear",
		]);
		expect(executedHerdr).toContainEqual([
			"agent",
			"prompt",
			"w1:pA",
			"/model Grok 4.7 low",
		]);
		expect(executedHerdr).toContainEqual([
			"agent",
			"prompt",
			"w1:pA",
			"/implement 55, ask no questions",
		]);
		expect(executedHerdr).toContainEqual([
			"agent",
			"prompt",
			"w1:pA",
			"/commit-push-pr ticket 55",
		]);
	});

	test("runs delivery workflow with custom model", async () => {
		const executedHerdr: string[][] = [];

		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			executedHerdr.push(args);
			if (args[0] === "agent" && args[1] === "get") {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: { result: { agent: { agent_status: "idle", title: "Done" } } },
				};
			}
			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		const mockGit: GitRunner = async () => ({
			status: 0,
			stdout: "",
			stderr: "",
		});
		const mockGh: GhRunner = async () => ({
			status: 0,
			stdout: JSON.stringify([
				{
					number: 101,
					title: "PR",
					url: "https://github.com/example/repo/pull/101",
					state: "OPEN",
				},
			]),
			stderr: "",
		});

		const finalState = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			model: "Claude 3.7 Sonnet medium",
			runGit: mockGit,
			runGh: mockGh,
			pollIntervalMs: 10,
		});

		expect(finalState.isFinished).toBe(true);
		expect(executedHerdr).toContainEqual([
			"agent",
			"prompt",
			"w1:pA",
			"/model Claude 3.7 Sonnet medium",
		]);
	});

	test("runs delivery workflow with agy default model", async () => {
		const executedHerdr: string[][] = [];

		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			executedHerdr.push(args);
			if (args[0] === "agent" && args[1] === "get") {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: { result: { agent: { agent_status: "idle", title: "Done" } } },
				};
			}
			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		const mockGit: GitRunner = async () => ({
			status: 0,
			stdout: "",
			stderr: "",
		});
		const mockGh: GhRunner = async () => ({
			status: 0,
			stdout: JSON.stringify([
				{
					number: 102,
					title: "PR",
					url: "https://github.com/example/repo/pull/102",
					state: "OPEN",
				},
			]),
			stderr: "",
		});

		const agySibling: SiblingAgent = {
			paneId: "w1:pA",
			agent: "agy",
			status: "idle",
		};

		const finalState = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: agySibling,
			client: mockHerdr,
			runGit: mockGit,
			runGh: mockGh,
			pollIntervalMs: 10,
		});

		expect(finalState.isFinished).toBe(true);
		expect(executedHerdr).toContainEqual([
			"agent",
			"prompt",
			"w1:pA",
			"/model gemini-3.7-flash-low",
		]);
	});

	test("handles failure in branch creation", async () => {
		const mockHerdr = async (): Promise<HerdrCall> => ({
			ok: true,
			status: 0,
			stdout: "",
			stderr: "",
			json: null,
		});
		const mockFailingGit: GitRunner = async (args) => {
			if (args[0] === "checkout" && args[1] === "main") {
				return { status: 1, stdout: "", stderr: "Cannot checkout main" };
			}
			return { status: 0, stdout: "", stderr: "" };
		};

		const state = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockFailingGit,
			pollIntervalMs: 10,
		});

		expect(state.isFinished).toBe(true);
		expect(state.error).toContain("Failed to checkout main");
		expect(state.steps[0]?.status).toBe("failed");
	});

	test("fails fast if working tree has uncommitted changes", async () => {
		const mockHerdr = async (): Promise<HerdrCall> => ({
			ok: true,
			status: 0,
			stdout: "",
			stderr: "",
			json: null,
		});
		const mockDirtyGit: GitRunner = async (args) => {
			if (args[0] === "status" && args[1] === "--porcelain") {
				return { status: 0, stdout: " M uncommitted.ts\n", stderr: "" };
			}
			return { status: 0, stdout: "", stderr: "" };
		};

		const state = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockDirtyGit,
			pollIntervalMs: 10,
		});

		expect(state.isFinished).toBe(true);
		expect(state.error).toContain("Working directory has uncommitted changes");
		expect(state.steps[0]?.status).toBe("failed");
	});

	test("waits for implement prompt to complete and agent to become idle before sending commit-push-pr", async () => {
		const executedHerdr: { time: number; args: string[] }[] = [];
		let currentPhase: "init" | "clear" | "model" | "implement" | "pr" = "init";
		let implementPollCount = 0;
		let prSentTime: number | null = null;
		let implementDoneTime: number | null = null;

		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			executedHerdr.push({ time: Date.now(), args });

			if (args[0] === "agent" && args[1] === "prompt") {
				const prompt = args[3];
				if (prompt === "/clear") currentPhase = "clear";
				else if (prompt?.startsWith("/model")) currentPhase = "model";
				else if (prompt?.startsWith("/implement")) currentPhase = "implement";
				else if (prompt?.startsWith("/commit-push-pr")) {
					currentPhase = "pr";
					prSentTime = Date.now();
				}
				return { ok: true, status: 0, stdout: "", stderr: "", json: null };
			}

			if (args[0] === "agent" && args[1] === "get") {
				if (currentPhase === "implement") {
					implementPollCount++;
					// Simulate 3 ticks of "working" before returning to "idle"
					if (implementPollCount < 3) {
						return {
							ok: true,
							status: 0,
							stdout: "",
							stderr: "",
							json: {
								result: {
									agent: {
										agent_status: "working",
										title: "Implementing feature...",
									},
								},
							},
						};
					} else {
						implementDoneTime = Date.now();
						return {
							ok: true,
							status: 0,
							stdout: "",
							stderr: "",
							json: {
								result: { agent: { agent_status: "idle", title: "Ready" } },
							},
						};
					}
				}
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: { result: { agent: { agent_status: "idle", title: "Ready" } } },
				};
			}

			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		const mockGit: GitRunner = async () => ({
			status: 0,
			stdout: "",
			stderr: "",
		});
		const mockGh: GhRunner = async () => ({
			status: 0,
			stdout: JSON.stringify([
				{
					number: 200,
					title: "PR",
					url: "https://github.com/example/repo/pull/200",
					state: "OPEN",
				},
			]),
			stderr: "",
		});

		const finalState = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockGit,
			runGh: mockGh,
			pollIntervalMs: 10,
			startupGraceMs: 20,
		});

		expect(finalState.isFinished).toBe(true);
		expect(implementPollCount).toBeGreaterThanOrEqual(3);
		expect(implementDoneTime).not.toBeNull();
		expect(prSentTime).not.toBeNull();
		// Verify commit-push-pr was sent strictly after implement was done
		if (prSentTime !== null && implementDoneTime !== null) {
			expect(prSentTime).toBeGreaterThanOrEqual(implementDoneTime);
		}
	});

	test("handles agent blocked during implementation", async () => {
		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			if (
				args[0] === "agent" &&
				args[1] === "prompt" &&
				args[3]?.startsWith("/implement")
			) {
				return { ok: true, status: 0, stdout: "", stderr: "", json: null };
			}
			if (args[0] === "agent" && args[1] === "get") {
				if (args[2] === "w1:pA") {
					return {
						ok: true,
						status: 0,
						stdout: "",
						stderr: "",
						json: {
							result: {
								agent: {
									agent_status: "blocked",
									title: "Waiting for human input",
								},
							},
						},
					};
				}
			}
			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		const mockGit: GitRunner = async () => ({
			status: 0,
			stdout: "",
			stderr: "",
		});

		const state = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockGit,
			pollIntervalMs: 10,
		});

		expect(state.isFinished).toBe(true);
		expect(state.error).toContain("Agent is blocked");
		expect(state.steps[1]?.status).toBe("failed");
	});

	test("waits and polls for PR until it appears on GitHub", async () => {
		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			if (args[0] === "agent" && args[1] === "get") {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: { result: { agent: { agent_status: "idle", title: "Done" } } },
				};
			}
			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		const mockGit: GitRunner = async () => ({
			status: 0,
			stdout: "",
			stderr: "",
		});

		let ghCallCount = 0;
		const mockGh: GhRunner = async () => {
			ghCallCount++;
			// Return not found for the first 2 queries
			if (ghCallCount <= 2) {
				return { status: 1, stdout: "", stderr: "no PR found" };
			}
			return {
				status: 0,
				stdout: JSON.stringify([
					{
						number: 350,
						title: "PR for #55",
						url: "https://github.com/example/repo/pull/350",
						state: "OPEN",
						headRefName: "55-add-payment-gateway-integration",
					},
				]),
				stderr: "",
			};
		};

		const state = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockGit,
			runGh: mockGh,
			pollIntervalMs: 10,
			prMaxWaitMs: 500,
		});

		expect(state.isFinished).toBe(true);
		expect(state.error).toBeUndefined();
		expect(state.steps[4]?.status).toBe("completed");
		expect(state.pr).toBeDefined();
		expect(state.pr?.number).toBe(350);
		expect(state.pr?.url).toBe("https://github.com/example/repo/pull/350");
		expect(ghCallCount).toBeGreaterThanOrEqual(3);
	});

	test("marks step as failed and does not create dummy PR when PR cannot be found", async () => {
		const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
			if (args[0] === "agent" && args[1] === "get") {
				return {
					ok: true,
					status: 0,
					stdout: "",
					stderr: "",
					json: { result: { agent: { agent_status: "idle", title: "Done" } } },
				};
			}
			return { ok: true, status: 0, stdout: "", stderr: "", json: null };
		};

		const mockGit: GitRunner = async () => ({
			status: 0,
			stdout: "",
			stderr: "",
		});
		const mockFailingGh: GhRunner = async () => ({
			status: 1,
			stdout: "",
			stderr: "no pull requests found",
		});

		const state = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: sampleDeliveryIssue,
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockGit,
			runGh: mockFailingGh,
			pollIntervalMs: 10,
			prMaxWaitMs: 30,
		});

		expect(state.isFinished).toBe(true);
		expect(state.error).toContain("PR was not found on GitHub");
		expect(state.steps[4]?.status).toBe("failed");
		expect(state.pr).toBeUndefined();
	});

	test("fails immediately if issue is blocked when allIssues is provided", async () => {
		const blockerIssue: Issue = {
			number: 50,
			title: "Prerequisite database migration",
			url: "https://github.com/example/repo/issues/50",
			labels: [],
			assignees: [],
			closed: false,
		};
		const blockedDeliveryIssue: Issue = {
			...sampleDeliveryIssue,
			body: "Blocked by: #50",
		};

		const mockHerdr = async (): Promise<HerdrCall> => ({
			ok: true,
			status: 0,
			stdout: "",
			stderr: "",
			json: null,
		});
		const mockGit: GitRunner = async () => ({
			status: 0,
			stdout: "",
			stderr: "",
		});

		const state = await runDeliveryWorkflow({
			cwd: "/fake/repo",
			issue: blockedDeliveryIssue,
			allIssues: [blockerIssue, blockedDeliveryIssue],
			sibling: idleSibling,
			client: mockHerdr,
			runGit: mockGit,
		});

		expect(state.isFinished).toBe(true);
		expect(state.error).toContain("blocked");
		expect(state.error).toContain("#50");
		expect(state.steps.every((s) => s.status === "pending")).toBe(true);
	});
});
