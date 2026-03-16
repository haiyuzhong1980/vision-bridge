import type { NormalizedImageResult, VisionHandoffRecord } from "./types.ts";

export function buildVisionHandoffRecord(
  normalized: NormalizedImageResult,
): VisionHandoffRecord {
  const tags = buildTags(normalized);
  return {
    schema: "vision-bridge/handoff@v1",
    kind: normalized.kind,
    title: buildTitle(normalized),
    summary: normalized.summary,
    tags,
    saveHints: buildSaveHints(normalized, tags),
    extracted: {
      keyFields: normalized.keyFields,
      entities: normalized.entities,
      uiElements: normalized.uiElements,
      riskFlags: normalized.riskFlags,
      tablePreview: normalized.tablePreview,
      chartSignals: normalized.chartSignals,
    },
    source: normalized.source,
  };
}

export function serializeVisionHandoff(record: VisionHandoffRecord): string {
  return [
    "[VisionHandoff]",
    JSON.stringify(record, null, 2),
  ].join("\n");
}

function buildTitle(result: NormalizedImageResult): string {
  if (result.keyFields.title) return result.keyFields.title;
  if (result.keyFields.amount) return `${result.kind}:${result.keyFields.amount}`;
  return `${result.kind}:${result.source.fileName}`;
}

function buildTags(result: NormalizedImageResult): string[] {
  const tags = [
    `kind:${result.kind}`,
    ...result.entities.map((value) => `entity:${value}`),
    ...result.riskFlags.map((value) => `risk:${value}`),
  ];
  if (result.tablePreview.length) tags.push("shape:table");
  if (result.chartSignals.length) tags.push("shape:chart");
  if (result.ocrText) tags.push("has:ocr");
  return [...new Set(tags)];
}

function buildSaveHints(
  result: NormalizedImageResult,
  tags: string[],
): VisionHandoffRecord["saveHints"] {
  if (result.kind === "receipt_or_invoice" || result.kind === "document_scan") {
    return {
      suggestedTarget: "knowledge",
      reason: "document-like image with reusable extracted structure",
      confidence: Math.max(0.7, result.confidence),
    };
  }
  if (result.kind === "chart_or_dashboard" || tags.includes("shape:chart")) {
    return {
      suggestedTarget: "knowledge",
      reason: "chart or dashboard image with reusable metrics and trend signals",
      confidence: Math.max(0.72, result.confidence),
    };
  }
  if (result.kind === "chat_screenshot") {
    return {
      suggestedTarget: "memory",
      reason: "conversation screenshot is usually session-specific context",
      confidence: Math.max(0.68, result.confidence),
    };
  }
  return {
    suggestedTarget: "none",
    reason: "generic image should only be saved on explicit request",
    confidence: Math.max(0.5, result.confidence),
  };
}
