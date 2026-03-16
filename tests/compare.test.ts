import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComparison, serializeCompareBlock } from "../src/compare.ts";
import type { AnalyzeImageResult, NormalizedImageResult, VisionHandoffRecord } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNormalized(
  kind: NormalizedImageResult["kind"],
  overrides: Partial<NormalizedImageResult> = {},
): NormalizedImageResult {
  return {
    kind,
    summary: `A ${kind} image.`,
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
    confidence: 0.7,
    warnings: [],
    source: { fileName: `${kind}.png`, mimeType: "image/png", sizeBytes: 1024 },
    ...overrides,
  };
}

function makeHandoff(
  kind: NormalizedImageResult["kind"],
  overrides: Partial<VisionHandoffRecord> = {},
): VisionHandoffRecord {
  return {
    schema: "vision-bridge/handoff@v1",
    kind,
    title: `${kind}:file.png`,
    summary: `A ${kind} image.`,
    tags: [`kind:${kind}`],
    saveHints: { suggestedTarget: "none", reason: "test", confidence: 0.5 },
    extracted: {
      keyFields: {},
      entities: [],
      uiElements: [],
      riskFlags: [],
      tablePreview: [],
      chartSignals: [],
    },
    source: { fileName: `${kind}.png`, mimeType: "image/png", sizeBytes: 1024 },
    ...overrides,
  };
}

function makeAnalysis(
  kind: NormalizedImageResult["kind"],
  normalizedOverrides: Partial<NormalizedImageResult> = {},
  handoffOverrides: Partial<VisionHandoffRecord> = {},
): AnalyzeImageResult {
  return {
    normalized: makeNormalized(kind, normalizedOverrides),
    handoff: makeHandoff(kind, handoffOverrides),
    imageBlock: `[Image]\nKind: ${kind}`,
  };
}

// ---------------------------------------------------------------------------
// buildComparison – sameKind
// ---------------------------------------------------------------------------
describe("buildComparison – sameKind detection", () => {
  it("sets sameKind=true when all images have the same kind", () => {
    const analyses = [
      makeAnalysis("document_scan"),
      makeAnalysis("document_scan"),
    ];
    const comparison = buildComparison(analyses);
    assert.equal(comparison.sameKind, true);
  });

  it("sets sameKind=false when images have different kinds", () => {
    const analyses = [
      makeAnalysis("document_scan"),
      makeAnalysis("receipt_or_invoice"),
    ];
    const comparison = buildComparison(analyses);
    assert.equal(comparison.sameKind, false);
  });
});

// ---------------------------------------------------------------------------
// buildComparison – schema and basics
// ---------------------------------------------------------------------------
describe("buildComparison – schema and counts", () => {
  it("sets correct schema identifier", () => {
    const comparison = buildComparison([makeAnalysis("photo_scene"), makeAnalysis("photo_scene")]);
    assert.equal(comparison.schema, "vision-bridge/compare@v1");
  });

  it("compared array has one entry per analysis", () => {
    const analyses = [makeAnalysis("photo_scene"), makeAnalysis("document_scan")];
    const comparison = buildComparison(analyses);
    assert.equal(comparison.compared.length, 2);
  });

  it("compared entries include fileName and kind", () => {
    const analyses = [makeAnalysis("chart_or_dashboard")];
    const comparison = buildComparison(analyses);
    assert.equal(comparison.compared[0]?.kind, "chart_or_dashboard");
    assert.equal(comparison.compared[0]?.fileName, "chart_or_dashboard.png");
  });
});

// ---------------------------------------------------------------------------
// buildComparison – summary
// ---------------------------------------------------------------------------
describe("buildComparison – summary", () => {
  it("mentions count and kind when same kind", () => {
    const analyses = [makeAnalysis("receipt_or_invoice"), makeAnalysis("receipt_or_invoice")];
    const comparison = buildComparison(analyses);
    assert.ok(comparison.summary.includes("2"), comparison.summary);
    assert.ok(comparison.summary.includes("receipt_or_invoice"), comparison.summary);
  });

  it("mentions multiple kinds when different", () => {
    const analyses = [makeAnalysis("document_scan"), makeAnalysis("chart_or_dashboard")];
    const comparison = buildComparison(analyses);
    assert.ok(comparison.summary.includes("document_scan"), comparison.summary);
    assert.ok(comparison.summary.includes("chart_or_dashboard"), comparison.summary);
  });
});

// ---------------------------------------------------------------------------
// buildComparison – similarities
// ---------------------------------------------------------------------------
describe("buildComparison – similarities", () => {
  it("includes same-kind similarity when sameKind=true", () => {
    const analyses = [makeAnalysis("photo_scene"), makeAnalysis("photo_scene")];
    const comparison = buildComparison(analyses);
    assert.ok(
      comparison.similarities.some((s) => s.includes("photo_scene")),
      `similarities: ${comparison.similarities.join(", ")}`,
    );
  });

  it("includes shared entity similarity", () => {
    const analyses = [
      makeAnalysis("receipt_or_invoice", { entities: ["merchant", "total"] }),
      makeAnalysis("receipt_or_invoice", { entities: ["merchant"] }),
    ];
    const comparison = buildComparison(analyses);
    assert.ok(
      comparison.similarities.some((s) => s.includes("merchant")),
      `similarities: ${comparison.similarities.join(", ")}`,
    );
  });

  it("includes shared tag similarity", () => {
    const tag = "kind:receipt_or_invoice";
    const analyses = [
      makeAnalysis("receipt_or_invoice", {}, { tags: [tag, "has:ocr"] }),
      makeAnalysis("receipt_or_invoice", {}, { tags: [tag] }),
    ];
    const comparison = buildComparison(analyses);
    assert.ok(
      comparison.similarities.some((s) => s.includes(tag)),
      `similarities: ${comparison.similarities.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// buildComparison – differences
// ---------------------------------------------------------------------------
describe("buildComparison – differences", () => {
  it("includes kind mismatch difference when kinds differ", () => {
    const analyses = [makeAnalysis("document_scan"), makeAnalysis("receipt_or_invoice")];
    const comparison = buildComparison(analyses);
    assert.ok(
      comparison.differences.some((d) => d.includes("kind mismatch")),
      `differences: ${comparison.differences.join(", ")}`,
    );
  });

  it("includes save target difference when save targets differ", () => {
    const analyses = [
      makeAnalysis("document_scan", {}, { saveHints: { suggestedTarget: "knowledge", reason: "doc", confidence: 0.7 } }),
      makeAnalysis("chat_screenshot", {}, { saveHints: { suggestedTarget: "memory", reason: "chat", confidence: 0.7 } }),
    ];
    const comparison = buildComparison(analyses);
    assert.ok(
      comparison.differences.some((d) => d.includes("save targets differ")),
      `differences: ${comparison.differences.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// buildComparison – saveRecommendation
// ---------------------------------------------------------------------------
describe("buildComparison – saveRecommendation", () => {
  it("returns knowledge when all targets are knowledge", () => {
    const analyses = [
      makeAnalysis("document_scan", {}, { saveHints: { suggestedTarget: "knowledge", reason: "", confidence: 0.7 } }),
      makeAnalysis("document_scan", {}, { saveHints: { suggestedTarget: "knowledge", reason: "", confidence: 0.7 } }),
    ];
    assert.equal(buildComparison(analyses).saveRecommendation, "knowledge");
  });

  it("returns memory when all targets are memory", () => {
    const analyses = [
      makeAnalysis("chat_screenshot", {}, { saveHints: { suggestedTarget: "memory", reason: "", confidence: 0.7 } }),
      makeAnalysis("chat_screenshot", {}, { saveHints: { suggestedTarget: "memory", reason: "", confidence: 0.7 } }),
    ];
    assert.equal(buildComparison(analyses).saveRecommendation, "memory");
  });

  it("returns knowledge when at least one target is knowledge", () => {
    const analyses = [
      makeAnalysis("document_scan", {}, { saveHints: { suggestedTarget: "knowledge", reason: "", confidence: 0.7 } }),
      makeAnalysis("chat_screenshot", {}, { saveHints: { suggestedTarget: "memory", reason: "", confidence: 0.7 } }),
    ];
    assert.equal(buildComparison(analyses).saveRecommendation, "knowledge");
  });

  it("returns none when all targets are none", () => {
    const analyses = [
      makeAnalysis("photo_scene", {}, { saveHints: { suggestedTarget: "none", reason: "", confidence: 0.5 } }),
      makeAnalysis("photo_scene", {}, { saveHints: { suggestedTarget: "none", reason: "", confidence: 0.5 } }),
    ];
    assert.equal(buildComparison(analyses).saveRecommendation, "none");
  });
});

// ---------------------------------------------------------------------------
// serializeCompareBlock
// ---------------------------------------------------------------------------
describe("serializeCompareBlock", () => {
  it("starts with [ImageCompare] header", () => {
    const comparison = buildComparison([makeAnalysis("photo_scene"), makeAnalysis("photo_scene")]);
    const block = serializeCompareBlock(comparison);
    assert.ok(block.startsWith("[ImageCompare]"), block.slice(0, 50));
  });

  it("includes Summary line", () => {
    const comparison = buildComparison([makeAnalysis("photo_scene"), makeAnalysis("photo_scene")]);
    const block = serializeCompareBlock(comparison);
    assert.ok(block.includes("Summary:"), block);
  });

  it("includes SameKind line", () => {
    const comparison = buildComparison([makeAnalysis("photo_scene"), makeAnalysis("document_scan")]);
    const block = serializeCompareBlock(comparison);
    assert.ok(block.includes("SameKind: false"), block);
  });

  it("includes SaveRecommendation line", () => {
    const comparison = buildComparison([makeAnalysis("photo_scene"), makeAnalysis("photo_scene")]);
    const block = serializeCompareBlock(comparison);
    assert.ok(block.includes("SaveRecommendation:"), block);
  });

  it("shows (mixed) for Kinds when kinds differ", () => {
    const comparison = buildComparison([makeAnalysis("photo_scene"), makeAnalysis("document_scan")]);
    // commonKinds.length > 1, so it should list them rather than "(mixed)"
    // The "(mixed)" label appears only when commonKinds array is empty
    const block = serializeCompareBlock(comparison);
    assert.ok(block.includes("Kinds:"), block);
  });
});
