export type InputKey =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "enter" }
  | { kind: "escape" }
  | { kind: "ctrl-c" }
  | { kind: "ctrl-w" }
  | { kind: "char"; value: string };

export function keyFromPress(
  str: string | undefined,
  key: { name?: string; ctrl?: boolean } | undefined,
): InputKey | undefined {
  if (key?.ctrl && key.name === "c") return { kind: "ctrl-c" };
  if ((key?.ctrl && key.name === "w") || str === "\x17") return { kind: "ctrl-w" };
  if (key?.name === "up") return { kind: "up" };
  if (key?.name === "down") return { kind: "down" };
  if (key?.name === "return" || key?.name === "enter") return { kind: "enter" };
  if (key?.name === "escape") return { kind: "escape" };
  if (str && [...str].length === 1 && (str.codePointAt(0) ?? 0) >= 32) {
    return { kind: "char", value: str };
  }
  return undefined;
}

