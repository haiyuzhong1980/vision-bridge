import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVisionHandoffRecord, serializeVisionHandoff } from "../src/handoff.ts";
import type { NormalizedImageResult } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// buildVisionHandoffRecord – schema and structure
// ---------------------------------------------------------------------------
describe("buildVisionHandoffRecord – schema", () => {
  it("sets correct schema identifier", () => {
    const record = buildVisionHandoffRecord(makeNormalized());
    assert.equal(record.schema, "vision-bridge/handoff@v1");
  });

  it("copies kind from normalized result", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "document_scan" }));
    assert.equal(record.kind, "document_scan");
  });

  it("copies summary from normalized result", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ summary: "A document." }));
    assert.equal(record.summary, "A document.");
  });

  it("copies source fields from normalized result", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({
        source: { fileName: "scan.jpg", mimeType: "image/jpeg", sizeBytes: 2048 },
      }),
    );
    assert.equal(record.source.fileName, "scan.jpg");
    assert.equal(record.source.mimeType, "image/jpeg");
    assert.equal(record.source.sizeBytes, 2048);
  });
});

// ---------------------------------------------------------------------------
// buildVisionHandoffRecord – title logic
// ---------------------------------------------------------------------------
describe("buildVisionHandoffRecord – title building", () => {
  it("uses keyFields.title when present", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ keyFields: { title: "My Document" } }),
    );
    assert.equal(record.title, "My Document");
  });

  it("uses kind:amount when amount present but no title", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ kind: "receipt_or_invoice", keyFields: { amount: "150.00" } }),
    );
    assert.ok(record.title.includes("receipt_or_invoice"), record.title);
    assert.ok(record.title.includes("150.00"), record.title);
  });

  it("uses kind:fileName as fallback when no title or amount", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ kind: "photo_scene", source: { fileName: "pic.png", mimeType: "image/png", sizeBytes: 10 } }),
    );
    assert.equal(record.title, "photo_scene:pic.png");
  });
});

// ---------------------------------------------------------------------------
// buildVisionHandoffRecord – tags
// ---------------------------------------------------------------------------
describe("buildVisionHandoffRecord – tags", () => {
  it("always includes kind tag", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "chart_or_dashboard" }));
    assert.ok(record.tags.includes("kind:chart_or_dashboard"), `tags: ${record.tags.join(", ")}`);
  });

  it("includes entity tags for each entity", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ entities: ["merchant", "total"] }),
    );
    assert.ok(record.tags.includes("entity:merchant"));
    assert.ok(record.tags.includes("entity:total"));
  });

  it("includes risk tags for each risk flag", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ riskFlags: ["contains_email"] }),
    );
    assert.ok(record.tags.includes("risk:contains_email"));
  });

  it("includes shape:table tag when tablePreview is non-empty", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ tablePreview: ["row 1", "row 2"] }),
    );
    assert.ok(record.tags.includes("shape:table"));
  });

  it("includes shape:chart tag when chartSignals is non-empty", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ chartSignals: ["metric:GMV"] }),
    );
    assert.ok(record.tags.includes("shape:chart"));
  });

  it("includes has:ocr tag when ocrText is non-empty", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ ocrText: "some text" }),
    );
    assert.ok(record.tags.includes("has:ocr"));
  });

  it("does not include has:ocr tag when ocrText is empty", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ ocrText: "" }));
    assert.ok(!record.tags.includes("has:ocr"));
  });

  it("deduplicates tags", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ entities: ["merchant", "merchant"] }),
    );
    const entityTags = record.tags.filter((t) => t === "entity:merchant");
    assert.equal(entityTags.length, 1);
  });
});

// ---------------------------------------------------------------------------
// buildVisionHandoffRecord – saveHints
// ---------------------------------------------------------------------------
describe("buildVisionHandoffRecord – saveHints", () => {
  it("suggests knowledge for receipt_or_invoice", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "receipt_or_invoice" }));
    assert.equal(record.saveHints.suggestedTarget, "knowledge");
  });

  it("suggests knowledge for document_scan", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "document_scan" }));
    assert.equal(record.saveHints.suggestedTarget, "knowledge");
  });

  it("suggests knowledge for chart_or_dashboard", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "chart_or_dashboard" }));
    assert.equal(record.saveHints.suggestedTarget, "knowledge");
  });

  it("suggests knowledge when chart signals present even if kind is mixed_unknown", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ kind: "mixed_unknown", chartSignals: ["metric:GMV"] }),
    );
    assert.equal(record.saveHints.suggestedTarget, "knowledge");
  });

  it("suggests memory for chat_screenshot", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "chat_screenshot" }));
    assert.equal(record.saveHints.suggestedTarget, "memory");
  });

  it("suggests none for photo_scene without signals", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "photo_scene" }));
    assert.equal(record.saveHints.suggestedTarget, "none");
  });

  it("saveHints.confidence is at least 0.5", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ kind: "photo_scene", confidence: 0.1 }));
    assert.ok(record.saveHints.confidence >= 0.5);
  });

  it("saveHints.confidence floors at 0.7 for document-like images", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ kind: "document_scan", confidence: 0.1 }),
    );
    assert.ok(record.saveHints.confidence >= 0.7);
  });
});

// ---------------------------------------------------------------------------
// buildVisionHandoffRecord – extracted fields
// ---------------------------------------------------------------------------
describe("buildVisionHandoffRecord – extracted fields", () => {
  it("copies keyFields into extracted.keyFields", () => {
    const record = buildVisionHandoffRecord(
      makeNormalized({ keyFields: { amount: "50.00" } }),
    );
    assert.deepEqual(record.extracted.keyFields, { amount: "50.00" });
  });

  it("copies entities into extracted.entities", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ entities: ["merchant"] }));
    assert.deepEqual(record.extracted.entities, ["merchant"]);
  });

  it("copies riskFlags into extracted.riskFlags", () => {
    const record = buildVisionHandoffRecord(makeNormalized({ riskFlags: ["contains_phone_number"] }));
    assert.deepEqual(record.extracted.riskFlags, ["contains_phone_number"]);
  });
});

// ---------------------------------------------------------------------------
// serializeVisionHandoff
// ---------------------------------------------------------------------------
describe("serializeVisionHandoff", () => {
  it("starts with [VisionHandoff] header", () => {
    const record = buildVisionHandoffRecord(makeNormalized());
    const serialized = serializeVisionHandoff(record);
    assert.ok(serialized.startsWith("[VisionHandoff]"), serialized.slice(0, 50));
  });

  it("includes valid JSON body", () => {
    const record = buildVisionHandoffRecord(makeNormalized());
    const serialized = serializeVisionHandoff(record);
    const jsonPart = serialized.split("\n").slice(1).join("\n");
    assert.doesNotThrow(() => JSON.parse(jsonPart), "serialized body should be valid JSON");
  });

  it("round-trips the record through JSON", () => {
    const input = makeNormalized({ kind: "document_scan", ocrText: "Some text" });
    const record = buildVisionHandoffRecord(input);
    const serialized = serializeVisionHandoff(record);
    const jsonPart = serialized.split("\n").slice(1).join("\n");
    const parsed = JSON.parse(jsonPart);
    assert.equal(parsed.schema, "vision-bridge/handoff@v1");
    assert.equal(parsed.kind, "document_scan");
  });
});
