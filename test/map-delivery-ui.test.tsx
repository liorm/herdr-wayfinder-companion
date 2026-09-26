import { describe, test } from "bun:test";
import { render } from "ink";
import { MapDeliveryDialog } from "../src/ui/components/MapDeliveryDialog.tsx";
import type { Issue } from "../src/github/issues.ts";
import { createInitialMapDeliveryState } from "../src/wayfinder/map-delivery.ts";

const mapIssue: Issue = {
  number: 10,
  title: "Setup User Dashboard and Permissions",
  url: "https://github.com/example/repo/issues/10",
  labels: ["wayfinder:map"],
  assignees: [],
  closed: false,
};

const sub1: Issue = {
  number: 11,
  title: "Create dashboard layout",
  url: "https://github.com/example/repo/issues/11",
  labels: ["ready-for-agent"],
  assignees: [],
  closed: false,
};

const sub2: Issue = {
  number: 12,
  title: "Add permission checks",
  url: "https://github.com/example/repo/issues/12",
  labels: ["ready-for-agent"],
  assignees: [],
  closed: false,
};

describe("MapDeliveryDialog component", () => {
  test("renders confirmation state before start with subtickets list", () => {
    const state = createInitialMapDeliveryState(mapIssue, [sub1, sub2]);
    const { unmount } = render(
      <MapDeliveryDialog
        mapIssue={mapIssue}
        steps={state.steps}
        isStarted={false}
        isFinished={false}
        modifiedFiles={[]}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });

  test("renders in-progress state with active sub-step, modified files, and status", () => {
    const state = createInitialMapDeliveryState(mapIssue, [sub1, sub2]);
    state.steps[0]!.status = "running";
    state.steps[0]!.deliveryState = {
      issue: sub1,
      branchName: "11-create-dashboard-layout",
      isStarted: true,
      isFinished: false,
      alreadyDelivered: false,
      steps: [
        { id: "branch", title: "Switch to branch", status: "completed" },
        { id: "clear", title: "Clear session", status: "completed" },
        { id: "model", title: "Set model", status: "completed" },
        { id: "implement", title: "Implement ticket", status: "running" },
        { id: "pr", title: "Create PR", status: "pending" },
      ],
      currentStepId: "implement",
      modifiedFiles: [{ path: "src/dashboard.tsx", status: "modified", rawStatus: " M" }],
    };

    const { unmount } = render(
      <MapDeliveryDialog
        mapIssue={mapIssue}
        steps={state.steps}
        currentStepIndex={0}
        currentIssue={sub1}
        isStarted={true}
        isFinished={false}
        modifiedFiles={[{ path: "src/dashboard.tsx", status: "modified", rawStatus: " M" }]}
        agentMessage="Running tests for dashboard"
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });

  test("renders finished state with all completed steps", () => {
    const state = createInitialMapDeliveryState(mapIssue, [sub1, sub2]);
    state.steps[0]!.status = "completed";
    state.steps[1]!.status = "completed";

    const { unmount } = render(
      <MapDeliveryDialog
        mapIssue={mapIssue}
        steps={state.steps}
        isStarted={true}
        isFinished={true}
        modifiedFiles={[]}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });

  test("renders error state when a step failed", () => {
    const state = createInitialMapDeliveryState(mapIssue, [sub1, sub2]);
    state.steps[0]!.status = "failed";
    state.steps[0]!.error = "Failed to squash PR";

    const { unmount } = render(
      <MapDeliveryDialog
        mapIssue={mapIssue}
        steps={state.steps}
        isStarted={true}
        isFinished={true}
        error="Failed to squash PR #101 for ticket #11"
        modifiedFiles={[]}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });
});
