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
});

describe("formatPlainIssues", () => {
  test("prints one issue per line", () => {
    expect(formatPlainIssues("acme/widgets", "open", [issue])).toContain("acme/widgets  (open)\n\n#7  Fix the gate  bug");
  });

  test("says when the filter is empty", () => {
    expect(formatPlainIssues("acme/widgets", "closed", [])).toContain("No closed issues.");
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
  test("maps arrows, enter, quit characters, and ctrl-c", () => {
    expect(keyFromPress(undefined, { name: "up" })).toEqual({ kind: "up" });
    expect(keyFromPress(undefined, { name: "down" })).toEqual({ kind: "down" });
    expect(keyFromPress("\r", { name: "return" })).toEqual({ kind: "enter" });
    expect(keyFromPress("\x1b", { name: "escape" })).toEqual({ kind: "escape" });
    expect(keyFromPress("\x03", { name: "c", ctrl: true })).toEqual({ kind: "ctrl-c" });
    expect(keyFromPress("q", { name: "q" })).toEqual({ kind: "char", value: "q" });
    expect(keyFromPress("j", { name: "j" })).toEqual({ kind: "char", value: "j" });
  });
});
