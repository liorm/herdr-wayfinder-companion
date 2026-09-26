import { describe, expect, test } from "bun:test";
import {
  findAssociatedBranch,
  findTicketPR,
  formatTicketBranch,
  getModifiedFiles,
  listGitBranches,
  listPullRequests,
  matchPullRequestsToIssues,
  parseGitStatus,
  prepareDeliveryBranch,
  waitForTicketPR,
  type GitRunner,
} from "../src/git.ts";
import type { GhRunner } from "../src/github/issues.ts";

describe("formatTicketBranch", () => {
  test("formats branch names in kebab-case with ticket number prefix", () => {
    expect(formatTicketBranch(42, "Add user authentication")).toBe("42-add-user-authentication");
    expect(formatTicketBranch(101, "Fix OAuth2 / Login redirect bug!")).toBe("101-fix-oauth2-login-redirect-bug");
    expect(formatTicketBranch(5, "UPPERCASE Title With Special @#$ Chars")).toBe("5-uppercase-title-with-special-chars");
    expect(formatTicketBranch(12, "   trimmed   spaces   ")).toBe("12-trimmed-spaces");
  });
});

describe("parseGitStatus", () => {
  test("correctly parses added, modified, deleted, and untracked files", () => {
    const porcelain = `
 M src/main.ts
M  src/runtime.ts
?? src/git.ts
A  src/new-feature.ts
 D old-file.txt
D  deleted-index.txt
R  old-name.ts -> new-name.ts
`;
    const files = parseGitStatus(porcelain);
    expect(files).toHaveLength(7);
    expect(files[0]).toEqual({ path: "src/main.ts", status: "modified", rawStatus: " M" });
    expect(files[1]).toEqual({ path: "src/runtime.ts", status: "modified", rawStatus: "M " });
    expect(files[2]).toEqual({ path: "src/git.ts", status: "untracked", rawStatus: "??" });
    expect(files[3]).toEqual({ path: "src/new-feature.ts", status: "added", rawStatus: "A " });
    expect(files[4]).toEqual({ path: "old-file.txt", status: "deleted", rawStatus: " D" });
    expect(files[5]).toEqual({ path: "deleted-index.txt", status: "deleted", rawStatus: "D " });
    expect(files[6]).toEqual({ path: "new-name.ts", status: "renamed", rawStatus: "R " });
  });

  test("handles empty git status", () => {
    expect(parseGitStatus("")).toEqual([]);
    expect(parseGitStatus("   \n  \n")).toEqual([]);
  });
});

describe("getModifiedFiles", () => {
  test("runs status --porcelain and returns parsed files", async () => {
    const mockGit: GitRunner = async (args) => {
      expect(args).toEqual(["status", "--porcelain"]);
      return {
        status: 0,
        stdout: " M src/index.ts\n?? test.txt\n",
        stderr: "",
      };
    };

    const files = await getModifiedFiles("/fake/repo", mockGit);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe("src/index.ts");
    expect(files[1]?.path).toBe("test.txt");
  });
});

describe("listGitBranches", () => {
  test("lists unique local and remote branches without origin prefixes", async () => {
    const mockGit: GitRunner = async (args) => {
      expect(args).toEqual(["branch", "-a", "--format=%(refname:short)"]);
      return {
        status: 0,
        stdout: `
main
42-add-auth
remotes/origin/HEAD
remotes/origin/main
origin/42-add-auth
origin/43-another-task
`,
        stderr: "",
      };
    };

    const branches = await listGitBranches("/fake/repo", mockGit);
    expect(branches).toContain("main");
    expect(branches).toContain("42-add-auth");
    expect(branches).toContain("43-another-task");
    expect(branches).not.toContain("HEAD");
  });
});

describe("findAssociatedBranch", () => {
  test("finds matching branch by exact name or prefix", () => {
    const branches = ["main", "42-add-auth", "43-fix-bug", "develop"];
    expect(findAssociatedBranch(42, "Add auth", branches)).toBe("42-add-auth");
    expect(findAssociatedBranch(43, "Fix bug completely", branches)).toBe("43-fix-bug");
    expect(findAssociatedBranch(99, "Nonexistent task", branches)).toBeUndefined();
  });
});

describe("prepareDeliveryBranch", () => {
  test("fails if working directory has uncommitted changes", async () => {
    const mockGit: GitRunner = async (args) => {
      if (args[0] === "status" && args[1] === "--porcelain") {
        return { status: 0, stdout: " M src/dirty.ts\n?? new-file.txt\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = await prepareDeliveryBranch("/fake/repo", "42-branch", mockGit);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Working directory has uncommitted changes (src/dirty.ts, new-file.txt)");
  });

  test("checks out main, pulls with rebase, and creates new branch when branch does not exist", async () => {
    const executed: string[][] = [];
    const mockGit: GitRunner = async (args) => {
      executed.push(args);
      if (args[0] === "rev-parse" && args[2] === "main") {
        return { status: 0, stdout: "abc", stderr: "" };
      }
      if (args[0] === "rev-parse" && args[2] === "42-new-branch") {
        return { status: 1, stdout: "", stderr: "not found" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = await prepareDeliveryBranch("/fake/repo", "42-new-branch", mockGit);
    expect(res.ok).toBe(true);
    expect(executed).toEqual([
      ["status", "--porcelain"],
      ["rev-parse", "--verify", "main"],
      ["checkout", "main"],
      ["pull", "--rebase", "origin", "main"],
      ["rev-parse", "--verify", "42-new-branch"],
      ["checkout", "-b", "42-new-branch"],
    ]);
  });

  test("checks out existing branch instead of creating with -b", async () => {
    const executed: string[][] = [];
    const mockGit: GitRunner = async (args) => {
      executed.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = await prepareDeliveryBranch("/fake/repo", "42-existing-branch", mockGit);
    expect(res.ok).toBe(true);
    expect(executed).toContainEqual(["checkout", "42-existing-branch"]);
  });

  test("handles checkout failure gracefully", async () => {
    const mockGit: GitRunner = async (args) => {
      if (args[0] === "checkout" && args[1] === "main") {
        return { status: 1, stdout: "", stderr: "error: checkout failed" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = await prepareDeliveryBranch("/fake/repo", "42-branch", mockGit);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Failed to checkout main: error: checkout failed");
  });
});

describe("findTicketPR", () => {
  test("finds PR via pr view on current branch", async () => {
    const mockGh: GhRunner = async (args) => {
      if (args.includes("view")) {
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 171,
            title: "Implement feature #171",
            url: "https://github.com/org/repo/pull/171",
            state: "OPEN",
            headRefName: "171-feature",
          }),
          stderr: "",
        };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    };

    const pr = await findTicketPR("/fake/repo", 171, "171-feature", mockGh);
    expect(pr).not.toBeNull();
    expect(pr?.number).toBe(171);
    expect(pr?.url).toBe("https://github.com/org/repo/pull/171");
  });

  test("finds PR by head branch", async () => {
    const mockGh: GhRunner = async (args) => {
      if (args.includes("view")) {
        return { status: 1, stdout: "", stderr: "no pull requests found" };
      }
      if (args.includes("--head")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 123,
              title: "Implement auth #42",
              url: "https://github.com/org/repo/pull/123",
              state: "OPEN",
              headRefName: "42-add-auth",
            },
          ]),
          stderr: "",
        };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    };

    const pr = await findTicketPR("/fake/repo", 42, "42-add-auth", mockGh);
    expect(pr).not.toBeNull();
    expect(pr?.number).toBe(123);
    expect(pr?.url).toBe("https://github.com/org/repo/pull/123");
  });

  test("finds PR by recent PR list", async () => {
    const mockGh: GhRunner = async (args) => {
      if (args.includes("view") || args.includes("--head")) {
        return { status: 1, stdout: "", stderr: "no pr" };
      }
      if (args.includes("--limit") && args.includes("30")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 789,
              title: "Fix bug for #55",
              url: "https://github.com/org/repo/pull/789",
              state: "OPEN",
              headRefName: "other-branch",
            },
          ]),
          stderr: "",
        };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    };

    const pr = await findTicketPR("/fake/repo", 55, "55-something", mockGh);
    expect(pr).not.toBeNull();
    expect(pr?.number).toBe(789);
    expect(pr?.title).toBe("Fix bug for #55");
  });

  test("finds PR by ticket search if head branch and list not matched", async () => {
    const mockGh: GhRunner = async (args) => {
      if (args.includes("view") || args.includes("--head") || (args.includes("--limit") && args.includes("30"))) {
        return { status: 0, stdout: "[]", stderr: "" };
      }
      if (args.includes("--search")) {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              number: 456,
              title: "Fix bug in ticket #43",
              url: "https://github.com/org/repo/pull/456",
              state: "MERGED",
              headRefName: "custom-branch",
            },
          ]),
          stderr: "",
        };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    };

    const pr = await findTicketPR("/fake/repo", 43, undefined, mockGh);
    expect(pr).not.toBeNull();
    expect(pr?.number).toBe(456);
    expect(pr?.state).toBe("merged");
  });
});

describe("waitForTicketPR", () => {
  test("waits until PR becomes available after multiple poll attempts", async () => {
    let pollAttempts = 0;
    const mockGh: GhRunner = async (args) => {
      // Count when a full findTicketPR cycle starts (pr view is the first call)
      if (args.includes("view")) {
        pollAttempts++;
      }
      if (pollAttempts < 3) {
        return { status: 1, stdout: "", stderr: "no pr yet" };
      }
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            number: 200,
            title: "PR for #99",
            url: "https://github.com/org/repo/pull/200",
            state: "OPEN",
            headRefName: "99-branch",
          },
        ]),
        stderr: "",
      };
    };

    let pollCallbacks = 0;
    const pr = await waitForTicketPR(
      "/fake/repo",
      99,
      "99-branch",
      mockGh,
      500,
      10,
      () => {
        pollCallbacks++;
      },
    );

    expect(pr).not.toBeNull();
    expect(pr?.number).toBe(200);
    expect(pollAttempts).toBeGreaterThanOrEqual(3);
    expect(pollCallbacks).toBeGreaterThanOrEqual(2);
  });

  test("returns null if PR is not found within timeout", async () => {
    const mockGh: GhRunner = async () => ({
      status: 1,
      stdout: "",
      stderr: "not found",
    });

    const pr = await waitForTicketPR("/fake/repo", 99, "99-branch", mockGh, 30, 10);
    expect(pr).toBeNull();
  });
});

describe("listPullRequests and matchPullRequestsToIssues", () => {
  test("lists pull requests from gh pr list and parses attributes", async () => {
    const mockGh: GhRunner = async () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          number: 10,
          title: "Add sessions feature for #180",
          url: "https://github.com/org/repo/pull/10",
          state: "OPEN",
          headRefName: "180-end-a-persons-exis",
        },
        {
          number: 11,
          title: "Map #140 updates",
          url: "https://github.com/org/repo/pull/11",
          state: "CLOSED",
          headRefName: "140-map-updates",
        },
      ]),
      stderr: "",
    });

    const prs = await listPullRequests("/fake/repo", mockGh);
    expect(prs).toHaveLength(2);
    expect(prs[0]).toEqual({
      number: 10,
      title: "Add sessions feature for #180",
      url: "https://github.com/org/repo/pull/10",
      state: "open",
      headRefName: "180-end-a-persons-exis",
    });
  });

  test("matches pull requests to issues by branch, prefix, and title", () => {
    const sampleIssues = [
      {
        number: 180,
        title: "End a person's existing sessions",
        url: "https://github.com/org/repo/issues/180",
        closed: false,
        labels: ["ready-for-agent"],
        assignees: [],
      },
      {
        number: 140,
        title: "Map 140",
        url: "https://github.com/org/repo/issues/140",
        closed: false,
        labels: ["wayfinder:map"],
        assignees: [],
      },
    ];

    const prs = [
      {
        number: 10,
        title: "Add sessions feature for #180",
        url: "https://github.com/org/repo/pull/10",
        state: "open",
        headRefName: "180-end-a-persons-exis",
      },
      {
        number: 11,
        title: "Map 140 updates",
        url: "https://github.com/org/repo/pull/11",
        state: "closed",
        headRefName: "custom-branch",
      },
    ];

    const matched = matchPullRequestsToIssues(sampleIssues, prs, { 180: "180-end-a-persons-exis" });
    expect(matched[180]?.number).toBe(10);
    expect(matched[180]?.url).toBe("https://github.com/org/repo/pull/10");
    expect(matched[140]?.number).toBe(11);
  });
});
