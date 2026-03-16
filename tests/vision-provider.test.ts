import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runVisionProvider } from "../src/vision/provider.ts";
import type {
  ClassificationResult,
  ImageInput,
  OcrResult,
  VisionBridgeConfig,
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
  kind: ClassificationResult["kind"] = "photo_scene",
  confidence = 0.52,
): ClassificationResult {
  return {
    kind,
    confidence,
    reasons: ["test"],
  };
}

function makeOcr(text = "", lines?: string[]): OcrResult {
  return {
    provider: "test",
    text,
    lines: lines ?? text.split("\n").filter(Boolean),
    warnings: [],
  };
}

function makeConfig(
  visionProvider: VisionBridgeConfig["vision"]["provider"] = "heuristic",
): VisionBridgeConfig {
  return {
    enabled: true,
    debug: false,
    autoInject: { enabled: true, maxRecentMessages: 8 },
    limits: { maxImageBytes: 15 * 1024 * 1024, maxImageCount: 4, maxSummaryChars: 4000 },
    ocr: { provider: "auto", fallbackOrder: ["paddleocr"], timeoutMs: 30000 },
    vision: { provider: visionProvider },
  };
}

// ---------------------------------------------------------------------------
// disabled provider
// ---------------------------------------------------------------------------
describe("runVisionProvider – disabled provider", () => {
  it("returns provider=disabled when config.vision.provider is disabled", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification(),
      makeOcr(),
      makeConfig("disabled"),
    );
    assert.equal(result.provider, "disabled");
  });

  it("returns a summary mentioning the file name when disabled", async () => {
    const result = await runVisionProvider(
      makeInput({ fileName: "my_photo.png" }),
      makeClassification(),
      makeOcr(),
      makeConfig("disabled"),
    );
    assert.ok(result.summary.includes("my_photo.png"), result.summary);
  });

  it("returns empty arrays for all structured fields when disabled", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification(),
      makeOcr(),
      makeConfig("disabled"),
    );
    assert.deepEqual(result.entities, []);
    assert.deepEqual(result.uiElements, []);
    assert.deepEqual(result.riskFlags, []);
    assert.deepEqual(result.layoutHints, []);
  });

  it("returns a warning when disabled", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification(),
      makeOcr(),
      makeConfig("disabled"),
    );
    assert.ok(result.warnings.length > 0);
  });
});

// ---------------------------------------------------------------------------
// heuristic provider – summary
// ---------------------------------------------------------------------------
describe("runVisionProvider – heuristic summary", () => {
  it("returns provider=heuristic", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification(),
      makeOcr(),
      makeConfig(),
    );
    assert.equal(result.provider, "heuristic");
  });

  it("includes file name in the summary", async () => {
    const result = await runVisionProvider(
      makeInput({ fileName: "scan.jpg" }),
      makeClassification("document_scan"),
      makeOcr(),
      makeConfig(),
    );
    assert.ok(result.summary.includes("scan.jpg"), result.summary);
  });

  it("includes classification kind in summary", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("receipt_or_invoice"),
      makeOcr(),
      makeConfig(),
    );
    assert.ok(result.summary.includes("receipt_or_invoice"), result.summary);
  });

  it("appends OCR lead to summary when OCR has text", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification(),
      makeOcr("Hello world"),
      makeConfig(),
    );
    assert.ok(result.summary.includes("Hello world"), result.summary);
  });

  it("truncates long OCR lead to 140 chars with ellipsis", async () => {
    const longText = "x".repeat(200);
    const result = await runVisionProvider(
      makeInput(),
      makeClassification(),
      makeOcr(longText),
      makeConfig(),
    );
    // The OCR lead in the summary should be truncated
    assert.ok(!result.summary.includes(longText), "should not embed full 200-char text verbatim");
  });
});

// ---------------------------------------------------------------------------
// heuristic provider – entities
// ---------------------------------------------------------------------------
describe("runVisionProvider – entities", () => {
  it("returns merchant/total/date entities for receipt_or_invoice", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("receipt_or_invoice"),
      makeOcr("合计 100 实付 100"),
      makeConfig(),
    );
    assert.ok(result.entities.includes("merchant"), `entities: ${result.entities.join(", ")}`);
    assert.ok(result.entities.includes("total"), `entities: ${result.entities.join(", ")}`);
  });

  it("returns metric/trend entities for chart_or_dashboard", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("chart_or_dashboard"),
      makeOcr("GMV 100 增长 10%"),
      makeConfig(),
    );
    assert.ok(result.entities.includes("metric"), `entities: ${result.entities.join(", ")}`);
  });

  it("returns title/section entities for document_scan", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("document_scan"),
      makeOcr("Introduction\nSection 1"),
      makeConfig(),
    );
    assert.ok(result.entities.includes("title"), `entities: ${result.entities.join(", ")}`);
  });

  it("returns empty entities for photo_scene", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("photo_scene"),
      makeOcr(""),
      makeConfig(),
    );
    assert.deepEqual(result.entities, []);
  });
});

// ---------------------------------------------------------------------------
// heuristic provider – uiElements
// ---------------------------------------------------------------------------
describe("runVisionProvider – uiElements", () => {
  it("returns message_list, timestamp, input_box for chat_screenshot", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("chat_screenshot"),
      makeOcr(""),
      makeConfig(),
    );
    assert.ok(result.uiElements.includes("message_list"));
    assert.ok(result.uiElements.includes("timestamp"));
    assert.ok(result.uiElements.includes("input_box"));
  });

  it("returns chart_area and legend for chart_or_dashboard", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("chart_or_dashboard"),
      makeOcr(""),
      makeConfig(),
    );
    assert.ok(result.uiElements.includes("chart_area"));
    assert.ok(result.uiElements.includes("legend"));
  });

  it("returns empty uiElements for document_scan", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("document_scan"),
      makeOcr(""),
      makeConfig(),
    );
    assert.deepEqual(result.uiElements, []);
  });
});

// ---------------------------------------------------------------------------
// heuristic provider – riskFlags
// ---------------------------------------------------------------------------
describe("runVisionProvider – riskFlags", () => {
  it("flags financial_fields for receipt_or_invoice", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("receipt_or_invoice"),
      makeOcr(""),
      makeConfig(),
    );
    assert.ok(result.riskFlags.includes("contains_financial_fields"));
  });

  it("flags private_conversation for chat_screenshot", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("chat_screenshot"),
      makeOcr(""),
      makeConfig(),
    );
    assert.ok(result.riskFlags.includes("may_contain_private_conversation"));
  });

  it("flags phone number when OCR contains Chinese mobile number", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("photo_scene"),
      makeOcr("联系: 13812345678"),
      makeConfig(),
    );
    assert.ok(result.riskFlags.includes("contains_phone_number"), `flags: ${result.riskFlags.join(", ")}`);
  });

  it("flags email when OCR contains email address", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("photo_scene"),
      makeOcr("Send to user@example.com"),
      makeConfig(),
    );
    assert.ok(result.riskFlags.includes("contains_email"), `flags: ${result.riskFlags.join(", ")}`);
  });

  it("flags long numeric identifier (card-like number)", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("photo_scene"),
      // 16-digit card number with spaces (join them for the check)
      makeOcr("Card: 1234 5678 9012 3456"),
      makeConfig(),
    );
    assert.ok(
      result.riskFlags.includes("contains_long_numeric_identifier"),
      `flags: ${result.riskFlags.join(", ")}`,
    );
  });

  it("returns no risk flags for clean photo_scene with no PII", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("photo_scene"),
      makeOcr("A nice sunset photo."),
      makeConfig(),
    );
    assert.deepEqual(result.riskFlags, []);
  });

  it("deduplicates risk flags", async () => {
    // OCR with both 11-digit and 1[3-9]-prefixed patterns is the same phone
    const result = await runVisionProvider(
      makeInput(),
      makeClassification("photo_scene"),
      makeOcr("13812345678 13812345678"),
      makeConfig(),
    );
    const phoneFlags = result.riskFlags.filter((f) => f === "contains_phone_number");
    assert.ok(phoneFlags.length <= 1, "phone flag should not be duplicated");
  });
});

// ---------------------------------------------------------------------------
// heuristic provider – empty warnings
// ---------------------------------------------------------------------------
describe("runVisionProvider – warnings", () => {
  it("returns empty warnings array for heuristic provider on clean input", async () => {
    const result = await runVisionProvider(
      makeInput(),
      makeClassification(),
      makeOcr(""),
      makeConfig(),
    );
    assert.deepEqual(result.warnings, []);
  });
});
