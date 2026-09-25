import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github/issues.ts";
import { formatPlainIssues, renderPane, type ListModel } from "../src/ui/render.ts";
import { boardRows, parentMapNumber, ticketKind } from "../src/wayfinder/board.ts";

function issue(partial: Partial<Issue> & Pick<Issue, "number" | "title" | "labels">): Issue {
  return {
    url: "",
    assignees: [],
    closed: false,
    ...partial,
  };
}

const map = issue({
  number: 140,
  title: "Users, roles, and the operator dashboard",
  labels: ["wayfinder:map"],
});
const research = issue({
  number: 141,
  title: "Current admin vs user gating inventory",
  labels: ["wayfinder:research"],
  body: "Part of #140\n",
});
const claimed = issue({
  number: 143,
  title: "One role per person vs dual-hat",
  labels: ["wayfinder:grilling"],
  assignees: ["liorm"],
  body: "Part of #140\n",
});
const blocked = issue({
  number: 171,
  title: "Assign a strip's creator",
  labels: ["ready-for-agent"],
  body: "Part of #140\nBlocked by: #143\n",
});
const childOfMissing = issue({
  number: 64,
  title: "How the reader chooses UI language",
  labels: ["wayfinder:grilling"],
  body: "Part of #60\n",
  closed: true,
});
const bug = issue({ number: 4, title: "Cropped panel", labels: ["bug"] });

describe("ticketKind", () => {
  test("reads wayfinder labels, with delivery separate from decision types", () => {
    expect(ticketKind(["wayfinder:map"])).toBe("map");
    expect(ticketKind(["wayfinder:grilling", "needs-triage"])).toBe("grilling");
    expect(ticketKind(["ready-for-agent"])).toBe("delivery");
    expect(ticketKind(["wayfinder:task", "ready-for-agent"])).toBe("task");
    expect(ticketKind(["bug"])).toBe("other");
  });
});

describe("parentMapNumber", () => {
  test("reads the Part of line", () => {
    expect(parentMapNumber("Part of #140\n\n## Question\n")).toBe(140);
    expect(parentMapNumber("no parent")).toBeUndefined();
  });
});

describe("boardRows", () => {
  test("nests children under maps and keeps unrelated issues in Other", () => {
    const rows = boardRows([bug, blocked, claimed, research, map, childOfMissing]);
    expect(rows.map(describeRow)).toEqual([
      "issue #140 depth 0 map",
      "issue #141 depth 1 research · frontier",
      "issue #143 depth 1 grilling · liorm",
      "issue #171 depth 1 delivery · blocked",
      "label Map #60",
      "issue #64 depth 1 grilling · closed",
      "label Other",
      "issue #4 depth 0 bug",
    ]);
  });

  test("leaves a repo without maps as a flat list", () => {
    const rows = boardRows([bug]);
    expect(rows).toEqual([
      { type: "issue", issue: bug, depth: 0, kind: "other", badges: ["bug"] },
    ]);
  });
});

describe("render", () => {
  test("draws the map as a root and the selected child under it", () => {
    const issues = [map, research, claimed];
    const model: ListModel = {
      kind: "list",
      repo: "acme/ink",
      state: "open",
      issues: [map, research, claimed],
      selected: 1,
      scroll: 0,
    };
    const frame = renderPane(model, 80, 10);
    expect(frame).toContain("1 map");
    expect(frame).toContain("#140");
    expect(frame).toContain("  #141");
    expect(frame).toContain("research · frontier");
    expect(frame).toContain("\x1b[7m");
    expect(formatPlainIssues("acme/ink", "open", issues)).toContain("  #141  Current admin vs user gating inventory  research · frontier");
  });
});

function describeRow(row: ReturnType<typeof boardRows>[number]): string {
  if (row.type === "label") return `label ${row.text}`;
  return `issue #${row.issue.number} depth ${row.depth} ${row.badges.join(" · ")}`;
}
