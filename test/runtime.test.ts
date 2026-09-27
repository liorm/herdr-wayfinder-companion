import { describe, expect, test } from "bun:test";
import { parseContext, repoDirectory } from "../src/runtime.ts";

describe("parseContext", () => {
	test("returns an empty context when the env value is missing", () => {
		expect(parseContext(undefined)).toEqual({ raw: {} });
	});

	test("returns an empty context when the env value is not JSON", () => {
		expect(parseContext("not-json")).toEqual({ raw: {} });
	});

	test("reads the fields Herdr puts on the invocation", () => {
		const context = parseContext(
			JSON.stringify({
				workspace_id: "w1",
				workspace_label: "api",
				tab_id: "w1:t1",
				tab_label: "dev",
				focused_pane_id: "w1:p1",
				focused_pane_agent: "claude",
				focused_pane_status: "working",
				focused_pane_cwd: "/work/api",
				workspace_cwd: "/work",
				selected_text: "fix the parser",
				clicked_url: "https://example.com",
				link_handler_id: "docs",
				invocation_source: "link_click",
			}),
		);

		expect(context.workspaceId).toBe("w1");
		expect(context.workspaceLabel).toBe("api");
		expect(context.tabId).toBe("w1:t1");
		expect(context.paneId).toBe("w1:p1");
		expect(context.focusedPaneAgent).toBe("claude");
		expect(context.focusedPaneStatus).toBe("working");
		expect(context.focusedPaneCwd).toBe("/work/api");
		expect(context.workspaceCwd).toBe("/work");
		expect(repoDirectory(context)).toBe("/work/api");
		expect(context.selectedText).toBe("fix the parser");
		expect(context.clickedUrl).toBe("https://example.com");
		expect(context.invocationSource).toBe("link_click");
	});

	test("uses the workspace directory when the focused pane has none", () => {
		const context = parseContext(
			JSON.stringify({ workspace_cwd: "/work/repo" }),
		);
		expect(repoDirectory(context)).toBe("/work/repo");
	});
});
