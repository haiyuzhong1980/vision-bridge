import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildKeyFields,
  buildLayoutHints,
  buildTableHints,
  buildChartHints,
  buildTablePreview,
  buildChartSignals,
} from "../src/extract/structured.ts";
import type { ImageKind, OcrResult } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOcr(text: string, lines?: string[]): OcrResult {
  return {
    provider: "test",
    text,
    lines: lines ?? text.split("\n").filter(Boolean),
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// buildKeyFields
// ---------------------------------------------------------------------------
describe("buildKeyFields – document_scan", () => {
  it("sets title from first meaningful OCR line", () => {
    const ocr = makeOcr("Introduction\nBody text here.");
    const fields = buildKeyFields("document_scan", ocr);
    assert.equal(fields.title, "Introduction");
  });

  it("returns empty object when OCR lines are empty", () => {
    const fields = buildKeyFields("document_scan", makeOcr(""));
    assert.equal(Object.keys(fields).length, 0);
  });
});

describe("buildKeyFields – chat_screenshot", () => {
  it("extracts latest_time from timestamp in OCR text", () => {
    const ocr = makeOcr("Alice\nHello\n14:30\nBob\nHi there");
    const fields = buildKeyFields("chat_screenshot", ocr);
    assert.equal(fields.latest_time, "14:30");
  });

  it("does not set latest_time when no timestamp present", () => {
    const fields = buildKeyFields("chat_screenshot", makeOcr("Alice\nHello world"));
    assert.equal(fields.latest_time, undefined);
  });
});

describe("buildKeyFields – receipt_or_invoice", () => {
  it("extracts amount from 合计 pattern", () => {
    const ocr = makeOcr("商品 苹果\n合计 ¥120.50\n收款 现金");
    const fields = buildKeyFields("receipt_or_invoice", ocr);
    assert.equal(fields.amount, "120.50");
  });

  it("extracts amount from total English pattern", () => {
    const ocr = makeOcr("Item: Apple\ntotal amount 55.00\nThank you");
    const fields = buildKeyFields("receipt_or_invoice", ocr);
    assert.equal(fields.amount, "55.00");
  });

  it("extracts date from ISO date pattern", () => {
    const ocr = makeOcr("Date: 2024-03-15\nTotal 100.00");
    const fields = buildKeyFields("receipt_or_invoice", ocr);
    assert.equal(fields.date, "2024-03-15");
  });

  it("extracts date from Chinese date pattern", () => {
    const ocr = makeOcr("日期: 2024年3月15日\n合计 50");
    const fields = buildKeyFields("receipt_or_invoice", ocr);
    assert.equal(fields.date, "2024年3月15日");
  });
});

describe("buildKeyFields – phone, email, url detection (any kind)", () => {
  it("extracts Chinese mobile phone number", () => {
    const ocr = makeOcr("联系: 13812345678");
    const fields = buildKeyFields("photo_scene", ocr);
    assert.equal(fields.phone, "13812345678");
  });

  it("extracts email address", () => {
    const ocr = makeOcr("Contact: user@example.com");
    const fields = buildKeyFields("photo_scene", ocr);
    assert.equal(fields.email, "user@example.com");
  });

  it("extracts https URL", () => {
    const ocr = makeOcr("See https://example.com/page for details");
    const fields = buildKeyFields("photo_scene", ocr);
    assert.ok(fields.url?.startsWith("https://"), `url: ${fields.url}`);
  });
});

// ---------------------------------------------------------------------------
// buildLayoutHints
// ---------------------------------------------------------------------------
describe("buildLayoutHints", () => {
  it("returns chat layout hints for chat_screenshot", () => {
    const hints = buildLayoutHints("chat_screenshot", makeOcr(""));
    assert.ok(hints.includes("top_bar"));
    assert.ok(hints.includes("message_stream"));
    assert.ok(hints.includes("composer"));
  });

  it("returns document layout hints for document_scan", () => {
    const hints = buildLayoutHints("document_scan", makeOcr("Line one\nLine two"));
    assert.ok(hints.includes("page_block"));
    assert.ok(hints.includes("paragraph_flow"));
  });

  it("includes list_structure hint for document_scan when OCR has list items", () => {
    const ocr = makeOcr("1. First item\n2. Second item");
    const hints = buildLayoutHints("document_scan", ocr);
    assert.ok(hints.includes("list_structure"), `hints: ${hints.join(", ")}`);
  });

  it("returns receipt layout hints for receipt_or_invoice", () => {
    const hints = buildLayoutHints("receipt_or_invoice", makeOcr(""));
    assert.ok(hints.includes("header"));
    assert.ok(hints.includes("line_items"));
    assert.ok(hints.includes("summary_footer"));
  });

  it("returns chart layout hints for chart_or_dashboard", () => {
    const hints = buildLayoutHints("chart_or_dashboard", makeOcr(""));
    assert.ok(hints.includes("metric_cards"));
    assert.ok(hints.includes("visualization_region"));
  });

  it("returns empty array for photo_scene", () => {
    const hints = buildLayoutHints("photo_scene", makeOcr(""));
    assert.deepEqual(hints, []);
  });
});

// ---------------------------------------------------------------------------
// buildTableHints
// ---------------------------------------------------------------------------
describe("buildTableHints", () => {
  it("returns line_items and totals_block hints for receipt_or_invoice", () => {
    const hints = buildTableHints("receipt_or_invoice", makeOcr(""));
    assert.ok(hints.includes("possible_line_items"));
    assert.ok(hints.includes("possible_totals_block"));
  });

  it("returns table row hints for document_scan with tabular OCR", () => {
    const ocr = makeOcr("col1  col2  col3\nval1  val2  val3");
    const hints = buildTableHints("document_scan", ocr);
    assert.ok(hints.length > 0, "should return table hints for tabular document");
  });

  it("returns empty array for photo_scene", () => {
    const hints = buildTableHints("photo_scene", makeOcr(""));
    assert.deepEqual(hints, []);
  });

  it("returns empty array for document_scan without tabular content", () => {
    const hints = buildTableHints("document_scan", makeOcr("Just a paragraph."));
    assert.deepEqual(hints, []);
  });
});

// ---------------------------------------------------------------------------
// buildChartHints
// ---------------------------------------------------------------------------
describe("buildChartHints", () => {
  it("returns empty array for non-chart kinds", () => {
    for (const kind of ["photo_scene", "chat_screenshot", "document_scan", "receipt_or_invoice"] as ImageKind[]) {
      const hints = buildChartHints(kind, makeOcr(""));
      assert.deepEqual(hints, [], `expected empty for kind=${kind}`);
    }
  });

  it("returns trend_chart_candidate for chart_or_dashboard", () => {
    const hints = buildChartHints("chart_or_dashboard", makeOcr("Q1 2024 revenue"));
    assert.ok(hints.includes("trend_chart_candidate"));
  });

  it("includes rate_or_growth_signal when OCR contains percentage", () => {
    const hints = buildChartHints("chart_or_dashboard", makeOcr("增长 15%"));
    assert.ok(hints.includes("contains_rate_or_growth_signal"), `hints: ${hints.join(", ")}`);
  });

  it("includes business_metrics hint when GMV present", () => {
    const hints = buildChartHints("chart_or_dashboard", makeOcr("GMV 100万"));
    assert.ok(hints.includes("contains_business_metrics"), `hints: ${hints.join(", ")}`);
  });
});

// ---------------------------------------------------------------------------
// buildTablePreview
// ---------------------------------------------------------------------------
describe("buildTablePreview", () => {
  it("returns empty array for photo_scene", () => {
    assert.deepEqual(buildTablePreview("photo_scene", makeOcr("anything")), []);
  });

  it("returns empty array for chat_screenshot", () => {
    assert.deepEqual(buildTablePreview("chat_screenshot", makeOcr("anything")), []);
  });

  it("returns rows for receipt_or_invoice with tabular content", () => {
    const ocr = makeOcr(
      "苹果  5.00\n香蕉  3.50\n合计  8.50",
      ["苹果  5.00", "香蕉  3.50", "合计  8.50"],
    );
    const preview = buildTablePreview("receipt_or_invoice", ocr);
    assert.ok(preview.length > 0, "should return tabular rows");
  });

  it("limits preview to at most 5 rows", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Item ${i}  ${i}.00`);
    const ocr = makeOcr(lines.join("\n"), lines);
    const preview = buildTablePreview("receipt_or_invoice", ocr);
    assert.ok(preview.length <= 5, `got ${preview.length} rows, expected <=5`);
  });

  it("deduplicates identical rows", () => {
    const lines = ["苹果  5.00", "苹果  5.00", "香蕉  3.50"];
    const ocr = makeOcr(lines.join("\n"), lines);
    const preview = buildTablePreview("receipt_or_invoice", ocr);
    const appleCount = preview.filter((r) => r === "苹果  5.00").length;
    assert.ok(appleCount <= 1, "identical rows should be deduplicated");
  });
});

// ---------------------------------------------------------------------------
// buildChartSignals
// ---------------------------------------------------------------------------
describe("buildChartSignals", () => {
  it("returns empty array for non-chart kinds", () => {
    for (const kind of ["photo_scene", "chat_screenshot", "document_scan", "receipt_or_invoice"] as ImageKind[]) {
      assert.deepEqual(buildChartSignals(kind, makeOcr("GMV DAU 10%")), [], `kind=${kind}`);
    }
  });

  it("extracts metric signals from OCR text", () => {
    const signals = buildChartSignals("chart_or_dashboard", makeOcr("GMV 100 DAU 2000 MAU 50000"));
    assert.ok(signals.includes("metric:GMV"), `signals: ${signals.join(", ")}`);
    assert.ok(signals.includes("metric:DAU"), `signals: ${signals.join(", ")}`);
    assert.ok(signals.includes("metric:MAU"), `signals: ${signals.join(", ")}`);
  });

  it("extracts percent signals from OCR text", () => {
    const signals = buildChartSignals("chart_or_dashboard", makeOcr("增长 15.5%"));
    assert.ok(signals.some((s) => s.startsWith("percent:")), `signals: ${signals.join(", ")}`);
  });

  it("limits percent signals to 4", () => {
    const text = "10% 20% 30% 40% 50%";
    const signals = buildChartSignals("chart_or_dashboard", makeOcr(text));
    const percentSignals = signals.filter((s) => s.startsWith("percent:"));
    assert.ok(percentSignals.length <= 4, `got ${percentSignals.length} percent signals`);
  });

  it("extracts period signals like Q1 or 本周", () => {
    const signals = buildChartSignals("chart_or_dashboard", makeOcr("Q1 本周 本月 dashboard"));
    assert.ok(signals.some((s) => s.startsWith("period:")), `signals: ${signals.join(", ")}`);
  });

  it("deduplicates signals", () => {
    const signals = buildChartSignals("chart_or_dashboard", makeOcr("GMV GMV GMV 10%"));
    const gmvCount = signals.filter((s) => s === "metric:GMV").length;
    assert.ok(gmvCount <= 1, "GMV signal should not be duplicated");
  });
});
