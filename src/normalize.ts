import type {
  ClassificationResult,
  ImageInput,
  NormalizedImageResult,
  OcrResult,
  VisionBridgeConfig,
  VisionResult,
} from "./types.ts";

export function normalizeImageAnalysis(params: {
  input: ImageInput;
  classification: ClassificationResult;
  ocr: OcrResult;
  vision: VisionResult;
  config: VisionBridgeConfig;
}): NormalizedImageResult {
  const warnings = [...params.ocr.warnings, ...params.vision.warnings];
  const ocrText = params.ocr.text.trim();
  const summary = trim(
    ocrText
      ? `${params.vision.summary} OCR extracted ${ocrText.length} characters.`
      : params.vision.summary,
    params.config.limits.maxSummaryChars,
  );

  return {
    kind: params.classification.kind,
    summary,
    ocrText,
    entities: params.vision.entities,
    uiElements: params.vision.uiElements,
    riskFlags: params.vision.riskFlags,
    keyFields: params.vision.keyFields,
    layoutHints: params.vision.layoutHints,
    tableHints: params.vision.tableHints,
    chartHints: params.vision.chartHints,
    tablePreview: params.vision.tablePreview,
    chartSignals: params.vision.chartSignals,
    confidence: params.classification.confidence,
    warnings,
    source: {
      fileName: params.input.fileName,
      mimeType: params.input.mimeType,
      sizeBytes: params.input.sizeBytes,
    },
  };
}

export function serializeImageBlock(result: NormalizedImageResult): string {
  const lines = [
    "[Image]",
    `Kind: ${result.kind}`,
    `Summary: ${result.summary}`,
    `OCR: ${result.ocrText || "(none)"}`,
    `Entities: ${result.entities.length ? result.entities.join(", ") : "(none)"}`,
    `UI: ${result.uiElements.length ? result.uiElements.join(", ") : "(none)"}`,
    `KeyFields: ${serializeKeyFields(result.keyFields)}`,
    `Layout: ${result.layoutHints.length ? result.layoutHints.join(", ") : "(none)"}`,
    `Table: ${result.tableHints.length ? result.tableHints.join(", ") : "(none)"}`,
    `Chart: ${result.chartHints.length ? result.chartHints.join(", ") : "(none)"}`,
    `TablePreview: ${result.tablePreview.length ? result.tablePreview.join(" | ") : "(none)"}`,
    `ChartSignals: ${result.chartSignals.length ? result.chartSignals.join(", ") : "(none)"}`,
    `Risks: ${result.riskFlags.length ? result.riskFlags.join(", ") : "(none)"}`,
    `Confidence: ${result.confidence.toFixed(2)}`,
  ];
  if (result.warnings.length) {
    lines.push(`Warnings: ${result.warnings.join(" | ")}`);
  }
  return lines.join("\n");
}

function trim(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function serializeKeyFields(keyFields: Record<string, string>): string {
  const entries = Object.entries(keyFields).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) {
    return "(none)";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join("; ");
}
