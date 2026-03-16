import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inferMimeType, buildImageInput } from "../src/files.ts";
import type { VisionBridgeConfig } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<VisionBridgeConfig["limits"]> = {}): VisionBridgeConfig {
  return {
    enabled: true,
    debug: false,
    autoInject: { enabled: true, maxRecentMessages: 8 },
    limits: {
      maxImageBytes: 15 * 1024 * 1024,
      maxImageCount: 4,
      maxSummaryChars: 4000,
      ...overrides,
    },
    ocr: { provider: "auto", fallbackOrder: ["paddleocr"], timeoutMs: 30000 },
    vision: { provider: "heuristic" },
  };
}

const TMP = path.join(tmpdir(), `vb-test-${process.pid}`);

// ---------------------------------------------------------------------------
// inferMimeType
// ---------------------------------------------------------------------------
describe("inferMimeType", () => {
  it("returns image/png for .png files", () => {
    assert.equal(inferMimeType("/path/to/file.png"), "image/png");
  });

  it("returns image/jpeg for .jpg files", () => {
    assert.equal(inferMimeType("/path/to/file.jpg"), "image/jpeg");
  });

  it("returns image/jpeg for .jpeg files", () => {
    assert.equal(inferMimeType("/path/to/file.jpeg"), "image/jpeg");
  });

  it("returns image/webp for .webp files", () => {
    assert.equal(inferMimeType("/path/to/file.webp"), "image/webp");
  });

  it("returns image/gif for .gif files", () => {
    assert.equal(inferMimeType("/path/to/file.gif"), "image/gif");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    assert.equal(inferMimeType("/path/to/file.bmp"), "application/octet-stream");
  });

  it("is case-insensitive for extension matching", () => {
    assert.equal(inferMimeType("/path/to/FILE.PNG"), "image/png");
    assert.equal(inferMimeType("/path/to/FILE.JPG"), "image/jpeg");
  });
});

// ---------------------------------------------------------------------------
// buildImageInput – real temp files
// ---------------------------------------------------------------------------
describe("buildImageInput", () => {
  before(async () => {
    await mkdir(TMP, { recursive: true });
  });

  after(async () => {
    // best-effort cleanup
    try { await rmdir(TMP, { recursive: true } as Parameters<typeof rmdir>[1]); } catch { /* ignore */ }
  });

  it("returns a valid ImageInput for a normal PNG file", async () => {
    const filePath = path.join(TMP, "valid.png");
    // 4-byte minimal content (not a real PNG but sufficient for the stat check)
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const result = await buildImageInput(filePath, "test hint", makeConfig());
      assert.equal(result.filePath, filePath);
      assert.equal(result.fileName, "valid.png");
      assert.equal(result.mimeType, "image/png");
      assert.equal(result.sizeBytes, 4);
      assert.equal(result.hint, "test hint");
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("returns ImageInput without hint when hint is undefined", async () => {
    const filePath = path.join(TMP, "no_hint.png");
    await writeFile(filePath, Buffer.from([0x01, 0x02, 0x03]));
    try {
      const result = await buildImageInput(filePath, undefined, makeConfig());
      assert.equal(result.hint, undefined);
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("throws when file does not exist", async () => {
    const filePath = path.join(TMP, "nonexistent.png");
    await assert.rejects(() => buildImageInput(filePath, undefined, makeConfig()));
  });

  it("throws when file is 0 bytes (P0 fix)", async () => {
    const filePath = path.join(TMP, "empty.png");
    await writeFile(filePath, Buffer.alloc(0));
    try {
      await assert.rejects(
        () => buildImageInput(filePath, undefined, makeConfig()),
        (err: Error) => {
          assert.ok(err.message.includes("empty") || err.message.includes("0 bytes"), err.message);
          return true;
        },
      );
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("throws when file size exceeds maxImageBytes", async () => {
    const filePath = path.join(TMP, "big.png");
    // Write 5 bytes but set maxImageBytes to 4
    await writeFile(filePath, Buffer.alloc(5, 0xff));
    try {
      await assert.rejects(
        () => buildImageInput(filePath, undefined, makeConfig({ maxImageBytes: 4, maxImageCount: 4, maxSummaryChars: 4000 })),
        (err: Error) => {
          assert.ok(err.message.includes("too large"), err.message);
          return true;
        },
      );
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("throws when file has unsupported mime type (.bin)", async () => {
    const filePath = path.join(TMP, "file.bin");
    await writeFile(filePath, Buffer.alloc(10, 0x00));
    try {
      await assert.rejects(
        () => buildImageInput(filePath, undefined, makeConfig()),
        (err: Error) => {
          assert.ok(err.message.includes("unsupported"), err.message);
          return true;
        },
      );
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("sets sizeBytes correctly from actual file size", async () => {
    const filePath = path.join(TMP, "sized.jpg");
    const content = Buffer.alloc(100, 0x42);
    await writeFile(filePath, content);
    try {
      const result = await buildImageInput(filePath, undefined, makeConfig());
      assert.equal(result.sizeBytes, 100);
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });
});
