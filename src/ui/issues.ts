import readline from "node:readline";
import {
  loadIssues,
  loadIssueView,
  nextIssueState,
  type Issue,
  type IssueState,
} from "../github/issues.ts";
import { keyFromPress, type InputKey } from "./keys.ts";
import { boardRows, lineOfSelection, selectableIssues } from "../wayfinder/board.ts";
import {
  formatPlainIssues,
  moveScroll,
  preserveSelection,
  renderPane,
  reveal,
  type DetailModel,
  type ListModel,
  type MessageModel,
  type PaneModel,
} from "./render.ts";

const MISSING_DIRECTORY =
  "No workspace directory in the Herdr context. Open Wayfinder Companion from a workspace.";

export async function runIssuePane(
  cwd: string | undefined,
  options?: { onClose?: () => Promise<void> },
): Promise<number> {
  try {
    if (!cwd) return await presentMessage(MISSING_DIRECTORY, 1);
    if (!process.stdin.isTTY || !process.stdout.isTTY) return await printIssues(cwd);

    const loaded = await loadIssues(cwd, "open");
    if (!loaded.ok) return await presentMessage(loaded.message, 1);
    await browse(cwd, listModel(loaded.repo, loaded.state, loaded.issues, 0));
    return 0;
  } finally {
    await options?.onClose?.().catch(() => {});
  }
}

async function printIssues(cwd: string): Promise<number> {
  const loaded = await loadIssues(cwd, "open");
  if (!loaded.ok) {
    console.error(loaded.message);
    return 1;
  }
  console.log(formatPlainIssues(loaded.repo, loaded.state, loaded.issues));
  return 0;
}

async function presentMessage(message: string, code: number): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(message);
    return code;
  }
  const model: MessageModel = {
    kind: "message",
    title: "Wayfinder Companion",
    lines: message.split("\n"),
    footer: "q close",
  };
  await withTerminal(async (session) => {
    session.paint(model);
    await session.until((key) => isQuit(key));
  });
  return code;
}

async function browse(cwd: string, initial: ListModel): Promise<void> {
  let model: PaneModel = initial;
  await withTerminal(async (session) => {
    session.paint(model);
    await session.until(async (key) => {
      if (key.kind === "ctrl-c" || (key.kind === "char" && (key.value === "q" || key.value === "Q"))) {
        return true;
      }
      if (model.kind !== "list" && model.kind !== "detail") return false;

      if (model.kind === "detail") {
        if (key.kind === "escape") {
          model = model.list;
          session.paint(model);
        } else if (key.kind === "up" || (key.kind === "char" && key.value === "k")) {
          model = scrollDetail(model, -1);
          session.paint(model);
        } else if (key.kind === "down" || (key.kind === "char" && key.value === "j")) {
          model = scrollDetail(model, 1);
          session.paint(model);
        }
        return false;
      }

      if (key.kind === "escape") return true;

      const windowSize = Math.max(session.rows() - 3, 1);
      if (key.kind === "up" || (key.kind === "char" && key.value === "k")) {
        model = moveSelection(model, -1, windowSize);
        session.paint(model);
        return false;
      }
      if (key.kind === "down" || (key.kind === "char" && key.value === "j")) {
        model = moveSelection(model, 1, windowSize);
        session.paint(model);
        return false;
      }
      if (key.kind === "char" && key.value === "f") {
        const next = nextIssueState(model.state);
        session.paint(loadingList(model, `Loading ${next} issues…`));
        const loaded = await loadIssues(cwd, next);
        model = loaded.ok
          ? listModel(loaded.repo, loaded.state, loaded.issues, undefined, session.rows())
          : { ...model, notice: loaded.message };
        session.paint(model);
        return false;
      }
      if (key.kind === "char" && key.value === "r") {
        const previous = model.issues[model.selected]?.number;
        const selected = model.selected;
        session.paint(loadingList(model, "Refreshing…"));
        const loaded = await loadIssues(cwd, model.state);
        model = loaded.ok
          ? listModel(
              loaded.repo,
              loaded.state,
              loaded.issues,
              preserveSelection(loaded.issues, selected, previous),
              session.rows(),
            )
          : { ...model, notice: loaded.message };
        session.paint(model);
        return false;
      }
      if (key.kind === "enter") {
        const issue = model.issues[model.selected];
        if (!issue) return false;
        const list = model;
        session.paint(viewLoading(issue));
        const viewed = await loadIssueView(cwd, issue.number);
        model = viewed.ok
          ? { kind: "detail", issue, body: viewed.body, scroll: 0, list }
          : { ...list, notice: viewed.message };
        session.paint(model);
      }
      return false;
    });
  });
}

function listModel(
  repo: string,
  state: IssueState,
  issues: Issue[],
  selected: number | undefined,
  rows = termRows(),
): ListModel {
  const arranged = selectableIssues(boardRows(issues));
  const index = selected === undefined ? 0 : selected;
  const chosen = arranged.length === 0 ? 0 : Math.min(index, arranged.length - 1);
  const windowSize = Math.max(rows - 3, 1);
  return {
    kind: "list",
    repo,
    state,
    issues: arranged,
    selected: chosen,
    scroll: reveal(lineOfSelection(boardRows(arranged), chosen), 0, windowSize),
  };
}

function moveSelection(model: ListModel, delta: number, windowSize: number): ListModel {
  if (model.issues.length === 0) return model;
  const selected = Math.min(model.issues.length - 1, Math.max(0, model.selected + delta));
  const line = lineOfSelection(boardRows(model.issues), selected);
  return { ...model, selected, scroll: reveal(line, model.scroll, windowSize), notice: undefined };
}

function scrollDetail(model: DetailModel, delta: number): DetailModel {
  const lineCount = Math.max(model.body.split("\n").length, 1);
  return { ...model, scroll: moveScroll(model.scroll, delta, lineCount, Math.max(termRows() - 3, 1)) };
}

function loadingList(model: ListModel, notice: string): ListModel {
  return { ...model, notice };
}

function viewLoading(issue: Issue): MessageModel {
  return {
    kind: "message",
    title: `#${issue.number}  ${issue.title}`,
    lines: ["Loading…"],
    footer: "q close",
  };
}

function isQuit(key: InputKey): boolean {
  return key.kind === "ctrl-c" || key.kind === "escape" || (key.kind === "char" && (key.value === "q" || key.value === "Q"));
}

interface TerminalSession {
  paint: (model: PaneModel) => void;
  rows: () => number;
  until: (onKey: (key: InputKey) => boolean | Promise<boolean>) => Promise<void>;
}

async function withTerminal(run: (session: TerminalSession) => Promise<void>): Promise<void> {
  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write("\x1b[?1049h\x1b[?25l");

  let current: PaneModel = {
    kind: "message",
    title: "Wayfinder Companion",
    lines: ["Loading…"],
    footer: "",
  };
  const paint = (model: PaneModel) => {
    current = model;
    process.stdout.write(renderPane(model, termColumns(), termRows()));
  };
  const onResize = () => {
    process.stdout.write(renderPane(current, termColumns(), termRows()));
  };
  process.stdout.on("resize", onResize);

  let chain = Promise.resolve();
  let finished = false;
  let finish: (() => void) | undefined;
  let fail: ((error: unknown) => void) | undefined;
  let onKey: ((key: InputKey) => boolean | Promise<boolean>) | undefined;
  const onKeypress = (str: string, key: readline.Key) => {
    const input = keyFromPress(str, key);
    if (!input || finished || !onKey) return;
    const handle = onKey;
    chain = chain
      .then(async () => {
        if (finished) return;
        const quit = await handle(input);
        if (quit && !finished) {
          finished = true;
          finish?.();
        }
      })
      .catch((error: unknown) => {
        if (!finished) {
          finished = true;
          fail?.(error);
        }
      });
  };
  stdin.on("keypress", onKeypress);

  const session: TerminalSession = {
    paint,
    rows: termRows,
    until: (handler) =>
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
        onKey = handler;
      }),
  };

  try {
    await run(session);
  } finally {
    finished = true;
    stdin.off("keypress", onKeypress);
    process.stdout.off("resize", onResize);
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  }
}

function termColumns(): number {
  return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
}

function termRows(): number {
  return process.stdout.rows && process.stdout.rows > 0 ? process.stdout.rows : 24;
}
