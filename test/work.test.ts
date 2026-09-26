import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github/issues.ts";
import type { SiblingAgent } from "../src/sibling.ts";
import { isIssueBlocked } from "../src/wayfinder/board.ts";
import {
  dispatchWork,
  handleWorkDelivery,
  handleWorkGrilling,
  handleWorkMap,
  handleWorkOther,
  handleWorkPrototype,
  handleWorkResearch,
  handleWorkTask,
} from "../src/wayfinder/work.ts";
import type { HerdrCall } from "../src/herdr.ts";

const mapIssue: Issue = {
  number: 42,
  title: "Build Authentication System",
  url: "https://github.com/example/repo/issues/42",
  labels: ["wayfinder:map"],
  assignees: [],
  closed: false,
};

const grillingIssue: Issue = {
  number: 43,
  title: "Grill auth architecture",
  url: "https://github.com/example/repo/issues/43",
  labels: ["wayfinder:grilling"],
  assignees: [],
  closed: false,
};

const researchIssue: Issue = {
  number: 44,
  title: "Research OAuth providers",
  url: "https://github.com/example/repo/issues/44",
  labels: ["wayfinder:research"],
  assignees: [],
  closed: false,
};

const prototypeIssue: Issue = {
  number: 45,
  title: "Prototype session tokens",
  url: "https://github.com/example/repo/issues/45",
  labels: ["wayfinder:prototype"],
  assignees: [],
  closed: false,
};

const taskIssue: Issue = {
  number: 46,
  title: "Add login form component",
  url: "https://github.com/example/repo/issues/46",
  labels: ["wayfinder:task"],
  assignees: [],
  closed: false,
};

const deliveryIssue: Issue = {
  number: 47,
  title: "Deploy auth service",
  url: "https://github.com/example/repo/issues/47",
  labels: ["ready-for-agent"],
  assignees: [],
  closed: false,
};

const otherIssue: Issue = {
  number: 48,
  title: "Update documentation",
  url: "https://github.com/example/repo/issues/48",
  labels: ["documentation"],
  assignees: [],
  closed: false,
};

describe("isIssueBlocked", () => {
  test("identifies when an issue is blocked by an open issue", () => {
    const blocker: Issue = {
      number: 10,
      title: "Prerequisite setup",
      url: "https://example.com/10",
      labels: [],
      assignees: [],
      closed: false,
    };
    const blockedIssue: Issue = {
      number: 11,
      title: "Next step",
      url: "https://example.com/11",
      body: "Blocked by: #10",
      labels: [],
      assignees: [],
      closed: false,
    };
    expect(isIssueBlocked(blockedIssue, [blocker, blockedIssue])).toBe(true);
  });

  test("returns false when blocker issue is closed", () => {
    const closedBlocker: Issue = {
      number: 10,
      title: "Prerequisite setup",
      url: "https://example.com/10",
      labels: [],
      assignees: [],
      closed: true,
    };
    const issue: Issue = {
      number: 11,
      title: "Next step",
      url: "https://example.com/11",
      body: "Blocked by: #10",
      labels: [],
      assignees: [],
      closed: false,
    };
    expect(isIssueBlocked(issue, [closedBlocker, issue])).toBe(false);
  });

  test("returns false when issue itself is closed", () => {
    const blocker: Issue = {
      number: 10,
      title: "Prerequisite setup",
      url: "https://example.com/10",
      labels: [],
      assignees: [],
      closed: false,
    };
    const closedIssue: Issue = {
      number: 11,
      title: "Next step",
      url: "https://example.com/11",
      body: "Blocked by: #10",
      labels: [],
      assignees: [],
      closed: true,
    };
    expect(isIssueBlocked(closedIssue, [blocker, closedIssue])).toBe(false);
  });
});

describe("dispatchWork", () => {
  const idleSibling: SiblingAgent = {
    paneId: "w1:pC",
    agent: "grok",
    status: "idle",
  };

  test("sends /clear, /model Grok 4.7 medium, and /wayfinder XX for map tickets", async () => {
    const executedCommands: string[][] = [];
    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      executedCommands.push(args);
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const result = await dispatchWork(mapIssue, idleSibling, mockHerdr);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Started work on map #42");

    expect(executedCommands).toEqual([
      ["agent", "prompt", "w1:pC", "/clear"],
      ["agent", "prompt", "w1:pC", "/model Grok 4.7 medium"],
      ["agent", "prompt", "w1:pC", "/wayfinder 42"],
    ]);
  });

  test("uses custom model when specified for map tickets", async () => {
    const executedCommands: string[][] = [];
    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      executedCommands.push(args);
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const result = await dispatchWork(mapIssue, idleSibling, mockHerdr, {
      model: "Claude 3.7 Sonnet high",
    });
    expect(result.ok).toBe(true);
    expect(executedCommands).toEqual([
      ["agent", "prompt", "w1:pC", "/clear"],
      ["agent", "prompt", "w1:pC", "/model Claude 3.7 Sonnet high"],
      ["agent", "prompt", "w1:pC", "/wayfinder 42"],
    ]);
  });

  test("uses agy default model when sibling agent is agy", async () => {
    const executedCommands: string[][] = [];
    const mockHerdr = async (args: string[]): Promise<HerdrCall> => {
      executedCommands.push(args);
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const agySibling: SiblingAgent = {
      paneId: "w1:pA",
      agent: "agy",
      status: "idle",
    };

    const result = await dispatchWork(mapIssue, agySibling, mockHerdr);
    expect(result.ok).toBe(true);
    expect(executedCommands).toEqual([
      ["agent", "prompt", "w1:pA", "/clear"],
      ["agent", "prompt", "w1:pA", "/model gemini-3.7-flash-medium"],
      ["agent", "prompt", "w1:pA", "/wayfinder 42"],
    ]);
  });

  test("fails immediately if sibling agent is not idle", async () => {
    const workingSibling: SiblingAgent = {
      paneId: "w1:pC",
      agent: "grok",
      status: "working",
    };
    const mockHerdr = async (): Promise<HerdrCall> => {
      throw new Error("should not be called");
    };

    const result = await dispatchWork(mapIssue, workingSibling, mockHerdr);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Agent is not idle (working)");
  });

  test("fails if sibling agent status is unknown or undefined", async () => {
    const unknownSibling: SiblingAgent = {
      paneId: "w1:pC",
      agent: "grok",
    };
    const mockHerdr = async (): Promise<HerdrCall> => {
      throw new Error("should not be called");
    };

    const result = await dispatchWork(mapIssue, unknownSibling, mockHerdr);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Agent is not idle");
  });

  test("returns not implemented yet for grilling, research, prototype, task, and other kinds", async () => {
    const mockHerdr = async (): Promise<HerdrCall> => {
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const grillingRes = await dispatchWork(grillingIssue, idleSibling, mockHerdr);
    expect(grillingRes.ok).toBe(false);
    expect(grillingRes.message).toBe("Work for grilling tickets is not implemented yet");

    const researchRes = await dispatchWork(researchIssue, idleSibling, mockHerdr);
    expect(researchRes.ok).toBe(false);
    expect(researchRes.message).toBe("Work for research tickets is not implemented yet");

    const protoRes = await dispatchWork(prototypeIssue, idleSibling, mockHerdr);
    expect(protoRes.ok).toBe(false);
    expect(protoRes.message).toBe("Work for prototype tickets is not implemented yet");

    const taskRes = await dispatchWork(taskIssue, idleSibling, mockHerdr);
    expect(taskRes.ok).toBe(false);
    expect(taskRes.message).toBe("Work for task tickets is not implemented yet");

    const otherRes = await dispatchWork(otherIssue, idleSibling, mockHerdr);
    expect(otherRes.ok).toBe(false);
    expect(otherRes.message).toBe("Work for other tickets is not implemented yet");
  });

  test("handles individual handler functions directly", async () => {
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

    expect((await handleWorkGrilling(grillingIssue, idleSibling, mockHerdr)).message).toContain("grilling");
    expect((await handleWorkResearch(researchIssue, idleSibling, mockHerdr)).message).toContain("research");
    expect((await handleWorkPrototype(prototypeIssue, idleSibling, mockHerdr)).message).toContain("prototype");
    expect((await handleWorkTask(taskIssue, idleSibling, mockHerdr)).message).toContain("task");
    expect((await handleWorkOther(otherIssue, idleSibling, mockHerdr)).message).toContain("other");

    const mockGit = async () => ({ status: 0, stdout: "", stderr: "" });
    const mockGh = async () => ({
      status: 0,
      stdout: JSON.stringify([{ number: 1, title: "PR", url: "https://pr.url", state: "OPEN" }]),
      stderr: "",
    });
    const delivRes = await handleWorkDelivery(deliveryIssue, idleSibling, mockHerdr, {
      cwd: "/fake/repo",
      runGit: mockGit,
      runGh: mockGh,
      pollIntervalMs: 10,
    });
    expect(delivRes.ok).toBe(true);
    expect(delivRes.message).toContain("Delivery PR created: https://pr.url");
  });

  test("handles error response from herdr client during map prompt sequence", async () => {
    const mockFailingHerdr = async (args: string[]): Promise<HerdrCall> => {
      if (args[3] === "/clear") {
        return { ok: true, status: 0, stdout: "", stderr: "", json: null };
      }
      if (args[3] === "/model Grok 4.7 medium") {
        return { ok: false, status: 1, stdout: "", stderr: "model switch failed", json: null };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", json: null };
    };

    const result = await handleWorkMap(mapIssue, idleSibling, mockFailingHerdr);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Failed to set model: model switch failed");
  });

  test("notImplemented is true for unimplemented ticket types", async () => {
    const mockHerdr = async (): Promise<HerdrCall> => ({ ok: true, status: 0, stdout: "", stderr: "", json: null });
    const res = await dispatchWork(grillingIssue, idleSibling, mockHerdr);
    expect(res.notImplemented).toBe(true);
  });
});

describe("createErrorDialog", () => {
  test("creates a dialog state object with title, message, and optional detail", () => {
    const { createErrorDialog } = require("../src/ui/dialog.ts");
    const dialog = createErrorDialog("Something went wrong", "Custom Error", "Detail message");
    expect(dialog).toEqual({
      title: "Custom Error",
      message: "Something went wrong",
      detail: "Detail message",
    });

    const defaultDialog = createErrorDialog("Generic failure");
    expect(defaultDialog).toEqual({
      title: "Error",
      message: "Generic failure",
      detail: undefined,
    });
  });
});
