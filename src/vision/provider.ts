import type {
  ClassificationResult,
  ImageInput,
  OcrResult,
  VisionBridgeConfig,
  VisionResult,
} from "../types.ts";
import {
  buildChartSignals,
  buildChartHints,
  buildKeyFields,
  buildLayoutHints,
  buildTablePreview,
  buildTableHints,
} from "../extract/structured.ts";

export async function runVisionProvider(
  input: ImageInput,
  classification: ClassificationResult,
  ocr: OcrResult,
  config: VisionBridgeConfig,
): Promise<VisionResult> {
  if (config.vision.provider === "disabled") {
    return {
      provider: "disabled",
      summary: `Vision provider is disabled. File ${input.fileName} was classified as ${classification.kind}.`,
      entities: [],
      uiElements: [],
      riskFlags: [],
      keyFields: {},
      layoutHints: [],
      tableHints: [],
      chartHints: [],
      tablePreview: [],
      chartSignals: [],
      warnings: ["Vision provider is disabled"],
    };
  }

  const summary = buildHeuristicSummary(input, classification, ocr);
  return {
    provider: "heuristic",
    summary,
    entities: buildEntities(classification.kind, ocr),
    uiElements: buildUiElements(classification.kind),
    riskFlags: buildRiskFlags(classification.kind, ocr),
    keyFields: buildKeyFields(classification.kind, ocr),
    layoutHints: buildLayoutHints(classification.kind, ocr),
    tableHints: buildTableHints(classification.kind, ocr),
    chartHints: buildChartHints(classification.kind, ocr),
    tablePreview: buildTablePreview(classification.kind, ocr),
    chartSignals: buildChartSignals(classification.kind, ocr),
    warnings: [],
  };
}

function buildHeuristicSummary(
  input: ImageInput,
  classification: ClassificationResult,
  ocr: OcrResult,
): string {
  const reason = classification.reasons[0] ?? "generic image heuristics";
  const ocrLead = summarizeOcrLead(ocr.text);
  const base = `Image ${input.fileName} appears to be ${classification.kind} based on ${reason}.`;
  return ocrLead ? `${base} OCR suggests: ${ocrLead}` : base;
}

function buildEntities(kind: ClassificationResult["kind"], ocr: OcrResult): string[] {
  if (kind === "receipt_or_invoice") return unique(["merchant", "total", "date", ...pickReceiptEntities(ocr.text)]);
  if (kind === "chart_or_dashboard") return unique(["metric", "trend", "series", ...pickChartEntities(ocr.text)]);
  if (kind === "document_scan") return unique(["title", "section", ...pickDocumentEntities(ocr.lines)]);
  return [];
}

function buildUiElements(kind: ClassificationResult["kind"]): string[] {
  if (kind === "chat_screenshot") return ["message_list", "timestamp", "input_box"];
  if (kind === "chart_or_dashboard") return ["header", "chart_area", "legend"];
  return [];
}

function buildRiskFlags(kind: ClassificationResult["kind"], ocr: OcrResult): string[] {
  const flags: string[] = [];
  if (kind === "receipt_or_invoice") flags.push("contains_financial_fields");
  if (kind === "chat_screenshot") flags.push("may_contain_private_conversation");
  if (/\b\d{11}\b/.test(ocr.text) || /\b1[3-9]\d{9}\b/.test(ocr.text)) flags.push("contains_phone_number");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(ocr.text)) flags.push("contains_email");
  if (/\b\d{15,19}\b/.test(ocr.text.replace(/\s+/g, ""))) flags.push("contains_long_numeric_identifier");
  return unique(flags);
}

function summarizeOcrLead(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "";
  }
  return clean.length <= 140 ? clean : `${clean.slice(0, 137)}...`;
}

function pickReceiptEntities(text: string): string[] {
  const entities: string[] = [];
  if (/total|合计|实付|应付/i.test(text)) entities.push("total");
  if (/日期|时间|date|time/i.test(text)) entities.push("date");
  if (/税|tax|invoice|发票/i.test(text)) entities.push("tax_or_invoice");
  return entities;
}

function pickChartEntities(text: string): string[] {
  const entities: string[] = [];
  if (/%|同比|环比|增长|下降|trend/i.test(text)) entities.push("trend_indicator");
  if (/GMV|DAU|MAU|CTR|ROI|收入|成本|订单/i.test(text)) entities.push("business_metric");
  return entities;
}

function pickDocumentEntities(lines: string[]): string[] {
  const entities: string[] = [];
  const first = lines[0] ?? "";
  if (first) entities.push("heading");
  if (lines.some((line) => /^\d+[\.\)]/.test(line.trim()))) entities.push("numbered_list");
  if (lines.some((line) => /第.+章|section|chapter/i.test(line))) entities.push("section_marker");
  return entities;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
