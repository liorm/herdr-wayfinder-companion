import { describe, test } from "bun:test";
import { render } from "ink";
import { DeliveryDialog } from "../src/ui/components/DeliveryDialog.tsx";
import type { Issue } from "../src/github/issues.ts";
import { createInitialDeliverySteps } from "../src/wayfinder/delivery.ts";

const sampleIssue: Issue = {
  number: 77,
  title: "Implement payment processing",
  url: "https://github.com/example/repo/issues/77",
  labels: ["ready-for-agent"],
  assignees: [],
  closed: false,
};

describe("DeliveryDialog component", () => {
  test("renders confirmation state before start with branch and steps", () => {
    const steps = createInitialDeliverySteps(sampleIssue, "77-implement-payment-processing");
    const { unmount } = render(
      <DeliveryDialog
        issue={sampleIssue}
        branchName="77-implement-payment-processing"
        isStarted={false}
        isFinished={false}
        alreadyDelivered={false}
        steps={steps}
        modifiedFiles={[]}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });

  test("renders already-delivered dialog with PR link", () => {
    const steps = createInitialDeliverySteps(sampleIssue, "77-implement-payment-processing");
    const { unmount } = render(
      <DeliveryDialog
        issue={sampleIssue}
        branchName="77-implement-payment-processing"
        isStarted={false}
        isFinished={true}
        alreadyDelivered={true}
        existingPR={{
          number: 88,
          title: "Implement payments",
          url: "https://github.com/example/repo/pull/88",
          state: "open",
        }}
        steps={steps}
        modifiedFiles={[]}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });

  test("renders in-progress state with modified files and spinner", () => {
    const steps = createInitialDeliverySteps(sampleIssue, "77-implement-payment-processing");
    steps[0]!.status = "completed";
    steps[1]!.status = "completed";
    steps[2]!.status = "completed";
    steps[3]!.status = "running";

    const { unmount } = render(
      <DeliveryDialog
        issue={sampleIssue}
        branchName="77-implement-payment-processing"
        isStarted={true}
        isFinished={false}
        alreadyDelivered={false}
        currentStepId="implement"
        steps={steps}
        modifiedFiles={[
          { path: "src/payment.ts", status: "modified", rawStatus: " M" },
          { path: "src/new-feature.ts", status: "added", rawStatus: "A " },
          { path: "src/deprecated.ts", status: "deleted", rawStatus: " D" },
        ]}
        agentMessage="Refactoring payment service"
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });

  test("renders finished state with PR link", () => {
    const steps = createInitialDeliverySteps(sampleIssue, "77-implement-payment-processing");
    steps.forEach((s) => (s.status = "completed"));

    const { unmount } = render(
      <DeliveryDialog
        issue={sampleIssue}
        branchName="77-implement-payment-processing"
        isStarted={true}
        isFinished={true}
        alreadyDelivered={false}
        steps={steps}
        modifiedFiles={[{ path: "src/payment.ts", status: "modified", rawStatus: " M" }]}
        pr={{
          number: 99,
          title: "Implement payment processing",
          url: "https://github.com/example/repo/pull/99",
          state: "open",
        }}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });
});
