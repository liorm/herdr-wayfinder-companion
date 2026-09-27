import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	cacheKeyForDirectory,
	cacheFilePathForDirectory,
	getCachedIssues,
	saveCachedIssues,
	clearRepoCache,
} from "../src/github/cache.ts";
import type { Issue } from "../src/github/issues.ts";

describe("cache", () => {
	const tempDir = path.join(os.tmpdir(), `wayfinder-cache-test-${Date.now()}`);

	beforeEach(() => {
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const sampleIssue: Issue = {
		number: 42,
		title: "Add cache support",
		url: "https://github.com/acme/widgets/issues/42",
		labels: ["enhancement"],
		assignees: ["ada"],
		closed: false,
	};

	const sampleIssues: Issue[] = [sampleIssue];

	test("cacheKeyForDirectory generates consistent hash for directory", () => {
		const key1 = cacheKeyForDirectory("/path/to/repo");
		const key2 = cacheKeyForDirectory("/path/to/repo");
		const key3 = cacheKeyForDirectory("/other/path");
		expect(key1).toBe(key2);
		expect(key1).not.toBe(key3);
	});

	test("saves and loads cached issues per working folder and state", () => {
		saveCachedIssues(
			"/work/repoA",
			"open",
			"owner/repoA",
			sampleIssues,
			tempDir,
		);

		const cachedOpen = getCachedIssues("/work/repoA", "open", tempDir);
		expect(cachedOpen).not.toBeNull();
		expect(cachedOpen?.repo).toBe("owner/repoA");
		expect(cachedOpen?.state).toBe("open");
		expect(cachedOpen?.issues).toEqual(sampleIssues);

		// Different state not cached yet
		const cachedClosed = getCachedIssues("/work/repoA", "closed", tempDir);
		expect(cachedClosed).toBeNull();

		// Now save closed state
		const closedIssues: Issue[] = [
			{ ...sampleIssue, number: 43, closed: true },
		];
		saveCachedIssues(
			"/work/repoA",
			"closed",
			"owner/repoA",
			closedIssues,
			tempDir,
		);

		expect(getCachedIssues("/work/repoA", "closed", tempDir)?.issues).toEqual(
			closedIssues,
		);
		expect(getCachedIssues("/work/repoA", "open", tempDir)?.issues).toEqual(
			sampleIssues,
		);
	});

	test("caches are isolated per working folder", () => {
		saveCachedIssues(
			"/work/repoA",
			"open",
			"owner/repoA",
			sampleIssues,
			tempDir,
		);
		saveCachedIssues(
			"/work/repoB",
			"open",
			"owner/repoB",
			[{ ...sampleIssue, number: 99, title: "Repo B Issue" }],
			tempDir,
		);

		const a = getCachedIssues("/work/repoA", "open", tempDir);
		const b = getCachedIssues("/work/repoB", "open", tempDir);

		expect(a?.repo).toBe("owner/repoA");
		expect(a?.issues[0]?.number).toBe(42);

		expect(b?.repo).toBe("owner/repoB");
		expect(b?.issues[0]?.number).toBe(99);
	});

	test("returns null gracefully on corrupted cache file", () => {
		const filePath = cacheFilePathForDirectory("/work/corrupted", tempDir);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, "invalid json{{{", "utf-8");

		const result = getCachedIssues("/work/corrupted", "open", tempDir);
		expect(result).toBeNull();
	});

	test("clears cache for a specific working folder", () => {
		saveCachedIssues(
			"/work/repoA",
			"open",
			"owner/repoA",
			sampleIssues,
			tempDir,
		);
		saveCachedIssues(
			"/work/repoB",
			"open",
			"owner/repoB",
			sampleIssues,
			tempDir,
		);

		clearRepoCache("/work/repoA", tempDir);

		expect(getCachedIssues("/work/repoA", "open", tempDir)).toBeNull();
		expect(getCachedIssues("/work/repoB", "open", tempDir)).not.toBeNull();
	});
});
