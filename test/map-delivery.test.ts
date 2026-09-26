import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github/issues.ts";
import type { GhRunner } from "../src/github/issues.ts";
import type { GitRunner } from "../src/git.ts";
import type { HerdrCall } from "../src/herdr.ts";
import type { SiblingAgent } from "../src/sibling.ts";
import {
  canDeliverMap,
  createInitialMapDeliveryState,
  getMapSubtickets,
  runMapDeliveryWorkflow,
} from "../src/wayfinder/map-delivery.ts";

const mapIssue: Issue = {
  number: 10,
  title: "Core Authentication Epic",
  url: "https://github.com/example/repo/issues/10",
  labels: ["wayfinder:map"],
  assignees: [],
  closed: false,
};

const subIssue1: Issue = {
  number: 11,
  title: "Setup Auth Database Models",
  url: "https://github.com/example/repo/issues/11",
  labels: ["ready-for-agent"],
  assignees: [],
  closed: false,
  body: "Part of #10",
};

const subIssue2: Issue = {
  number: 12,
  title: "Implement Login Handler",
  url: "https://github.com/example/repo/issues/12",
  labels: ["ready-for-agent"],
  assignees: [],
  closed: false,
  body: "Part of #10\nBlocked by: #11",
};

const subIssueResearch: Issue = {
  number: 13,
  title: "Research OAuth Providers",
  url: "https://github.com/example/repo/issues/13",
  labels: ["wayfinder:research"],
  assignees: [],
  closed: false,
  body: "Part of #10",
};

const idleSibling: SiblingAgent = {
  paneId: "pane-1",
  agent: "grok",
  status: "idle",
  cwd: "/repo",
};

describe("getMapSubtickets and canDeliverMap", () => {
  test("extracts and sorts subtickets topologically", () => {
    const all = [mapIssue, subIssue2, subIssue1];
    const subs = getMapSubtickets(mapIssue, all);
    expect(subs).toHaveLength(2);
    expect(subs[0]!.number).toBe(11);
    expect(subs[1]!.number).toBe(12);
  });

  test("canDeliverMap returns true when all subtickets are delivery state", () => {
    const all = [mapIssue, subIssue1, subIssue2];
    const res = canDeliverMap(mapIssue, all);
    expect(res.canDeliver).toBe(true);
    expect(res.subtickets).toHaveLength(2);
  });

  test("canDeliverMap returns false when ticket is not a map", () => {
    const res = canDeliverMap(subIssue1, [mapIssue, subIssue1]);
    expect(res.canDeliver).toBe(false);
    expect(res.reason).toContain("not a map ticket");
  });

  test("canDeliverMap returns false when map has no subtickets", () => {
    const res = canDeliverMap(mapIssue, [mapIssue]);
    expect(res.canDeliver).toBe(false);
    expect(res.reason).toContain("has no subtickets");
  });

  test("canDeliverMap returns false when any subticket is not delivery", () => {
    const all = [mapIssue, subIssue1, subIssueResearch];
    const res = canDeliverMap(mapIssue, all);
    expect(res.canDeliver).toBe(false);
    expect(res.reason).toContain("Not all subtickets are in delivery state");
    expect(res.reason).toContain("#13 (research)");
  });

  test("canDeliverMap returns false when all subtickets are already closed", () => {
    const closedSub1 = { ...subIssue1, closed: true };
    const closedSub2 = { ...subIssue2, closed: true };
    const res = canDeliverMap(mapIssue, [mapIssue, closedSub1, closedSub2]);
    expect(res.canDeliver).toBe(false);
    expect(res.reason).toContain("already closed");
  });
});

describe("createInitialMapDeliveryState", () => {
  test("creates steps for all subtickets", () => {
    const state = createInitialMapDeliveryState(mapIssue, [subIssue1, subIssue2]);
    expect(state.mapIssue).toEqual(mapIssue);
    expect(state.steps).toHaveLength(2);
    expect(state.steps[0]!.issue.number).toBe(11);
    expect(state.steps[0]!.status).toBe("pending");
    expect(state.steps[1]!.issue.number).toBe(12);
    expect(state.steps[1]!.status).toBe("pending");
    expect(state.isStarted).toBe(false);
    expect(state.isFinished).toBe(false);
  });

  test("marks already closed subtickets as completed", () => {
    const closedSub = { ...subIssue1, closed: true };
    const state = createInitialMapDeliveryState(mapIssue, [closedSub, subIssue2]);
    expect(state.steps[0]!.status).toBe("completed");
    expect(state.steps[1]!.status).toBe("pending");
  });
});

describe("runMapDeliveryWorkflow", () => {
  test("runs sequential delivery on each subticket, squashes PR, and waits for ticket close", async () => {
    const promptsSent: string[] = [];
    const prsSquashed: number[] = [];
    const closedChecks: number[] = [];

    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      if (args[0] === "agent" && args[1] === "prompt") {
        promptsSent.push(args[3]!);
        return { ok: true, status: 0, stdout: "", stderr: "", json: { status: "ok" } };
      }
      if (args[0] === "agent" && args[1] === "get") {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: {
            result: {
              agent: {
                agent_status: "idle",
                title: "Ready",
              },
            },
          },
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: {} };
    };

    const mockGit: GitRunner = async (args) => {
      if (args[0] === "status" && args[1] === "--porcelain") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const mockGh: GhRunner = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        const headIdx = args.indexOf("--head");
        const head = headIdx >= 0 ? args[headIdx + 1] : undefined;
        if (head?.includes("12")) {
          return {
            status: 0,
            stdout: JSON.stringify([
              {
                number: 102,
                title: "Deliver 12",
                url: "https://github.com/example/repo/pull/102",
                state: "open",
                headRefName: "12-implement-login-handler",
              },
            ]),
            stderr: "",
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 101,
              title: "Deliver 11",
              url: "https://github.com/example/repo/pull/101",
              state: "open",
              headRefName: "11-setup-auth-database-models",
            },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        const prNum = Number(args[2]);
        prsSquashed.push(prNum);
        return { status: 0, stdout: `PR #${prNum} merged and squashed`, stderr: "" };
      }
      if (args[0] === "issue" && args[1] === "view") {
        const issueNum = Number(args[2]);
        closedChecks.push(issueNum);
        return { status: 0, stdout: JSON.stringify({ state: "CLOSED", closed: true }), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = await runMapDeliveryWorkflow({
      cwd: "/repo",
      mapIssue,
      subtickets: [subIssue1, subIssue2],
      sibling: idleSibling,
      client: mockHerdr,
      runGit: mockGit,
      runGh: mockGh,
      pollIntervalMs: 5,
      startupGraceMs: 1,
      maxWaitMs: 100,
      closeMaxWaitMs: 100,
    });

    expect(result.isFinished).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.status).toBe("completed");
    expect(result.steps[1]!.status).toBe("completed");

    // Both tickets had delivery prompts sent
    expect(promptsSent).toContain("/implement 11, ask no questions");
    expect(promptsSent).toContain("/commit-push-pr ticket 11");
    expect(promptsSent).toContain("/implement 12, ask no questions");
    expect(promptsSent).toContain("/commit-push-pr ticket 12");

    // Both PRs squashed
    expect(prsSquashed).toContain(101);
    expect(prsSquashed).toContain(102);

    // Both tickets checked for close on GitHub
    expect(closedChecks).toContain(11);
    expect(closedChecks).toContain(12);
  });

  test("handles squash failure and stops sequential workflow", async () => {
    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      if (args[0] === "agent" && args[1] === "prompt") {
        return { ok: true, status: 0, stdout: "", stderr: "", json: { status: "ok" } };
      }
      if (args[0] === "agent" && args[1] === "get") {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: { result: { agent: { agent_status: "idle", title: "Ready" } } },
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: {} };
    };

    const mockGit: GitRunner = async () => ({ status: 0, stdout: "", stderr: "" });

    const mockGh: GhRunner = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 101,
              title: "Deliver 11",
              url: "https://github.com/example/repo/pull/101",
              state: "open",
              headRefName: "11-setup-auth-database-models",
            },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { status: 1, stdout: "", stderr: "Required status checks failing" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = await runMapDeliveryWorkflow({
      cwd: "/repo",
      mapIssue,
      subtickets: [subIssue1, subIssue2],
      sibling: idleSibling,
      client: mockHerdr,
      runGit: mockGit,
      runGh: mockGh,
      pollIntervalMs: 5,
      startupGraceMs: 1,
      maxWaitMs: 100,
    });

    expect(result.isFinished).toBe(true);
    expect(result.error).toContain("Required status checks failing");
    expect(result.steps[0]!.status).toBe("failed");
    expect(result.steps[1]!.status).toBe("pending"); // stopped before step 2
  });

  test("handles timeout when ticket is not closed on GitHub after squash", async () => {
    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      if (args[0] === "agent" && args[1] === "prompt") {
        return { ok: true, status: 0, stdout: "", stderr: "", json: { status: "ok" } };
      }
      if (args[0] === "agent" && args[1] === "get") {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: { result: { agent: { agent_status: "idle", title: "Ready" } } },
        };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: {} };
    };

    const mockGit: GitRunner = async () => ({ status: 0, stdout: "", stderr: "" });

    const mockGh: GhRunner = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 101,
              title: "Deliver 11",
              url: "https://github.com/example/repo/pull/101",
              state: "open",
              headRefName: "11-setup-auth-database-models",
            },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { status: 0, stdout: "Merged", stderr: "" };
      }
      if (args[0] === "issue" && args[1] === "view") {
        return { status: 0, stdout: JSON.stringify({ state: "OPEN", closed: false }), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = await runMapDeliveryWorkflow({
      cwd: "/repo",
      mapIssue,
      subtickets: [subIssue1],
      sibling: idleSibling,
      client: mockHerdr,
      runGit: mockGit,
      runGh: mockGh,
      pollIntervalMs: 5,
      startupGraceMs: 1,
      maxWaitMs: 100,
      closeMaxWaitMs: 20,
    });

    expect(result.isFinished).toBe(true);
    expect(result.error).toContain("Ticket #11 was not closed on GitHub after squashing");
    expect(result.steps[0]!.status).toBe("failed");
  });
});
