import type { Issue } from "../github/issues.ts";

/** Wayfinder ticket kinds from pass-the-ink `scripts/wayfinder.js` and `docs/agents/issue-tracker.md`. */
export type TicketKind = "map" | "grilling" | "research" | "prototype" | "task" | "delivery" | "other";

const DECISIONS = ["grilling", "research", "prototype", "task"] as const;

export type BoardRow =
  | { type: "issue"; issue: Issue; depth: number; kind: TicketKind; badges: string[] }
  | { type: "label"; text: string };

export function ticketKind(labels: string[]): TicketKind {
  if (labels.includes("wayfinder:map")) return "map";
  for (const type of DECISIONS) {
    if (labels.includes(`wayfinder:${type}`)) return type;
  }
  if (labels.includes("ready-for-agent")) return "delivery";
  return "other";
}

/** Child issues name their map with `Part of #<n>` at the top of the body. */
export function parentMapNumber(body: string | undefined): number | undefined {
  const match = body?.match(/Part of #(\d+)/);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isInteger(number) ? number : undefined;
}

export function blockerNumbers(body: string | undefined): number[] {
  const match = body?.match(/Blocked by:\s*([^\n]+)/);
  if (!match) return [];
  const line = match[1];
  if (!line) return [];
  const numbers: number[] = [];
  for (const found of line.matchAll(/#(\d+)/g)) {
    const number = Number(found[1]);
    if (Number.isInteger(number)) numbers.push(number);
  }
  return numbers;
}

export function boardRows(issues: Issue[]): BoardRow[] {
  if (!usesMaps(issues)) {
    return issues.map((issue) => issueRow(issue, 0, issues));
  }

  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const children = new Map<number, Issue[]>();
  const loose: Issue[] = [];

  for (const issue of issues) {
    if (ticketKind(issue.labels) === "map") continue;
    const parent = parentMapNumber(issue.body);
    if (parent === undefined || parent === issue.number) {
      loose.push(issue);
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(issue);
    children.set(parent, list);
  }

  const rows: BoardRow[] = [];
  const emitted = new Set<number>();
  const maps = issues
    .filter((issue) => ticketKind(issue.labels) === "map")
    .sort((a, b) => b.number - a.number);

  for (const map of maps) {
    emitted.add(map.number);
    rows.push(issueRow(map, 0, issues));
    for (const child of sortChildren(children.get(map.number) ?? [])) {
      emitted.add(child.number);
      rows.push(issueRow(child, 1, issues));
    }
  }

  const missingParents = [...children.keys()]
    .filter((number) => !maps.some((map) => map.number === number))
    .sort((a, b) => b - a);

  for (const parent of missingParents) {
    const parentIssue = byNumber.get(parent);
    if (parentIssue && !emitted.has(parentIssue.number)) {
      emitted.add(parentIssue.number);
      rows.push(issueRow(parentIssue, 0, issues));
    } else if (!parentIssue) {
      rows.push({ type: "label", text: `Map #${parent}` });
    }
    for (const child of sortChildren(children.get(parent) ?? [])) {
      if (emitted.has(child.number)) continue;
      emitted.add(child.number);
      rows.push(issueRow(child, 1, issues));
    }
  }

  const rest = loose.filter((issue) => !emitted.has(issue.number)).sort((a, b) => b.number - a.number);
  if (rest.length > 0) {
    if (rows.length > 0) rows.push({ type: "label", text: "Other" });
    for (const issue of rest) rows.push(issueRow(issue, 0, issues));
  }

  return rows;
}

export function selectableIssues(rows: BoardRow[]): Issue[] {
  return rows.flatMap((row) => (row.type === "issue" ? [row.issue] : []));
}

export function lineOfSelection(rows: BoardRow[], selected: number): number {
  const issue = selectableIssues(rows)[selected];
  if (!issue) return 0;
  const line = rows.findIndex((row) => row.type === "issue" && row.issue.number === issue.number);
  return line < 0 ? 0 : line;
}

function usesMaps(issues: Issue[]): boolean {
  return issues.some(
    (issue) => ticketKind(issue.labels) === "map" || parentMapNumber(issue.body) !== undefined,
  );
}

function sortChildren(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => a.number - b.number);
}

function issueRow(issue: Issue, depth: number, all: Issue[]): BoardRow {
  const kind = ticketKind(issue.labels);
  return { type: "issue", issue, depth, kind, badges: badgesFor(issue, kind, all) };
}

function badgesFor(issue: Issue, kind: TicketKind, all: Issue[]): string[] {
  const badges: string[] = [];
  if (kind === "other") {
    if (issue.labels.length > 0) badges.push(issue.labels.join(", "));
  } else {
    badges.push(kind);
    const extras = issue.labels.filter((label) => !isKindLabel(label, kind));
    if (extras.length > 0) badges.push(extras.join(", "));
  }
  if (issue.closed) badges.push("closed");

  const openNumbers = new Set(all.filter((item) => !item.closed).map((item) => item.number));
  const blocked = !issue.closed && blockerNumbers(issue.body).some((number) => openNumbers.has(number));
  if (blocked) badges.push("blocked");
  if (!issue.closed && issue.assignees.length > 0) badges.push(issue.assignees[0] ?? "");
  if (isFrontier(issue, kind, blocked)) badges.push("frontier");
  return badges.filter((badge) => badge.length > 0);
}

function isKindLabel(label: string, kind: TicketKind): boolean {
  if (kind === "map") return label === "wayfinder:map";
  if (kind === "delivery") return label === "ready-for-agent";
  if (kind === "other") return false;
  return label === `wayfinder:${kind}`;
}

function isFrontier(issue: Issue, kind: TicketKind, blocked: boolean): boolean {
  if (issue.closed || blocked || issue.assignees.length > 0) return false;
  if (issue.labels.includes("ready-for-agent")) return false;
  return kind === "grilling" || kind === "research" || kind === "prototype" || kind === "task";
}
