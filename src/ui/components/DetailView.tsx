import type React from "react";
import { Box, Text } from "ink";
import { clip } from "../render.ts";
import { TICKET_FOOTER } from "../ticket.ts";

export interface DetailViewProps {
	lines: string[];
	scroll: number;
	columns: number;
	rows: number;
}

export const DetailView: React.FC<DetailViewProps> = ({
	lines,
	scroll,
	columns,
	rows,
}) => {
	const showFooter = rows > 1;
	const windowSize = showFooter ? rows - 1 : Math.max(rows, 1);
	const visibleLines = lines.slice(scroll, scroll + windowSize);
	while (visibleLines.length < windowSize) visibleLines.push("");

	return (
		<Box flexDirection="column" width={columns} height={Math.max(rows, 1)}>
			<Box flexDirection="column" width={columns} height={windowSize}>
				{visibleLines.map((line, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines in terminal scroll buffer do not have unique IDs
					<Box key={`detail-line-${scroll + index}`} width={columns} height={1}>
						<Text wrap="truncate">{line.length > 0 ? line : " "}</Text>
					</Box>
				))}
			</Box>
			{showFooter ? (
				<Box width={columns} height={1}>
					<Text dimColor>{clip(TICKET_FOOTER, columns)}</Text>
				</Box>
			) : null}
		</Box>
	);
};
