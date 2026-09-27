import stringWidth from "string-width";
import sliceAnsi from "slice-ansi";

export interface DialogState {
	title?: string;
	message: string;
	detail?: string;
}

export function createErrorDialog(
	message: string,
	title: string = "Error",
	detail?: string,
): DialogState {
	return {
		title,
		message,
		detail,
	};
}

export function clipText(str: string, maxLen: number): string {
	if (maxLen <= 0) return "";
	const len = stringWidth(str);
	if (len <= maxLen) return str;
	if (maxLen === 1) return "…";
	return `${sliceAnsi(str, 0, maxLen - 1)}…`;
}

export function padLine(str: string, len: number): string {
	const clipped = clipText(str, len);
	const currentWidth = stringWidth(clipped);
	const padding = Math.max(0, len - currentWidth);
	return clipped + " ".repeat(padding);
}

export function centerLine(str: string, len: number): string {
	const clipped = clipText(str, len);
	const currentWidth = stringWidth(clipped);
	const remaining = Math.max(0, len - currentWidth);
	const left = Math.floor(remaining / 2);
	const right = remaining - left;
	return " ".repeat(left) + clipped + " ".repeat(right);
}
