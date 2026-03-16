import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultVisionBridgeConfig,
  loadVisionBridgeConfig,
  validateVisionBridgeConfig,
} from "../src/config.ts";
import type { VisionBridgeConfig } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helper: build a minimal fake PluginApi
// ---------------------------------------------------------------------------
function makeApi(pluginConfig?: Partial<VisionBridgeConfig>) {
  return {
    config: {
      plugins: {
        entries: {
          "vision-bridge": { config: pluginConfig },
        },
      },
    },
  } as unknown as Parameters<typeof loadVisionBridgeConfig>[0];
}

function makeEmptyApi() {
  return {
    config: {},
  } as unknown as Parameters<typeof loadVisionBridgeConfig>[0];
}

// ---------------------------------------------------------------------------
// defaultVisionBridgeConfig
// ---------------------------------------------------------------------------
describe("defaultVisionBridgeConfig", () => {
  it("has enabled set to true", () => {
    assert.equal(defaultVisionBridgeConfig.enabled, true);
  });

  it("has debug set to false", () => {
    assert.equal(defaultVisionBridgeConfig.debug, false);
  });

  it("has autoInject enabled with maxRecentMessages 8", () => {
    assert.equal(defaultVisionBridgeConfig.autoInject.enabled, true);
    assert.equal(defaultVisionBridgeConfig.autoInject.maxRecentMessages, 8);
  });

  it("has maxImageBytes of 15MB", () => {
    assert.equal(defaultVisionBridgeConfig.limits.maxImageBytes, 15 * 1024 * 1024);
  });

  it("has maxImageCount of 4", () => {
    assert.equal(defaultVisionBridgeConfig.limits.maxImageCount, 4);
  });

  it("has maxSummaryChars of 4000", () => {
    assert.equal(defaultVisionBridgeConfig.limits.maxSummaryChars, 4000);
  });

  it("has ocr provider set to auto", () => {
    assert.equal(defaultVisionBridgeConfig.ocr.provider, "auto");
  });

  it("has ocr timeoutMs of 30000", () => {
    assert.equal(defaultVisionBridgeConfig.ocr.timeoutMs, 30000);
  });

  it("has vision provider set to heuristic", () => {
    assert.equal(defaultVisionBridgeConfig.vision.provider, "heuristic");
  });
});

// ---------------------------------------------------------------------------
// loadVisionBridgeConfig
// ---------------------------------------------------------------------------
describe("loadVisionBridgeConfig", () => {
  it("returns defaults when no plugin config is present", () => {
    const config = loadVisionBridgeConfig(makeEmptyApi());
    assert.equal(config.enabled, true);
    assert.equal(config.debug, false);
    assert.equal(config.limits.maxSummaryChars, 4000);
  });

  it("overrides top-level enabled flag", () => {
    const config = loadVisionBridgeConfig(makeApi({ enabled: false }));
    assert.equal(config.enabled, false);
  });

  it("overrides top-level debug flag", () => {
    const config = loadVisionBridgeConfig(makeApi({ debug: true }));
    assert.equal(config.debug, true);
  });

  it("deep-merges limits, preserving unset fields from defaults", () => {
    const config = loadVisionBridgeConfig(
      makeApi({ limits: { maxImageBytes: 1024, maxImageCount: 2, maxSummaryChars: 500 } }),
    );
    assert.equal(config.limits.maxImageBytes, 1024);
    assert.equal(config.limits.maxSummaryChars, 500);
    // maxImageCount comes from the override
    assert.equal(config.limits.maxImageCount, 2);
  });

  it("deep-merges autoInject, preserving unset fields from defaults", () => {
    const config = loadVisionBridgeConfig(
      makeApi({ autoInject: { enabled: false, maxRecentMessages: 3 } }),
    );
    assert.equal(config.autoInject.enabled, false);
    assert.equal(config.autoInject.maxRecentMessages, 3);
  });

  it("deep-merges ocr overrides", () => {
    const config = loadVisionBridgeConfig(
      makeApi({ ocr: { provider: "paddleocr", fallbackOrder: ["paddleocr"], timeoutMs: 5000 } }),
    );
    assert.equal(config.ocr.provider, "paddleocr");
    assert.equal(config.ocr.timeoutMs, 5000);
  });

  it("deep-merges vision overrides", () => {
    const config = loadVisionBridgeConfig(
      makeApi({ vision: { provider: "disabled" } }),
    );
    assert.equal(config.vision.provider, "disabled");
  });

  it("uses defaults when plugin entries are absent", () => {
    const api = {
      config: { plugins: { entries: {} } },
    } as unknown as Parameters<typeof loadVisionBridgeConfig>[0];
    const config = loadVisionBridgeConfig(api);
    assert.equal(config.enabled, true);
  });
});

// ---------------------------------------------------------------------------
// validateVisionBridgeConfig
// ---------------------------------------------------------------------------
describe("validateVisionBridgeConfig", () => {
  function validConfig(): VisionBridgeConfig {
    return structuredClone(defaultVisionBridgeConfig);
  }

  it("returns valid=true for the default config", () => {
    const result = validateVisionBridgeConfig(validConfig());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("reports error when maxRecentMessages is 0", () => {
    const cfg = validConfig();
    cfg.autoInject.maxRecentMessages = 0;
    const result = validateVisionBridgeConfig(cfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("maxRecentMessages")));
  });

  it("reports error when maxImageBytes is 0", () => {
    const cfg = validConfig();
    cfg.limits.maxImageBytes = 0;
    const result = validateVisionBridgeConfig(cfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("maxImageBytes")));
  });

  it("reports error when maxImageCount is negative", () => {
    const cfg = validConfig();
    cfg.limits.maxImageCount = -1;
    const result = validateVisionBridgeConfig(cfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("maxImageCount")));
  });

  it("reports error when maxSummaryChars is 0", () => {
    const cfg = validConfig();
    cfg.limits.maxSummaryChars = 0;
    const result = validateVisionBridgeConfig(cfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("maxSummaryChars")));
  });

  it("reports error when timeoutMs is 0", () => {
    const cfg = validConfig();
    cfg.ocr.timeoutMs = 0;
    const result = validateVisionBridgeConfig(cfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("timeoutMs")));
  });

  it("reports error when fallbackOrder is empty", () => {
    const cfg = validConfig();
    cfg.ocr.fallbackOrder = [];
    const result = validateVisionBridgeConfig(cfg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("fallbackOrder")));
  });

  it("accumulates multiple errors at once", () => {
    const cfg = validConfig();
    cfg.limits.maxImageBytes = 0;
    cfg.limits.maxSummaryChars = 0;
    const result = validateVisionBridgeConfig(cfg);
    assert.ok(result.errors.length >= 2);
  });
});
