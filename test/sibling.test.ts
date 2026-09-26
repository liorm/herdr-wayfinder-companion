import { describe, expect, test } from "bun:test";
import {
  cleanTerminalTitle,
  extractAgentMessageFromOutput,
  resolveSiblingAgent,
} from "../src/sibling.ts";
import { collectStatus } from "../src/commands.ts";
import type { PluginRuntime } from "../src/runtime.ts";

describe("cleanTerminalTitle", () => {
  test("removes agent suffix from terminal title", () => {
    expect(
      cleanTerminalTitle("One role bundles Studio and People grant… - grok", "grok"),
    ).toBe("One role bundles Studio and People grant…");
    expect(
      cleanTerminalTitle("Refactoring database queries - Claude", "claude"),
    ).toBe("Refactoring database queries");
  });

  test("strips braille spinner prefix", () => {
    expect(cleanTerminalTitle("⠋ Thinking about task", "codex")).toBe("Thinking about task");
    expect(cleanTerminalTitle("› Next step", "agent")).toBe("Next step");
  });

  test("returns undefined for generic shell commands or prompts", () => {
    expect(cleanTerminalTitle("zsh")).toBeUndefined();
    expect(cleanTerminalTitle("bash")).toBeUndefined();
    expect(cleanTerminalTitle("liormualem@Mac:~/repo$ ")).toBeUndefined();
  });
});

describe("extractAgentMessageFromOutput", () => {
  test("extracts last meaningful recap from terminal snapshot", () => {
    const output = `
│   This is worth an ADR if you want it.                                                        │
└                                                                                              ┘
    Worked for 4m32s

 ┃  ◆ Recap
 ┃
 ┃  We locked one role per person on Users, roles, and the operator dashboard: Admin
 ┃  confers every grant, Publisher only the Studio grant, and User none, then updated
 ┃  \`CONTEXT.md\` and the follow-on issues.

 ╭────────────────────────────────────────────────────────────────────────────────────────────╮
 │ ❯                                                                                          │
 ╰─────────────────────────────────────────────────────── Grok 4.7 (medium) · always-approve ─╯
 Shift+Tab:mode  │  Ctrl+.:shortcuts
`;
    const message = extractAgentMessageFromOutput(output);
    expect(message).toBe(
      "We locked one role per person on Users, roles, and the operator dashboard: Admin confers every grant, Publisher only the Studio grant, and User none, then updated `CONTEXT.md` and the follow-on issues.",
    );
  });

  test("returns undefined when output contains only shell prompts or borders", () => {
    const output = `
╭────────╮
│ ❯      │
╰────────╯
Shift+Tab:mode
`;
    expect(extractAgentMessageFromOutput(output)).toBeUndefined();
  });
});

describe("resolveSiblingAgent", () => {
  const dummyRuntime: PluginRuntime = {
    pluginId: "wayfinder.companion",
    binPath: "herdr",
    paneId: "w1:p2",
    tabId: "w1:t1",
    context: {
      raw: {},
      paneId: "w1:p1",
      focusedPaneAgent: "claude",
      focusedPaneStatus: "working",
    },
  };

  test("resolves sibling agent using neighbor and pane list", async () => {
    const mockHerdr = async (args: string[]): Promise<any> => {
      const cmd = args.join(" ");
      if (cmd.includes("pane neighbor --direction left")) {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: {
            result: { neighbor: { neighbor_pane_id: "w1:p1" } },
          },
        };
      }
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
                  pane_id: "w1:p1",
                  tab_id: "w1:t1",
                  agent: "grok",
                  agent_status: "idle",
                  terminal_title_stripped: "Fixed user auth - grok",
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
      return { ok: false, status: 1, stdout: "", stderr: "", json: null };
    };

    const sibling = await resolveSiblingAgent(dummyRuntime, mockHerdr);
    expect(sibling).toEqual({
      paneId: "w1:p1",
      agent: "grok",
      status: "idle",
      lastMessage: "Fixed user auth",
    });
  });

  test("reads terminal output when no title or state_label is available", async () => {
    const mockHerdr = async (args: string[]): Promise<any> => {
      const cmd = args.join(" ");
      if (cmd.includes("pane neighbor")) {
        return {
          ok: true,
          status: 0,
          stdout: "",
          stderr: "",
          json: { result: { neighbor: { neighbor_pane_id: "w1:p1" } } },
        };
      }
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
                  pane_id: "w1:p1",
                  tab_id: "w1:t1",
                  agent: "codex",
                  agent_status: "done",
                  terminal_title: "bash",
                },
              ],
            },
          },
        };
      }
      if (cmd.includes("agent list")) {
        return { ok: true, status: 0, stdout: "", stderr: "", json: { result: { agents: [] } } };
      }
      if (cmd.includes("pane read")) {
        return {
          ok: true,
          status: 0,
          stdout: "All 15 tests passed successfully.\n❯ \n",
          stderr: "",
          json: null,
        };
      }
      return { ok: false, status: 1, stdout: "", stderr: "", json: null };
    };

    const sibling = await resolveSiblingAgent(dummyRuntime, mockHerdr);
    expect(sibling).toEqual({
      paneId: "w1:p1",
      agent: "codex",
      status: "done",
      lastMessage: "All 15 tests passed successfully.",
    });
  });

  test("falls back to context information when herdr calls fail", async () => {
    const failingHerdr = async (): Promise<any> => ({
      ok: false,
      status: 127,
      stdout: "",
      stderr: "error",
      json: null,
    });

    const sibling = await resolveSiblingAgent(dummyRuntime, failingHerdr);
    expect(sibling).toEqual({
      paneId: "w1:p1",
      agent: "claude",
      status: "working",
      lastMessage: undefined,
    });
  });
});

describe("collectStatus", () => {
  test("includes sibling info in status report", async () => {
    const runtime: PluginRuntime = {
      pluginId: "wayfinder.companion",
      binPath: "herdr",
      context: {
        raw: {
          focused_pane_id: "w1:p1",
          agent: "grok",
          agent_status: "idle",
          message: "All tasks completed",
        },
        paneId: "w1:p1",
        focusedPaneAgent: "grok",
        focusedPaneStatus: "idle",
      },
    };

    const report = await collectStatus(runtime);
    expect(report.sibling).toBeDefined();
    expect(report.sibling?.agent).toBe("grok");
    expect(report.sibling?.status).toBe("idle");
    expect(report.sibling?.lastMessage).toBe("All tasks completed");
  });
});

describe("refreshBoardState", () => {
  test("refreshes tickets and sibling agent concurrently", async () => {
    const { refreshBoardState } = await import("../src/ui/issues.tsx");
    const mockRuntime: PluginRuntime = {
      pluginId: "wayfinder.companion",
      binPath: "herdr",
      context: { raw: {} },
    };
    const mockFetchSibling = async () => ({
      agent: "claude",
      status: "idle",
      lastMessage: "Finished migration",
    });

    const result = await refreshBoardState("/not/a/real/dir", "open", mockRuntime, mockFetchSibling);
    expect(result.sibling).toEqual({
      agent: "claude",
      status: "idle",
      lastMessage: "Finished migration",
    });
    // loadIssues returns not ok for non-existent repo, but refreshBoardState returns both results
    expect(result.loaded).toBeDefined();
  });
});
