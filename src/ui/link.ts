/**
 * Formats a terminal hyperlink using standard OSC 8 escape sequence with underline.
 */
export function terminalLink(text: string, url?: string, underline = true): string {
  if (!url) return text;
  return underline
    ? `\x1b]8;;${url}\x07\x1b[4m${text}\x1b[24m\x1b]8;;\x07`
    : `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}
