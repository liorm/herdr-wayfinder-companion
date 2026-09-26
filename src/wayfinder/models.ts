import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TicketKind } from "./board.ts";

export type AgentKind = "grok" | "agy";

export const AGENT_AVAILABLE_MODELS: Record<AgentKind, readonly string[]> = {
  grok: [
    "Grok 4.6 low",
    "Grok 4.6 medium",
    "Grok 4.6 high",
    "Grok 4.7 low",
    "Grok 4.7 medium",
    "Grok 4.7 high",
  ],
  agy: [
    "gemini-3.6-flash-low",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-high",
    "gemini-3.7-flash-low",
    "gemini-3.7-flash-medium",
    "gemini-3.7-flash-high",
  ],
};

export const AVAILABLE_MODELS = AGENT_AVAILABLE_MODELS.grok;

export type ModelConfig = Record<TicketKind, string>;

/**
 * Normalizes agent string to supported AgentKind ("grok" or "agy"). Defaults to "grok".
 */
export function normalizeAgentKind(agent?: string): AgentKind {
  if (!agent) return "grok";
  const lower = agent.toLowerCase().trim();
  if (lower.includes("agy") || lower.includes("gemini") || lower.includes("antigravity")) {
    return "agy";
  }
  return "grok";
}

/**
 * Returns available models for the given agent kind.
 */
export function getAvailableModels(agent?: AgentKind | string): readonly string[] {
  const norm = normalizeAgentKind(agent);
  return AGENT_AVAILABLE_MODELS[norm];
}

/**
 * Default models and effort levels used for each Wayfinder workitem / ticket kind per agent.
 */
export const DEFAULT_MODELS: Record<AgentKind, ModelConfig> = {
  grok: {
    map: "Grok 4.7 medium",
    delivery: "Grok 4.7 low",
    grilling: "Grok 4.7 high",
    research: "Grok 4.7 high",
    prototype: "Grok 4.7 medium",
    task: "Grok 4.7 low",
    other: "Grok 4.7 medium",
  },
  agy: {
    map: "gemini-3.7-flash-medium",
    delivery: "gemini-3.7-flash-low",
    grilling: "gemini-3.7-flash-high",
    research: "gemini-3.7-flash-high",
    prototype: "gemini-3.7-flash-medium",
    task: "gemini-3.7-flash-low",
    other: "gemini-3.7-flash-medium",
  },
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
export function readConfigFile(
  configDir?: string,
  agent?: AgentKind | string,
): Partial<ModelConfig> | null {
  const dir = configDir ?? process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (!dir) return null;

  const filePath = join(dir, "config.json");
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const models = (parsed.models && typeof parsed.models === "object") ? parsed.models : parsed;
        const normAgent = normalizeAgentKind(agent);
        if (models[normAgent] && typeof models[normAgent] === "object" && !Array.isArray(models[normAgent])) {
          return models[normAgent] as Partial<ModelConfig>;
        }
        return models as Partial<ModelConfig>;
      }
    } catch {
      // Corrupted or unreadable config file, ignore and fallback
    }
  }

  return null;
}

/**
 * Saves a chosen model for a specific ticket kind and agent into config.json in HERDR_PLUGIN_CONFIG_DIR.
 */
export function saveModelConfig(
  kind: TicketKind,
  model: string,
  agent?: AgentKind | string,
  configDir?: string,
): boolean {
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

    const normAgent = normalizeAgentKind(agent);
    const modelsObj =
      currentConfig.models && typeof currentConfig.models === "object" && !Array.isArray(currentConfig.models)
        ? (currentConfig.models as Record<string, unknown>)
        : {};

    const agentModels =
      modelsObj[normAgent] && typeof modelsObj[normAgent] === "object" && !Array.isArray(modelsObj[normAgent])
        ? (modelsObj[normAgent] as Record<string, string>)
        : {};

    modelsObj[normAgent] = {
      ...agentModels,
      [kind]: model,
    };

    currentConfig.models = modelsObj;

    writeFileSync(filePath, JSON.stringify(currentConfig, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the next model in AVAILABLE_MODELS cycle for the given agent kind.
 */
export function getNextModel(currentModel: string, agent?: AgentKind | string): string {
  const available = getAvailableModels(agent);
  const currentIndex = available.indexOf(currentModel);
  if (currentIndex === -1) {
    return available[0]!;
  }
  const nextIndex = (currentIndex + 1) % available.length;
  return available[nextIndex]!;
}

export interface ModelResolutionOptions {
  agent?: AgentKind | string;
  configDir?: string;
  customModels?: Partial<Record<TicketKind, string>>;
}

/**
 * Resolves the model to use for a given ticket kind.
 * Resolution precedence:
 * 1. customModels option (programmatic / session override)
 * 2. Agent-specific environment variable (e.g. WAYFINDER_AGY_MODEL_MAP, WAYFINDER_GROK_MODEL_MAP)
 * 3. General environment variable (e.g. WAYFINDER_MODEL_MAP)
 * 4. Config file in HERDR_PLUGIN_CONFIG_DIR (config.json)
 * 5. General fallback env var WAYFINDER_DEFAULT_MODEL
 * 6. Default model map (DEFAULT_MODELS[agent])
 */
export function getModelForTicketKind(
  kind: TicketKind,
  options?: ModelResolutionOptions,
): string {
  const normAgent = normalizeAgentKind(options?.agent);

  if (options?.customModels?.[kind]) {
    return options.customModels[kind]!;
  }

  const agentEnvKey = `WAYFINDER_${normAgent.toUpperCase()}_MODEL_${kind.toUpperCase()}`;
  if (process.env[agentEnvKey]?.trim()) {
    return process.env[agentEnvKey]!.trim();
  }

  const envKey = ENV_MODEL_KEYS[kind];
  if (envKey && process.env[envKey]?.trim()) {
    return process.env[envKey]!.trim();
  }

  const fileConfig = readConfigFile(options?.configDir ?? process.env.HERDR_PLUGIN_CONFIG_DIR, normAgent);
  if (fileConfig && fileConfig[kind]) {
    const val = String(fileConfig[kind]).trim();
    if (val.length > 0) return val;
  }

  if (process.env.WAYFINDER_DEFAULT_MODEL?.trim()) {
    return process.env.WAYFINDER_DEFAULT_MODEL.trim();
  }

  return DEFAULT_MODELS[normAgent][kind] ?? (normAgent === "agy" ? "gemini-3.7-flash-medium" : "Grok 4.7 medium");
}
