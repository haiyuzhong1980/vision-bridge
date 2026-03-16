import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyImage, refineClassificationWithOcr } from "../src/classifier.ts";
import type { ClassificationResult, ImageInput, OcrResult } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeInput(overrides: Partial<ImageInput> = {}): ImageInput {
  return {
    filePath: "/tmp/image.png",
    fileName: "image.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    ...overrides,
  };
}

function makeOcr(text: string, lines?: string[]): OcrResult {
  return {
    provider: "test",
    text,
    lines: lines ?? text.split("\n").filter(Boolean),
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// classifyImage – filename/hint keyword path
// ---------------------------------------------------------------------------
describe("classifyImage – filename-based classification", () => {
  it("classifies receipt filename as receipt_or_invoice", () => {
    const result = classifyImage(makeInput({ fileName: "receipt_2024.png" }));
    assert.equal(result.kind, "receipt_or_invoice");
    assert.ok(result.confidence >= 0.8);
  });

  it("classifies invoice filename as receipt_or_invoice", () => {
    const result = classifyImage(makeInput({ fileName: "invoice.jpg" }));
    assert.equal(result.kind, "receipt_or_invoice");
  });

  it("classifies screenshot filename as chat_screenshot", () => {
    const result = classifyImage(makeInput({ fileName: "screenshot.png" }));
    assert.equal(result.kind, "chat_screenshot");
  });

  it("classifies telegram filename as chat_screenshot", () => {
    const result = classifyImage(makeInput({ fileName: "telegram_chat.png" }));
    assert.equal(result.kind, "chat_screenshot");
  });

  it("classifies chart filename as chart_or_dashboard", () => {
    const result = classifyImage(makeInput({ fileName: "chart_q3.png" }));
    assert.equal(result.kind, "chart_or_dashboard");
  });

  it("classifies dashboard filename as chart_or_dashboard", () => {
    const result = classifyImage(makeInput({ fileName: "dashboard.webp" }));
    assert.equal(result.kind, "chart_or_dashboard");
  });

  it("classifies scan filename as document_scan", () => {
    const result = classifyImage(makeInput({ fileName: "scan_doc.png" }));
    assert.equal(result.kind, "document_scan");
  });

  it("classifies document filename as document_scan", () => {
    const result = classifyImage(makeInput({ fileName: "document.pdf.png" }));
    assert.equal(result.kind, "document_scan");
  });

  it("classifies generic image/png as photo_scene", () => {
    const result = classifyImage(makeInput({ fileName: "photo_001.png", mimeType: "image/jpeg" }));
    // 'photo' does not match any keyword path, falls through to mime check
    assert.equal(result.kind, "photo_scene");
  });

  it("classifies unknown non-image mime as mixed_unknown", () => {
    const result = classifyImage(
      makeInput({ fileName: "file.bin", mimeType: "application/octet-stream" }),
    );
    assert.equal(result.kind, "mixed_unknown");
    assert.ok(result.confidence <= 0.3);
  });

  it("uses hint in classification when filename is neutral", () => {
    const result = classifyImage(
      makeInput({ fileName: "image.png", hint: "this is a receipt" }),
    );
    assert.equal(result.kind, "receipt_or_invoice");
  });

  it("returns reasons array with at least one entry", () => {
    const result = classifyImage(makeInput({ fileName: "receipt.png" }));
    assert.ok(Array.isArray(result.reasons));
    assert.ok(result.reasons.length > 0);
  });
});

// ---------------------------------------------------------------------------
// refineClassificationWithOcr
// ---------------------------------------------------------------------------
describe("refineClassificationWithOcr – returns initial when OCR text is empty", () => {
  it("returns original classification unchanged when ocr text is blank", () => {
    const initial: ClassificationResult = {
      kind: "photo_scene",
      confidence: 0.52,
      reasons: ["generic image mime type"],
    };
    const result = refineClassificationWithOcr(initial, makeInput(), makeOcr(""));
    assert.deepEqual(result, initial);
  });
});

describe("refineClassificationWithOcr – receipt OCR signals", () => {
  it("upgrades confidence when OCR contains receipt keywords matching initial kind", () => {
    const initial: ClassificationResult = {
      kind: "receipt_or_invoice",
      confidence: 0.82,
      reasons: ["matched receipt/invoice keywords"],
    };
    const ocr = makeOcr("合计 120.00 实付 120.00 商户 某商店 订单号 12345");
    const result = refineClassificationWithOcr(initial, makeInput(), ocr);
    assert.equal(result.kind, "receipt_or_invoice");
    assert.ok(result.confidence >= 0.82);
  });

  it("overrides kind when OCR clearly matches receipt for a photo_scene initial", () => {
    const initial: ClassificationResult = {
      kind: "photo_scene",
      confidence: 0.52,
      reasons: ["generic image mime type"],
    };
    const ocr = makeOcr("合计 100 实付 100 税额 10 商户 某店 订单号 9999");
    const result = refineClassificationWithOcr(initial, makeInput(), ocr);
    assert.equal(result.kind, "receipt_or_invoice");
  });
});

describe("refineClassificationWithOcr – chat screenshot OCR signals", () => {
  it("detects chat screenshot from timestamp-like lines", () => {
    const initial: ClassificationResult = {
      kind: "photo_scene",
      confidence: 0.52,
      reasons: ["generic image mime type"],
    };
    const ocr = makeOcr("Alice\nHello world\n12:34\nBob");
    const result = refineClassificationWithOcr(initial, makeInput(), ocr);
    assert.equal(result.kind, "chat_screenshot");
  });
});

describe("refineClassificationWithOcr – chart/dashboard OCR signals", () => {
  it("detects chart from dashboard metrics keywords", () => {
    const initial: ClassificationResult = {
      kind: "photo_scene",
      confidence: 0.52,
      reasons: ["generic image mime type"],
    };
    const ocr = makeOcr("dashboard GMV DAU 同比 增长");
    const result = refineClassificationWithOcr(initial, makeInput(), ocr);
    assert.equal(result.kind, "chart_or_dashboard");
  });
});

describe("refineClassificationWithOcr – document OCR signals", () => {
  it("detects document from numbered list structure", () => {
    const initial: ClassificationResult = {
      kind: "photo_scene",
      confidence: 0.52,
      reasons: ["generic image mime type"],
    };
    const ocrText = [
      "第一章 Introduction",
      "1. First item in the list",
      "2. Second item in the list",
      "3. Third item in the list",
      "This is a long paragraph that extends to many words.",
    ].join("\n");
    const result = refineClassificationWithOcr(initial, makeInput(), makeOcr(ocrText));
    assert.equal(result.kind, "document_scan");
  });
});

describe("refineClassificationWithOcr – no match leaves initial unchanged", () => {
  it("returns initial kind when OCR text does not trigger any heuristic", () => {
    const initial: ClassificationResult = {
      kind: "photo_scene",
      confidence: 0.52,
      reasons: ["generic image mime type"],
    };
    const ocr = makeOcr("some random text that matches nothing");
    const result = refineClassificationWithOcr(initial, makeInput(), ocr);
    assert.equal(result.kind, "photo_scene");
    assert.equal(result.confidence, initial.confidence);
  });
});

describe("refineClassificationWithOcr – confidence ceiling and reason deduplication", () => {
  it("does not push confidence above 0.98 when boosting same kind", () => {
    const initial: ClassificationResult = {
      kind: "receipt_or_invoice",
      confidence: 0.97,
      reasons: ["matched receipt/invoice keywords"],
    };
    const ocr = makeOcr("合计 100 实付 100 税额 10 商户 某店 订单号 9999 收款 subtotal total");
    const result = refineClassificationWithOcr(initial, makeInput(), ocr);
    assert.ok(result.confidence <= 0.98);
  });

  it("deduplicates reasons when boosting same kind", () => {
    const sharedReason = "matched receipt/invoice keywords";
    const initial: ClassificationResult = {
      kind: "receipt_or_invoice",
      confidence: 0.82,
      reasons: [sharedReason],
    };
    const ocr = makeOcr("合计 100 实付 100 税额 10 商户 某店 订单号 9999");
    const result = refineClassificationWithOcr(initial, makeInput(), ocr);
    const count = result.reasons.filter((r) => r === sharedReason).length;
    assert.ok(count <= 1, "reason should not be duplicated");
  });
});
