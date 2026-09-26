import { describe, test } from "bun:test";
import { render } from "ink";
import { ModelDialog } from "../src/ui/components/ModelDialog.tsx";

describe("ModelDialog component", () => {
  test("renders model dialog with all available models", () => {
    const { unmount } = render(
      <ModelDialog
        kind="map"
        issueNumber={42}
        currentModel="Grok 4.7 medium"
        selectedIndex={4}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });

  test("renders model dialog for generic kind without issue number", () => {
    const { unmount } = render(
      <ModelDialog
        kind="delivery"
        currentModel="Grok 4.6 low"
        selectedIndex={0}
        columns={80}
        rows={24}
      />,
    );
    unmount();
  });
});
