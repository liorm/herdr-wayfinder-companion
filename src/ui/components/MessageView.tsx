import type React from "react";
import { Box, Text } from "ink";
import { clip } from "../render.ts";

export interface MessageViewProps {
	title: string;
	lines: string[];
	footer: string;
	columns: number;
	rows: number;
}

export const MessageView: React.FC<MessageViewProps> = ({
	title,
	lines,
	footer,
	columns,
	rows,
}) => {
	const bodyRoom = Math.max(rows - 3, 0);
	const visibleLines = lines.slice(0, bodyRoom);

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			<Box width={columns}>
				<Text bold>{clip(title, columns)}</Text>
			</Box>
			<Box width={columns}>
				<Text> </Text>
			</Box>
			<Box flexDirection="column" flexGrow={1}>
				{visibleLines.map((line, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines in message view do not have unique IDs
					<Box key={`msg-${index}`} width={columns}>
						<Text>{clip(line, columns)}</Text>
					</Box>
				))}
			</Box>
			<Box width={columns}>
				<Text dimColor>{clip(footer, columns)}</Text>
			</Box>
		</Box>
	);
};
