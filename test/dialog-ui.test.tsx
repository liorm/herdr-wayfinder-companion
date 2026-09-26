import { describe, test, expect } from "bun:test";
import renderToString from "../node_modules/ink/build/render-to-string.js";
import { Box } from "ink";
import { ListView } from "../src/ui/components/ListView.tsx";
import { DeliveryDialog } from "../src/ui/components/DeliveryDialog.tsx";
import { ErrorDialog } from "../src/ui/components/ErrorDialog.tsx";
import { ModelDialog } from "../src/ui/components/ModelDialog.tsx";
import { createInitialDeliveryState } from "../src/wayfinder/delivery.ts";
import { clipText, padLine, centerLine } from "../src/ui/dialog.ts";
import type { Issue } from "../src/github/issues.ts";
import stringWidth from "string-width";

describe("Dialog components rendering and opacity", () => {
  test("clipText, padLine, centerLine maintain exact visual width", () => {
    const textWithEmojiAndAnsi = " \x1b[1;33m⚠️  Ticket #123 has already been delivered with PR\x1b[0m";
    const padded = padLine(textWithEmojiAndAnsi, 60);
    expect(stringWidth(padded)).toBe(60);

    const centered = centerLine("\x1b[7;1m  OK  \x1b[0m \x1b[2m(Enter, Esc, or q to close)\x1b[0m", 60);
    expect(stringWidth(centered)).toBe(60);

    const clipped = clipText("A very long text that must be clipped", 15);
    expect(stringWidth(clipped)).toBe(15);
    expect(clipped.endsWith("…")).toBe(true);
  });

  test("DeliveryDialog renders with long titles without wrapping or leaking background", () => {
    const longIssue: Issue = {
      number: 42,
      title: "A very long issue title that spans across the entire terminal row 12345678901234567890",
      url: "https://github.com/owner/repo/issues/42",
      closed: false,
      labels: ["wayfinder:delivery"],
      assignees: [],
    };

    const backgroundIssues: Issue[] = Array.from({ length: 15 }, (_, i) => ({
      number: i + 1,
      title: `Background ticket ${i + 1} with long text 1234567890123456789012345678901234567890`,
      url: `https://github.com/owner/repo/issues/${i + 1}`,
      closed: false,
      labels: [],
      assignees: [],
    }));

    const delivState = createInitialDeliveryState(longIssue, undefined, { agent: "grok" });
    delivState.isStarted = true;
    delivState.modifiedFiles = [
      { path: "src/ui/components/DeliveryDialog.tsx", status: "modified", rawStatus: " M" },
    ];

    const output = renderToString(
      <Box width={80} height={24} position="relative">
        <ListView
          repo="owner/repo"
          state="open"
          issues={backgroundIssues}
          selected={0}
          scroll={0}
          columns={80}
          rows={24}
          branches={{}}
          prs={{}}
        />
        <DeliveryDialog
          issue={delivState.issue}
          branchName={delivState.branchName}
          isStarted={delivState.isStarted}
          isFinished={delivState.isFinished}
          alreadyDelivered={delivState.alreadyDelivered}
          existingPR={delivState.existingPR}
          steps={delivState.steps}
          currentStepId={delivState.currentStepId}
          modifiedFiles={delivState.modifiedFiles}
          agentMessage={delivState.agentMessage}
          pr={delivState.pr}
          error={delivState.error}
          columns={80}
          rows={24}
        />
      </Box>,
    );

    // Ensure dialog is rendered
    expect(output).toContain("Delivery Work: #42");
    expect(output).toContain("Branch:");
    expect(output).toContain("Modified files (1):");

    // Ensure lines inside dialog do not leak corrupted wrapped fragments
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes("│")) {
        // Line with dialog box border: the content between │ and │ should be padded properly
        const start = line.indexOf("│");
        const end = line.lastIndexOf("│");
        if (start !== -1 && end !== -1 && start < end) {
          const inner = line.slice(start + 1, end);
          expect(stringWidth(inner)).toBe(72);
        }
      }
    }
  });

  test("ErrorDialog renders without wrapping or leaking background", () => {
    const backgroundIssues: Issue[] = Array.from({ length: 10 }, (_, i) => ({
      number: i + 1,
      title: `Background ticket ${i + 1} with very long title text filling row`,
      url: `https://github.com/owner/repo/issues/${i + 1}`,
      closed: false,
      labels: [],
      assignees: [],
    }));

    const output = renderToString(
      <Box width={80} height={24} position="relative">
        <ListView
          repo="owner/repo"
          state="open"
          issues={backgroundIssues}
          selected={0}
          scroll={0}
          columns={80}
          rows={24}
          branches={{}}
          prs={{}}
        />
        <ErrorDialog
          title="Something Failed Very Badly"
          message="This is a very long error message that should wrap nicely within the dialog text area without overflowing."
          detail="Detailed diagnostic error code ERR_LONG_SOMETHING_1234567890"
          columns={80}
          rows={24}
        />
      </Box>,
    );

    expect(output).toContain("Something Failed");
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes("│")) {
        const start = line.indexOf("│");
        const end = line.lastIndexOf("│");
        if (start !== -1 && end !== -1 && start < end) {
          const inner = line.slice(start + 1, end);
          expect(stringWidth(inner)).toBe(62);
        }
      }
    }
  });

  test("ModelDialog renders with opaque padded lines", () => {
    const backgroundIssues: Issue[] = Array.from({ length: 10 }, (_, i) => ({
      number: i + 1,
      title: `Background ticket ${i + 1} with long title text filling row`,
      url: `https://github.com/owner/repo/issues/${i + 1}`,
      closed: false,
      labels: [],
      assignees: [],
    }));

    const output = renderToString(
      <Box width={80} height={24} position="relative">
        <ListView
          repo="owner/repo"
          state="open"
          issues={backgroundIssues}
          selected={0}
          scroll={0}
          columns={80}
          rows={24}
          branches={{}}
          prs={{}}
        />
        <ModelDialog
          kind="map"
          agent="grok"
          issueNumber={42}
          currentModel="Grok 4.7 medium"
          selectedIndex={4}
          columns={80}
          rows={24}
        />
      </Box>,
    );

    expect(output).toContain("Choose Model");
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes("│")) {
        const start = line.indexOf("│");
        const end = line.lastIndexOf("│");
        if (start !== -1 && end !== -1 && start < end) {
          const inner = line.slice(start + 1, end);
          expect(stringWidth(inner)).toBe(52);
        }
      }
    }
  });
});
