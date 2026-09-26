import { describe, expect, test } from "bun:test";
import { keyFromPress } from "../src/ui/keys.ts";
import { formatPlainIssues, preserveSelection, renderPane, reveal, type ListModel } from "../src/ui/render.ts";
import type { Issue } from "../src/github/issues.ts";

const issue: Issue = {
  number: 7,
  title: "Fix the gate",
  url: "https://example.com/7",
  labels: ["bug"],
  assignees: [],
  closed: false,
};

describe("renderPane", () => {
  test("shows the repo, the selected issue, and its labels", () => {
    const model: ListModel = {
      kind: "list",
      repo: "acme/widgets",
      state: "open",
      issues: [issue],
      selected: 0,
      scroll: 0,
    };
    const frame = renderPane(model, 80, 8);
    expect(frame).toContain("acme/widgets");
    expect(frame).toContain("#7");
    expect(frame).toContain("Fix the gate");
    expect(frame).toContain("bug");
    expect(frame).toContain("\x1b[7m");
  });

  test("shows the sibling agent and last reported message in the status line", () => {
    const model: ListModel = {
      kind: "list",
      repo: "acme/widgets",
      state: "open",
      issues: [issue],
      selected: 0,
      scroll: 0,
      sibling: {
        agent: "grok",
        status: "idle",
        lastMessage: "One role bundles Studio and People grant…",
      },
    };
    const frame = renderPane(model, 100, 8);
    expect(frame).toContain("grok (idle): One role bundles Studio and People grant…");
  });

  test("detail view falls back to issue.body when model.body is empty", () => {
    const list: ListModel = {
      kind: "list",
      repo: "acme/widgets",
      state: "open",
      issues: [{ ...issue, body: "This is the fallback body from issue list." }],
      selected: 0,
      scroll: 0,
    };
    const frame = renderPane(
      {
        kind: "detail",
        issue: { ...issue, body: "This is the fallback body from issue list." },
        body: "",
        scroll: 0,
        list,
      },
      80,
      8,
    );
    expect(frame).toContain("This is the fallback body from issue list.");
    expect(frame).not.toContain("This issue has no body.");
    expect(frame).toContain("esc back");
    expect(frame).not.toContain("q close");
  });

  test("detail view renders markdown and word-wraps long content", () => {
    const list: ListModel = {
      kind: "list",
      repo: "acme/widgets",
      state: "open",
      issues: [issue],
      selected: 0,
      scroll: 0,
    };
    const frame = renderPane(
      {
        kind: "detail",
        issue,
        body: "# Bug Summary\n\nThis is a rather long sentence that needs to wrap cleanly within thirty columns without overflowing.",
        scroll: 0,
        list,
      },
      30,
      10,
    );
    expect(frame).toContain("Bug Summary");
    expect(frame).toContain("rather long");
    expect(plainRows(frame)[0]).toContain("#7");
    expect(plainRows(frame)[1]).toContain("Fix the gate");
    expect(plainRows(frame).at(-1)).toContain("esc back");
    expect(frame).not.toContain("q close");
  });

  test("detail scroll fills every row above the footer", () => {
    const list: ListModel = {
      kind: "list",
      repo: "acme/widgets",
      state: "open",
      issues: [issue],
      selected: 0,
      scroll: 0,
    };
    const body = Array.from({ length: 40 }, (_, index) => `paragraph ${index} ${"word ".repeat(12)}`).join("\n\n");
    const frame = renderPane(
      {
        kind: "detail",
        issue,
        body,
        scroll: 0,
        list,
      },
      40,
      12,
    );
    const rows = plainRows(frame);
    expect(rows).toHaveLength(12);
    expect(rows.at(-1)).toContain("esc back");
    expect(rows[0]).toContain("#7");
    expect(rows.some((row) => row.includes("paragraph 0"))).toBe(true);
    // Blank markdown rows still occupy a terminal row, so the window stays full height.
    expect(rows.slice(0, -1).some((row) => row.trim() === "" && row.length === 40)).toBe(true);
    const scrolled = renderPane(
      {
        kind: "detail",
        issue,
        body,
        scroll: 1000,
        list,
      },
      40,
      12,
    );
    expect(plainRows(scrolled).slice(0, -1).join("\n")).toContain("paragraph 39");
  });

  test("dialog view renders error title, ASCII icon, message, and dismiss hint", () => {
    const frame = renderPane(
      {
        kind: "dialog",
        title: "Not Implemented",
        message: "Work for grilling tickets is not implemented yet.",
        detail: "Please check back later",
      },
      80,
      10,
    );
    expect(frame).toContain("Not Implemented");
    expect(frame).toContain("╔═════╗");
    expect(frame).toContain("║  ✖  ║");
    expect(frame).toContain("Work for grilling tickets is not implemented yet.");
    expect(frame).toContain("Please check back later");
    expect(frame).toContain("[ OK ] (Enter or Esc)");
  });

  test("dialog view overlays the base background view without replacing it", () => {
    const list: ListModel = {
      kind: "list",
      repo: "acme/widgets",
      state: "open",
      issues: [issue],
      selected: 0,
      scroll: 0,
    };
    const frame = renderPane(
      {
        kind: "dialog",
        title: "Not Implemented",
        message: "Work for grilling tickets is not implemented yet.",
        base: list,
      },
      80,
      12,
    );
    expect(frame).toContain("acme/widgets");
    expect(frame).toContain("Wayfinder Companion");
    expect(frame).toContain("Not Implemented");
    expect(frame).toContain("║  ✖  ║");
  });
});

function plainRows(frame: string): string[] {
  return frame
    .split(/\x1b\[\d+;1H/)
    .slice(1)
    .map((row) => row.replace(/\x1b\[[0-9;]*m/g, ""));
}

describe("formatPlainIssues", () => {
  test("prints one issue per line", () => {
    expect(formatPlainIssues("acme/widgets", "open", [issue])).toContain("acme/widgets  (open)\n\n#7  Fix the gate  bug");
  });

  test("says when the filter is empty", () => {
    expect(formatPlainIssues("acme/widgets", "closed", [])).toContain("No closed issues.");
  });

  test("includes the sibling agent status and message when present", () => {
    const output = formatPlainIssues("acme/widgets", "open", [issue], {
      agent: "claude",
      status: "working",
      lastMessage: "Refactoring auth endpoints",
    });
    expect(output).toContain("acme/widgets  (open) · claude (working): Refactoring auth endpoints");
  });
});

describe("preserveSelection", () => {
  test("keeps the same issue number after a refresh", () => {
    const issues = [
      { ...issue, number: 1, title: "one" },
      { ...issue, number: 7, title: "seven" },
    ];
    expect(preserveSelection(issues, 0, 7)).toBe(1);
  });
});

describe("reveal", () => {
  test("scrolls the window so the selection stays visible", () => {
    expect(reveal(0, 5, 3)).toBe(0);
    expect(reveal(8, 0, 3)).toBe(6);
    expect(reveal(4, 2, 5)).toBe(2);
  });
});

describe("keyFromPress", () => {
  test("maps arrows, enter, quit characters, ctrl-c, and ctrl-w", () => {
    expect(keyFromPress(undefined, { name: "up" })).toEqual({ kind: "up" });
    expect(keyFromPress(undefined, { name: "down" })).toEqual({ kind: "down" });
    expect(keyFromPress("\r", { name: "return" })).toEqual({ kind: "enter" });
    expect(keyFromPress("\x1b", { name: "escape" })).toEqual({ kind: "escape" });
    expect(keyFromPress("\x03", { name: "c", ctrl: true })).toEqual({ kind: "ctrl-c" });
    expect(keyFromPress("\x17", { name: "w", ctrl: true })).toEqual({ kind: "ctrl-w" });
    expect(keyFromPress("\x17", undefined)).toEqual({ kind: "ctrl-w" });
    expect(keyFromPress("q", { name: "q" })).toEqual({ kind: "char", value: "q" });
    expect(keyFromPress("j", { name: "j" })).toEqual({ kind: "char", value: "j" });
    expect(keyFromPress("w", { name: "w" })).toEqual({ kind: "char", value: "w" });
  });
});

