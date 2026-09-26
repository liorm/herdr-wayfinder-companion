import React from "react";
import { Box, Text } from "ink";
import { AVAILABLE_MODELS } from "../../wayfinder/models.ts";

export interface ModelDialogProps {
  kind: string;
  issueNumber?: number;
  currentModel: string;
  selectedIndex: number;
  columns: number;
  rows: number;
}

function padLine(str: string, len: number): string {
  const visible = [...str.replace(/\x1b\[[0-9;]*m/g, "")].length;
  return str + " ".repeat(Math.max(0, len - visible));
}

function centerLine(str: string, len: number): string {
  const visible = [...str.replace(/\x1b\[[0-9;]*m/g, "")].length;
  const left = Math.max(0, Math.floor((len - visible) / 2));
  const right = Math.max(0, len - visible - left);
  return " ".repeat(left) + str + " ".repeat(right);
}

export const ModelDialog: React.FC<ModelDialogProps> = ({
  kind,
  issueNumber,
  currentModel,
  selectedIndex,
  columns,
  rows,
}) => {
  const dialogWidth = Math.min(Math.max(columns - 4, 38), 54);
  const innerWidth = dialogWidth - 2;

  const headerTitle = issueNumber ? `Choose Model: #${issueNumber} (${kind})` : `Choose Model (${kind})`;

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

        {AVAILABLE_MODELS.map((model, idx) => {
          const isHovered = idx === selectedIndex;
          const isActive = model === currentModel;
          const prefix = isHovered ? "❯ " : "  ";
          const suffix = isActive ? " \x1b[2m(current)\x1b[0m" : "";
          const text = `${prefix}${model}${suffix}`;

          return (
            <Text key={model} inverse={isHovered}>
              {padLine(` ${text}`, innerWidth)}
            </Text>
          );
        })}

        <Text>{padLine("", innerWidth)}</Text>
        <Text>{centerLine("\x1b[2m↑/↓ select   Enter save   Esc cancel\x1b[0m", innerWidth)}</Text>
      </Box>
    </Box>
  );
};
