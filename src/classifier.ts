import type { ClassificationResult, ImageInput, OcrResult } from "./types.ts";

export function classifyImage(input: ImageInput): ClassificationResult {
  const lower = `${input.fileName} ${input.hint ?? ""}`.toLowerCase();
  const reasons: string[] = [];

  if (matches(lower, ["receipt", "invoice", "发票", "小票", "账单"])) {
    reasons.push("matched receipt/invoice keywords");
    return { kind: "receipt_or_invoice", confidence: 0.82, reasons };
  }
  if (matches(lower, ["screenshot", "截图", "screen", "chat", "telegram", "whatsapp"])) {
    reasons.push("matched screenshot/chat keywords");
    return { kind: "chat_screenshot", confidence: 0.8, reasons };
  }
  if (matches(lower, ["chart", "dashboard", "图表", "报表", "panel"])) {
    reasons.push("matched chart/dashboard keywords");
    return { kind: "chart_or_dashboard", confidence: 0.78, reasons };
  }
  if (matches(lower, ["scan", "document", "pdf", "doc", "文档", "扫描"])) {
    reasons.push("matched document keywords");
    return { kind: "document_scan", confidence: 0.76, reasons };
  }
  if (input.mimeType.startsWith("image/")) {
    reasons.push("generic image mime type");
    return { kind: "photo_scene", confidence: 0.52, reasons };
  }
  reasons.push("no strong heuristic match");
  return { kind: "mixed_unknown", confidence: 0.3, reasons };
}

export function refineClassificationWithOcr(
  initial: ClassificationResult,
  input: ImageInput,
  ocr: OcrResult,
): ClassificationResult {
  const rawOcrText = ocr.text.trim();
  if (!rawOcrText) {
    return initial;
  }

  const reasons = [...initial.reasons];
  const kindFromOcr = detectKindFromOcr(rawOcrText, input);
  if (!kindFromOcr) {
    return initial;
  }
  if (kindFromOcr.kind === initial.kind) {
    return {
      ...initial,
      confidence: Math.min(0.98, Math.max(initial.confidence, kindFromOcr.confidence)),
      reasons: unique([...reasons, kindFromOcr.reason]),
    };
  }
  return {
    kind: kindFromOcr.kind,
    confidence: Math.max(initial.confidence, kindFromOcr.confidence),
    reasons: unique([...reasons, kindFromOcr.reason]),
  };
}

function matches(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function detectKindFromOcr(
  text: string,
  input: ImageInput,
): { kind: ClassificationResult["kind"]; confidence: number; reason: string } | null {
  const lower = `${input.fileName} ${input.hint ?? ""} ${text}`.toLowerCase();

  if (isReceiptLike(lower)) {
    return {
      kind: "receipt_or_invoice",
      confidence: 0.88,
      reason: "ocr matched receipt or invoice fields",
    };
  }

  if (isChatScreenshotLike(text, lower)) {
    return {
      kind: "chat_screenshot",
      confidence: 0.86,
      reason: "ocr matched chat screenshot structure",
    };
  }

  if (isChartLike(lower)) {
    return {
      kind: "chart_or_dashboard",
      confidence: 0.82,
      reason: "ocr matched dashboard or chart terminology",
    };
  }

  if (isDocumentLike(text, lower)) {
    return {
      kind: "document_scan",
      confidence: 0.8,
      reason: "ocr matched document-style heading or list structure",
    };
  }

  return null;
}

function isReceiptLike(text: string): boolean {
  const keywordHits = countMatches(text, [
    "合计",
    "实付",
    "应付",
    "金额",
    "税额",
    "invoice",
    "receipt",
    "tax",
    "subtotal",
    "total",
    "订单号",
    "商户",
    "收款",
  ]);
  return keywordHits >= 2;
}

function isChartLike(text: string): boolean {
  const keywordHits = countMatches(text, [
    "同比",
    "环比",
    "增长",
    "下降",
    "趋势",
    "dashboard",
    "gmv",
    "dau",
    "mau",
    "ctr",
    "roi",
    "图表",
    "报表",
    "本周",
    "本月",
  ]);
  return keywordHits >= 2;
}

function isDocumentLike(ocrText: string, fullText: string): boolean {
  const lines = ocrText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const headingLike = lines.some((line) => /第.+章|第.+节|chapter|section|摘要|目录/i.test(line));
  const numberedLike = lines.filter((line) => /^\d+[\.\)]\s*/.test(line)).length >= 2;
  const paragraphLike = lines.length >= 5 && lines.some((line) => line.length >= 20);
  const instructionLike =
    lines.length >= 4 &&
    lines.filter((line) => /[:：-]/.test(line) || /^\d+\./.test(line)).length >= 3;
  const docKeywords = countMatches(fullText, ["文档", "说明", "指南", "报告", "协议", "notice"]) >= 1;
  const textDense = lines.length >= 4 && lines.join("").length >= 40;
  return headingLike || numberedLike || instructionLike || (paragraphLike && docKeywords) || (textDense && docKeywords);
}

function isChatScreenshotLike(ocrText: string, fullText: string): boolean {
  const lines = ocrText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const timeStampLike = lines.filter((line) => /\b\d{1,2}:\d{2}\b/.test(line)).length;
  const speakerLike = lines.filter((line) => /^[A-Za-z][A-Za-z0-9 _-]{1,20}$/.test(line)).length;
  const chatKeywords = countMatches(fullText, [
    "telegram",
    "whatsapp",
    "chatgpt",
    "message",
    "sender",
    "conversation info",
    "reply_to_current",
    "请输入消息",
    "发送",
    "对话",
    "消息",
  ]);
  return timeStampLike >= 1 || speakerLike >= 2 || chatKeywords >= 2;
}

function countMatches(text: string, patterns: string[]): number {
  return patterns.filter((pattern) => text.includes(pattern)).length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
