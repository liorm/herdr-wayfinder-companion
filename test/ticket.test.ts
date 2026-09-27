import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github/issues.ts";
import {
	formatTicketView,
	parseIssueView,
	parseRawComments,
} from "../src/ui/ticket.ts";

const issue: Issue = {
	number: 7,
	title: "Fix the gate",
	url: "https://example.com/7",
	updatedAt: "2026-09-12T15:04:00Z",
	author: "ada",
	labels: ["bug"],
	assignees: ["lior"],
	closed: false,
};

const view = [
	"title:\tFix the gate",
	"state:\tOPEN",
	"author:\tada",
	"labels:\tbug",
	"comments:\t1",
	"assignees:\tlior",
	"projects:\t",
	"milestone:\t",
	"number:\t7",
	"--",
	"The gate is stuck.",
].join("\n");

const comments = [
	"author:\tada",
	"association:\tnone",
	"edited:\tfalse",
	"status:\tnone",
	"--",
	"Ship it.",
	"--",
].join("\n");

describe("parseIssueView", () => {
	test("splits the raw gh preamble from the description", () => {
		expect(parseIssueView(view)).toEqual({
			fields: {
				title: "Fix the gate",
				state: "OPEN",
				author: "ada",
				labels: "bug",
				comments: "1",
				assignees: "lior",
				projects: "",
				milestone: "",
				number: "7",
			},
			body: "The gate is stuck.",
		});
	});
});

describe("parseRawComments", () => {
	test("reads gh comment blocks", () => {
		expect(parseRawComments(comments)).toEqual({
			comments: [
				{
					author: "ada",
					association: "none",
					edited: false,
					status: "none",
					body: "Ship it.",
				},
			],
			rest: "",
		});
	});
});

describe("formatTicketView", () => {
	test("puts metadata on its own colored lines and keeps the description", () => {
		const lines = formatTicketView(issue, view, comments, 60, [issue]);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence contains ESC
		const plain = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
		expect(plain[0]).toContain("#7");
		expect(plain[0]).toContain("Open");
		expect(plain[0]).toContain("in progress");
		expect(plain[1]).toBe("Fix the gate");
		expect(plain[2]).toContain("ada");
		expect(plain[2]).toContain("assigned lior");
		expect(plain[2]).toContain("1 comment");
		expect(plain[2]).toContain("updated 12 Sep 2026");
		expect(plain.join("\n")).toContain("The gate is stuck.");
		expect(plain.join("\n")).toContain("Ship it.");
		expect(plain.join("\n")).not.toContain("title:");
		expect(lines[0]).toContain("\x1b[32m");
		expect(lines[1]).toContain("\x1b[1m");
	});

	test("renders PR link line when PR option is provided", () => {
		const lines = formatTicketView(issue, view, comments, 80, [issue], {
			prs: {
				7: {
					number: 99,
					url: "https://github.com/org/repo/pull/99",
					state: "open",
				},
			},
		});
		const plain = lines.map((line) => {
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence contains ESC and BEL
			return line.replace(/\x1b\[[0-9;]*m|\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "");
		});
		expect(plain.join("\n")).toContain(
			"Pull Request: PR #99 • https://github.com/org/repo/pull/99 [open]",
		);
	});
});
