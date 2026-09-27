import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import wrapAnsi from "wrap-ansi";

export interface MarkdownOptions {
	width?: number;
	reflowText?: boolean;
	tab?: number;
}

/**
 * Formats a markdown string for terminal display with ANSI colors and styles,
 * and wraps lines according to the specified width.
 * Returns an array of formatted, word-wrapped lines.
 */
export function formatMarkdown(
	text: string,
	width = 80,
	options?: MarkdownOptions,
): string[] {
	const clean = text.trim();
	if (!clean) {
		return ["This issue has no body."];
	}

	const effectiveWidth = Math.max(width, 20);
	try {
		const markedInstance = new Marked();
		markedInstance.use(
			markedTerminal({
				width: effectiveWidth,
				reflowText: options?.reflowText ?? true,
				tab: options?.tab ?? 2,
			}) as unknown as Parameters<typeof markedInstance.use>[0],
		);

		const parsed = markedInstance.parse(clean) as string;
		const trimmed = parsed.replace(/\s+$/, "");
		const wrapped = wrapAnsi(trimmed, effectiveWidth, {
			hard: false,
			wordWrap: true,
			trim: false,
		});

		return wrapped.split("\n");
	} catch {
		const wrapped = wrapAnsi(clean, effectiveWidth, {
			hard: false,
			wordWrap: true,
			trim: false,
		});
		return wrapped.split("\n");
	}
}
