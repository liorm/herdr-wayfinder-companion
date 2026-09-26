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
    const steps = createInitialDeliverySteps(sampleDeliveryIssue, "55-add-payment-gateway-integration");
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.id)).toEqual(["branch", "clear", "model", "implement", "pr"]);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(steps[0]?.title).toContain("55-add-payment-gateway-integration");
    expect(steps[3]?.title).toContain("/implement 55, ask no questions");
    expect(steps[4]?.title).toContain("/commit-push-pr ticket 55");
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
          json: { result: { agent: { agent_status: "idle", title: "Working on it" } } },
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const mockGit: GitRunner = async (args) => {
      executedGit.push(args);
      if (args[0] === "status") {
        return { status: 0, stdout: " M src/payments.ts\n?? src/gateway.ts\n", stderr: "" };
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

    expect(executedHerdr).toContainEqual(["agent", "prompt", "w1:pA", "/clear"]);
    expect(executedHerdr).toContainEqual(["agent", "prompt", "w1:pA", "/model Grok 4.7 low"]);
    expect(executedHerdr).toContainEqual(["agent", "prompt", "w1:pA", "/implement 55, ask no questions"]);
    expect(executedHerdr).toContainEqual(["agent", "prompt", "w1:pA", "/commit-push-pr ticket 55"]);
  });

  test("handles failure in branch creation", async () => {
    const mockHerdr = async (): Promise<HerdrCall> => ({ ok: true, status: 0, stdout: "", stderr: "", json: null });
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
});
