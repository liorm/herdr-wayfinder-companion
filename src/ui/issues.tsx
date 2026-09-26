import { render } from "ink";
import {
  loadIssues,
  type Issue,
  type IssueState,
} from "../github/issues.ts";
import {
  getCachedIssues,
  saveCachedIssues,
} from "../github/cache.ts";
import { listGitBranches, findAssociatedBranch } from "../git.ts";
import { formatPlainIssues } from "./render.ts";
import { readRuntime, type PluginRuntime } from "../runtime.ts";
import { resolveSiblingAgent, type SiblingAgent } from "../sibling.ts";
import { App } from "./App.tsx";

const MISSING_DIRECTORY =
  "No workspace directory in the Herdr context. Open Wayfinder Companion from a workspace.";

export interface IssuePaneOptions {
  onClose?: () => Promise<void>;
  runtime?: PluginRuntime;
  refreshIntervalMs?: number;
  fetchSibling?: (runtime: PluginRuntime) => Promise<SiblingAgent | undefined>;
  fetchBranches?: (cwd: string) => Promise<string[]>;
}

export async function refreshBoardState(
  cwd: string,
  currentState: IssueState,
  runtime?: PluginRuntime,
  fetchSibling: (runtime: PluginRuntime) => Promise<SiblingAgent | undefined> = resolveSiblingAgent,
  fetchBranches: (cwd: string) => Promise<string[]> = listGitBranches,
) {
  const [loaded, sibling, gitBranches] = await Promise.all([
    loadIssues(cwd, currentState),
    runtime ? fetchSibling(runtime).catch(() => undefined) : Promise.resolve(undefined),
    fetchBranches(cwd).catch(() => [] as string[]),
  ]);
  if (loaded.ok) {
    saveCachedIssues(cwd, currentState, loaded.repo, loaded.issues, runtime?.stateDir);
  }
  const branches: Record<number, string> = {};
  if (loaded.ok) {
    for (const issue of loaded.issues) {
      const match = findAssociatedBranch(issue.number, issue.title, gitBranches);
      if (match) {
        branches[issue.number] = match;
      }
    }
  }
  return { loaded, sibling, branches };
}

export async function runIssuePane(
  cwd: string | undefined,
  options?: IssuePaneOptions,
): Promise<number> {
  try {
    const runtime = options?.runtime ?? readRuntime();
    const fetchSibling = options?.fetchSibling ?? resolveSiblingAgent;

    if (!cwd) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(MISSING_DIRECTORY);
        return 1;
      }
      return await renderMessage("Wayfinder Companion", [MISSING_DIRECTORY], 1);
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const sibling = await fetchSibling(runtime).catch(() => undefined);
      return await printIssues(cwd, sibling, runtime);
    }

    const cached = getCachedIssues(cwd, "open", runtime.stateDir);
    if (cached) {
      const sibling = await fetchSibling(runtime).catch(() => undefined);
      return await startInkApp({
        cwd,
        initialRepo: cached.repo,
        initialState: "open",
        initialIssues: cached.issues,
        initialSibling: sibling,
        runtime,
        refreshIntervalMs: options?.refreshIntervalMs,
        fetchSibling,
        initialRefresh: true,
      });
    }

    const [loaded, sibling] = await Promise.all([
      loadIssues(cwd, "open"),
      fetchSibling(runtime).catch(() => undefined),
    ]);

    if (!loaded.ok) {
      return await renderMessage("Wayfinder Companion", loaded.message.split("\n"), 1);
    }

    saveCachedIssues(cwd, "open", loaded.repo, loaded.issues, runtime.stateDir);

    return await startInkApp({
      cwd,
      initialRepo: loaded.repo,
      initialState: loaded.state,
      initialIssues: loaded.issues,
      initialSibling: sibling,
      runtime,
      refreshIntervalMs: options?.refreshIntervalMs,
      fetchSibling,
    });
  } finally {
    await options?.onClose?.().catch(() => {});
  }
}

async function printIssues(cwd: string, sibling?: SiblingAgent, runtime?: PluginRuntime): Promise<number> {
  const loaded = await loadIssues(cwd, "open");
  if (!loaded.ok) {
    const cached = getCachedIssues(cwd, "open", runtime?.stateDir);
    if (cached) {
      console.log(formatPlainIssues(cached.repo, "open", cached.issues, sibling));
      return 0;
    }
    console.error(loaded.message);
    return 1;
  }
  saveCachedIssues(cwd, "open", loaded.repo, loaded.issues, runtime?.stateDir);
  console.log(formatPlainIssues(loaded.repo, loaded.state, loaded.issues, sibling));
  return 0;
}

async function renderMessage(title: string, lines: string[], code: number): Promise<number> {
  const isTTY = process.stdin.isTTY;
  if (isTTY) {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
  }
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  try {
    const inkInstance = render(
      <App
        initialMessage={{
          title,
          lines,
          footer: "q close",
        }}
      />,
      { exitOnCtrlC: false },
    );
    await inkInstance.waitUntilExit();
    return code;
  } finally {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    if (isTTY) {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    }
  }
}

async function startInkApp(props: {
  cwd: string;
  initialRepo: string;
  initialState: IssueState;
  initialIssues: Issue[];
  initialSibling?: SiblingAgent;
  initialRefresh?: boolean;
  runtime?: PluginRuntime;
  refreshIntervalMs?: number;
  fetchSibling?: (runtime: PluginRuntime) => Promise<SiblingAgent | undefined>;
}): Promise<number> {
  const isTTY = process.stdin.isTTY;
  if (isTTY) {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
  }
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  try {
    const inkInstance = render(
      <App
        cwd={props.cwd}
        initialRepo={props.initialRepo}
        initialState={props.initialState}
        initialIssues={props.initialIssues}
        initialSibling={props.initialSibling}
        initialRefresh={props.initialRefresh}
        runtime={props.runtime}
        refreshIntervalMs={props.refreshIntervalMs}
        fetchSibling={props.fetchSibling}
      />,
      { exitOnCtrlC: false },
    );
    await inkInstance.waitUntilExit();
    return 0;
  } finally {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    if (isTTY) {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    }
  }
}
