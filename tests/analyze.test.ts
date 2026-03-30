import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, unlink, utimes, writeFile, mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  analyzeImageFile,
  buildAnalysisCacheFilePath,
  buildAnalysisCacheKey,
} from "../src/analyze.ts";
import { buildImageInput } from "../src/files.ts";
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

  it("writes successful analyses to disk cache", async () => {
    const filePath = path.join(TMP, "cacheable.png");
    const config = makeConfig();
    await writeFile(filePath, Buffer.from("vision-bridge-cache-test"));

    try {
      const result = await analyzeImageFile({ filePath, config });
      assert.notEqual(result.error, true, "expected analysis to succeed");

      const input = await buildImageInput(filePath, undefined, config);
      const cacheKey = buildAnalysisCacheKey(input, config);
      const cachePath = buildAnalysisCacheFilePath(cacheKey);
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as {
        schema?: string;
        result?: { normalized?: { source?: { fileName?: string } } };
      };

      assert.equal(cached.schema, "vision-bridge/analyze-cache@v1");
      assert.equal(cached.result?.normalized?.source?.fileName, "cacheable.png");
      await rm(cachePath, { force: true });
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("changes the cache key when the file modification time changes", async () => {
    const filePath = path.join(TMP, "mtime-sensitive.png");
    const config = makeConfig();
    await writeFile(filePath, Buffer.from("first-version"));

    try {
      const initialInput = await buildImageInput(filePath, undefined, config);
      const initialKey = buildAnalysisCacheKey(initialInput, config);

      const nextTime = new Date(initialInput.modifiedMs + 2_000);
      await writeFile(filePath, Buffer.from("second-version"));
      await utimes(filePath, nextTime, nextTime);

      const updatedInput = await buildImageInput(filePath, undefined, config);
      const updatedKey = buildAnalysisCacheKey(updatedInput, config);

      assert.notEqual(updatedKey, initialKey, "expected cache key to change after file update");
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("changes the cache key when the analysis hint changes", async () => {
    const filePath = path.join(TMP, "hint-sensitive.png");
    const config = makeConfig();
    await writeFile(filePath, Buffer.from("same-image-different-hints"));

    try {
      const autoInput = await buildImageInput(filePath, "auto_inbound_context", config);
      const manualInput = await buildImageInput(filePath, "manual_receipt_check", config);

      assert.notEqual(
        buildAnalysisCacheKey(autoInput, config),
        buildAnalysisCacheKey(manualInput, config),
        "expected cache key to include hint-sensitive context",
      );
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });
});
