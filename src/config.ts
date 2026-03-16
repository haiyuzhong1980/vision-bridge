import type { PluginApi } from "openclaw/plugin-sdk/core";
import type { VisionBridgeConfig } from "./types.ts";

export const defaultVisionBridgeConfig: VisionBridgeConfig = {
  enabled: true,
  debug: false,
  autoInject: {
    enabled: true,
    maxRecentMessages: 8,
  },
  limits: {
    maxImageBytes: 15 * 1024 * 1024,
    maxImageCount: 4,
    maxSummaryChars: 4000,
  },
  ocr: {
    provider: "auto",
    fallbackOrder:
      process.platform === "darwin" ? ["macos_vision", "paddleocr"] : ["paddleocr"],
    timeoutMs: 30000,
  },
  vision: {
    provider: "heuristic",
  },
};

function merge<T extends object>(base: T, patch: Partial<T> | undefined): T {
  return { ...base, ...(patch ?? {}) };
}

export function loadVisionBridgeConfig(api: PluginApi): VisionBridgeConfig {
  const raw = api.config.plugins?.entries?.["vision-bridge"]?.config as
    | Partial<VisionBridgeConfig>
    | undefined;

  return {
    ...defaultVisionBridgeConfig,
    ...(raw ?? {}),
    autoInject: merge(defaultVisionBridgeConfig.autoInject, raw?.autoInject),
    limits: merge(defaultVisionBridgeConfig.limits, raw?.limits),
    ocr: merge(defaultVisionBridgeConfig.ocr, raw?.ocr),
    vision: merge(defaultVisionBridgeConfig.vision, raw?.vision),
  };
}

export function validateVisionBridgeConfig(config: VisionBridgeConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (config.autoInject.maxRecentMessages <= 0)
    errors.push("autoInject.maxRecentMessages must be > 0");
  if (config.limits.maxImageBytes <= 0) errors.push("limits.maxImageBytes must be > 0");
  if (config.limits.maxImageCount <= 0) errors.push("limits.maxImageCount must be > 0");
  if (config.limits.maxSummaryChars <= 0) errors.push("limits.maxSummaryChars must be > 0");
  if (config.ocr.timeoutMs <= 0) errors.push("ocr.timeoutMs must be > 0");
  if (!Array.isArray(config.ocr.fallbackOrder) || config.ocr.fallbackOrder.length === 0) {
    errors.push("ocr.fallbackOrder must contain at least one provider");
  }
  return { valid: errors.length === 0, errors };
}
