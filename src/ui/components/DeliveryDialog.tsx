import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { Issue } from "../../github/issues.ts";
import type { ModifiedFile, PRInfo } from "../../git.ts";
import type { DeliveryStep } from "../../wayfinder/delivery.ts";

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

function clipText(str: string, maxLen: number): string {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, "");
  if (plain.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

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

  const headerTitle = clipText(` Delivery Work: #${issue.number} ${issue.title} `, innerWidth - 4);

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
        <Text>{padLine(` Branch: \x1b[1;36m${branchName}\x1b[0m \x1b[2m(base: main)\x1b[0m`, innerWidth)}</Text>
        <Text>{padLine("", innerWidth)}</Text>

        {alreadyDelivered ? (
          <Box flexDirection="column">
            <Text>{padLine(" \x1b[1;33m⚠️  Ticket has already been delivered with a PR.\x1b[0m", innerWidth)}</Text>
            {existingPR ? (
              <>
                <Text>{padLine(` PR: \x1b[1;36m#${existingPR.number} ${existingPR.title}\x1b[0m`, innerWidth)}</Text>
                <Text>{padLine(` URL: \x1b[4;34m${existingPR.url}\x1b[0m`, innerWidth)}</Text>
              </>
            ) : null}
            <Text>{padLine("", innerWidth)}</Text>
            <Text>{centerLine("\x1b[7;1m  OK  \x1b[0m \x1b[2m(Enter, Esc, or q to close)\x1b[0m", innerWidth)}</Text>
          </Box>
        ) : !isStarted ? (
          <Box flexDirection="column">
            <Text>{padLine(" \x1b[1mSteps to execute:\x1b[0m", innerWidth)}</Text>
            {steps.map((step, idx) => (
              <Text key={`preview-${step.id}`}>
                {padLine(`   \x1b[2m[ ] ${idx + 1}. ${step.title}\x1b[0m`, innerWidth)}
              </Text>
            ))}
            <Text>{padLine("", innerWidth)}</Text>
            <Text>
              {centerLine(
                "\x1b[7;1;32m  Start Work  \x1b[0m \x1b[2m(Enter or Space)\x1b[0m   \x1b[2m(Esc or q to cancel)\x1b[0m",
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

              return (
                <Text key={`step-${step.id}`}>
                  {padLine(
                    ` ${icon}${styleOpen}${idx + 1}. ${step.title}${styleClose}${
                      step.error ? ` \x1b[31m(${step.error})\x1b[0m` : ""
                    }`,
                    innerWidth,
                  )}
                </Text>
              );
            })}

            {modifiedFiles.length > 0 ? (
              <Box flexDirection="column" marginTop={1}>
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
                  return (
                    <Text key={`file-${file.path}`}>
                      {padLine(
                        `   \x1b[1;${colorCode} ${clipText(file.path, innerWidth - 8)}\x1b[0m`,
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
                {padLine(` \x1b[2mAgent: ${clipText(agentMessage, innerWidth - 10)}\x1b[0m`, innerWidth)}
              </Text>
            ) : null}

            {isFinished && pr ? (
              <Box flexDirection="column" marginTop={1}>
                <Text>
                  {padLine(
                    ` \x1b[1;32m🎉 Delivery PR Created:\x1b[0m \x1b[1;36m#${pr.number} ${clipText(
                      pr.title,
                      innerWidth - 30,
                    )}\x1b[0m`,
                    innerWidth,
                  )}
                </Text>
                <Text>{padLine(`    \x1b[4;34m${pr.url}\x1b[0m`, innerWidth)}</Text>
              </Box>
            ) : null}

            {error ? (
              <Box flexDirection="column" marginTop={1}>
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
