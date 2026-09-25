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
      "issue #140 depth 0 map [map]",
      "issue #141 depth 1 research · frontier [frontier]",
      "issue #143 depth 1 grilling · in progress · liorm [progress]",
      "issue #171 depth 1 delivery · blocked [blocked]",
      "label Map #60",
      "issue #64 depth 1 grilling · closed [closed]",
      "label Other",
      "issue #4 depth 0 bug [plain]",
    ]);
  });

  test("lets blocked and triage beat an otherwise available ticket", () => {
    const triage = issue({
      number: 128,
      title: "What product metrics do we need first?",
      labels: ["wayfinder:grilling", "needs-triage"],
    });
    const ready = issue({
      number: 179,
      title: "Grant Admin from the env list only when none exist",
      labels: ["ready-for-agent"],
      body: "Part of #140\nBlocked by: None\n",
    });
    const waiting = issue({
      number: 12,
      title: "Need a repro",
      labels: ["needs-info"],
    });
    const rows = boardRows([map, triage, ready, waiting, claimed]);
    expect(rows.map(describeRow)).toEqual([
      "issue #140 depth 0 map [map]",
      "issue #143 depth 1 grilling · in progress · liorm [progress]",
      "issue #179 depth 1 delivery [ready]",
      "label Other",
      "issue #128 depth 0 grilling · needs-triage [attention]",
      "issue #12 depth 0 needs-info [attention]",
    ]);
  });

  test("leaves a repo without maps as a flat list", () => {
    const rows = boardRows([bug]);
    expect(rows).toEqual([
      { type: "issue", issue: bug, depth: 0, kind: "other", badges: ["bug"], tone: "plain" },
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
    expect(frame).toContain("\x1b[34m");
    expect(frame).toContain("\x1b[36m");
    expect(frame).toContain("\x1b[32m");
    expect(frame).toContain("in progress");
    expect(frame).toContain("\x1b[7m");
    expect(formatPlainIssues("acme/ink", "open", issues)).toContain(
      "  #141  Current admin vs user gating inventory  research · frontier",
    );
  });

  test("paints blocked rows red and leaves the plain list uncolored", () => {
    const model: ListModel = {
      kind: "list",
      repo: "acme/ink",
      state: "open",
      issues: [map, blocked, claimed],
      selected: 0,
      scroll: 0,
    };
    const frame = renderPane(model, 80, 10);
    expect(frame).toContain("\x1b[31m");
    expect(frame).toContain("blocked");
    expect(formatPlainIssues("acme/ink", "open", [map, blocked, claimed])).not.toContain("\x1b[");
  });
});

function describeRow(row: ReturnType<typeof boardRows>[number]): string {
  if (row.type === "label") return `label ${row.text}`;
  return `issue #${row.issue.number} depth ${row.depth} ${row.badges.join(" · ")} [${row.tone}]`;
}
