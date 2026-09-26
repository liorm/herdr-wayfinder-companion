import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { Issue } from "../../github/issues.ts";
import type { ModifiedFile, PRInfo } from "../../git.ts";
import type { DeliveryStep } from "../../wayfinder/delivery.ts";
import { clipText, padLine, centerLine } from "../dialog.ts";

export interface DeliveryDialogProps {
  issue: Issue;
  branchName: string;
  isStarted: boolean;
  isFinished: boolean;
  alreadyDelivered: boolean;
  existingPR?: PRInfo;
  steps: DeliveryStep[];
  currentStepId?: string;
  modifiedFiles: ModifiedFile[];
  agentMessage?: string;
  pr?: PRInfo;
  error?: string;
  columns: number;
  rows: number;
}

const SPINNER_FRAMES = ["Oo", "oO", "oo", "OO", "oO", "Oo"];

export const DeliveryDialog: React.FC<DeliveryDialogProps> = ({
  issue,
  branchName,
  isStarted,
  isFinished,
  alreadyDelivered,
  existingPR,
  steps,
  modifiedFiles,
  agentMessage,
  pr,
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
    : alreadyDelivered
      ? "yellow"
      : isFinished
        ? "green"
        : "cyan";

  const headerTitle = clipText(`Delivery Work: #${issue.number} ${issue.title}`, innerWidth - 6);
  const branchLine = clipText(`Branch: ${branchName} (base: main)`, innerWidth - 2);

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
        <Text>{padLine(` \x1b[1;36m${branchLine}\x1b[0m`, innerWidth)}</Text>
        <Text>{padLine("", innerWidth)}</Text>

        {alreadyDelivered ? (
          <Box flexDirection="column">
            <Text>{padLine(" \x1b[1;33m⚠️  Ticket has already been delivered with a PR.\x1b[0m", innerWidth)}</Text>
            {existingPR ? (
              <>
                <Text>{padLine(` \x1b[1;36m${clipText(`PR: #${existingPR.number} ${existingPR.title}`, innerWidth - 2)}\x1b[0m`, innerWidth)}</Text>
                <Text>{padLine(` \x1b[4;34m${clipText(`URL: ${existingPR.url}`, innerWidth - 2)}\x1b[0m`, innerWidth)}</Text>
              </>
            ) : null}
            <Text>{padLine("", innerWidth)}</Text>
            <Text>{centerLine("\x1b[7;1m  OK  \x1b[0m \x1b[2m(Enter, Esc, or q to close)\x1b[0m", innerWidth)}</Text>
          </Box>
        ) : !isStarted ? (
          <Box flexDirection="column">
            <Text>{padLine(" \x1b[1mSteps to execute:\x1b[0m", innerWidth)}</Text>
            {steps.map((step, idx) => {
              const stepText = clipText(`[ ] ${idx + 1}. ${step.title}`, innerWidth - 4);
              return (
                <Text key={`preview-${step.id}`}>
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
              const stepContent = clipText(`${idx + 1}. ${step.title}${errText}`, innerWidth - 6);

              return (
                <Text key={`step-${step.id}`}>
                  {padLine(
                    ` ${icon}${styleOpen}${stepContent}${styleClose}`,
                    innerWidth,
                  )}
                </Text>
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
                {modifiedFiles.slice(0, 5).map((file) => {
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
                {modifiedFiles.length > 5 ? (
                  <Text>
                    {padLine(`   \x1b[2m... and ${modifiedFiles.length - 5} more files\x1b[0m`, innerWidth)}
                  </Text>
                ) : null}
              </Box>
            ) : null}

            {agentMessage && !isFinished ? (
              <Text>
                {padLine(` \x1b[2m${clipText(`Agent: ${agentMessage}`, innerWidth - 2)}\x1b[0m`, innerWidth)}
              </Text>
            ) : null}

            {isFinished && pr ? (
              <Box flexDirection="column">
                <Text>{padLine("", innerWidth)}</Text>
                <Text>
                  {padLine(
                    ` \x1b[1;32m🎉 Delivery PR Created:\x1b[0m \x1b[1;36m#${pr.number} ${clipText(
                      pr.title,
                      innerWidth - 30,
                    )}\x1b[0m`,
                    innerWidth,
                  )}
                </Text>
                <Text>{padLine(`    \x1b[4;34m${clipText(pr.url, innerWidth - 5)}\x1b[0m`, innerWidth)}</Text>
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
              <Text>{centerLine("\x1b[2mDelivery in progress... please wait\x1b[0m", innerWidth)}</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
