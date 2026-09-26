import React from "react";
import { Box, Text } from "ink";
import type { Issue } from "../../github/issues.ts";
import { clip } from "../render.ts";

export interface DetailViewProps {
  issue: Issue;
  lines: string[];
  scroll: number;
  columns: number;
  rows: number;
}

export const DetailView: React.FC<DetailViewProps> = ({
  issue,
  lines,
  scroll,
  columns,
  rows,
}) => {
  const windowSize = Math.max(rows - 3, 1);
  const visibleLines = lines.slice(scroll, scroll + windowSize);

  while (visibleLines.length < windowSize) {
    visibleLines.push("");
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box width={columns}>
        <Text bold>{clip(`#${issue.number}  ${issue.title}`, columns)}</Text>
      </Box>
      <Box width={columns}>
        <Text dimColor>{clip("j/k scroll   esc back   q close", columns)}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visibleLines.map((line, index) => (
          <Box key={`detail-line-${scroll + index}`} width={columns}>
            <Text wrap="truncate">{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
