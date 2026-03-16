import { classifyImage, refineClassificationWithOcr } from "./classifier.ts";
import { buildImageInput } from "./files.ts";
import { buildVisionHandoffRecord } from "./handoff.ts";
import { normalizeImageAnalysis, serializeImageBlock } from "./normalize.ts";
import { runPaddleOcr } from "./ocr/paddleocr.ts";
import type { AnalyzeImageResult, VisionBridgeConfig } from "./types.ts";
import { runVisionProvider } from "./vision/provider.ts";

export async function analyzeImageFile(params: {
  filePath: string;
  hint?: string;
  config: VisionBridgeConfig;
}): Promise<AnalyzeImageResult & { error?: true; message?: string }> {
  try {
    const input = await buildImageInput(params.filePath, params.hint, params.config);
    const initialClassification = classifyImage(input);
    const ocr = await runPaddleOcr(input, params.config);
    const classification = refineClassificationWithOcr(initialClassification, input, ocr);
    const vision = await runVisionProvider(input, classification, ocr, params.config);
    const normalized = normalizeImageAnalysis({
      input,
      classification,
      ocr,
      vision,
      config: params.config,
    });
    const handoff = buildVisionHandoffRecord(normalized);

    return {
      normalized,
      handoff,
      imageBlock: serializeImageBlock(normalized),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: true,
      message,
      normalized: {
        kind: "mixed_unknown",
        summary: "",
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
        confidence: 0,
        warnings: [message],
        source: { fileName: "", mimeType: "", sizeBytes: 0 },
      },
      handoff: {
        schema: "vision-bridge/handoff@v1",
        kind: "mixed_unknown",
        title: "",
        summary: "",
        tags: [],
        saveHints: { suggestedTarget: "none", reason: "", confidence: 0 },
        extracted: {
          keyFields: {},
          entities: [],
          uiElements: [],
          riskFlags: [],
          tablePreview: [],
          chartSignals: [],
        },
        source: { fileName: "", mimeType: "", sizeBytes: 0 },
      },
      imageBlock: "",
    };
  }
}
