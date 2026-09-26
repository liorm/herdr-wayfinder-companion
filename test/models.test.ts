import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AVAILABLE_MODELS,
  getModelForTicketKind,
  getNextModel,
  saveModelConfig,
} from "../src/wayfinder/models.ts";

describe("model configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("AVAILABLE_MODELS contains all Grok 4.6 and 4.7 low/medium/high variants", () => {
    expect(AVAILABLE_MODELS).toEqual([
      "Grok 4.6 low",
      "Grok 4.6 medium",
      "Grok 4.6 high",
      "Grok 4.7 low",
      "Grok 4.7 medium",
      "Grok 4.7 high",
    ]);
  });

  test("returns default models for all ticket kinds", () => {
    expect(getModelForTicketKind("map")).toBe("Grok 4.7 medium");
    expect(getModelForTicketKind("delivery")).toBe("Grok 4.7 low");
    expect(getModelForTicketKind("grilling")).toBe("Grok 4.7 high");
    expect(getModelForTicketKind("research")).toBe("Grok 4.7 high");
    expect(getModelForTicketKind("prototype")).toBe("Grok 4.7 medium");
    expect(getModelForTicketKind("task")).toBe("Grok 4.7 low");
    expect(getModelForTicketKind("other")).toBe("Grok 4.7 medium");
  });

  test("getNextModel cycles through available models", () => {
    expect(getNextModel("Grok 4.6 low")).toBe("Grok 4.6 medium");
    expect(getNextModel("Grok 4.6 medium")).toBe("Grok 4.6 high");
    expect(getNextModel("Grok 4.6 high")).toBe("Grok 4.7 low");
    expect(getNextModel("Grok 4.7 low")).toBe("Grok 4.7 medium");
    expect(getNextModel("Grok 4.7 medium")).toBe("Grok 4.7 high");
    expect(getNextModel("Grok 4.7 high")).toBe("Grok 4.6 low");
    expect(getNextModel("unknown")).toBe("Grok 4.6 low");
  });

  test("saveModelConfig persists model choice into config.json", () => {
    const tempConfigDir = join(tmpdir(), `wayfinder-test-save-${Date.now()}`);

    const saved = saveModelConfig("map", "Grok 4.6 high", tempConfigDir);
    expect(saved).toBe(true);

    const savedDelivery = saveModelConfig("delivery", "Grok 4.7 high", tempConfigDir);
    expect(savedDelivery).toBe(true);

    const raw = readFileSync(join(tempConfigDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.models.map).toBe("Grok 4.6 high");
    expect(parsed.models.delivery).toBe("Grok 4.7 high");

    expect(getModelForTicketKind("map", { configDir: tempConfigDir })).toBe("Grok 4.6 high");
    expect(getModelForTicketKind("delivery", { configDir: tempConfigDir })).toBe("Grok 4.7 high");

    rmSync(tempConfigDir, { recursive: true, force: true });
  });

  test("customModels option overrides all others", () => {
    const custom = { map: "Grok 4.6 low" };
    expect(getModelForTicketKind("map", { customModels: custom })).toBe("Grok 4.6 low");
  });

  test("environment variable overrides default per ticket kind", () => {
    process.env.WAYFINDER_MODEL_MAP = "Grok 4.7 high";
    process.env.WAYFINDER_MODEL_DELIVERY = "Grok 4.6 medium";

    expect(getModelForTicketKind("map")).toBe("Grok 4.7 high");
    expect(getModelForTicketKind("delivery")).toBe("Grok 4.6 medium");
    expect(getModelForTicketKind("research")).toBe("Grok 4.7 high");
  });

  test("general fallback environment variable WAYFINDER_DEFAULT_MODEL", () => {
    process.env.WAYFINDER_DEFAULT_MODEL = "Grok 4.6 high";
    expect(getModelForTicketKind("other")).toBe("Grok 4.6 high");
  });

  test("reads config from config.json in configDir", () => {
    const tempConfigDir = join(tmpdir(), `wayfinder-test-config-${Date.now()}`);
    mkdirSync(tempConfigDir, { recursive: true });

    writeFileSync(
      join(tempConfigDir, "config.json"),
      JSON.stringify({
        models: {
          map: "Grok 4.7 high",
          delivery: "Grok 4.6 low",
          task: "Grok 4.6 medium",
        },
      }),
    );

    expect(getModelForTicketKind("map", { configDir: tempConfigDir })).toBe("Grok 4.7 high");
    expect(getModelForTicketKind("delivery", { configDir: tempConfigDir })).toBe("Grok 4.6 low");
    expect(getModelForTicketKind("task", { configDir: tempConfigDir })).toBe("Grok 4.6 medium");
    expect(getModelForTicketKind("research", { configDir: tempConfigDir })).toBe("Grok 4.7 high");

    rmSync(tempConfigDir, { recursive: true, force: true });
  });
});
