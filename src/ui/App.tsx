import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import {
  loadIssueView,
  nextIssueState,
  type Issue,
  type IssueState,
} from "../github/issues.ts";
import { getCachedIssues } from "../github/cache.ts";
import { createClient, type HerdrCall } from "../herdr.ts";
import type { PluginRuntime } from "../runtime.ts";
import { resolveSiblingAgent, type SiblingAgent } from "../sibling.ts";
import { boardRows, isIssueBlocked, lineOfSelection, selectableIssues } from "../wayfinder/board.ts";
import { dispatchWork } from "../wayfinder/work.ts";
import { preserveSelection, reveal } from "./render.ts";
import { formatTicketView } from "./ticket.ts";
import { ListView } from "./components/ListView.tsx";
import { DetailView } from "./components/DetailView.tsx";
import { MessageView } from "./components/MessageView.tsx";
import { ErrorDialog } from "./components/ErrorDialog.tsx";
import { createErrorDialog, type DialogState } from "./dialog.ts";
import { refreshBoardState } from "./issues.tsx";

export interface AppProps {
  cwd?: string;
  initialRepo?: string;
  initialState?: IssueState;
  initialIssues?: Issue[];
  initialSibling?: SiblingAgent;
  initialRefresh?: boolean;
  initialMessage?: {
    title: string;
    lines: string[];
    footer?: string;
  };
  initialError?: DialogState;
  runtime?: PluginRuntime;
  refreshIntervalMs?: number;
  fetchSibling?: (runtime: PluginRuntime) => Promise<SiblingAgent | undefined>;
  herdrClient?: (args: string[]) => Promise<HerdrCall>;
}

export const App: React.FC<AppProps> = ({
  cwd,
  initialRepo = "",
  initialState = "open",
  initialIssues = [],
  initialSibling,
  initialRefresh = false,
  initialMessage,
  initialError,
  runtime,
  refreshIntervalMs = 5000,
  fetchSibling = resolveSiblingAgent,
  herdrClient,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [dimensions, setDimensions] = useState({
    columns: stdout?.columns && stdout.columns > 0 ? stdout.columns : process.stdout.columns || 80,
    rows: stdout?.rows && stdout.rows > 0 ? stdout.rows : process.stdout.rows || 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        columns: stdout?.columns && stdout.columns > 0 ? stdout.columns : process.stdout.columns || 80,
        rows: stdout?.rows && stdout.rows > 0 ? stdout.rows : process.stdout.rows || 24,
      });
    };
    stdout?.on("resize", handleResize);
    process.stdout.on("resize", handleResize);
    return () => {
      stdout?.off("resize", handleResize);
      process.stdout.off("resize", handleResize);
    };
  }, [stdout]);

  const initialArranged = selectableIssues(boardRows(initialIssues));
  const [mode, setMode] = useState<"list" | "detail" | "message">(
    initialMessage ? "message" : "list",
  );
  const [repo, setRepo] = useState(initialRepo);
  const [state, setState] = useState<IssueState>(initialState);
  const [issues, setIssues] = useState<Issue[]>(initialArranged);
  const [selected, setSelected] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [sibling, setSibling] = useState<SiblingAgent | undefined>(initialSibling);
  const [errorDialog, setErrorDialog] = useState<DialogState | null>(initialError ?? null);

  const showError = useCallback((message: string, title: string = "Error", detail?: string) => {
    setErrorDialog(createErrorDialog(message, title, detail));
  }, []);

  // Detail view state
  const [detailIssue, setDetailIssue] = useState<Issue | null>(null);
  const [detailRawBody, setDetailRawBody] = useState<string>("");
  const [detailComments, setDetailComments] = useState<string>("");
  const [detailLines, setDetailLines] = useState<string[]>([]);
  const [detailScroll, setDetailScroll] = useState<number>(0);

  // Message view state
  const [message] = useState<{
    title: string;
    lines: string[];
    footer: string;
  } | null>(
    initialMessage
      ? {
          title: initialMessage.title,
          lines: initialMessage.lines,
          footer: initialMessage.footer ?? "q close",
        }
      : null,
  );

  // Refs for background refresh
  const stateRef = useRef(state);
  stateRef.current = state;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refreshingRef = useRef(false);

  const listWindow = Math.max(dimensions.rows - 3, 1);
  const detailWindow = Math.max(dimensions.rows - 1, 1);

  // Re-wrap the ticket when the pane width changes. The header scrolls with the body.
  useEffect(() => {
    if (mode === "detail" && detailIssue) {
      const next = formatTicketView(detailIssue, detailRawBody, detailComments, dimensions.columns, issues);
      setDetailLines(next);
      setDetailScroll((prev) => Math.min(prev, Math.max(0, next.length - detailWindow)));
    }
  }, [dimensions.columns, mode, detailIssue, detailRawBody, detailComments, issues, detailWindow]);

  // Immediate initial background refresh if requested (e.g. fast startup from cache)
  useEffect(() => {
    if (!initialRefresh || !cwd) return;
    let cancelled = false;
    (async () => {
      try {
        const { loaded, sibling: newSibling } = await refreshBoardState(
          cwd,
          stateRef.current,
          runtime,
          fetchSibling,
        );
        if (cancelled) return;
        if (newSibling !== undefined) {
          setSibling(newSibling);
        }
        if (loaded.ok) {
          const prevNumber = issuesRef.current[selectedRef.current]?.number;
          const currentSel = selectedRef.current;
          const nextArranged = selectableIssues(boardRows(loaded.issues));
          const newSel = preserveSelection(nextArranged, currentSel, prevNumber);
          setRepo(loaded.repo);
          setIssues(nextArranged);
          setSelected(newSel);
        }
      } catch {
        // ignore background errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialRefresh, cwd, runtime, fetchSibling]);

  // Background refresh
  useEffect(() => {
    if (!cwd || refreshIntervalMs <= 0) return;

    const interval = setInterval(async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const currentState = stateRef.current;
        const { loaded, sibling: newSibling } = await refreshBoardState(
          cwd,
          currentState,
          runtime,
          fetchSibling,
        );
        if (newSibling !== undefined) {
          setSibling(newSibling);
        }
        if (loaded.ok) {
          const prevNumber = issuesRef.current[selectedRef.current]?.number;
          const currentSel = selectedRef.current;
          const nextArranged = selectableIssues(boardRows(loaded.issues));
          const newSel = preserveSelection(nextArranged, currentSel, prevNumber);
          setRepo(loaded.repo);
          setIssues(nextArranged);
          setSelected(newSel);
        }
      } catch {
        // ignore background errors
      } finally {
        refreshingRef.current = false;
      }
    }, refreshIntervalMs);

    return () => clearInterval(interval);
  }, [cwd, refreshIntervalMs, runtime, fetchSibling]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (issues.length === 0) return;
      const nextSelected = Math.min(issues.length - 1, Math.max(0, selected + delta));
      const laid = boardRows(issues);
      const line = lineOfSelection(laid, nextSelected);
      setSelected(nextSelected);
      setScroll(reveal(line, scroll, listWindow));
      setNotice(undefined);
    },
    [issues, selected, scroll, listWindow],
  );

  useInput(async (input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (errorDialog) {
      if (
        key.return ||
        key.escape ||
        input === " " ||
        input === "o" ||
        input === "O" ||
        input === "q" ||
        input === "Q"
      ) {
        setErrorDialog(null);
        return;
      }
      return;
    }

    if (input === "q" || input === "Q") {
      exit();
      return;
    }

    if (mode === "message") {
      if (key.escape) {
        exit();
      }
      return;
    }

    if (mode === "detail") {
      if (key.escape) {
        setMode("list");
        return;
      }
      if (key.upArrow || input === "k") {
        setDetailScroll((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setDetailScroll((prev) => {
          const max = Math.max(0, detailLines.length - detailWindow);
          return Math.min(max, prev + 1);
        });
        return;
      }
      if (key.pageDown || input === " ") {
        setDetailScroll((prev) => {
          const max = Math.max(0, detailLines.length - detailWindow);
          return Math.min(max, prev + detailWindow);
        });
        return;
      }
      if (key.pageUp || input === "b") {
        setDetailScroll((prev) => Math.max(0, prev - detailWindow));
        return;
      }
      if (input === "w" || input === "W") {
        if (!detailIssue) return;
        if (isIssueBlocked(detailIssue, issues)) {
          showError(`Ticket #${detailIssue.number} is blocked.`, "Action Blocked");
          return;
        }
        if (!sibling || sibling.status !== "idle") {
          const statusText = sibling?.status ? ` (${sibling.status})` : " (unavailable)";
          showError(`Agent is not idle${statusText}.`, "Agent Busy");
          return;
        }
        setNotice(`Starting work on #${detailIssue.number}…`);
        const client = herdrClient ?? createClient(runtime?.binPath ?? "herdr");
        const result = await dispatchWork(detailIssue, sibling, client);
        if (result.notImplemented) {
          showError(result.message, "Not Implemented");
        } else if (!result.ok) {
          showError(result.message, "Error");
        } else {
          setNotice(result.message);
        }
        return;
      }
      return;
    }

    if (mode === "list") {
      if (key.escape) {
        exit();
        return;
      }
      if (key.upArrow || input === "k") {
        moveSelection(-1);
        return;
      }
      if (key.downArrow || input === "j") {
        moveSelection(1);
        return;
      }
      if (input === "w" || input === "W") {
        const currentIssue = issues[selected];
        if (!currentIssue) return;
        if (isIssueBlocked(currentIssue, issues)) {
          showError(`Ticket #${currentIssue.number} is blocked.`, "Action Blocked");
          return;
        }
        if (!sibling || sibling.status !== "idle") {
          const statusText = sibling?.status ? ` (${sibling.status})` : " (unavailable)";
          showError(`Agent is not idle${statusText}.`, "Agent Busy");
          return;
        }
        setNotice(`Starting work on #${currentIssue.number}…`);
        const client = herdrClient ?? createClient(runtime?.binPath ?? "herdr");
        const result = await dispatchWork(currentIssue, sibling, client);
        if (result.notImplemented) {
          showError(result.message, "Not Implemented");
        } else if (!result.ok) {
          showError(result.message, "Error");
        } else {
          setNotice(result.message);
        }
        return;
      }
      if (input === "f" || input === "F") {
        if (!cwd) return;
        const next = nextIssueState(state);
        const cached = getCachedIssues(cwd, next, runtime?.stateDir);
        if (cached) {
          const nextArranged = selectableIssues(boardRows(cached.issues));
          setRepo(cached.repo);
          setState(next);
          setIssues(nextArranged);
          setSelected(0);
          setScroll(0);
        }
        setNotice(`Loading ${next} issues…`);
        const { loaded, sibling: newSibling } = await refreshBoardState(
          cwd,
          next,
          runtime,
          fetchSibling,
        );
        if (newSibling !== undefined) setSibling(newSibling);
        if (loaded.ok) {
          const nextArranged = selectableIssues(boardRows(loaded.issues));
          setRepo(loaded.repo);
          setState(loaded.state);
          setIssues(nextArranged);
          setSelected(0);
          setScroll(0);
          setNotice(undefined);
        } else {
          if (!cached) {
            setNotice(loaded.message);
          } else {
            setNotice(undefined);
          }
        }
        return;
      }
      if (input === "r" || input === "R") {
        if (!cwd) return;
        const previous = issues[selected]?.number;
        const currentSel = selected;
        setNotice("Refreshing…");
        const { loaded, sibling: newSibling } = await refreshBoardState(
          cwd,
          state,
          runtime,
          fetchSibling,
        );
        if (newSibling !== undefined) setSibling(newSibling);
        if (loaded.ok) {
          const nextArranged = selectableIssues(boardRows(loaded.issues));
          const newSel = preserveSelection(nextArranged, currentSel, previous);
          const laid = boardRows(nextArranged);
          const line = lineOfSelection(laid, newSel);
          setRepo(loaded.repo);
          setIssues(nextArranged);
          setSelected(newSel);
          setScroll(reveal(line, scroll, listWindow));
          setNotice(undefined);
        } else {
          setNotice(loaded.message);
        }
        return;
      }
      if (key.return) {
        if (!cwd) return;
        const currentIssue = issues[selected];
        if (!currentIssue) return;
        setNotice(`Loading #${currentIssue.number}…`);
        const viewed = await loadIssueView(cwd, currentIssue.number);
        const body = viewed.ok ? viewed.body : "";
        const comments = viewed.ok ? viewed.comments : "";
        const fallback = !viewed.ok && currentIssue.body ? currentIssue.body : body;
        if (viewed.ok || fallback.length > 0) {
          setDetailIssue(currentIssue);
          setDetailRawBody(fallback);
          setDetailComments(comments);
          setDetailLines(formatTicketView(currentIssue, fallback, comments, dimensions.columns, issues));
          setDetailScroll(0);
          setNotice(undefined);
          setMode("detail");
        } else {
          setNotice(viewed.message);
        }
        return;
      }
    }
  });

  return (
    <Box width={dimensions.columns} height={dimensions.rows} position="relative">
      {mode === "message" && message ? (
        <MessageView
          title={message.title}
          lines={message.lines}
          footer={message.footer}
          columns={dimensions.columns}
          rows={dimensions.rows}
        />
      ) : mode === "detail" && detailIssue ? (
        <DetailView
          lines={detailLines}
          scroll={detailScroll}
          columns={dimensions.columns}
          rows={dimensions.rows}
        />
      ) : (
        <ListView
          repo={repo}
          state={state}
          issues={issues}
          selected={selected}
          scroll={scroll}
          notice={notice}
          sibling={sibling}
          columns={dimensions.columns}
          rows={dimensions.rows}
        />
      )}

      {errorDialog ? (
        <ErrorDialog
          title={errorDialog.title}
          message={errorDialog.message}
          detail={errorDialog.detail}
          columns={dimensions.columns}
          rows={dimensions.rows}
        />
      ) : null}
    </Box>
  );
};
