import type { Issue, IssueState } from "../github/issues.ts";

export interface ListModel {
  kind: "list";
  repo: string;
  state: IssueState;
  issues: Issue[];
  selected: number;
  scroll: number;
  notice?: string;
}

export interface DetailModel {
  kind: "detail";
  issue: Issue;
  body: string;
  scroll: number;
  list: ListModel;
}

export interface MessageModel {
  kind: "message";
  title: string;
  lines: string[];
  footer: string;
}

export type PaneModel = ListModel | DetailModel | MessageModel;

export function reveal(selected: number, scroll: number, windowSize: number): number {
  if (windowSize <= 0) return 0;
  if (selected < scroll) return selected;
  if (selected >= scroll + windowSize) return selected - windowSize + 1;
  return scroll;
}

export function moveScroll(scroll: number, delta: number, lineCount: number, windowSize: number): number {
  const max = Math.max(0, lineCount - Math.max(windowSize, 0));
  return Math.min(max, Math.max(0, scroll + delta));
}

export function preserveSelection(issues: Issue[], selected: number, previousNumber: number | undefined): number {
  if (issues.length === 0) return 0;
  if (previousNumber !== undefined) {
    const kept = issues.findIndex((issue) => issue.number === previousNumber);
    if (kept >= 0) return kept;
  }
  return Math.min(selected, issues.length - 1);
}

export function renderPane(model: PaneModel, columns: number, rows: number): string {
  const width = Math.max(columns, 1);
  const height = Math.max(rows, 1);
  const lines = model.kind === "list"
    ? listLines(model, width, height)
    : model.kind === "detail"
      ? detailLines(model, width, height)
      : messageLines(model, width, height);
  let frame = "\x1b[H";
  for (let row = 0; row < height; row++) {
    frame += `\x1b[${row + 1};1H${lines[row] ?? blank(width)}`;
  }
  return frame;
}

export function formatPlainIssues(repo: string, state: IssueState, issues: Issue[]): string {
  const lines = [`${repo}  (${state})`, ""];
  if (issues.length === 0) {
    lines.push(`No ${state} issues.`);
  } else {
    for (const issue of issues) lines.push(issueText(issue, 200));
  }
  return lines.join("\n");
}

function listLines(model: ListModel, columns: number, rows: number): string[] {
  const windowSize = Math.max(rows - 3, 1);
  const scroll = reveal(model.selected, model.scroll, windowSize);
  const count = model.issues.length === 100 ? "100 (limit)" : String(model.issues.length);
  const subtitle = model.notice ?? `${model.state} · ${count}`;
  const lines = [
    pad(clip(`Wayfinder Companion  ${model.repo}`, columns), columns),
    pad(clip(subtitle, columns), columns),
  ];
  if (model.issues.length === 0) {
    lines.push(pad(clip(`No ${model.state} issues.`, columns), columns));
  } else {
    for (let index = 0; index < windowSize; index++) {
      const issue = model.issues[scroll + index];
      if (!issue) {
        lines.push(blank(columns));
        continue;
      }
      const text = pad(issueText(issue, columns), columns);
      lines.push(scroll + index === model.selected ? invert(text) : text);
    }
  }
  while (lines.length < rows - 1) lines.push(blank(columns));
  lines.push(pad(clip("j/k move   enter view   f filter   r refresh   q close", columns), columns));
  return lines.slice(0, rows);
}

function detailLines(model: DetailModel, columns: number, rows: number): string[] {
  const windowSize = Math.max(rows - 3, 1);
  const body = model.body.length > 0 ? model.body.split("\n") : ["This issue has no body."];
  const scroll = moveScroll(model.scroll, 0, body.length, windowSize);
  const lines = [
    pad(clip(`#${model.issue.number}  ${model.issue.title}`, columns), columns),
    pad(clip("j/k scroll   esc back   q close", columns), columns),
  ];
  for (let index = 0; index < windowSize; index++) {
    lines.push(pad(clip(body[scroll + index] ?? "", columns), columns));
  }
  return lines.slice(0, rows);
}

function messageLines(model: MessageModel, columns: number, rows: number): string[] {
  const lines = [pad(clip(model.title, columns), columns), blank(columns)];
  const bodyRoom = Math.max(rows - 3, 0);
  for (const line of model.lines.slice(0, bodyRoom)) lines.push(pad(clip(line, columns), columns));
  while (lines.length < rows - 1) lines.push(blank(columns));
  lines.push(pad(clip(model.footer, columns), columns));
  return lines.slice(0, rows);
}

function issueText(issue: Issue, width: number): string {
  const prefix = `#${issue.number}  `;
  const labels = issue.labels.length > 0 ? `  ${issue.labels.join(", ")}` : "";
  const budget = width - [...prefix].length - [...labels].length;
  if (budget < 8) return clip(`${prefix}${issue.title}`, width);
  return `${prefix}${clip(issue.title, budget)}${labels}`;
}

export function clip(text: string, width: number): string {
  if (width <= 0) return "";
  const chars = [...text];
  if (chars.length <= width) return text;
  if (width === 1) return "…";
  return `${chars.slice(0, width - 1).join("")}…`;
}

function pad(text: string, width: number): string {
  const extra = width - [...text].length;
  return extra > 0 ? text + " ".repeat(extra) : text;
}

function blank(width: number): string {
  return " ".repeat(Math.max(width, 0));
}

function invert(text: string): string {
  return `\x1b[7m${text}\x1b[27m`;
}
