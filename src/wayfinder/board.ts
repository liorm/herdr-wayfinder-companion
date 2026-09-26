import type { Issue } from "../github/issues.ts";

/** Wayfinder ticket kinds from pass-the-ink `scripts/wayfinder.js` and `docs/agents/issue-tracker.md`. */
export type TicketKind = "map" | "grilling" | "research" | "prototype" | "task" | "delivery" | "other";

const DECISIONS = ["grilling", "research", "prototype", "task"] as const;

/** Work state painted on a list row. Ticket kind stays text; color follows this. */
export type RowTone =
  | "blocked"
  | "progress"
  | "frontier"
  | "ready"
  | "attention"
  | "closed"
  | "map"
  | "plain";

export type BoardRow =
  | { type: "issue"; issue: Issue; depth: number; kind: TicketKind; badges: string[]; tone: RowTone }
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

export interface BoardOptions {
  branches?: Map<number, string> | Record<number, string>;
  prs?: Map<number, { number: number; url: string; state?: string }> | Record<number, { number: number; url: string; state?: string }>;
}

export function boardRows(issues: Issue[], options?: BoardOptions): BoardRow[] {
  if (!usesMaps(issues)) {
    return issues.map((issue) => issueRow(issue, 0, issues, options));
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
    rows.push(issueRow(map, 0, issues, options));
    for (const child of sortChildren(children.get(map.number) ?? [], issues)) {
      emitted.add(child.number);
      rows.push(issueRow(child, 1, issues, options));
    }
  }

  const missingParents = [...children.keys()]
    .filter((number) => !maps.some((map) => map.number === number))
    .sort((a, b) => b - a);

  for (const parent of missingParents) {
    const parentIssue = byNumber.get(parent);
    if (parentIssue && !emitted.has(parentIssue.number)) {
      emitted.add(parentIssue.number);
      rows.push(issueRow(parentIssue, 0, issues, options));
    } else if (!parentIssue) {
      rows.push({ type: "label", text: `Map #${parent}` });
    }
    for (const child of sortChildren(children.get(parent) ?? [], issues)) {
      if (emitted.has(child.number)) continue;
      emitted.add(child.number);
      rows.push(issueRow(child, 1, issues, options));
    }
  }

  const rest = loose.filter((issue) => !emitted.has(issue.number)).sort((a, b) => b.number - a.number);
  if (rest.length > 0) {
    if (rows.length > 0) rows.push({ type: "label", text: "Other" });
    for (const issue of rest) rows.push(issueRow(issue, 0, issues, options));
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

export function sortChildren(issues: Issue[], all: Issue[] = issues): Issue[] {
  const openNumbers = new Set(all.filter((item) => !item.closed).map((item) => item.number));
  const childMap = new Map(issues.map((issue) => [issue.number, issue]));

  const levels = new Map<number, number>();
  const visiting = new Set<number>();

  function getLevel(issue: Issue): number {
    if (issue.closed) return Infinity;
    if (levels.has(issue.number)) return levels.get(issue.number)!;
    if (visiting.has(issue.number)) return 0;

    visiting.add(issue.number);

    const blockers = blockerNumbers(issue.body);
    const openBlockers = blockers.filter((num) => openNumbers.has(num));

    if (openBlockers.length === 0) {
      visiting.delete(issue.number);
      levels.set(issue.number, 0);
      return 0;
    }

    let maxBlockerLevel = 0;
    for (const blockerNum of openBlockers) {
      const blockerIssue = childMap.get(blockerNum);
      if (blockerIssue) {
        maxBlockerLevel = Math.max(maxBlockerLevel, getLevel(blockerIssue));
      } else {
        maxBlockerLevel = Math.max(maxBlockerLevel, 0);
      }
    }

    visiting.delete(issue.number);
    const level = 1 + maxBlockerLevel;
    levels.set(issue.number, level);
    return level;
  }

  return [...issues].sort((a, b) => {
    if (a.closed !== b.closed) {
      return a.closed ? 1 : -1;
    }
    if (a.closed && b.closed) {
      return a.number - b.number;
    }
    const levelA = getLevel(a);
    const levelB = getLevel(b);
    if (levelA !== levelB) {
      return levelA - levelB;
    }
    return a.number - b.number;
  });
}

export function isIssueBlocked(issue: Issue, all: Issue[]): boolean {
  if (issue.closed) return false;
  const openNumbers = new Set(all.filter((item) => !item.closed).map((item) => item.number));
  return blockerNumbers(issue.body).some((number) => openNumbers.has(number));
}

function getOptionBranch(options: BoardOptions | undefined, issueNumber: number): string | undefined {
  if (!options?.branches) return undefined;
  if (options.branches instanceof Map) return options.branches.get(issueNumber);
  return options.branches[issueNumber];
}

function getOptionPR(
  options: BoardOptions | undefined,
  issueNumber: number,
): { number: number; url: string; state?: string } | undefined {
  if (!options?.prs) return undefined;
  if (options.prs instanceof Map) return options.prs.get(issueNumber);
  return options.prs[issueNumber];
}

function issueRow(issue: Issue, depth: number, all: Issue[], options?: BoardOptions): BoardRow {
  const kind = ticketKind(issue.labels);
  const blocked = isIssueBlocked(issue, all);
  const branch = getOptionBranch(options, issue.number);
  const pr = getOptionPR(options, issue.number);
  const badges = badgesFor(issue, kind, blocked, branch, pr);
  return { type: "issue", issue, depth, kind, badges, tone: rowTone(issue, kind, blocked, pr) };
}

function badgesFor(
  issue: Issue,
  kind: TicketKind,
  blocked: boolean,
  branch?: string,
  pr?: { number: number; url: string; state?: string },
): string[] {
  const badges: string[] = [];
  if (kind === "other") {
    if (issue.labels.length > 0) badges.push(issue.labels.join(", "));
  } else {
    badges.push(kind);
    const extras = issue.labels.filter((label) => !isKindLabel(label, kind));
    if (extras.length > 0) badges.push(extras.join(", "));
  }
  if (branch) {
    badges.push(branch);
  }
  if (pr) {
    badges.push(`PR #${pr.number}`);
  }
  if (issue.closed) badges.push("closed");
  if (blocked) badges.push("blocked");
  if (!issue.closed && issue.assignees.length > 0) {
    if (!blocked) badges.push("in progress");
    badges.push(issue.assignees[0] ?? "");
  }
  if (isFrontier(issue, kind, blocked)) badges.push("frontier");
  return badges.filter((badge) => badge.length > 0);
}

/** One color per row. Blocked and claimed beat "available" states. */
export function rowTone(
  issue: Issue,
  kind: TicketKind,
  blocked: boolean,
  _pr?: { number: number; url: string; state?: string },
): RowTone {
  if (issue.closed) return "closed";
  if (blocked) return "blocked";
  if (issue.assignees.length > 0) return "progress";
  if (issue.labels.includes("needs-info") || issue.labels.includes("needs-triage")) return "attention";
  if (isFrontier(issue, kind, blocked)) return "frontier";
  if (kind === "delivery" || issue.labels.includes("ready-for-human")) return "ready";
  if (kind === "map") return "map";
  return "plain";
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
  if (issue.labels.includes("needs-triage") || issue.labels.includes("needs-info")) return false;
  return kind === "grilling" || kind === "research" || kind === "prototype" || kind === "task";
}
