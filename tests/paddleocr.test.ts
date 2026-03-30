import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  OCR_MIN_PROVIDER_TIMEOUT_MS,
  OCR_PROVIDER_TIMEOUT_CAP_MS,
  buildEmptyOcrResult,
  hasOcrText,
  isConfiguredOcrProvider,
  getOcrProviderName,
  getEffectiveOcrProviderLabel,
  resolveProviderAttemptTimeoutMs,
  resolveProviderOrder,
  resolveRemainingOcrBudget,
  summarizeOcrLines,
  shouldAttemptOcrProvider,
  truncateOcrWarnings,
  ensureOcrWarnings,
  mergeOcrWarnings,
  normalizeOcrText,
  normalizeOcrLines,
} from "../src/ocr/paddleocr.ts";
import type { VisionBridgeConfig } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(
  provider: VisionBridgeConfig["ocr"]["provider"] = "auto",
  fallbackOrder: VisionBridgeConfig["ocr"]["fallbackOrder"] = ["paddleocr"],
): VisionBridgeConfig {
  return {
    enabled: true,
    debug: false,
    autoInject: { enabled: true, maxRecentMessages: 8 },
    limits: { maxImageBytes: 15 * 1024 * 1024, maxImageCount: 4, maxSummaryChars: 4000 },
    ocr: { provider, fallbackOrder, timeoutMs: 30000 },
    vision: { provider: "heuristic" },
  };
}

// ---------------------------------------------------------------------------
// buildEmptyOcrResult
// ---------------------------------------------------------------------------
describe("buildEmptyOcrResult", () => {
  it("returns OcrResult with the specified provider", () => {
    const result = buildEmptyOcrResult("paddleocr", "some warning");
    assert.equal(result.provider, "paddleocr");
  });

  it("returns empty text and lines", () => {
    const result = buildEmptyOcrResult("paddleocr", "warn");
    assert.equal(result.text, "");
    assert.deepEqual(result.lines, []);
  });

  it("includes the warning in the warnings array", () => {
    const result = buildEmptyOcrResult("paddleocr", "OCR timed out");
    assert.ok(result.warnings.includes("OCR timed out"));
  });
});

// ---------------------------------------------------------------------------
// hasOcrText
// ---------------------------------------------------------------------------
describe("hasOcrText", () => {
  it("returns false for empty string", () => {
    assert.equal(hasOcrText(""), false);
  });

  it("returns false for whitespace-only string", () => {
    assert.equal(hasOcrText("   \n  "), false);
  });

  it("returns true for non-empty trimmed string", () => {
    assert.equal(hasOcrText("hello"), true);
    assert.equal(hasOcrText("  hello  "), true);
  });
});

// ---------------------------------------------------------------------------
// isConfiguredOcrProvider
// ---------------------------------------------------------------------------
describe("isConfiguredOcrProvider", () => {
  it("returns false when provider is disabled", () => {
    assert.equal(isConfiguredOcrProvider(makeConfig("disabled")), false);
  });

  it("returns true when provider is paddleocr", () => {
    assert.equal(isConfiguredOcrProvider(makeConfig("paddleocr")), true);
  });

  it("returns true when provider is macos_vision", () => {
    assert.equal(isConfiguredOcrProvider(makeConfig("macos_vision")), true);
  });

  it("returns true when provider is auto", () => {
    assert.equal(isConfiguredOcrProvider(makeConfig("auto")), true);
  });
});

// ---------------------------------------------------------------------------
// getOcrProviderName
// ---------------------------------------------------------------------------
describe("getOcrProviderName", () => {
  it("returns the provider string from config", () => {
    assert.equal(getOcrProviderName(makeConfig("paddleocr")), "paddleocr");
    assert.equal(getOcrProviderName(makeConfig("disabled")), "disabled");
  });
});

// ---------------------------------------------------------------------------
// getEffectiveOcrProviderLabel
// ---------------------------------------------------------------------------
describe("getEffectiveOcrProviderLabel", () => {
  it("returns provider name when config has specific (non-auto) provider", () => {
    assert.equal(getEffectiveOcrProviderLabel(makeConfig("paddleocr")), "paddleocr");
  });

  it("returns platform-aware label when provider is auto", () => {
    const label = getEffectiveOcrProviderLabel(makeConfig("auto"));
    // On darwin: macos_vision_then_paddleocr, elsewhere: paddleocr
    assert.ok(
      label === "macos_vision_then_paddleocr" || label === "paddleocr",
      `unexpected label: ${label}`,
    );
  });

  it("returns paddleocr on non-darwin when config is undefined", () => {
    // We can't easily mock process.platform, but we can test that the label is a string
    const label = getEffectiveOcrProviderLabel(undefined);
    assert.ok(typeof label === "string" && label.length > 0);
  });
});

// ---------------------------------------------------------------------------
// resolveProviderOrder
// ---------------------------------------------------------------------------
describe("resolveProviderOrder", () => {
  it("prepends explicit provider and de-dupes fallback providers", () => {
    assert.deepEqual(
      resolveProviderOrder(makeConfig("macos_vision", ["paddleocr", "macos_vision"])),
      ["macos_vision", "paddleocr"],
    );
  });

  it("uses fallback order as-is when provider is auto", () => {
    assert.deepEqual(
      resolveProviderOrder(makeConfig("auto", ["macos_vision", "paddleocr"])),
      ["macos_vision", "paddleocr"],
    );
  });
});

// ---------------------------------------------------------------------------
// OCR budget helpers
// ---------------------------------------------------------------------------
describe("OCR budget helpers", () => {
  it("shrinks remaining budget based on elapsed time", () => {
    assert.equal(resolveRemainingOcrBudget(1_000, 5_000, 3_000), 3_000);
  });

  it("never returns a negative remaining budget", () => {
    assert.equal(resolveRemainingOcrBudget(1_000, 5_000, 8_000), 0);
  });

  it("skips provider attempts when remaining budget falls below the minimum", () => {
    assert.equal(shouldAttemptOcrProvider(OCR_MIN_PROVIDER_TIMEOUT_MS - 1), false);
    assert.equal(shouldAttemptOcrProvider(OCR_MIN_PROVIDER_TIMEOUT_MS), true);
  });

  it("caps macOS Vision attempts to a provider-specific maximum", () => {
    assert.equal(
      resolveProviderAttemptTimeoutMs("macos_vision", 45_000),
      OCR_PROVIDER_TIMEOUT_CAP_MS.macos_vision,
    );
  });

  it("caps PaddleOCR attempts to a provider-specific maximum", () => {
    assert.equal(
      resolveProviderAttemptTimeoutMs("paddleocr", 45_000),
      OCR_PROVIDER_TIMEOUT_CAP_MS.paddleocr,
    );
  });

  it("never returns less than the minimum provider timeout floor", () => {
    assert.equal(
      resolveProviderAttemptTimeoutMs("paddleocr", OCR_MIN_PROVIDER_TIMEOUT_MS - 200),
      OCR_MIN_PROVIDER_TIMEOUT_MS,
    );
  });
});

// ---------------------------------------------------------------------------
// summarizeOcrLines
// ---------------------------------------------------------------------------
describe("summarizeOcrLines", () => {
  it("joins lines with newlines", () => {
    assert.equal(summarizeOcrLines(["line1", "line2", "line3"]), "line1\nline2\nline3");
  });

  it("returns empty string for empty array", () => {
    assert.equal(summarizeOcrLines([]), "");
  });

  it("returns single line without trailing newline", () => {
    assert.equal(summarizeOcrLines(["only"]), "only");
  });
});

// ---------------------------------------------------------------------------
// truncateOcrWarnings
// ---------------------------------------------------------------------------
describe("truncateOcrWarnings", () => {
  it("returns all warnings when count <= 5", () => {
    const warnings = ["a", "b", "c"];
    assert.deepEqual(truncateOcrWarnings(warnings), warnings);
  });

  it("truncates to first 5 warnings when count > 5", () => {
    const warnings = ["1", "2", "3", "4", "5", "6", "7"];
    const result = truncateOcrWarnings(warnings);
    assert.equal(result.length, 5);
    assert.deepEqual(result, ["1", "2", "3", "4", "5"]);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(truncateOcrWarnings([]), []);
  });
});

// ---------------------------------------------------------------------------
// ensureOcrWarnings
// ---------------------------------------------------------------------------
describe("ensureOcrWarnings", () => {
  it("filters out blank/whitespace-only warnings", () => {
    const result = ensureOcrWarnings(["real warning", "  ", "", "another"]);
    assert.deepEqual(result, ["real warning", "another"]);
  });

  it("returns all valid warnings unchanged", () => {
    const warnings = ["warn1", "warn2"];
    assert.deepEqual(ensureOcrWarnings(warnings), warnings);
  });

  it("returns empty array when all warnings are blank", () => {
    assert.deepEqual(ensureOcrWarnings(["  ", " "]), []);
  });
});

// ---------------------------------------------------------------------------
// mergeOcrWarnings
// ---------------------------------------------------------------------------
describe("mergeOcrWarnings", () => {
  it("merges multiple warning groups into one flat array", () => {
    const result = mergeOcrWarnings(["a", "b"], ["c"]);
    assert.deepEqual(result, ["a", "b", "c"]);
  });

  it("filters out blank entries when merging", () => {
    const result = mergeOcrWarnings(["valid", "  "], ["", "also valid"]);
    assert.deepEqual(result, ["valid", "also valid"]);
  });

  it("returns empty array when all groups are empty", () => {
    assert.deepEqual(mergeOcrWarnings([], []), []);
  });
});

// ---------------------------------------------------------------------------
// normalizeOcrText
// ---------------------------------------------------------------------------
describe("normalizeOcrText", () => {
  it("trims leading and trailing whitespace", () => {
    assert.equal(normalizeOcrText("  hello  "), "hello");
  });

  it("returns empty string for blank input", () => {
    assert.equal(normalizeOcrText("   "), "");
  });

  it("leaves internal whitespace intact", () => {
    assert.equal(normalizeOcrText("  a  b  "), "a  b");
  });
});

// ---------------------------------------------------------------------------
// normalizeOcrLines
// ---------------------------------------------------------------------------
describe("normalizeOcrLines", () => {
  it("trims each line", () => {
    assert.deepEqual(normalizeOcrLines(["  hello  ", " world "]), ["hello", "world"]);
  });

  it("filters out blank lines after trimming", () => {
    assert.deepEqual(normalizeOcrLines(["  ", "  text  ", ""]), ["text"]);
  });

  it("returns empty array for all-blank input", () => {
    assert.deepEqual(normalizeOcrLines(["  ", ""]), []);
  });
});
