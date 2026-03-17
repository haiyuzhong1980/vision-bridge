import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeImageFile } from "../src/analyze.ts";
import type { VisionBridgeConfig } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(): VisionBridgeConfig {
  return {
    enabled: true,
    debug: false,
    autoInject: { enabled: false, maxRecentMessages: 8 },
    limits: {
      maxImageBytes: 15 * 1024 * 1024,
      maxImageCount: 4,
      maxSummaryChars: 4000,
    },
    ocr: { provider: "disabled", fallbackOrder: [], timeoutMs: 5000 },
    vision: { provider: "heuristic" },
  };
}

const TMP = path.join(tmpdir(), `vb-analyze-test-${process.pid}`);

describe("analyzeImageFile", () => {
  before(async () => {
    await mkdir(TMP, { recursive: true });
  });

  after(async () => {
    try { await rmdir(TMP, { recursive: true } as Parameters<typeof rmdir>[1]); } catch { /* ignore */ }
  });

  it("returns structured error (error: true) when file does not exist", async () => {
    const result = await analyzeImageFile({
      filePath: path.join(TMP, "nonexistent.png"),
      config: makeConfig(),
    });
    assert.equal(result.error, true, "expected error flag to be true");
    assert.ok(result.message, "expected error message to be set");
  });

  it("returns structured error for zero-byte file", async () => {
    const filePath = path.join(TMP, "empty.png");
    await writeFile(filePath, Buffer.alloc(0));
    try {
      const result = await analyzeImageFile({ filePath, config: makeConfig() });
      assert.equal(result.error, true, "expected error flag to be true for empty file");
      assert.ok(result.message, "expected error message to be set");
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("returns structured error for unsupported mime type (.bin)", async () => {
    const filePath = path.join(TMP, "file.bin");
    await writeFile(filePath, Buffer.alloc(100, 0x00));
    try {
      const result = await analyzeImageFile({ filePath, config: makeConfig() });
      assert.equal(result.error, true, "expected error flag to be true for unsupported type");
      assert.ok(result.message, "expected error message to be set");
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });
});
