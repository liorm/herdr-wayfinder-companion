import type React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { clipText, padLine, centerLine } from "../dialog.ts";

export interface ErrorDialogProps {
	title?: string;
	message: string;
	detail?: string;
	columns: number;
	rows: number;
}

function wrapWords(text: string, width: number): string[] {
	if (width <= 0) return [""];
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (!word) continue;
		if (stringWidth(word) > width) {
			if (current) {
				lines.push(current);
				current = "";
			}
			lines.push(clipText(word, width));
			continue;
		}
		if (!current) {
			current = word;
		} else if (stringWidth(current) + 1 + stringWidth(word) <= width) {
			current += ` ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines.length > 0 ? lines : [""];
}

export const ErrorDialog: React.FC<ErrorDialogProps> = ({
	title = "Error",
	message,
	detail,
	columns,
	rows,
}) => {
	const dialogWidth = Math.min(Math.max(columns - 4, 36), 64);
	const innerWidth = dialogWidth - 2; // Subtract border width (1 on each side)
	const iconPrefixWidth = 11; // "  ╔═════╗  "
	const textWidth = Math.max(innerWidth - iconPrefixWidth - 2, 10);

	const headerTitle = clipText(title, innerWidth - 6);
	const messageLines = wrapWords(message, textWidth);
	const detailLines = detail ? wrapWords(detail, textWidth) : [];
	const contentRows = Math.max(
		3,
		messageLines.length + (detailLines.length > 0 ? detailLines.length + 1 : 0),
	);

	const iconPrefixes = [
		"  \x1b[1;31m╔═════╗\x1b[0m  ",
		"  \x1b[1;31m║  ✖  ║\x1b[0m  ",
		"  \x1b[1;31m╚═════╝\x1b[0m  ",
	];

	const bodyLines: string[] = [];
	let msgIdx = 0;
	let detailIdx = 0;

	for (let i = 0; i < contentRows; i++) {
		const icon = iconPrefixes[i] ?? "           ";
		let textChunk = "";
		if (msgIdx < messageLines.length) {
			textChunk = messageLines[msgIdx++] ?? "";
		} else if (detailLines.length > 0 && detailIdx === 0) {
			textChunk = `\x1b[2m${detailLines[detailIdx++] ?? ""}\x1b[0m`;
		} else if (detailIdx < detailLines.length) {
			textChunk = `\x1b[2m${detailLines[detailIdx++] ?? ""}\x1b[0m`;
		}
		bodyLines.push(padLine(`${icon}${textChunk}`, innerWidth));
	}

	return (
		<Box
			position="absolute"
			top={0}
			left={0}
			width={columns}
			height={rows}
			justifyContent="center"
			alignItems="center"
		>
			<Box
				flexDirection="column"
				width={dialogWidth}
				borderStyle="round"
				borderColor="red"
			>
				<Text>
					{padLine(` \x1b[1;31m[ ${headerTitle} ]\x1b[0m`, innerWidth)}
				</Text>
				<Text>{padLine("", innerWidth)}</Text>
				{bodyLines.map((line, idx) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines in error modal do not have unique IDs
					<Text key={`body-${idx}`}>{line}</Text>
				))}
				<Text>{padLine("", innerWidth)}</Text>
				<Text>
					{centerLine(
						"\x1b[7;1m  OK  \x1b[0m \x1b[2m(Enter or Esc)\x1b[0m",
						innerWidth,
					)}
				</Text>
			</Box>
		</Box>
	);
};
