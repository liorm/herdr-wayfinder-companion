import type { Issue } from "../github/issues.ts";
import { boardRows, type BoardOptions, type RowTone } from "../wayfinder/board.ts";
import { formatMarkdown } from "./markdown.ts";

/** Ticket view footer. `q` closes the whole plugin, so it is not a ticket shortcut. */
export const TICKET_FOOTER = "j/k scroll   esc back   o open   w work";

export interface IssueViewFields {
  [key: string]: string;
}

export interface RawComment {
  author: string;
  association: string;
  edited: boolean;
  status: string;
  body: string;
}

const TONE_SGR: Record<RowTone, string | undefined> = {
  blocked: "31",
  progress: "32",
  frontier: "36",
  ready: "35",
  attention: "33",
  closed: "2",
  map: "34",
  plain: "32",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseIssueView(text: string): { fields: IssueViewFields; body: string } {
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return { fields: {}, body: "" };
  const lines = trimmed.split("\n");
  if (!/^title:[ \t]/.test(lines[0] ?? "")) return { fields: {}, body: trimmed };

  const fields: IssueViewFields = {};
  let index = 0;
  for (; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line === "--") {
      index += 1;
      break;
    }
    const match = /^([A-Za-z]+):[ \t]?(.*)$/.exec(line);
    if (!match) break;
    fields[match[1]?.toLowerCase() ?? ""] = (match[2] ?? "").trim();
  }
  return { fields, body: lines.slice(index).join("\n").replace(/^\n/, "").replace(/\s+$/, "") };
}

export function parseRawComments(text: string): { comments: RawComment[]; rest: string } {
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return { comments: [], rest: "" };

  const comments: RawComment[] = [];
  const rest: string[] = [];
  for (const block of trimmed.split(/\n(?=author:[ \t])/)) {
    const match = /^author:[ \t]([^\n]*)\nassociation:[ \t]([^\n]*)\nedited:[ \t]([^\n]*)\nstatus:[ \t]([^\n]*)\n--\n([\s\S]*)$/.exec(
      block,
    );
    if (!match) {
      if (block.trim()) rest.push(block.trim());
      continue;
    }
    comments.push({
      author: (match[1] ?? "").trim(),
      association: (match[2] ?? "").trim(),
      edited: (match[3] ?? "").trim() === "true",
      status: (match[4] ?? "").trim(),
      body: (match[5] ?? "").replace(/\n--\s*$/, "").replace(/\s+$/, ""),
    });
  }
  return { comments, rest: rest.join("\n\n").trim() };
}

export function formatTicketView(
  issue: Issue,
  viewText: string,
  commentsText: string,
  columns: number,
  issues: Issue[] = [issue],
  options?: BoardOptions,
): string[] {
  const width = Math.max(columns, 1);
  const parsed = parseIssueView(viewText);
  const description = parsed.body.trim() || issue.body?.trim() || "";
  const { comments, rest } = parseRawComments(commentsText);
  const { tone, badges } = describeIssue(issue, issues, options);
  const closed = parsed.fields.state ? parsed.fields.state.toUpperCase() === "CLOSED" : issue.closed;
  const lines: string[] = [];

  lines.push(
    ...renderSegments(
      [
        { text: `#${issue.number}`, codes: "1" },
        { text: closed ? "Closed" : "Open", codes: closed ? "2" : (TONE_SGR[tone] ?? "32") },
        ...statusBadges(badges, issue).map((badge) => ({ text: badge, codes: badgeCode(badge, tone) })),
      ],
      width,
    ),
  );

  const title = (issue.title || parsed.fields.title || "(untitled)").trim();
  for (const line of wrapPlain(title, width)) lines.push(style(line, "1"));

  const meta = metaLine(issue, parsed.fields);
  if (meta) {
    for (const line of wrapPlain(meta, width)) lines.push(style(line, "2"));
  }

  const pr = options?.prs ? (options.prs instanceof Map ? options.prs.get(issue.number) : options.prs[issue.number]) : undefined;
  if (pr) {
    const prLine = `Pull Request: PR #${pr.number} • ${pr.url}${pr.state ? ` [${pr.state}]` : ""}`;
    for (const line of wrapPlain(prLine, width)) lines.push(style(line, "35"));
  }

  const hasBody = description.length > 0 || comments.length > 0 || rest.length > 0;
  if (hasBody) lines.push(style("─".repeat(width), "2"));

  if (description) {
    lines.push(...formatMarkdown(description, width));
  } else if (!hasBody) {
    lines.push(style("This issue has no body.", "2"));
  }

  if (comments.length > 0 || rest.length > 0) {
    lines.push("");
    lines.push(style("Comments", "1"));
    for (const comment of comments) {
      lines.push(commentHeader(comment));
      if (comment.body.trim()) lines.push(...formatMarkdown(comment.body, width));
      lines.push("");
    }
    if (rest) lines.push(...formatMarkdown(rest, width));
  }

  return lines;
}

function describeIssue(issue: Issue, issues: Issue[], options?: BoardOptions): { tone: RowTone; badges: string[] } {
  const source = issues.some((item) => item.number === issue.number) ? issues : [issue, ...issues];
  const found = boardRows(source, options).find((row) => row.type === "issue" && row.issue.number === issue.number);
  if (found && found.type === "issue") return { tone: found.tone, badges: found.badges };
  return { tone: issue.closed ? "closed" : "plain", badges: [] };
}

function statusBadges(badges: string[], issue: Issue): string[] {
  const assignees = new Set(issue.assignees);
  return badges.filter((badge) => badge !== "closed" && !assignees.has(badge));
}

function badgeCode(badge: string, tone: RowTone): string {
  if (badge === "blocked") return "31";
  if (badge === "in progress") return "32";
  if (badge === "frontier") return "36";
  if (badge === "map") return "34";
  if (badge === "delivery" || tone === "ready") return "35";
  if (tone === "attention") return "33";
  return "2";
}

function metaLine(issue: Issue, fields: IssueViewFields): string {
  const parts: string[] = [];
  const author = issue.author || fields.author;
  if (author) parts.push(author);
  if (issue.assignees.length > 0) parts.push(`assigned ${issue.assignees.join(", ")}`);
  if (fields.comments) {
    const count = Number(fields.comments);
    if (Number.isInteger(count) && count >= 0) parts.push(`${count} ${count === 1 ? "comment" : "comments"}`);
  }
  const updated = formatUpdated(issue.updatedAt);
  if (updated) parts.push(updated);
  if (fields.milestone) parts.push(`milestone ${fields.milestone}`);
  if (fields.projects) parts.push(fields.projects);
  return parts.join(" · ");
}

function formatUpdated(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const month = MONTHS[date.getUTCMonth()] ?? "";
  return `updated ${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

function commentHeader(comment: RawComment): string {
  const parts = [style(comment.author || "comment", "1")];
  const association = comment.association.toLowerCase();
  if (association && association !== "none") parts.push(style(comment.association, "2"));
  const status = comment.status.toLowerCase();
  if (status && status !== "none") parts.push(style(comment.status, status === "approved" ? "32" : "2"));
  if (comment.edited) parts.push(style("edited", "2"));
  return parts.join(style(" · ", "2"));
}

function renderSegments(parts: Array<{ text: string; codes?: string }>, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  let used = 0;
  const commit = () => {
    if (!current) return;
    lines.push(current);
    current = "";
    used = 0;
  };
  const append = (chunk: string, codes: string | undefined) => {
    if (used > 0 && used + 2 + [...chunk].length > width) commit();
    if (used > 0) {
      current += "  ";
      used += 2;
    }
    current += style(chunk, codes);
    used += [...chunk].length;
  };
  for (const part of parts) {
    const text = part.text.trim();
    if (!text) continue;
    const chunks = wrapPlain(text, width);
    chunks.forEach((chunk, index) => {
      append(chunk, part.codes);
      if (index < chunks.length - 1) commit();
    });
  }
  commit();
  return lines.length > 0 ? lines : [""];
}

function wrapPlain(text: string, width: number): string[] {
  const chars = [...text];
  if (chars.length <= width) return [text];
  const lines: string[] = [];
  let rest = chars;
  while (rest.length > width) {
    let breakAt = width;
    const window = rest.slice(0, width);
    const lastSpace = window.lastIndexOf(" ");
    if (lastSpace > Math.floor(width * 0.4)) breakAt = lastSpace;
    lines.push(rest.slice(0, breakAt).join("").trimEnd());
    rest = rest.slice(breakAt);
    while (rest[0] === " ") rest = rest.slice(1);
  }
  if (rest.length > 0) lines.push(rest.join(""));
  return lines;
}

function style(text: string, codes: string | undefined): string {
  if (!codes || text.length === 0) return text;
  return `\x1b[${codes}m${text}\x1b[0m`;
}
