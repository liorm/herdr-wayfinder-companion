import { describe, expect, test } from "bun:test";
import { createClient, type CommandOutput } from "../src/herdr.ts";

describe("createClient", () => {
	test("parses a JSON stdout payload", async () => {
		const herdr = createClient(
			"herdr",
			async (_bin, args): Promise<CommandOutput> => {
				expect(args).toEqual(["workspace", "list"]);
				return { status: 0, stdout: '{"ok":true,"result":[]}\n', stderr: "" };
			},
		);

		const call = await herdr(["workspace", "list"]);
		expect(call.ok).toBe(true);
		expect(call.json).toEqual({ ok: true, result: [] });
	});

	test("reports a spawn failure without throwing", async () => {
		const herdr = createClient("missing-herdr", async () => {
			throw new Error("spawn missing-herdr ENOENT");
		});

		const call = await herdr(["status"]);
		expect(call.ok).toBe(false);
		expect(call.status).toBe(127);
		expect(call.stderr).toContain("ENOENT");
	});
});
