import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github/issues.ts";
import { formatPlainIssues, renderPane, type ListModel } from "../src/ui/render.ts";
import { boardRows, parentMapNumber, ticketKind, sortChildren } from "../src/wayfinder/board.ts";

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

describe("sortChildren", () => {
  test("places unblocked tickets before blocked tickets", () => {
    const t1 = issue({ number: 182, title: "Role and grants", labels: ["ready-for-agent"], body: "Part of #140\nBlocked by: None" });
    const t2 = issue({ number: 184, title: "Serve /studio and /admin", labels: ["ready-for-agent"], body: "Part of #140\nBlocked by: None" });
    const t3 = issue({ number: 190, title: "Build operator ledger", labels: ["ready-for-agent"], body: "Part of #140\nBlocked by: #182, #184" });
    const sorted = sortChildren([t3, t2, t1]);
    expect(sorted.map((t) => t.number)).toEqual([182, 184, 190]);
  });

  test("sorts multi-level dependency chains topologically", () => {
    const root = issue({ number: 10, title: "Root", labels: ["ready-for-agent"], body: "Part of #1\nBlocked by: None" });
    const mid = issue({ number: 20, title: "Mid", labels: ["ready-for-agent"], body: "Part of #1\nBlocked by: #10" });
    const leaf = issue({ number: 30, title: "Leaf", labels: ["ready-for-agent"], body: "Part of #1\nBlocked by: #20" });
    const sorted = sortChildren([leaf, root, mid]);
    expect(sorted.map((t) => t.number)).toEqual([10, 20, 30]);
  });

  test("places closed tickets at the bottom", () => {
    const openTicket = issue({ number: 50, title: "Open", labels: ["ready-for-agent"], body: "Part of #1\nBlocked by: None" });
    const closedTicket = issue({ number: 10, title: "Closed", labels: ["ready-for-agent"], body: "Part of #1\n", closed: true });
    const sorted = sortChildren([closedTicket, openTicket]);
    expect(sorted.map((t) => t.number)).toEqual([50, 10]);
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

  test("includes associated branch and PR badges when options are provided", () => {
    const rows = boardRows([claimed, blocked], {
      branches: { 171: "171-assign-strip-creator" },
      prs: { 171: { number: 45, url: "https://github.com/org/repo/pull/45" } },
    });
    expect(rows[0]).toEqual({ type: "label", text: "Map #140" });
    expect(rows[2]).toEqual({
      type: "issue",
      issue: blocked,
      depth: 1,
      kind: "delivery",
      badges: ["delivery", "PR #45", "blocked"],
      tone: "blocked",
    });

    const rowsWithBranchOnly = boardRows([claimed, blocked], {
      branches: { 171: "171-assign-strip-creator" },
    });
    expect(rowsWithBranchOnly[2]).toEqual({
      type: "issue",
      issue: blocked,
      depth: 1,
      kind: "delivery",
      badges: ["delivery", "171-assign-strip-creator", "blocked"],
      tone: "blocked",
    });
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
