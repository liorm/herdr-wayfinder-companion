import { defaultGh, type GhRunner, type Issue } from "./github/issues.ts";

export interface GitOutput {
	status: number;
	stdout: string;
	stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => Promise<GitOutput>;

export type FileChangeStatus =
	| "added"
	| "modified"
	| "deleted"
	| "renamed"
	| "untracked";

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
export function formatTicketBranch(
	ticketNumber: number,
	title: string,
): string {
	const slug = title
		.toLowerCase()
		.replace(/['"“”‘’]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug ? `${ticketNumber}-${slug}` : String(ticketNumber);
}

export async function defaultGit(
	args: string[],
	cwd: string,
): Promise<GitOutput> {
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
			return {
				status: status === 0 ? 124 : status,
				stdout,
				stderr: stderr.trim() || "git timed out after 20s",
			};
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
	const lines = porcelainOutput
		.split(/\r?\n/)
		.filter((l) => l.trim().length > 0);
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
	const rawBranches = result.stdout
		.split(/\r?\n/)
		.map((b) => b.trim())
		.filter((b) => b.length > 0);
	const branchSet = new Set<string>();

	for (const branch of rawBranches) {
		// Clean up remotes/origin/ or origin/
		const cleaned = branch
			.replace(/^(remotes\/)?origin\//, "")
			.replace(/^origin\//, "");
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
	const prefixMatch = branches.find(
		(b) => b.startsWith(prefix) || b === String(issueNumber),
	);
	if (prefixMatch) {
		return prefixMatch;
	}

	return undefined;
}

/**
 * Checks out main/master, pulls latest with rebase, and creates or switches to the target branch.
 * Requires a pristine working directory before proceeding.
 */
export async function prepareDeliveryBranch(
	cwd: string,
	branchName: string,
	run: GitRunner = defaultGit,
): Promise<{ ok: boolean; error?: string }> {
	// 1. Ensure working directory is pristine
	const modified = await getModifiedFiles(cwd, run);
	if (modified.length > 0) {
		const fileList = modified
			.map((f) => f.path)
			.slice(0, 5)
			.join(", ");
		const more = modified.length > 5 ? ` and ${modified.length - 5} more` : "";
		return {
			ok: false,
			error: `Working directory has uncommitted changes (${fileList}${more}). Please commit, stash, or clean before starting delivery.`,
		};
	}

	// Determine default base branch (main or master)
	let baseBranch = "main";
	const checkMain = await run(["rev-parse", "--verify", "main"], cwd);
	if (checkMain.status !== 0) {
		const checkMaster = await run(["rev-parse", "--verify", "master"], cwd);
		if (checkMaster.status === 0) {
			baseBranch = "master";
		}
	}

	// 2. Checkout base branch
	const checkoutBase = await run(["checkout", baseBranch], cwd);
	if (checkoutBase.status !== 0) {
		return {
			ok: false,
			error: `Failed to checkout ${baseBranch}: ${checkoutBase.stderr.trim() || checkoutBase.stdout.trim()}`,
		};
	}

	// 3. Pull latest base branch with rebase
	const pullResult = await run(["pull", "--rebase", "origin", baseBranch], cwd);
	if (pullResult.status !== 0) {
		// If pull origin fails, try bare git pull --rebase
		const fallbackPull = await run(["pull", "--rebase"], cwd);
		if (fallbackPull.status !== 0) {
			return {
				ok: false,
				error: `Failed to pull ${baseBranch}: ${pullResult.stderr.trim() || fallbackPull.stderr.trim()}`,
			};
		}
	}

	// 4. Switch to or create branch
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
	// 1. Try gh pr view for the current checked-out branch
	const viewResult = await runGh(
		["pr", "view", "--json", "number,title,url,state,headRefName"],
		cwd,
	);
	if (viewResult.status === 0 && viewResult.stdout.trim()) {
		try {
			const parsed = JSON.parse(viewResult.stdout) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const pr = parsed as Record<string, unknown>;
				if (pr.number && Number(pr.number) > 0) {
					const title = String(pr.title ?? "");
					const headRef = pr.headRefName ? String(pr.headRefName) : "";
					const matchesTicket =
						(branchName && headRef === branchName) ||
						headRef.startsWith(`${issueNumber}-`) ||
						headRef === String(issueNumber) ||
						new RegExp(`(#|\\b)${issueNumber}\\b`).test(title);
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

	// 2. If branchName is known, query gh pr list by head branch
	if (branchName) {
		const byBranch = await runGh(
			[
				"pr",
				"list",
				"--head",
				branchName,
				"--state",
				"all",
				"--json",
				"number,title,url,state,headRefName",
				"--limit",
				"1",
			],
			cwd,
		);
		if (byBranch.status === 0) {
			try {
				const parsed = JSON.parse(byBranch.stdout) as unknown[];
				if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]) {
					const pr = parsed[0] as Record<string, unknown>;
					if (pr.number && Number(pr.number) > 0) {
						return {
							number: Number(pr.number),
							title: String(pr.title ?? ""),
							url: String(pr.url ?? ""),
							state: String(pr.state ?? "").toLowerCase(),
							headRefName: pr.headRefName ? String(pr.headRefName) : undefined,
						};
					}
				}
			} catch {
				// ignore parse error
			}
		}
	}

	// 3. Query recent PRs in the repository directly (no search index delay)
	const recentPRs = await runGh(
		[
			"pr",
			"list",
			"--state",
			"all",
			"--limit",
			"30",
			"--json",
			"number,title,url,state,headRefName",
		],
		cwd,
	);
	if (recentPRs.status === 0) {
		try {
			const parsed = JSON.parse(recentPRs.stdout) as unknown[];
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					const pr = item as Record<string, unknown>;
					if (!pr?.number || Number(pr.number) <= 0) continue;
					const title = String(pr.title ?? "");
					const headRef = pr.headRefName ? String(pr.headRefName) : "";
					const matchesTicket =
						(branchName && headRef === branchName) ||
						headRef.startsWith(`${issueNumber}-`) ||
						headRef === String(issueNumber) ||
						new RegExp(`(#|\\b)${issueNumber}\\b`).test(title);
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

	// 4. Search for PRs referencing the issue number
	const bySearch = await runGh(
		[
			"pr",
			"list",
			"--search",
			`${issueNumber}`,
			"--state",
			"all",
			"--json",
			"number,title,url,state,headRefName",
			"--limit",
			"10",
		],
		cwd,
	);
	if (bySearch.status === 0) {
		try {
			const parsed = JSON.parse(bySearch.stdout) as unknown[];
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					const pr = item as Record<string, unknown>;
					if (!pr?.number || Number(pr.number) <= 0) continue;
					const title = String(pr.title ?? "");
					const headRef = pr.headRefName ? String(pr.headRefName) : "";
					const matchesTicket =
						(branchName && headRef === branchName) ||
						headRef.startsWith(`${issueNumber}-`) ||
						headRef === String(issueNumber) ||
						new RegExp(`(#|\\b)${issueNumber}\\b`).test(title);
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

/**
 * Polls for an existing PR associated with a ticket or branch until found or timeout.
 */
export async function waitForTicketPR(
	cwd: string,
	issueNumber: number,
	branchName?: string,
	runGh: GhRunner = defaultGh,
	maxWaitMs = 15_000,
	pollIntervalMs = 1_000,
	onPoll?: () => void | Promise<void>,
): Promise<PRInfo | null> {
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		const pr = await findTicketPR(cwd, issueNumber, branchName, runGh);
		if (pr && pr.number > 0 && pr.url) {
			return pr;
		}
		if (onPoll) {
			await onPoll();
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	// Try one final check
	const finalPR = await findTicketPR(cwd, issueNumber, branchName, runGh);
	if (finalPR && finalPR.number > 0 && finalPR.url) {
		return finalPR;
	}
	return null;
}

/**
 * Lists recent pull requests for the workspace repository via gh pr list.
 */
export async function listPullRequests(
	cwd: string,
	runGh: GhRunner = defaultGh,
): Promise<PRInfo[]> {
	const result = await runGh(
		[
			"pr",
			"list",
			"--state",
			"all",
			"--limit",
			"100",
			"--json",
			"number,title,url,state,headRefName",
		],
		cwd,
	);
	if (result.status !== 0) return [];
	try {
		const parsed = JSON.parse(result.stdout) as unknown[];
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(item): item is Record<string, unknown> =>
					typeof item === "object" && item !== null,
			)
			.map((pr) => ({
				number: Number(pr.number),
				title: String(pr.title ?? ""),
				url: String(pr.url ?? ""),
				state: String(pr.state ?? "").toLowerCase(),
				headRefName: pr.headRefName ? String(pr.headRefName) : undefined,
			}));
	} catch {
		return [];
	}
}

/**
 * Matches pull requests to issues based on head branch or issue references in PR title.
 */
export function matchPullRequestsToIssues(
	issues: Issue[],
	prs: PRInfo[],
	branches?: Record<number, string>,
): Record<number, PRInfo> {
	const matched: Record<number, PRInfo> = {};
	for (const issue of issues) {
		const branch = branches?.[issue.number];
		let found = branch
			? prs.find((pr) => pr.headRefName === branch)
			: undefined;
		if (!found) {
			found = prs.find((pr) => pr.headRefName?.startsWith(`${issue.number}-`));
		}
		if (!found) {
			const regex = new RegExp(`(#|\\b)${issue.number}\\b`);
			found = prs.find((pr) => regex.test(pr.title));
		}
		if (found) {
			matched[issue.number] = found;
		}
	}
	return matched;
}

/**
 * Squashes and merges a pull request on GitHub via gh pr merge.
 */
export async function squashPullRequest(
	cwd: string,
	prNumber: number,
	runGh: GhRunner = defaultGh,
): Promise<{ ok: boolean; error?: string }> {
	// Try gh pr merge <prNumber> --squash --delete-branch
	const result = await runGh(
		["pr", "merge", String(prNumber), "--squash", "--delete-branch"],
		cwd,
	);
	if (result.status === 0) {
		return { ok: true };
	}
	// Try fallback with auto-merge if standard merge failed (e.g. checks in progress or auto-merge required)
	const autoResult = await runGh(
		["pr", "merge", String(prNumber), "--squash", "--auto", "--delete-branch"],
		cwd,
	);
	if (autoResult.status === 0) {
		return { ok: true };
	}
	const errorMsg =
		autoResult.stderr.trim() ||
		result.stderr.trim() ||
		autoResult.stdout.trim() ||
		result.stdout.trim() ||
		`gh pr merge failed with status ${result.status}`;
	return { ok: false, error: errorMsg };
}

/**
 * Polls GitHub until the issue/ticket is closed.
 */
export async function waitForTicketClosed(
	cwd: string,
	issueNumber: number,
	runGh: GhRunner = defaultGh,
	maxWaitMs = 30_000,
	pollIntervalMs = 1_000,
	onPoll?: () => void | Promise<void>,
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		const result = await runGh(
			["issue", "view", String(issueNumber), "--json", "state,closed"],
			cwd,
		);
		if (result.status === 0 && result.stdout.trim()) {
			try {
				const parsed = JSON.parse(result.stdout) as {
					state?: string;
					closed?: boolean;
				};
				if (
					parsed.closed === true ||
					parsed.state?.toUpperCase() === "CLOSED"
				) {
					return true;
				}
			} catch {
				// ignore JSON parse error
			}
		}
		if (onPoll) {
			await onPoll();
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	// Final check
	const finalResult = await runGh(
		["issue", "view", String(issueNumber), "--json", "state,closed"],
		cwd,
	);
	if (finalResult.status === 0 && finalResult.stdout.trim()) {
		try {
			const parsed = JSON.parse(finalResult.stdout) as {
				state?: string;
				closed?: boolean;
			};
			if (parsed.closed === true || parsed.state?.toUpperCase() === "CLOSED") {
				return true;
			}
		} catch {
			// ignore
		}
	}

	return false;
}

/**
 * Opens a URL in the user's default browser.
 */
export function openInBrowser(url: string): void {
	if (!url) return;
	const cmd =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";
	try {
		Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
	} catch {
		// ignore
	}
}
