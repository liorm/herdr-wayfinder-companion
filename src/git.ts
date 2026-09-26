import { defaultGh, type GhRunner } from "./github/issues.ts";

export interface GitOutput {
  status: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => Promise<GitOutput>;

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface ModifiedFile {
  path: string;
  status: FileChangeStatus;
  rawStatus: string;
}

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefName?: string;
}

/**
 * Creates a kebab-case branch name for a ticket in the format:
 * `XX-ticket-title-kebab-case`
 */
export function formatTicketBranch(ticketNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/['"“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${ticketNumber}-${slug}` : String(ticketNumber);
}

export async function defaultGit(args: string[], cwd: string): Promise<GitOutput> {
  try {
    const proc = Bun.spawn(["git", ...args], {
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
      return { status: status === 0 ? 124 : status, stdout, stderr: stderr.trim() || "git timed out after 20s" };
    }
    return { status, stdout, stderr };
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    return { status: 127, stdout: "", stderr };
  }
}

/**
 * Parses `git status --porcelain` output into structured modified file records.
 */
export function parseGitStatus(porcelainOutput: string): ModifiedFile[] {
  const lines = porcelainOutput.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const result: ModifiedFile[] = [];

  for (const line of lines) {
    if (line.length < 3) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rawStatus = `${x}${y}`;
    let filePath = line.slice(3).trim();

    // In case of rename: R  old -> new
    if (rawStatus.includes("R") && filePath.includes("->")) {
      const parts = filePath.split("->").map((p) => p.trim());
      filePath = parts[1] ?? filePath;
    }

    let status: FileChangeStatus = "modified";
    if (rawStatus === "??" || rawStatus.includes("?")) {
      status = "untracked";
    } else if (rawStatus.includes("A")) {
      status = "added";
    } else if (rawStatus.includes("D")) {
      status = "deleted";
    } else if (rawStatus.includes("R")) {
      status = "renamed";
    } else if (rawStatus.includes("M")) {
      status = "modified";
    }

    result.push({
      path: filePath,
      status,
      rawStatus,
    });
  }

  return result;
}

/**
 * Gets modified files in repository working copy.
 */
export async function getModifiedFiles(
  cwd: string,
  run: GitRunner = defaultGit,
): Promise<ModifiedFile[]> {
  const result = await run(["status", "--porcelain"], cwd);
  if (result.status !== 0) {
    return [];
  }
  return parseGitStatus(result.stdout);
}

/**
 * Lists all local and remote branches in the repository.
 */
export async function listGitBranches(
  cwd: string,
  run: GitRunner = defaultGit,
): Promise<string[]> {
  const result = await run(["branch", "-a", "--format=%(refname:short)"], cwd);
  if (result.status !== 0) {
    return [];
  }
  const rawBranches = result.stdout.split(/\r?\n/).map((b) => b.trim()).filter((b) => b.length > 0);
  const branchSet = new Set<string>();

  for (const branch of rawBranches) {
    // Clean up remotes/origin/ or origin/
    const cleaned = branch.replace(/^(remotes\/)?origin\//, "").replace(/^origin\//, "");
    if (cleaned && cleaned !== "HEAD" && !cleaned.includes("HEAD ->")) {
      branchSet.add(cleaned);
    }
  }

  return [...branchSet];
}

/**
 * Finds if an existing branch matches a ticket number or slug.
 */
export function findAssociatedBranch(
  issueNumber: number,
  title: string,
  branches: string[],
): string | undefined {
  const expectedName = formatTicketBranch(issueNumber, title);
  if (branches.includes(expectedName)) {
    return expectedName;
  }

  const prefix = `${issueNumber}-`;
  const prefixMatch = branches.find((b) => b.startsWith(prefix) || b === String(issueNumber));
  if (prefixMatch) {
    return prefixMatch;
  }

  return undefined;
}

/**
 * Checks out main/master, pulls latest, and creates or switches to the target branch.
 */
export async function prepareDeliveryBranch(
  cwd: string,
  branchName: string,
  run: GitRunner = defaultGit,
): Promise<{ ok: boolean; error?: string }> {
  // Determine default base branch (main or master)
  let baseBranch = "main";
  const checkMain = await run(["rev-parse", "--verify", "main"], cwd);
  if (checkMain.status !== 0) {
    const checkMaster = await run(["rev-parse", "--verify", "master"], cwd);
    if (checkMaster.status === 0) {
      baseBranch = "master";
    }
  }

  // 1. Checkout base branch
  const checkoutBase = await run(["checkout", baseBranch], cwd);
  if (checkoutBase.status !== 0) {
    return {
      ok: false,
      error: `Failed to checkout ${baseBranch}: ${checkoutBase.stderr.trim() || checkoutBase.stdout.trim()}`,
    };
  }

  // 2. Pull latest base branch
  const pullResult = await run(["pull", "origin", baseBranch], cwd);
  if (pullResult.status !== 0) {
    // If pull origin fails, try bare git pull
    const fallbackPull = await run(["pull"], cwd);
    if (fallbackPull.status !== 0) {
      return {
        ok: false,
        error: `Failed to pull ${baseBranch}: ${pullResult.stderr.trim() || fallbackPull.stderr.trim()}`,
      };
    }
  }

  // 3. Switch to or create branch
  const branchExists = await run(["rev-parse", "--verify", branchName], cwd);
  if (branchExists.status === 0) {
    const checkoutBranch = await run(["checkout", branchName], cwd);
    if (checkoutBranch.status !== 0) {
      return {
        ok: false,
        error: `Failed to checkout branch ${branchName}: ${checkoutBranch.stderr.trim()}`,
      };
    }
  } else {
    const createBranch = await run(["checkout", "-b", branchName], cwd);
    if (createBranch.status !== 0) {
      return {
        ok: false,
        error: `Failed to create branch ${branchName}: ${createBranch.stderr.trim()}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Searches for an existing PR associated with a ticket or branch.
 */
export async function findTicketPR(
  cwd: string,
  issueNumber: number,
  branchName?: string,
  runGh: GhRunner = defaultGh,
): Promise<PRInfo | null> {
  // 1. If branchName is known, query gh pr list by head branch
  if (branchName) {
    const byBranch = await runGh(
      ["pr", "list", "--head", branchName, "--state", "all", "--json", "number,title,url,state,headRefName", "--limit", "1"],
      cwd,
    );
    if (byBranch.status === 0) {
      try {
        const parsed = JSON.parse(byBranch.stdout) as unknown[];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]) {
          const pr = parsed[0] as Record<string, unknown>;
          return {
            number: Number(pr.number),
            title: String(pr.title ?? ""),
            url: String(pr.url ?? ""),
            state: String(pr.state ?? "").toLowerCase(),
            headRefName: pr.headRefName ? String(pr.headRefName) : undefined,
          };
        }
      } catch {
        // ignore parse error
      }
    }
  }

  // 2. Search for PRs referencing the issue number in title or search
  const bySearch = await runGh(
    ["pr", "list", "--search", `${issueNumber} in:title`, "--state", "all", "--json", "number,title,url,state,headRefName", "--limit", "5"],
    cwd,
  );
  if (bySearch.status === 0) {
    try {
      const parsed = JSON.parse(bySearch.stdout) as unknown[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const pr = item as Record<string, unknown>;
          const title = String(pr.title ?? "");
          const headRef = pr.headRefName ? String(pr.headRefName) : "";
          // Check if PR references ticket number as #XX or starts with XX-
          const matchesTicket =
            new RegExp(`(#|\\b)${issueNumber}\\b`).test(title) ||
            headRef.startsWith(`${issueNumber}-`);
          if (matchesTicket) {
            return {
              number: Number(pr.number),
              title,
              url: String(pr.url ?? ""),
              state: String(pr.state ?? "").toLowerCase(),
              headRefName: headRef || undefined,
            };
          }
        }
      }
    } catch {
      // ignore parse error
    }
  }

  return null;
}
