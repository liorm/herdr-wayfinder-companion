import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { Issue, IssueState } from "./issues.ts";

export interface CachedStateData {
	issues: Issue[];
	cachedAt: string;
}

export interface RepoTicketCache {
	version: 1;
	cwd: string;
	repo: string;
	updatedAt: string;
	states: Partial<Record<IssueState, CachedStateData>>;
}

export function getDefaultCacheDir(stateDir?: string): string {
	if (stateDir && stateDir.trim().length > 0) {
		return path.join(stateDir, "tickets");
	}
	const xdgCache = process.env.XDG_CACHE_HOME;
	if (xdgCache && xdgCache.trim().length > 0) {
		return path.join(xdgCache, "wayfinder-companion", "tickets");
	}
	return path.join(os.homedir(), ".cache", "wayfinder-companion", "tickets");
}

export function cacheKeyForDirectory(cwd: string): string {
	const normalized = path.resolve(cwd);
	return crypto
		.createHash("sha256")
		.update(normalized)
		.digest("hex")
		.slice(0, 16);
}

export function cacheFilePathForDirectory(
	cwd: string,
	stateDir?: string,
): string {
	const dir = getDefaultCacheDir(stateDir);
	const key = cacheKeyForDirectory(cwd);
	return path.join(dir, `${key}.json`);
}

export function readRepoCache(
	cwd: string,
	stateDir?: string,
): RepoTicketCache | null {
	try {
		const filePath = cacheFilePathForDirectory(cwd, stateDir);
		if (!fs.existsSync(filePath)) return null;
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as RepoTicketCache;
		if (
			parsed &&
			parsed.version === 1 &&
			typeof parsed.repo === "string" &&
			parsed.states
		) {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

export function getCachedIssues(
	cwd: string,
	state: IssueState,
	stateDir?: string,
): {
	repo: string;
	state: IssueState;
	issues: Issue[];
	cachedAt: string;
} | null {
	const cache = readRepoCache(cwd, stateDir);
	if (!cache) return null;
	const stateData = cache.states[state];
	if (!stateData || !Array.isArray(stateData.issues)) return null;
	return {
		repo: cache.repo,
		state,
		issues: stateData.issues,
		cachedAt: stateData.cachedAt,
	};
}

export function saveCachedIssues(
	cwd: string,
	state: IssueState,
	repo: string,
	issues: Issue[],
	stateDir?: string,
): void {
	try {
		const filePath = cacheFilePathForDirectory(cwd, stateDir);
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		const existing = readRepoCache(cwd, stateDir) ?? {
			version: 1,
			cwd: path.resolve(cwd),
			repo,
			updatedAt: new Date().toISOString(),
			states: {},
		};

		const now = new Date().toISOString();
		existing.repo = repo;
		existing.updatedAt = now;
		existing.states[state] = {
			issues,
			cachedAt: now,
		};

		fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
	} catch {
		// Best-effort cache saving
	}
}

export function clearRepoCache(cwd?: string, stateDir?: string): void {
	try {
		if (cwd) {
			const filePath = cacheFilePathForDirectory(cwd, stateDir);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		} else {
			const dir = getDefaultCacheDir(stateDir);
			if (fs.existsSync(dir)) {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
	} catch {
		// Best-effort
	}
}
