export type IssueState = "open" | "closed" | "all";

export interface Issue {
  number: number;
  title: string;
  url: string;
  updatedAt?: string;
  author?: string;
  labels: string[];
  assignees: string[];
  /** GitHub issue state. Missing `state` from `gh` is treated as open. */
  closed: boolean;
  body?: string;
}

export interface GhOutput {
  status: number;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[], cwd: string) => Promise<GhOutput>;

export type IssueLoad =
  | { ok: true; repo: string; state: IssueState; issues: Issue[] }
  | { ok: false; message: string };

export const ISSUE_LIMIT = 200;

const ISSUE_FIELDS = "number,title,labels,assignees,updatedAt,author,url,body,state";

export function nextIssueState(state: IssueState): IssueState {
  if (state === "open") return "closed";
  if (state === "closed") return "all";
  return "open";
}

export function parseRepoName(stdout: string): string {
  const parsed = JSON.parse(stdout) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("gh repo view did not return an object");
  }
  const name = (parsed as Record<string, unknown>).nameWithOwner;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("gh repo view did not return nameWithOwner");
  }
  return name;
}

export function parseIssues(stdout: string): Issue[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("gh issue list did not return a JSON array");
  }
  return parsed.flatMap(parseIssue);
}

export async function loadIssues(
  cwd: string,
  state: IssueState,
  run: GhRunner = defaultGh,
): Promise<IssueLoad> {
  const [repo, list] = await Promise.all([
    run(["repo", "view", "--json", "nameWithOwner"], cwd),
    run(["issue", "list", "--state", state, "--limit", String(ISSUE_LIMIT), "--json", ISSUE_FIELDS], cwd),
  ]);

  if (repo.status !== 0) return { ok: false, message: ghFailure(repo) };
  if (list.status !== 0) return { ok: false, message: ghFailure(list) };

  try {
    return { ok: true, repo: parseRepoName(repo.stdout), state, issues: parseIssues(list.stdout) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: detail };
  }
}

export async function loadIssueView(
  cwd: string,
  number: number,
  run: GhRunner = defaultGh,
): Promise<{ ok: true; body: string; comments: string } | { ok: false; message: string }> {
  const result = await run(["issue", "view", String(number)], cwd);
  if (result.status !== 0) return { ok: false, message: ghFailure(result) };
  const body = result.stdout.replace(/\s+$/, "");
  let comments = "";

  try {
    const commentResult = await run(["issue", "view", String(number), "--comments"], cwd);
    if (commentResult.status === 0) comments = commentResult.stdout.replace(/\s+$/, "");
  } catch {
    // comments fetching is best-effort
  }

  return { ok: true, body, comments };
}

export async function defaultGh(args: string[], cwd: string): Promise<GhOutput> {
  try {
    const proc = Bun.spawn(["gh", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, 20_000);
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    if (timedOut) {
      return { status: status === 0 ? 124 : status, stdout, stderr: stderr.trim() || "gh timed out after 20s" };
    }
    return { status, stdout, stderr };
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    return { status: 127, stdout: "", stderr };
  }
}

function ghFailure(result: GhOutput): string {
  const text = result.stderr.trim() || result.stdout.trim();
  if (result.status === 127 || /ENOENT|not found/i.test(text)) {
    return "gh was not found on PATH. Install the GitHub CLI and authenticate with `gh auth login`.";
  }
  return text || `gh exited ${result.status}`;
}

function parseIssue(value: unknown): Issue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.number !== "number" || typeof record.title !== "string") return [];
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : undefined;
  const author = loginOf(record.author);
  return [
    {
      number: record.number,
      title: record.title,
      url: typeof record.url === "string" ? record.url : "",
      ...(updatedAt ? { updatedAt } : {}),
      ...(author ? { author } : {}),
      labels: namesOf(record.labels),
      assignees: loginsOf(record.assignees),
      closed: isClosed(record),
      ...(typeof record.body === "string" ? { body: record.body } : {}),
    },
  ];
}

function isClosed(record: Record<string, unknown>): boolean {
  if (typeof record.closed === "boolean") return record.closed;
  const state = typeof record.state === "string" ? record.state.toLowerCase() : "";
  return state === "closed";
}

function loginOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const login = (value as Record<string, unknown>).login;
  return typeof login === "string" && login.length > 0 ? login : undefined;
}

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const name = (item as Record<string, unknown>).name;
    return typeof name === "string" && name.length > 0 ? [name] : [];
  });
}

function loginsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const login = loginOf(item);
    return login ? [login] : [];
  });
}
