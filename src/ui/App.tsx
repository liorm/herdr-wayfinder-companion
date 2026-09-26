import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import {
  loadIssueView,
  nextIssueState,
  type Issue,
  type IssueState,
  type GhRunner,
} from "../github/issues.ts";
import { getCachedIssues } from "../github/cache.ts";
import { createClient, type HerdrCall } from "../herdr.ts";
import type { PluginRuntime } from "../runtime.ts";
import { resolveSiblingAgent, type SiblingAgent } from "../sibling.ts";
import { boardRows, isIssueBlocked, lineOfSelection, selectableIssues, ticketKind } from "../wayfinder/board.ts";
import { dispatchWork } from "../wayfinder/work.ts";
import {
  createInitialDeliveryState,
  runDeliveryWorkflow,
  type DeliveryState,
} from "../wayfinder/delivery.ts";
import { findTicketPR, openInBrowser, type GitRunner, type PRInfo } from "../git.ts";
import { preserveSelection, reveal } from "./render.ts";
import { formatTicketView } from "./ticket.ts";
import { ListView } from "./components/ListView.tsx";
import { DetailView } from "./components/DetailView.tsx";
import { MessageView } from "./components/MessageView.tsx";
import { ErrorDialog } from "./components/ErrorDialog.tsx";
import { DeliveryDialog } from "./components/DeliveryDialog.tsx";
import { ModelDialog } from "./components/ModelDialog.tsx";
import { createErrorDialog, type DialogState } from "./dialog.ts";
import { refreshBoardState } from "./issues.tsx";
import {
  getAvailableModels,
  getModelForTicketKind,
  getNextModel,
  normalizeAgentKind,
  readConfigFile,
  saveModelConfig,
} from "../wayfinder/models.ts";
import type { TicketKind } from "../wayfinder/board.ts";

export interface AppProps {
  cwd?: string;
  initialRepo?: string;
  initialState?: IssueState;
  initialIssues?: Issue[];
  initialSibling?: SiblingAgent;
  initialBranches?: Record<number, string>;
  initialPrs?: Record<number, PRInfo>;
  initialRefresh?: boolean;
  initialMessage?: {
    title: string;
    lines: string[];
    footer?: string;
  };
  initialError?: DialogState;
  initialDelivery?: DeliveryState;
  runtime?: PluginRuntime;
  refreshIntervalMs?: number;
  fetchSibling?: (runtime: PluginRuntime) => Promise<SiblingAgent | undefined>;
  fetchBranches?: (cwd: string) => Promise<string[]>;
  fetchPRs?: (cwd: string) => Promise<PRInfo[]>;
  herdrClient?: (args: string[]) => Promise<HerdrCall>;
  runGit?: GitRunner;
  runGh?: GhRunner;
}

export const App: React.FC<AppProps> = ({
  cwd,
  initialRepo = "",
  initialState = "open",
  initialIssues = [],
  initialSibling,
  initialBranches = {},
  initialPrs = {},
  initialRefresh = false,
  initialMessage,
  initialError,
  initialDelivery,
  runtime,
  refreshIntervalMs = 5000,
  fetchSibling = resolveSiblingAgent,
  fetchBranches,
  fetchPRs,
  herdrClient,
  runGit,
  runGh,
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

  const [branches, setBranches] = useState<Record<number, string>>(initialBranches);
  const [prs, setPrs] = useState<Record<number, PRInfo>>(initialPrs);
  const [deliveryDialog, setDeliveryDialog] = useState<DeliveryState | null>(initialDelivery ?? null);

  const initialArranged = selectableIssues(boardRows(initialIssues, { branches: initialBranches, prs: initialPrs }));
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
  const [modelDialog, setModelDialog] = useState<{
    kind: TicketKind;
    agent?: string;
    issueNumber?: number;
    selectedIndex: number;
  } | null>(null);
  const [customModels, setCustomModels] = useState<Partial<Record<TicketKind, string>>>(
    () => readConfigFile(runtime?.configDir, initialSibling?.agent) ?? {},
  );

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
  const branchesRef = useRef(branches);
  branchesRef.current = branches;
  const prsRef = useRef(prs);
  prsRef.current = prs;
  const refreshingRef = useRef(false);

  const listWindow = Math.max(dimensions.rows - 3, 1);
  const detailWindow = Math.max(dimensions.rows - 1, 1);

  // Re-wrap the ticket when the pane width changes. The header scrolls with the body.
  useEffect(() => {
    if (mode === "detail" && detailIssue) {
      const next = formatTicketView(detailIssue, detailRawBody, detailComments, dimensions.columns, issues, {
        branches,
        prs,
      });
      setDetailLines(next);
      setDetailScroll((prev) => Math.min(prev, Math.max(0, next.length - detailWindow)));
    }
  }, [dimensions.columns, mode, detailIssue, detailRawBody, detailComments, issues, branches, prs, detailWindow]);

  // Immediate initial background refresh if requested (e.g. fast startup from cache)
  useEffect(() => {
    if (!initialRefresh || !cwd) return;
    let cancelled = false;
    (async () => {
      try {
        const { loaded, sibling: newSibling, branches: newBranches, prs: newPrs } = await refreshBoardState(
          cwd,
          stateRef.current,
          runtime,
          fetchSibling,
          fetchBranches,
          fetchPRs,
        );
        if (cancelled) return;
        if (newSibling !== undefined) {
          setSibling(newSibling);
        }
        if (newBranches) {
          setBranches(newBranches);
        }
        if (newPrs) {
          setPrs(newPrs);
        }
        if (loaded.ok) {
          const prevNumber = issuesRef.current[selectedRef.current]?.number;
          const currentSel = selectedRef.current;
          const nextArranged = selectableIssues(
            boardRows(loaded.issues, { branches: newBranches ?? branchesRef.current, prs: newPrs ?? prsRef.current }),
          );
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
  }, [initialRefresh, cwd, runtime, fetchSibling, fetchBranches, fetchPRs]);

  // Background refresh
  useEffect(() => {
    if (!cwd || refreshIntervalMs <= 0) return;

    const interval = setInterval(async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const currentState = stateRef.current;
        const { loaded, sibling: newSibling, branches: newBranches, prs: newPrs } = await refreshBoardState(
          cwd,
          currentState,
          runtime,
          fetchSibling,
          fetchBranches,
          fetchPRs,
        );
        if (newSibling !== undefined) {
          setSibling(newSibling);
        }
        if (newBranches) {
          setBranches(newBranches);
        }
        if (newPrs) {
          setPrs(newPrs);
        }
        if (loaded.ok) {
          const prevNumber = issuesRef.current[selectedRef.current]?.number;
          const currentSel = selectedRef.current;
          const nextArranged = selectableIssues(
            boardRows(loaded.issues, { branches: newBranches ?? branchesRef.current, prs: newPrs ?? prsRef.current }),
          );
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
  }, [cwd, refreshIntervalMs, runtime, fetchSibling, fetchBranches]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (issues.length === 0) return;
      const nextSelected = Math.min(issues.length - 1, Math.max(0, selected + delta));
      const laid = boardRows(issues, { branches, prs });
      const line = lineOfSelection(laid, nextSelected);
      setSelected(nextSelected);
      setScroll(reveal(line, scroll, listWindow));
      setNotice(undefined);
    },
    [issues, selected, scroll, listWindow, branches, prs],
  );

  const handleWorkPress = async (targetIssue: Issue) => {
    if (isIssueBlocked(targetIssue, issues)) {
      showError(`Ticket #${targetIssue.number} is blocked.`, "Action Blocked");
      return;
    }
    if (!sibling || sibling.status !== "idle") {
      const statusText = sibling?.status ? ` (${sibling.status})` : " (unavailable)";
      showError(`Agent is not idle${statusText}.`, "Agent Busy");
      return;
    }

    const kind = ticketKind(targetIssue.labels);
    if (kind === "delivery") {
      let existingPR = prs[targetIssue.number];
      if (!existingPR && cwd) {
        const found = await findTicketPR(cwd, targetIssue.number, branches[targetIssue.number], runGh);
        if (found) {
          existingPR = found;
          setPrs((prev) => ({ ...prev, [targetIssue.number]: found }));
        }
      }
      setDeliveryDialog(
        createInitialDeliveryState(targetIssue, existingPR, {
          agent: sibling?.agent,
          configDir: runtime?.configDir,
          customModels,
        }),
      );
      return;
    }

    setNotice(`Starting work on #${targetIssue.number}…`);
    const client = herdrClient ?? createClient(runtime?.binPath ?? "herdr");
    const result = await dispatchWork(targetIssue, sibling, client, {
      agent: sibling?.agent,
      configDir: runtime?.configDir,
      customModels,
    });
    if (result.notImplemented) {
      showError(result.message, "Not Implemented");
    } else if (!result.ok) {
      showError(result.message, "Error");
    } else {
      setNotice(result.message);
    }
  };

  useInput(async (input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (modelDialog) {
      const available = getAvailableModels(modelDialog.agent);
      if (key.upArrow || input === "k") {
        setModelDialog((prev) =>
          prev ? { ...prev, selectedIndex: Math.max(0, prev.selectedIndex - 1) } : null,
        );
        return;
      }
      if (key.downArrow || input === "j") {
        setModelDialog((prev) =>
          prev
            ? {
                ...prev,
                selectedIndex: Math.min(available.length - 1, prev.selectedIndex + 1),
              }
            : null,
        );
        return;
      }
      if (key.return || (key as { name?: string }).name === "enter" || input === " ") {
        const chosenModel = available[modelDialog.selectedIndex]!;
        setCustomModels((prev) => ({ ...prev, [modelDialog.kind]: chosenModel }));
        saveModelConfig(modelDialog.kind, chosenModel, modelDialog.agent, runtime?.configDir);
        setNotice(
          `Saved model for ${modelDialog.kind} (${normalizeAgentKind(modelDialog.agent)}): ${chosenModel}`,
        );
        setModelDialog(null);
        return;
      }
      if (key.escape || input === "q" || input === "Q") {
        setModelDialog(null);
        return;
      }
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

    if (deliveryDialog) {
      if (deliveryDialog.alreadyDelivered || deliveryDialog.isFinished || deliveryDialog.error) {
        if (
          key.return ||
          key.escape ||
          input === " " ||
          input === "q" ||
          input === "Q"
        ) {
          setDeliveryDialog(null);
          if (cwd) {
            refreshBoardState(cwd, stateRef.current, runtime, fetchSibling, fetchBranches)
              .then(({ loaded, sibling: newSibling, branches: newBranches }) => {
                if (newSibling !== undefined) setSibling(newSibling);
                if (newBranches) setBranches(newBranches);
                if (loaded.ok) {
                  const prevNumber = issuesRef.current[selectedRef.current]?.number;
                  const currentSel = selectedRef.current;
                  const nextArranged = selectableIssues(
                    boardRows(loaded.issues, { branches: newBranches, prs: prsRef.current }),
                  );
                  const newSel = preserveSelection(nextArranged, currentSel, prevNumber);
                  setRepo(loaded.repo);
                  setIssues(nextArranged);
                  setSelected(newSel);
                }
              })
              .catch(() => {});
          }
          return;
        }
        return;
      }

      if (!deliveryDialog.isStarted) {
        if (key.return || input === " ") {
          const client = herdrClient ?? createClient(runtime?.binPath ?? "herdr");
          const targetSibling = sibling;
          if (!targetSibling || targetSibling.status !== "idle") {
            setDeliveryDialog((prev) =>
              prev ? { ...prev, error: "Agent is no longer idle", isFinished: true } : null,
            );
            return;
          }
          if (!cwd) {
            setDeliveryDialog((prev) =>
              prev ? { ...prev, error: "No repository working directory found", isFinished: true } : null,
            );
            return;
          }

          setDeliveryDialog((prev) => (prev ? { ...prev, isStarted: true } : null));

          runDeliveryWorkflow({
            cwd,
            issue: deliveryDialog.issue,
            sibling: targetSibling,
            client,
            configDir: runtime?.configDir,
            customModels,
            runGit,
            runGh,
            onUpdate: (nextState) => {
              setDeliveryDialog(nextState);
            },
          })
            .then((finalState) => {
              if (finalState.pr) {
                setPrs((prev) => ({
                  ...prev,
                  [finalState.issue.number]: finalState.pr!,
                }));
              }
            })
            .catch((err) => {
              setDeliveryDialog((prev) =>
                prev
                  ? {
                      ...prev,
                      error: err instanceof Error ? err.message : String(err),
                      isFinished: true,
                    }
                  : null,
              );
            });
          return;
        }
        if (key.escape || input === "q" || input === "Q") {
          setDeliveryDialog(null);
          return;
        }
        return;
      }

      // If delivery workflow is running, ignore other keystrokes
      return;
    }

    if (input === "q" || input === "Q") {
      exit();
      return;
    }

    const keyObj = key as { ctrl?: boolean; name?: string; return?: boolean };
    const isCtrlM =
      (key.ctrl &&
        (keyObj.name === "m" ||
          input === "m" ||
          input === "\r" ||
          input === "\x0d" ||
          keyObj.name === "return")) ||
      input === "M";
    const isRotateM = !key.ctrl && input === "m";

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
        await handleWorkPress(detailIssue);
        return;
      }
      if (input === "o" || input === "O") {
        if (!detailIssue) return;
        const pr = prs[detailIssue.number];
        const targetUrl = pr?.url || detailIssue.url;
        if (targetUrl) {
          openInBrowser(targetUrl);
          setNotice(`Opened ${pr ? `PR #${pr.number}` : `#${detailIssue.number}`} in browser`);
        }
        return;
      }
      if (isCtrlM) {
        const agentKind = sibling?.agent;
        const currentKind = detailIssue ? ticketKind(detailIssue.labels) : "map";
        const currentModel = getModelForTicketKind(currentKind, {
          agent: agentKind,
          configDir: runtime?.configDir,
          customModels,
        });
        const available = getAvailableModels(agentKind);
        const curIdx = available.indexOf(currentModel);
        setModelDialog({
          kind: currentKind,
          agent: agentKind,
          issueNumber: detailIssue?.number,
          selectedIndex: curIdx >= 0 ? curIdx : 0,
        });
        return;
      }
      if (isRotateM) {
        const agentKind = sibling?.agent;
        const currentKind = detailIssue ? ticketKind(detailIssue.labels) : "map";
        const currentModel = getModelForTicketKind(currentKind, {
          agent: agentKind,
          configDir: runtime?.configDir,
          customModels,
        });
        const nextModel = getNextModel(currentModel, agentKind);
        setCustomModels((prev) => ({ ...prev, [currentKind]: nextModel }));
        saveModelConfig(currentKind, nextModel, agentKind, runtime?.configDir);
        setNotice(`Model for ${currentKind} (${normalizeAgentKind(agentKind)}): ${nextModel}`);
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
        await handleWorkPress(currentIssue);
        return;
      }
      if (input === "o" || input === "O") {
        const currentIssue = issues[selected];
        if (!currentIssue) return;
        const pr = prs[currentIssue.number];
        const targetUrl = pr?.url || currentIssue.url;
        if (targetUrl) {
          openInBrowser(targetUrl);
          setNotice(`Opened ${pr ? `PR #${pr.number}` : `#${currentIssue.number}`} in browser`);
        }
        return;
      }
      if (isCtrlM) {
        const agentKind = sibling?.agent;
        const currentIssue = issues[selected];
        const currentKind = currentIssue ? ticketKind(currentIssue.labels) : "map";
        const currentModel = getModelForTicketKind(currentKind, {
          agent: agentKind,
          configDir: runtime?.configDir,
          customModels,
        });
        const available = getAvailableModels(agentKind);
        const curIdx = available.indexOf(currentModel);
        setModelDialog({
          kind: currentKind,
          agent: agentKind,
          issueNumber: currentIssue?.number,
          selectedIndex: curIdx >= 0 ? curIdx : 0,
        });
        return;
      }
      if (isRotateM) {
        const agentKind = sibling?.agent;
        const currentIssue = issues[selected];
        const currentKind = currentIssue ? ticketKind(currentIssue.labels) : "map";
        const currentModel = getModelForTicketKind(currentKind, {
          agent: agentKind,
          configDir: runtime?.configDir,
          customModels,
        });
        const nextModel = getNextModel(currentModel, agentKind);
        setCustomModels((prev) => ({ ...prev, [currentKind]: nextModel }));
        saveModelConfig(currentKind, nextModel, agentKind, runtime?.configDir);
        setNotice(`Model for ${currentKind} (${normalizeAgentKind(agentKind)}): ${nextModel}`);
        return;
      }
      if (input === "f" || input === "F") {
        if (!cwd) return;
        const next = nextIssueState(state);
        const cached = getCachedIssues(cwd, next, runtime?.stateDir);
        if (cached) {
          const nextArranged = selectableIssues(boardRows(cached.issues, { branches, prs }));
          setRepo(cached.repo);
          setState(next);
          setIssues(nextArranged);
          setSelected(0);
          setScroll(0);
        }
        setNotice(`Loading ${next} issues…`);
        const { loaded, sibling: newSibling, branches: newBranches, prs: newPrs } = await refreshBoardState(
          cwd,
          next,
          runtime,
          fetchSibling,
          fetchBranches,
          fetchPRs,
        );
        if (newSibling !== undefined) setSibling(newSibling);
        if (newBranches) setBranches(newBranches);
        if (newPrs) setPrs(newPrs);
        if (loaded.ok) {
          const nextArranged = selectableIssues(boardRows(loaded.issues, { branches: newBranches ?? branches, prs: newPrs ?? prs }));
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
        const { loaded, sibling: newSibling, branches: newBranches, prs: newPrs } = await refreshBoardState(
          cwd,
          state,
          runtime,
          fetchSibling,
          fetchBranches,
          fetchPRs,
        );
        if (newSibling !== undefined) setSibling(newSibling);
        if (newBranches) setBranches(newBranches);
        if (newPrs) setPrs(newPrs);
        if (loaded.ok) {
          const nextArranged = selectableIssues(boardRows(loaded.issues, { branches: newBranches ?? branches, prs: newPrs ?? prs }));
          const newSel = preserveSelection(nextArranged, currentSel, previous);
          const laid = boardRows(nextArranged, { branches: newBranches ?? branches, prs: newPrs ?? prs });
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
          setDetailLines(formatTicketView(currentIssue, fallback, comments, dimensions.columns, issues, { branches, prs }));
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
          branches={branches}
          prs={prs}
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

      {deliveryDialog ? (
        <DeliveryDialog
          issue={deliveryDialog.issue}
          branchName={deliveryDialog.branchName}
          isStarted={deliveryDialog.isStarted}
          isFinished={deliveryDialog.isFinished}
          alreadyDelivered={deliveryDialog.alreadyDelivered}
          existingPR={deliveryDialog.existingPR}
          steps={deliveryDialog.steps}
          currentStepId={deliveryDialog.currentStepId}
          modifiedFiles={deliveryDialog.modifiedFiles}
          agentMessage={deliveryDialog.agentMessage}
          pr={deliveryDialog.pr}
          error={deliveryDialog.error}
          columns={dimensions.columns}
          rows={dimensions.rows}
        />
      ) : null}

      {modelDialog ? (
        <ModelDialog
          kind={modelDialog.kind}
          agent={modelDialog.agent}
          issueNumber={modelDialog.issueNumber}
          currentModel={getModelForTicketKind(modelDialog.kind, {
            agent: modelDialog.agent,
            configDir: runtime?.configDir,
            customModels,
          })}
          selectedIndex={modelDialog.selectedIndex}
          columns={dimensions.columns}
          rows={dimensions.rows}
        />
      ) : null}
    </Box>
  );
};
