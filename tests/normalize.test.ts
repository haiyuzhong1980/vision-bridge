import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeImageAnalysis, serializeImageBlock } from "../src/normalize.ts";
import type {
  ClassificationResult,
  ImageInput,
  NormalizedImageResult,
  OcrResult,
  VisionBridgeConfig,
  VisionResult,
} from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeInput(overrides: Partial<ImageInput> = {}): ImageInput {
  return {
    filePath: "/tmp/test.png",
    fileName: "test.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    ...overrides,
  };
}

function makeClassification(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    kind: "photo_scene",
    confidence: 0.52,
    reasons: ["generic image mime type"],
    ...overrides,
  };
}

function makeOcr(text = "", overrides: Partial<OcrResult> = {}): OcrResult {
  return {
    provider: "test",
    text,
    lines: text.split("\n").filter(Boolean),
    warnings: [],
    ...overrides,
  };
}

function makeVision(overrides: Partial<VisionResult> = {}): VisionResult {
  return {
    provider: "heuristic",
    summary: "A test image.",
    entities: [],
    uiElements: [],
    riskFlags: [],
    keyFields: {},
    layoutHints: [],
    tableHints: [],
    chartHints: [],
    tablePreview: [],
    chartSignals: [],
    warnings: [],
    ...overrides,
  };
}

function makeConfig(maxSummaryChars = 4000): VisionBridgeConfig {
  return {
    enabled: true,
    debug: false,
    autoInject: { enabled: true, maxRecentMessages: 8 },
    limits: { maxImageBytes: 15 * 1024 * 1024, maxImageCount: 4, maxSummaryChars },
    ocr: { provider: "auto", fallbackOrder: ["paddleocr"], timeoutMs: 30000 },
    vision: { provider: "heuristic" },
  };
}

// ---------------------------------------------------------------------------
// normalizeImageAnalysis
// ---------------------------------------------------------------------------
describe("normalizeImageAnalysis", () => {
  it("preserves classification kind in normalized result", () => {
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification({ kind: "receipt_or_invoice" }),
      ocr: makeOcr(),
      vision: makeVision(),
      config: makeConfig(),
    });
    assert.equal(result.kind, "receipt_or_invoice");
  });

  it("includes vision summary when OCR text is empty", () => {
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification(),
      ocr: makeOcr(""),
      vision: makeVision({ summary: "A plain photo." }),
      config: makeConfig(),
    });
    assert.equal(result.summary, "A plain photo.");
  });

  it("appends OCR character count to summary when OCR text is present", () => {
    const ocrText = "Hello World";
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification(),
      ocr: makeOcr(ocrText),
      vision: makeVision({ summary: "A document." }),
      config: makeConfig(),
    });
    assert.ok(
      result.summary.includes(`${ocrText.length} characters`),
      `summary should mention character count, got: ${result.summary}`,
    );
  });

  it("truncates summary to maxSummaryChars with ellipsis", () => {
    const longSummary = "x".repeat(5000);
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification(),
      ocr: makeOcr(""),
      vision: makeVision({ summary: longSummary }),
      config: makeConfig(100),
    });
    assert.ok(result.summary.length <= 100, `summary length ${result.summary.length} exceeds 100`);
    assert.ok(result.summary.endsWith("..."), "truncated summary should end with ...");
  });

  it("does not truncate summary within maxSummaryChars", () => {
    const summary = "Short summary.";
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification(),
      ocr: makeOcr(""),
      vision: makeVision({ summary }),
      config: makeConfig(4000),
    });
    assert.equal(result.summary, summary);
  });

  it("merges OCR and vision warnings", () => {
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification(),
      ocr: makeOcr("", { warnings: ["ocr_warn"] }),
      vision: makeVision({ warnings: ["vision_warn"] }),
      config: makeConfig(),
    });
    assert.ok(result.warnings.includes("ocr_warn"));
    assert.ok(result.warnings.includes("vision_warn"));
  });

  it("sets source fields from input", () => {
    const result = normalizeImageAnalysis({
      input: makeInput({ fileName: "my.jpg", mimeType: "image/jpeg", sizeBytes: 2048 }),
      classification: makeClassification(),
      ocr: makeOcr(),
      vision: makeVision(),
      config: makeConfig(),
    });
    assert.equal(result.source.fileName, "my.jpg");
    assert.equal(result.source.mimeType, "image/jpeg");
    assert.equal(result.source.sizeBytes, 2048);
  });

  it("trims leading/trailing whitespace from OCR text", () => {
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification(),
      ocr: makeOcr("  trimmed text  "),
      vision: makeVision(),
      config: makeConfig(),
    });
    assert.equal(result.ocrText, "trimmed text");
  });

  it("sets confidence from classification result", () => {
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification({ confidence: 0.77 }),
      ocr: makeOcr(),
      vision: makeVision(),
      config: makeConfig(),
    });
    assert.equal(result.confidence, 0.77);
  });

  it("propagates entities, uiElements, riskFlags, keyFields from vision", () => {
    const vision = makeVision({
      entities: ["merchant"],
      uiElements: ["button"],
      riskFlags: ["contains_email"],
      keyFields: { amount: "100" },
    });
    const result = normalizeImageAnalysis({
      input: makeInput(),
      classification: makeClassification(),
      ocr: makeOcr(),
      vision,
      config: makeConfig(),
    });
    assert.deepEqual(result.entities, ["merchant"]);
    assert.deepEqual(result.uiElements, ["button"]);
    assert.deepEqual(result.riskFlags, ["contains_email"]);
    assert.deepEqual(result.keyFields, { amount: "100" });
  });
});

// ---------------------------------------------------------------------------
// serializeImageBlock
// ---------------------------------------------------------------------------
describe("serializeImageBlock", () => {
  function makeNormalized(overrides: Partial<NormalizedImageResult> = {}): NormalizedImageResult {
    return {
      kind: "photo_scene",
      summary: "A photo.",
      ocrText: "",
      entities: [],
      uiElements: [],
      riskFlags: [],
      keyFields: {},
      layoutHints: [],
      tableHints: [],
      chartHints: [],
      tablePreview: [],
      chartSignals: [],
      confidence: 0.52,
      warnings: [],
      source: { fileName: "photo.png", mimeType: "image/png", sizeBytes: 1024 },
      ...overrides,
    };
  }

  it("starts with [Image] header", () => {
    const block = serializeImageBlock(makeNormalized());
    assert.ok(block.startsWith("[Image]"), `got: ${block.slice(0, 50)}`);
  });

  it("includes Kind line", () => {
    const block = serializeImageBlock(makeNormalized({ kind: "receipt_or_invoice" }));
    assert.ok(block.includes("Kind: receipt_or_invoice"));
  });

  it("includes Summary line", () => {
    const block = serializeImageBlock(makeNormalized({ summary: "My summary." }));
    assert.ok(block.includes("Summary: My summary."));
  });

  it("shows (none) when OCR text is empty", () => {
    const block = serializeImageBlock(makeNormalized({ ocrText: "" }));
    assert.ok(block.includes("OCR: (none)"));
  });

  it("shows actual OCR text when present", () => {
    const block = serializeImageBlock(makeNormalized({ ocrText: "Hello" }));
    assert.ok(block.includes("OCR: Hello"));
  });

  it("includes Confidence formatted to 2 decimal places", () => {
    const block = serializeImageBlock(makeNormalized({ confidence: 0.82 }));
    assert.ok(block.includes("Confidence: 0.82"), block);
  });

  it("includes Risks line with flag names", () => {
    const block = serializeImageBlock(makeNormalized({ riskFlags: ["contains_email"] }));
    assert.ok(block.includes("Risks: contains_email"));
  });

  it("shows (none) for Risks when empty", () => {
    const block = serializeImageBlock(makeNormalized({ riskFlags: [] }));
    assert.ok(block.includes("Risks: (none)"));
  });

  it("includes Warnings line only when warnings are present", () => {
    const withWarning = serializeImageBlock(makeNormalized({ warnings: ["watch_out"] }));
    assert.ok(withWarning.includes("Warnings: watch_out"));

    const withoutWarning = serializeImageBlock(makeNormalized({ warnings: [] }));
    assert.ok(!withoutWarning.includes("Warnings:"), "should not include Warnings line when empty");
  });

  it("serializes key fields as key=value pairs", () => {
    const block = serializeImageBlock(makeNormalized({ keyFields: { amount: "100", date: "2024-01-01" } }));
    assert.ok(block.includes("amount=100"));
    assert.ok(block.includes("date=2024-01-01"));
  });

  it("shows (none) for KeyFields when all values are blank", () => {
    const block = serializeImageBlock(makeNormalized({ keyFields: { empty: "  " } }));
    assert.ok(block.includes("KeyFields: (none)"), block);
  });
});
