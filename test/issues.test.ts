import { describe, expect, test } from "bun:test";
import { loadIssues, loadIssueView, nextIssueState, parseIssues, parseRepoName, type GhRunner } from "../src/github/issues.ts";

const issueJson = JSON.stringify([
  {
    number: 7,
    title: "Fix the gate",
    url: "https://github.com/acme/widgets/issues/7",
    updatedAt: "2026-09-01T00:00:00Z",
    author: { login: "ada" },
    labels: [{ name: "bug" }, { name: "" }],
    assignees: [{ login: "grace" }],
  },
  { title: "missing number" },
]);

describe("parseIssues", () => {
  test("reads gh issue list JSON and skips malformed rows", () => {
    const issues = parseIssues(issueJson);
    expect(issues).toEqual([
      {
        number: 7,
        title: "Fix the gate",
        url: "https://github.com/acme/widgets/issues/7",
        updatedAt: "2026-09-01T00:00:00Z",
        author: "ada",
        labels: ["bug"],
        assignees: ["grace"],
        closed: false,
      },
    ]);
  });
});

describe("loadIssues", () => {
  const run: GhRunner = async (args) => {
    if (args[0] === "repo") return { status: 0, stdout: '{"nameWithOwner":"acme/widgets"}\n', stderr: "" };
    return { status: 0, stdout: issueJson, stderr: "" };
  };

  test("loads the repo name and open issues", async () => {
    const loaded = await loadIssues("/work/widgets", "open", run);
    expect(loaded).toEqual({
      ok: true,
      repo: "acme/widgets",
      state: "open",
      issues: [
        {
          number: 7,
          title: "Fix the gate",
          url: "https://github.com/acme/widgets/issues/7",
          updatedAt: "2026-09-01T00:00:00Z",
          author: "ada",
          labels: ["bug"],
          assignees: ["grace"],
          closed: false,
        },
      ],
    });
  });

  test("reports a missing gh binary", async () => {
    const missing: GhRunner = async () => ({ status: 127, stdout: "", stderr: "spawn gh ENOENT" });
    const loaded = await loadIssues("/work/widgets", "open", missing);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.message).toContain("gh auth login");
  });

  test("prefers the repo view error when the directory is not a GitHub repo", async () => {
    const missing: GhRunner = async (args) => ({
      status: 1,
      stdout: "",
      stderr: args[0] === "repo" ? "no git remotes found" : "not a repository",
    });
    const loaded = await loadIssues("/work/widgets", "open", missing);
    expect(loaded).toEqual({ ok: false, message: "no git remotes found" });
  });
});

describe("loadIssueView", () => {
  test("returns the gh issue view text", async () => {
    const run: GhRunner = async (args) => {
      expect(args).toEqual(["issue", "view", "7", "--comments"]);
      return { status: 0, stdout: "title:\tFix the gate\n", stderr: "" };
    };
    const viewed = await loadIssueView("/work/widgets", 7, run);
    expect(viewed).toEqual({ ok: true, body: "title:\tFix the gate" });
  });
});

describe("nextIssueState", () => {
  test("cycles open, closed, then all", () => {
    expect(nextIssueState("open")).toBe("closed");
    expect(nextIssueState("closed")).toBe("all");
    expect(nextIssueState("all")).toBe("open");
  });
});

describe("parseRepoName", () => {
  test("reads nameWithOwner", () => {
    expect(parseRepoName('{"nameWithOwner":"acme/widgets"}')).toBe("acme/widgets");
  });
});
