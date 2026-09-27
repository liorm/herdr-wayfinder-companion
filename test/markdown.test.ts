import { describe, expect, test } from "bun:test";
import { formatMarkdown } from "../src/ui/markdown.ts";

describe("formatMarkdown", () => {
	test("returns fallback message for empty or blank text", () => {
		expect(formatMarkdown("")).toEqual(["This issue has no body."]);
		expect(formatMarkdown("   \n\t  ")).toEqual(["This issue has no body."]);
	});

	test("formats headings, bold, italic, and inline code", () => {
		const md =
			"# Main Heading\n\nThis is **bold text** and *italic text* with `inline code`.";
		const lines = formatMarkdown(md, 80);
		const text = lines.join("\n");
		expect(text).toContain("Main Heading");
		expect(text).toContain("bold text");
		expect(text).toContain("italic text");
		expect(text).toContain("inline code");
	});

	test("word wraps long paragraphs according to width", () => {
		const md =
			"This is a very long paragraph that will definitely exceed thirty characters and should be wrapped cleanly across multiple lines by the markdown word-wrapper without truncating.";
		const lines = formatMarkdown(md, 35);
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) {
			// Stripping ANSI escape codes for length check
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence contains ESC
			const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, "");
			expect(cleanLine.length).toBeLessThanOrEqual(35);
		}
	});

	test("formats bulleted and numbered lists", () => {
		const md =
			"- First item\n- Second item with longer description\n\n1. Numbered item 1\n2. Numbered item 2";
		const lines = formatMarkdown(md, 80);
		const text = lines.join("\n");
		expect(text).toContain("First item");
		expect(text).toContain("Second item with longer description");
		expect(text).toContain("Numbered item 1");
	});

	test("formats code blocks", () => {
		const md =
			"```ts\nconst greeting = 'hello world';\nconsole.log(greeting);\n```";
		const lines = formatMarkdown(md, 80);
		const text = lines.join("\n");
		expect(text).toContain("const greeting");
		expect(text).toContain("console.log(greeting)");
	});

	test("formats blockquotes", () => {
		const md = "> This is an important quote that needs attention.";
		const lines = formatMarkdown(md, 80);
		const text = lines.join("\n");
		expect(text).toContain("This is an important quote");
	});
});
