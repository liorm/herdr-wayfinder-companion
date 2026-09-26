import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { Issue } from "../../github/issues.ts";
import type { ModifiedFile } from "../../git.ts";
import type { MapDeliveryStep } from "../../wayfinder/map-delivery.ts";
import { clipText, padLine, centerLine } from "../dialog.ts";

export interface MapDeliveryDialogProps {
  mapIssue: Issue;
  steps: MapDeliveryStep[];
  currentStepIndex?: number;
  currentIssue?: Issue;
  isStarted: boolean;
  isFinished: boolean;
  modifiedFiles: ModifiedFile[];
  agentMessage?: string;
  error?: string;
  columns: number;
  rows: number;
}

const SPINNER_FRAMES = ["Oo", "oO", "oo", "OO", "oO", "Oo"];

export const MapDeliveryDialog: React.FC<MapDeliveryDialogProps> = ({
  mapIssue,
  steps,
  isStarted,
  isFinished,
  modifiedFiles,
  agentMessage,
  error,
  columns,
  rows,
}) => {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  useEffect(() => {
    if (!isStarted || isFinished) return;
    const timer = setInterval(() => {
      setSpinnerIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 250);
    return () => clearInterval(timer);
  }, [isStarted, isFinished]);

  const dialogWidth = Math.min(Math.max(columns - 4, 44), 74);
  const innerWidth = dialogWidth - 2;

  const currentSpinner = SPINNER_FRAMES[spinnerIndex] ?? "Oo";

  const borderColor = error
    ? "red"
    : isFinished
      ? "green"
      : "cyan";

  const headerTitle = clipText(`Map Delivery: #${mapIssue.number} ${mapIssue.title}`, innerWidth - 6);
  const subtitle = clipText(`Sequential Delivery: ${steps.length} items`, innerWidth - 2);

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
        borderColor={borderColor}
      >
        <Text>{padLine(` \x1b[1;${error ? "31" : isFinished ? "32" : "36"}m[ ${headerTitle} ]\x1b[0m`, innerWidth)}</Text>
        <Text>{padLine(` \x1b[1;36m${subtitle}\x1b[0m`, innerWidth)}</Text>
        <Text>{padLine("", innerWidth)}</Text>

        {!isStarted ? (
          <Box flexDirection="column">
            <Text>{padLine(" \x1b[1mDelivery items to execute sequentially:\x1b[0m", innerWidth)}</Text>
            {steps.map((step, idx) => {
              const marker = step.status === "completed" ? "[✔]" : "[ ]";
              const stepText = clipText(`${marker} ${idx + 1}. #${step.issue.number} ${step.issue.title}`, innerWidth - 4);
              return (
                <Text key={`preview-${step.issue.number}`}>
                  {padLine(`   \x1b[2m${stepText}\x1b[0m`, innerWidth)}
                </Text>
              );
            })}
            <Text>{padLine("", innerWidth)}</Text>
            <Text>
              {centerLine(
                "\x1b[7;1;32m  Start Work  \x1b[0m \x1b[2m(Enter/Space)\x1b[0m   \x1b[2m(Esc/q cancel)\x1b[0m",
                innerWidth,
              )}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {steps.map((step, idx) => {
              let icon = "  · ";
              let styleOpen = "\x1b[2m";
              let styleClose = "\x1b[0m";

              if (step.status === "completed") {
                icon = " \x1b[1;32m✔\x1b[0m ";
                styleOpen = "\x1b[32m";
              } else if (step.status === "running") {
                icon = `\x1b[1;36m${currentSpinner}\x1b[0m `;
                styleOpen = "\x1b[1;36m";
              } else if (step.status === "failed") {
                icon = " \x1b[1;31m✖\x1b[0m ";
                styleOpen = "\x1b[1;31m";
              }

              const errText = step.error ? ` (${step.error})` : "";
              const stepContent = clipText(`${idx + 1}. #${step.issue.number} ${step.issue.title}${errText}`, innerWidth - 6);

              const runningSubStep =
                step.status === "running" && step.deliveryState
                  ? step.deliveryState.steps.find((s) => s.status === "running")
                  : undefined;

              return (
                <Box key={`step-${step.issue.number}`} flexDirection="column">
                  <Text>
                    {padLine(
                      ` ${icon}${styleOpen}${stepContent}${styleClose}`,
                      innerWidth,
                    )}
                  </Text>
                  {runningSubStep ? (
                    <Text>
                      {padLine(
                        `      \x1b[2;36m└─ ${clipText(runningSubStep.title, innerWidth - 10)}\x1b[0m`,
                        innerWidth,
                      )}
                    </Text>
                  ) : null}
                </Box>
              );
            })}

            {modifiedFiles.length > 0 ? (
              <Box flexDirection="column">
                <Text>{padLine("", innerWidth)}</Text>
                <Text>
                  {padLine(
                    ` \x1b[1mModified files (${modifiedFiles.length}):\x1b[0m`,
                    innerWidth,
                  )}
                </Text>
                {modifiedFiles.slice(0, 4).map((file) => {
                  let colorCode = "33m~";
                  if (file.status === "added" || file.status === "untracked") {
                    colorCode = "32m+";
                  } else if (file.status === "deleted") {
                    colorCode = "31m-";
                  }
                  const filePath = clipText(file.path, innerWidth - 7);
                  return (
                    <Text key={`file-${file.path}`}>
                      {padLine(
                        `   \x1b[1;${colorCode} ${filePath}\x1b[0m`,
                        innerWidth,
                      )}
                    </Text>
                  );
                })}
                {modifiedFiles.length > 4 ? (
                  <Text>
                    {padLine(`   \x1b[2m... and ${modifiedFiles.length - 4} more files\x1b[0m`, innerWidth)}
                  </Text>
                ) : null}
              </Box>
            ) : null}

            {agentMessage && !isFinished ? (
              <Text>
                {padLine(` \x1b[2m${clipText(`Status: ${agentMessage}`, innerWidth - 2)}\x1b[0m`, innerWidth)}
              </Text>
            ) : null}

            {isFinished && !error ? (
              <Box flexDirection="column">
                <Text>{padLine("", innerWidth)}</Text>
                <Text>
                  {padLine(
                    ` \x1b[1;32m🎉 All ${steps.length} map delivery items completed & closed!\x1b[0m`,
                    innerWidth,
                  )}
                </Text>
              </Box>
            ) : null}

            {error ? (
              <Box flexDirection="column">
                <Text>{padLine("", innerWidth)}</Text>
                <Text>{padLine(` \x1b[1;31mError:\x1b[0m ${clipText(error, innerWidth - 10)}`, innerWidth)}</Text>
              </Box>
            ) : null}

            <Text>{padLine("", innerWidth)}</Text>
            {isFinished || error ? (
              <Text>{centerLine("\x1b[7;1m  Close  \x1b[0m \x1b[2m(Enter, Esc, or q)\x1b[0m", innerWidth)}</Text>
            ) : (
              <Text>{centerLine("\x1b[2mMap delivery in progress... please wait\x1b[0m", innerWidth)}</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
