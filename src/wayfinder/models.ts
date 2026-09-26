import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TicketKind } from "./board.ts";

export const AVAILABLE_MODELS = [
  "Grok 4.6 low",
  "Grok 4.6 medium",
  "Grok 4.6 high",
  "Grok 4.7 low",
  "Grok 4.7 medium",
  "Grok 4.7 high",
] as const;

export type AvailableModel = (typeof AVAILABLE_MODELS)[number];

export type ModelConfig = Record<TicketKind, string>;

/**
 * Default models and effort levels used for each Wayfinder workitem / ticket kind.
 */
export const DEFAULT_MODELS: ModelConfig = {
  map: "Grok 4.7 medium",
  delivery: "Grok 4.7 low",
  grilling: "Grok 4.7 high",
  research: "Grok 4.7 high",
  prototype: "Grok 4.7 medium",
  task: "Grok 4.7 low",
  other: "Grok 4.7 medium",
};

/**
 * Environment variable names for overriding model per ticket kind.
 */
const ENV_MODEL_KEYS: Record<TicketKind, string> = {
  map: "WAYFINDER_MODEL_MAP",
  delivery: "WAYFINDER_MODEL_DELIVERY",
  grilling: "WAYFINDER_MODEL_GRILLING",
  research: "WAYFINDER_MODEL_RESEARCH",
  prototype: "WAYFINDER_MODEL_PROTOTYPE",
  task: "WAYFINDER_MODEL_TASK",
  other: "WAYFINDER_MODEL_OTHER",
};

/**
 * Reads user config from config.json in HERDR_PLUGIN_CONFIG_DIR if present.
 */
export function readConfigFile(configDir?: string): Partial<ModelConfig> | null {
  const dir = configDir ?? process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (!dir) return null;

  const filePath = join(dir, "config.json");
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const models = (parsed.models && typeof parsed.models === "object") ? parsed.models : parsed;
        return models as Partial<ModelConfig>;
      }
    } catch {
      // Corrupted or unreadable config file, ignore and fallback
    }
  }

  return null;
}

/**
 * Saves a chosen model for a specific ticket kind into config.json in HERDR_PLUGIN_CONFIG_DIR.
 */
export function saveModelConfig(kind: TicketKind, model: string, configDir?: string): boolean {
  const dir = configDir ?? process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (!dir) return false;

  try {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "config.json");
    let currentConfig: Record<string, unknown> = {};

    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          currentConfig = parsed as Record<string, unknown>;
        }
      } catch {
        currentConfig = {};
      }
    }

    const existingModels =
      currentConfig.models && typeof currentConfig.models === "object" && !Array.isArray(currentConfig.models)
        ? (currentConfig.models as Record<string, string>)
        : {};

    currentConfig.models = {
      ...existingModels,
      [kind]: model,
    };

    writeFileSync(filePath, JSON.stringify(currentConfig, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the next model in AVAILABLE_MODELS cycle.
 */
export function getNextModel(currentModel: string): string {
  const currentIndex = AVAILABLE_MODELS.indexOf(currentModel as AvailableModel);
  if (currentIndex === -1) {
    return AVAILABLE_MODELS[0];
  }
  const nextIndex = (currentIndex + 1) % AVAILABLE_MODELS.length;
  return AVAILABLE_MODELS[nextIndex]!;
}

export interface ModelResolutionOptions {
  configDir?: string;
  customModels?: Partial<Record<TicketKind, string>>;
}

/**
 * Resolves the model to use for a given ticket kind.
 * Resolution precedence:
 * 1. customModels option (programmatic / session override)
 * 2. Environment variable (e.g. WAYFINDER_MODEL_MAP)
 * 3. Config file in HERDR_PLUGIN_CONFIG_DIR (config.json)
 * 4. General fallback env var WAYFINDER_DEFAULT_MODEL
 * 5. Default model map (DEFAULT_MODELS)
 */
export function getModelForTicketKind(
  kind: TicketKind,
  options?: ModelResolutionOptions,
): string {
  if (options?.customModels?.[kind]) {
    return options.customModels[kind]!;
  }

  const envKey = ENV_MODEL_KEYS[kind];
  if (envKey && process.env[envKey]) {
    const val = process.env[envKey]!.trim();
    if (val.length > 0) return val;
  }

  const fileConfig = readConfigFile(options?.configDir ?? process.env.HERDR_PLUGIN_CONFIG_DIR);
  if (fileConfig && fileConfig[kind]) {
    const val = String(fileConfig[kind]).trim();
    if (val.length > 0) return val;
  }

  if (process.env.WAYFINDER_DEFAULT_MODEL) {
    const val = process.env.WAYFINDER_DEFAULT_MODEL.trim();
    if (val.length > 0) return val;
  }

  return DEFAULT_MODELS[kind] ?? "Grok 4.7 medium";
}
