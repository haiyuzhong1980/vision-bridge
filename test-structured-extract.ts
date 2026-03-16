import { runVisionProvider } from "./src/vision/provider.ts";
import { normalizeImageAnalysis, serializeImageBlock } from "./src/normalize.ts";
import { defaultVisionBridgeConfig } from "./src/config.ts";
import { buildVisionHandoffRecord, serializeVisionHandoff } from "./src/handoff.ts";
import type { ClassificationResult, ImageInput, OcrResult } from "./src/types.ts";

const scenario = process.argv[2] ?? "chart";

const chartOcr: OcrResult = {
  provider: "fixture",
  text: "GMV 125.4\nROI 3.2\nCTR 4.8%\n本月 同比增长 12%\nQ1 Q2 Q3 Q4",
  lines: ["GMV 125.4", "ROI 3.2", "CTR 4.8%", "本月 同比增长 12%", "Q1 Q2 Q3 Q4"],
  warnings: [],
};

const tableOcr: OcrResult = {
  provider: "fixture",
  text: "项目  数量  金额\n云主机  2  399.00\n带宽  1  120.00\n合计  519.00",
  lines: ["项目  数量  金额", "云主机  2  399.00", "带宽  1  120.00", "合计  519.00"],
  warnings: [],
};

const fixtures: Record<string, { input: ImageInput; classification: ClassificationResult; ocr: OcrResult }> = {
  chart: {
    input: {
      filePath: "/tmp/chart.png",
      fileName: "chart.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    },
    classification: {
      kind: "chart_or_dashboard",
      confidence: 0.86,
      reasons: ["fixture chart"],
    },
    ocr: chartOcr,
  },
  table: {
    input: {
      filePath: "/tmp/table.png",
      fileName: "table.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    },
    classification: {
      kind: "receipt_or_invoice",
      confidence: 0.84,
      reasons: ["fixture table"],
    },
    ocr: tableOcr,
  },
};

const fixture = fixtures[scenario];

if (!fixture) {
  console.error(`unknown scenario: ${scenario}`);
  process.exit(2);
}

const vision = await runVisionProvider(
  fixture.input,
  fixture.classification,
  fixture.ocr,
  defaultVisionBridgeConfig,
);

const normalized = normalizeImageAnalysis({
  input: fixture.input,
  classification: fixture.classification,
  ocr: fixture.ocr,
  vision,
  config: defaultVisionBridgeConfig,
});
const handoff = buildVisionHandoffRecord(normalized);

console.log(serializeImageBlock(normalized));
console.log("\n" + serializeVisionHandoff(handoff));
console.log("\nJSON:");
console.log(JSON.stringify(normalized, null, 2));
