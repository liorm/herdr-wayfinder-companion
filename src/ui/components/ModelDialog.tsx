import React from "react";
import { Box, Text } from "ink";
import { getAvailableModels, normalizeAgentKind } from "../../wayfinder/models.ts";
import { clipText, padLine, centerLine } from "../dialog.ts";

export interface ModelDialogProps {
  kind: string;
  agent?: string;
  issueNumber?: number;
  currentModel: string;
  selectedIndex: number;
  columns: number;
  rows: number;
}

export const ModelDialog: React.FC<ModelDialogProps> = ({
  kind,
  agent,
  issueNumber,
  currentModel,
  selectedIndex,
  columns,
  rows,
}) => {
  const dialogWidth = Math.min(Math.max(columns - 4, 38), 54);
  const innerWidth = dialogWidth - 2;
  const normAgent = normalizeAgentKind(agent);
  const availableModels = getAvailableModels(normAgent);

  const titleContent = issueNumber
    ? `Choose Model (${normAgent}): #${issueNumber} (${kind})`
    : `Choose Model (${normAgent}): ${kind}`;
  const headerTitle = clipText(titleContent, innerWidth - 6);

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
        borderColor="cyan"
      >
        <Text>{padLine(` \x1b[1;36m[ ${headerTitle} ]\x1b[0m`, innerWidth)}</Text>
        <Text>{padLine("", innerWidth)}</Text>

        {availableModels.map((model, idx) => {
          const isHovered = idx === selectedIndex;
          const isActive = model === currentModel;
          const prefix = isHovered ? "❯ " : "  ";
          const suffix = isActive ? " \x1b[2m(current)\x1b[0m" : "";
          const lineText = clipText(`${prefix}${model}${suffix}`, innerWidth - 2);

          return (
            <Text key={model} inverse={isHovered}>
              {padLine(` ${lineText}`, innerWidth)}
            </Text>
          );
        })}

        <Text>{padLine("", innerWidth)}</Text>
        <Text>{centerLine("\x1b[2m↑/↓ select   Enter save   Esc cancel\x1b[0m", innerWidth)}</Text>
      </Box>
    </Box>
  );
};
