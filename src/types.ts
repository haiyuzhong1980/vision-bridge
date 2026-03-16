export type ImageKind =
  | "chat_screenshot"
  | "document_scan"
  | "receipt_or_invoice"
  | "photo_scene"
  | "chart_or_dashboard"
  | "mixed_unknown";

export interface VisionBridgeConfig {
  enabled: boolean;
  debug: boolean;
  autoInject: {
    enabled: boolean;
    maxRecentMessages: number;
  };
  limits: {
    maxImageBytes: number;
    maxImageCount: number;
    maxSummaryChars: number;
  };
  ocr: {
    provider: "disabled" | "paddleocr" | "macos_vision" | "auto";
    fallbackOrder: Array<"paddleocr" | "macos_vision">;
    timeoutMs: number;
  };
  vision: {
    provider: "disabled" | "heuristic";
  };
}

export interface ImageInput {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  hint?: string;
}

export interface ClassificationResult {
  kind: ImageKind;
  confidence: number;
  reasons: string[];
}

export interface OcrResult {
  provider: string;
  text: string;
  lines: string[];
  warnings: string[];
}

export interface VisionResult {
  provider: string;
  summary: string;
  entities: string[];
  uiElements: string[];
  riskFlags: string[];
  keyFields: Record<string, string>;
  layoutHints: string[];
  tableHints: string[];
  chartHints: string[];
  tablePreview: string[];
  chartSignals: string[];
  warnings: string[];
}

export interface NormalizedImageResult {
  kind: ImageKind;
  summary: string;
  ocrText: string;
  entities: string[];
  uiElements: string[];
  riskFlags: string[];
  keyFields: Record<string, string>;
  layoutHints: string[];
  tableHints: string[];
  chartHints: string[];
  tablePreview: string[];
  chartSignals: string[];
  confidence: number;
  warnings: string[];
  source: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  };
}

export interface VisionHandoffRecord {
  schema: "vision-bridge/handoff@v1";
  kind: ImageKind;
  title: string;
  summary: string;
  tags: string[];
  saveHints: {
    suggestedTarget: "memory" | "knowledge" | "none";
    reason: string;
    confidence: number;
  };
  extracted: {
    keyFields: Record<string, string>;
    entities: string[];
    uiElements: string[];
    riskFlags: string[];
    tablePreview: string[];
    chartSignals: string[];
  };
  source: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  };
}

export interface VisionCompareResult {
  schema: "vision-bridge/compare@v1";
  summary: string;
  commonKinds: string[];
  sameKind: boolean;
  similarities: string[];
  differences: string[];
  saveRecommendation: "memory" | "knowledge" | "none";
  compared: Array<{
    fileName: string;
    kind: ImageKind;
    title: string;
  }>;
}

export interface AnalyzeImageResult {
  normalized: NormalizedImageResult;
  handoff: VisionHandoffRecord;
  imageBlock: string;
}
