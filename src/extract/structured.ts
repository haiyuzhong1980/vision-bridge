import type { ImageKind, OcrResult } from "../types.ts";

export function buildKeyFields(kind: ImageKind, ocr: OcrResult): Record<string, string> {
  const fields: Record<string, string> = {};
  const firstMeaningfulLine = ocr.lines.find((line) => line.trim().length > 0) ?? "";

  if (kind === "document_scan" && firstMeaningfulLine) {
    fields.title = firstMeaningfulLine.trim();
  }

  if (kind === "chat_screenshot") {
    const timestamp = matchFirst(
      ocr.text,
      /\b\d{1,2}:\d{2}\b/,
      /\b(?:上午|下午)?\s?\d{1,2}:\d{2}\b/,
    );
    if (timestamp) fields.latest_time = timestamp;
  }

  if (kind === "receipt_or_invoice") {
    const amount = matchFirst(
      ocr.text,
      /(?:合计|实付|应付|总计)[^\d]{0,8}(\d+(?:\.\d{1,2})?)/i,
      /(?:total|amount)[^\d]{0,8}(\d+(?:\.\d{1,2})?)/i,
    );
    const date = matchFirst(
      ocr.text,
      /\b20\d{2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/,
      /\b\d{4}年\d{1,2}月\d{1,2}日\b/,
    );
    if (amount) fields.amount = amount;
    if (date) fields.date = date;
  }

  const phone = matchFirst(ocr.text, /\b1[3-9]\d{9}\b/);
  const email = matchFirst(ocr.text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const url = matchFirst(ocr.text, /https?:\/\/[^\s]+/i, /\b(?:www\.)[^\s]+\.[A-Z]{2,}\b/i);

  if (phone) fields.phone = phone;
  if (email) fields.email = email;
  if (url) fields.url = url;

  return fields;
}

export function buildLayoutHints(kind: ImageKind, ocr: OcrResult): string[] {
  if (kind === "chat_screenshot") return ["top_bar", "message_stream", "composer"];
  if (kind === "document_scan") {
    const hints = ["page_block", "paragraph_flow"];
    if (looksLikeList(ocr.lines)) hints.push("list_structure");
    return hints;
  }
  if (kind === "receipt_or_invoice") return ["header", "line_items", "summary_footer"];
  if (kind === "chart_or_dashboard") return ["header", "metric_cards", "visualization_region"];
  return [];
}

export function buildTableHints(kind: ImageKind, ocr: OcrResult): string[] {
  if (kind === "receipt_or_invoice") {
    return ["possible_line_items", "possible_totals_block"];
  }
  if (kind === "document_scan" && looksTabular(ocr.lines)) {
    return ["possible_table_rows", "possible_column_alignment"];
  }
  return [];
}

export function buildChartHints(kind: ImageKind, ocr: OcrResult): string[] {
  if (kind !== "chart_or_dashboard") return [];
  const hints = ["trend_chart_candidate"];
  if (/%|同比|环比|增长|下降/i.test(ocr.text)) hints.push("contains_rate_or_growth_signal");
  if (/GMV|DAU|MAU|CTR|ROI|收入|成本|订单/i.test(ocr.text)) hints.push("contains_business_metrics");
  return hints;
}

export function buildTablePreview(kind: ImageKind, ocr: OcrResult): string[] {
  if (kind !== "document_scan" && kind !== "receipt_or_invoice" && kind !== "chart_or_dashboard") {
    return [];
  }
  const candidates = ocr.lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => looksTabularLine(line) || looksReceiptLine(line))
    .slice(0, 5);
  return unique(candidates);
}

export function buildChartSignals(kind: ImageKind, ocr: OcrResult): string[] {
  if (kind !== "chart_or_dashboard") {
    return [];
  }
  const signals: string[] = [];
  const metricMatches = ocr.text.match(/\b(?:GMV|DAU|MAU|CTR|ROI|ARPU|CAC|LTV)\b/gi) ?? [];
  for (const metric of metricMatches) {
    signals.push(`metric:${metric.toUpperCase()}`);
  }
  const valueMatches = ocr.text.match(/-?\d+(?:\.\d+)?%/g) ?? [];
  for (const value of valueMatches.slice(0, 4)) {
    signals.push(`percent:${value}`);
  }
  const periodMatches =
    ocr.text.match(/\b(?:Q[1-4]|20\d{2}[\/-]\d{1,2}|本周|本月|今日|昨天)\b/gi) ?? [];
  for (const period of periodMatches.slice(0, 4)) {
    signals.push(`period:${period}`);
  }
  return unique(signals);
}

function looksLikeList(lines: string[]): boolean {
  return lines.some((line) => /^\s*(?:\d+[\.\)]|[-*•])\s+/.test(line));
}

function looksTabular(lines: string[]): boolean {
  return lines.some((line) => /\s{2,}/.test(line)) || lines.some((line) => /\t/.test(line));
}

function looksTabularLine(line: string): boolean {
  return /\s{2,}/.test(line) || /\t/.test(line) || /[:：]\s*\S+/.test(line);
}

function looksReceiptLine(line: string): boolean {
  return /(?:\d+(?:\.\d{1,2})?)\s*$/.test(line) && /[\p{Script=Han}A-Za-z]/u.test(line);
}

function matchFirst(text: string, ...patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (match[1]) return match[1].trim();
    return match[0].trim();
  }
  return "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
