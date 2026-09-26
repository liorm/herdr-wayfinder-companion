import React from "react";
import { Box, Text } from "ink";
import type { SiblingAgent } from "../../sibling.ts";
import { formatSubtitle, clip } from "../render.ts";
import { ISSUE_LIMIT, type Issue, type IssueState } from "../../github/issues.ts";

export interface HeaderProps {
  repo: string;
  state: IssueState;
  issues: Issue[];
  notice?: string;
  sibling?: SiblingAgent;
  columns: number;
}

export const Header: React.FC<HeaderProps> = ({
  repo,
  state,
  issues,
  notice,
  sibling,
  columns,
}) => {
  const count = issues.length === ISSUE_LIMIT ? `${ISSUE_LIMIT} (limit)` : String(issues.length);
  const maps = issues.filter((issue) => issue.labels.includes("wayfinder:map")).length;
  const summary =
    maps > 0
      ? `${state} · ${count} · ${maps} ${maps === 1 ? "map" : "maps"}`
      : `${state} · ${count}`;
  const subtitle = formatSubtitle(summary, notice, sibling);

  return (
    <Box flexDirection="column" width={columns}>
      <Text bold>{clip(`Wayfinder Companion  ${repo}`, columns)}</Text>
      <Text>{clip(subtitle, columns)}</Text>
    </Box>
  );
};
