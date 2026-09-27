import { describe, test } from "bun:test";
import { render } from "ink";
import { ModelDialog } from "../src/ui/components/ModelDialog.tsx";

describe("ModelDialog component", () => {
	test("renders model dialog with grok models", () => {
		const { unmount } = render(
			<ModelDialog
				kind="map"
				agent="grok"
				issueNumber={42}
				currentModel="Grok 4.7 medium"
				selectedIndex={4}
				columns={80}
				rows={24}
			/>,
		);
		unmount();
	});

	test("renders model dialog with agy models", () => {
		const { unmount } = render(
			<ModelDialog
				kind="map"
				agent="agy"
				issueNumber={42}
				currentModel="gemini-3.7-flash-medium"
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
				agent="agy"
				currentModel="gemini-3.6-flash-low"
				selectedIndex={0}
				columns={80}
				rows={24}
			/>,
		);
		unmount();
	});
});
