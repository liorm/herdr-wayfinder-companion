import { describe, expect, test, afterEach } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getAvailableModels,
  getModelForTicketKind,
  getNextModel,
  normalizeAgentKind,
  saveModelConfig,
} from "../src/wayfinder/models.ts";

describe("model configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("normalizeAgentKind normalizes various agent strings", () => {
    expect(normalizeAgentKind("grok")).toBe("grok");
    expect(normalizeAgentKind("GROK")).toBe("grok");
    expect(normalizeAgentKind("agy")).toBe("agy");
    expect(normalizeAgentKind("AGY")).toBe("agy");
    expect(normalizeAgentKind("antigravity")).toBe("agy");
    expect(normalizeAgentKind("gemini")).toBe("agy");
    expect(normalizeAgentKind(undefined)).toBe("grok");
    expect(normalizeAgentKind("unknown")).toBe("grok");
  });

  test("AGENT_AVAILABLE_MODELS contains correct models for grok and agy", () => {
    expect(getAvailableModels("grok")).toEqual([
      "Grok 4.6 low",
      "Grok 4.6 medium",
      "Grok 4.6 high",
      "Grok 4.7 low",
      "Grok 4.7 medium",
      "Grok 4.7 high",
    ]);

    expect(getAvailableModels("agy")).toEqual([
      "gemini-3.6-flash-low",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-high",
      "gemini-3.7-flash-low",
      "gemini-3.7-flash-medium",
      "gemini-3.7-flash-high",
    ]);
  });

  test("returns default models for grok and agy ticket kinds", () => {
    expect(getModelForTicketKind("map", { agent: "grok" })).toBe("Grok 4.7 medium");
    expect(getModelForTicketKind("delivery", { agent: "grok" })).toBe("Grok 4.7 low");
    expect(getModelForTicketKind("grilling", { agent: "grok" })).toBe("Grok 4.7 high");

    expect(getModelForTicketKind("map", { agent: "agy" })).toBe("gemini-3.7-flash-medium");
    expect(getModelForTicketKind("delivery", { agent: "agy" })).toBe("gemini-3.7-flash-low");
    expect(getModelForTicketKind("grilling", { agent: "agy" })).toBe("gemini-3.7-flash-high");
  });

  test("getNextModel cycles through available models per agent", () => {
    expect(getNextModel("Grok 4.6 low", "grok")).toBe("Grok 4.6 medium");
    expect(getNextModel("Grok 4.7 high", "grok")).toBe("Grok 4.6 low");

    expect(getNextModel("gemini-3.6-flash-low", "agy")).toBe("gemini-3.6-flash-medium");
    expect(getNextModel("gemini-3.6-flash-high", "agy")).toBe("gemini-3.7-flash-low");
    expect(getNextModel("gemini-3.7-flash-high", "agy")).toBe("gemini-3.6-flash-low");
    expect(getNextModel("unknown", "agy")).toBe("gemini-3.6-flash-low");
  });

  test("saveModelConfig persists model choice per agent into config.json", () => {
    const tempConfigDir = join(tmpdir(), `wayfinder-test-save-${Date.now()}`);

    saveModelConfig("map", "Grok 4.6 high", "grok", tempConfigDir);
    saveModelConfig("map", "gemini-3.6-flash-high", "agy", tempConfigDir);

    const raw = readFileSync(join(tempConfigDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.models.grok.map).toBe("Grok 4.6 high");
    expect(parsed.models.agy.map).toBe("gemini-3.6-flash-high");

    expect(getModelForTicketKind("map", { agent: "grok", configDir: tempConfigDir })).toBe("Grok 4.6 high");
    expect(getModelForTicketKind("map", { agent: "agy", configDir: tempConfigDir })).toBe("gemini-3.6-flash-high");

    rmSync(tempConfigDir, { recursive: true, force: true });
  });

  test("agent-specific environment variable overrides default", () => {
    process.env.WAYFINDER_AGY_MODEL_MAP = "gemini-3.6-flash-low";
    process.env.WAYFINDER_GROK_MODEL_MAP = "Grok 4.6 high";

    expect(getModelForTicketKind("map", { agent: "agy" })).toBe("gemini-3.6-flash-low");
    expect(getModelForTicketKind("map", { agent: "grok" })).toBe("Grok 4.6 high");
  });
});
