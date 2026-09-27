import type React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import type { Issue, IssueState } from "../../github/issues.ts";
import type { SiblingAgent } from "../../sibling.ts";
import {
	boardRows,
	lineOfSelection,
	selectableIssues,
	type BoardRow,
	type RowTone,
} from "../../wayfinder/board.ts";
import { clip, reveal } from "../render.ts";
import { clipText } from "../dialog.ts";
import { Header } from "./Header.tsx";

export interface ListViewProps {
	repo: string;
	state: IssueState;
	issues: Issue[];
	selected: number;
	scroll: number;
	notice?: string;
	sibling?: SiblingAgent;
	branches?: Record<number, string>;
	prs?: Record<number, { number: number; url: string; state?: string }>;
	columns: number;
	rows: number;
}

function toneColor(tone: RowTone): string | undefined {
	switch (tone) {
		case "blocked":
			return "red";
		case "progress":
			return "green";
		case "frontier":
			return "cyan";
		case "ready":
			return "magenta";
		case "attention":
			return "yellow";
		case "map":
			return "blue";
		default:
			return undefined;
	}
}

function formatRowText(row: BoardRow, width: number): string {
	if (row.type === "label") return clip(row.text, width);
	const indent = "  ".repeat(row.depth);
	const prefix = `${indent}#${row.issue.number}  `;
	const badges = row.badges.length > 0 ? `  ${row.badges.join(" · ")}` : "";
	const budget = width - stringWidth(prefix) - stringWidth(badges);
	if (budget < 8)
		return clipText(`${prefix}${row.issue.title}${badges}`, width);
	return `${prefix}${clipText(row.issue.title, budget)}${badges}`;
}

function padRight(text: string, width: number): string {
	const extra = width - stringWidth(text);
	return extra > 0 ? text + " ".repeat(extra) : text;
}

export const ListView: React.FC<ListViewProps> = ({
	repo,
	state,
	issues,
	selected,
	scroll,
	notice,
	sibling,
	branches,
	prs,
	columns,
	rows,
}) => {
	const windowSize = Math.max(rows - 3, 1);
	const laid = boardRows(issues, { branches, prs });
	const selectable = selectableIssues(laid);
	const selectedLine = lineOfSelection(laid, selected);
	const currentScroll = reveal(selectedLine, scroll, windowSize);

	const visibleRows: React.ReactNode[] = [];

	if (selectable.length === 0) {
		visibleRows.push(
			<Box key="empty" width={columns}>
				<Text>{clip(`No ${state} issues.`, columns)}</Text>
			</Box>,
		);
	} else {
		for (let index = 0; index < windowSize; index++) {
			const rowIndex = currentScroll + index;
			const row = laid[rowIndex];
			if (!row) {
				visibleRows.push(
					<Box key={`blank-${rowIndex}`} width={columns}>
						<Text> </Text>
					</Box>,
				);
				continue;
			}

			if (row.type === "label") {
				visibleRows.push(
					<Box key={`label-${rowIndex}`} width={columns}>
						<Text dimColor>{clip(row.text, columns)}</Text>
					</Box>,
				);
			} else {
				const isSelected = rowIndex === selectedLine;
				const color = toneColor(row.tone);
				const isClosed = row.tone === "closed";
				const text = padRight(formatRowText(row, columns), columns);

				visibleRows.push(
					<Box key={`issue-${row.issue.number}-${rowIndex}`} width={columns}>
						<Text color={color} dimColor={isClosed} inverse={isSelected}>
							{text}
						</Text>
					</Box>,
				);
			}
		}
	}

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			<Header
				repo={repo}
				state={state}
				issues={issues}
				notice={notice}
				sibling={sibling}
				columns={columns}
			/>
			<Box flexDirection="column" flexGrow={1}>
				{visibleRows}
			</Box>
			<Box width={columns}>
				<Text dimColor>
					{clip(
						"j/k move   enter view   o open   w work   ^w dialog   m model   f filter   r refresh   q close",
						columns,
					)}
				</Text>
			</Box>
		</Box>
	);
};
