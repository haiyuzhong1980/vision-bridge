import { buildComparison, serializeCompareBlock } from "./src/compare.ts";
import { buildVisionHandoffRecord } from "./src/handoff.ts";
import type { AnalyzeImageResult, NormalizedImageResult } from "./src/types.ts";

const samples: AnalyzeImageResult[] = [
  buildAnalyzeResult({
    fileName: "chart-a.png",
    kind: "chart_or_dashboard",
    title: "chart_or_dashboard:chart-a.png",
    entities: ["metric", "trend"],
    tags: ["kind:chart_or_dashboard", "shape:chart", "has:ocr"],
  }),
  buildAnalyzeResult({
    fileName: "chart-b.png",
    kind: "chart_or_dashboard",
    title: "chart_or_dashboard:chart-b.png",
    entities: ["metric", "trend", "series"],
    tags: ["kind:chart_or_dashboard", "shape:chart", "has:ocr"],
  }),
];

const mixedSamples: AnalyzeImageResult[] = [
  buildAnalyzeResult({
    fileName: "chart-a.png",
    kind: "chart_or_dashboard",
    title: "chart_or_dashboard:chart-a.png",
    entities: ["metric", "trend"],
    tags: ["kind:chart_or_dashboard", "shape:chart", "has:ocr"],
  }),
  buildAnalyzeResult({
    fileName: "receipt-a.png",
    kind: "receipt_or_invoice",
    title: "receipt_or_invoice:519.00",
    entities: ["merchant", "total"],
    tags: ["kind:receipt_or_invoice", "shape:table", "has:ocr"],
  }),
];

console.log("SAME KIND:");
console.log(serializeCompareBlock(buildComparison(samples)));
console.log("\nMIXED:");
console.log(serializeCompareBlock(buildComparison(mixedSamples)));

function buildAnalyzeResult(params: {
  fileName: string;
  kind: NormalizedImageResult["kind"];
  title: string;
  entities: string[];
  tags: string[];
}): AnalyzeImageResult {
  const normalized: NormalizedImageResult = {
    kind: params.kind,
    summary: `summary for ${params.fileName}`,
    ocrText: "ocr text",
    entities: params.entities,
    uiElements: [],
    riskFlags: [],
    keyFields: {},
    layoutHints: [],
    tableHints: [],
    chartHints: [],
    tablePreview: [],
    chartSignals: [],
    confidence: 0.8,
    warnings: [],
    source: {
      fileName: params.fileName,
      mimeType: "image/png",
      sizeBytes: 1024,
    },
  };
  const handoff = buildVisionHandoffRecord(normalized);
  handoff.title = params.title;
  handoff.tags = params.tags;
  return {
    normalized,
    handoff,
    imageBlock: "[Image]",
  };
}
