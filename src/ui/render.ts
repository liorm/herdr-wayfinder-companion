import { ISSUE_LIMIT, type Issue, type IssueState } from "../github/issues.ts";
import { boardRows, lineOfSelection, selectableIssues, type BoardRow, type RowTone } from "../wayfinder/board.ts";
import type { SiblingAgent } from "../sibling.ts";

export interface ListModel {
  kind: "list";
  repo: string;
  state: IssueState;
  issues: Issue[];
  selected: number;
  scroll: number;
  notice?: string;
  sibling?: SiblingAgent;
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

export function formatAgentDetails(sibling: SiblingAgent): string {
  const agentName = sibling.agent;
  const status = sibling.status;
  const message = sibling.lastMessage;

  let label = "";
  if (agentName && status) {
    label = `${agentName} (${status})`;
  } else if (agentName) {
    label = agentName;
  } else if (status) {
    label = `agent (${status})`;
  }

  if (label && message) {
    return `${label}: ${message}`;
  }
  if (message) {
    return message;
  }
  if (label) {
    return label;
  }
  return "";
}

export function formatSubtitle(summary: string, notice?: string, sibling?: SiblingAgent): string {
  if (notice) return notice;
  if (!sibling) return summary;
  const details = formatAgentDetails(sibling);
  return details ? `${summary} · ${details}` : summary;
}

export function formatPlainIssues(
  repo: string,
  state: IssueState,
  issues: Issue[],
  sibling?: SiblingAgent,
): string {
  const summary = `${repo}  (${state})`;
  const header = sibling ? formatSubtitle(summary, undefined, sibling) : summary;
  const lines = [header, ""];
  const rows = boardRows(issues);
  if (selectableIssues(rows).length === 0) {
    lines.push(`No ${state} issues.`);
  } else {
    for (const row of rows) lines.push(rowText(row, 200));
  }
  return lines.join("\n");
}

function listLines(model: ListModel, columns: number, rows: number): string[] {
  const windowSize = Math.max(rows - 3, 1);
  const laid = boardRows(model.issues);
  const selectedLine = lineOfSelection(laid, model.selected);
  const scroll = reveal(selectedLine, model.scroll, windowSize);
  const count = model.issues.length === ISSUE_LIMIT ? `${ISSUE_LIMIT} (limit)` : String(model.issues.length);
  const maps = model.issues.filter((issue) => issue.labels.includes("wayfinder:map")).length;
  const summary = maps > 0 ? `${model.state} · ${count} · ${maps} ${maps === 1 ? "map" : "maps"}` : `${model.state} · ${count}`;
  const subtitle = formatSubtitle(summary, model.notice, model.sibling);
  const lines = [
    pad(clip(`Wayfinder Companion  ${model.repo}`, columns), columns),
    pad(clip(subtitle, columns), columns),
  ];
  if (selectableIssues(laid).length === 0) {
    lines.push(pad(clip(`No ${model.state} issues.`, columns), columns));
  } else {
    for (let index = 0; index < windowSize; index++) {
      const row = laid[scroll + index];
      if (!row) {
        lines.push(blank(columns));
        continue;
      }
      const text = pad(rowText(row, columns), columns);
      const selected = row.type === "issue" && scroll + index === selectedLine;
      const tone = row.type === "issue" ? row.tone : "plain";
      lines.push(paint(text, tone, selected, row.type === "label"));
    }
  }
  while (lines.length < rows - 1) lines.push(blank(columns));
  lines.push(pad(clip("j/k move   enter view   f filter   r refresh   q close", columns), columns));
  return lines.slice(0, rows);
}

function detailLines(model: DetailModel, columns: number, rows: number): string[] {
  const windowSize = Math.max(rows - 3, 1);
  const text = model.body.trim().length > 0 ? model.body : (model.issue.body?.trim() ?? "");
  const body = text.length > 0 ? text.split("\n") : ["This issue has no body."];
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

function rowText(row: BoardRow, width: number): string {
  if (row.type === "label") return clip(row.text, width);
  const indent = "  ".repeat(row.depth);
  const prefix = `${indent}#${row.issue.number}  `;
  const badges = row.badges.length > 0 ? `  ${row.badges.join(" · ")}` : "";
  const budget = width - [...prefix].length - [...badges].length;
  if (budget < 8) return clip(`${prefix}${row.issue.title}${badges}`, width);
  return `${prefix}${clip(row.issue.title, budget)}${badges}`;
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

/** SGR codes. Kind stays uncolored; these are the work states on a pass-the-ink board. */
const TONE_SGR: Record<RowTone, string | undefined> = {
  blocked: "31",
  progress: "32",
  frontier: "36",
  ready: "35",
  attention: "33",
  closed: "2",
  map: "34",
  plain: undefined,
};

function paint(text: string, tone: RowTone, selected: boolean, label = false): string {
  const color = label ? "2" : TONE_SGR[tone];
  if (!color && !selected) return text;
  let open = "";
  if (color) open += `\x1b[${color}m`;
  if (selected) open += "\x1b[7m";
  return `${open}${text}\x1b[0m`;
}
