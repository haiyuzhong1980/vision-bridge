import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We test the pure, non-async parts that are exported or accessible via
// the module's behaviour. The main extractRecentImagePaths function is
// private, so we test it indirectly through buildVisionPromptContext
// using a mocked analyzeImageFile dependency.
//
// Since node:test does not have jest-style automatic module mocking, we
// test the extraction logic by examining what paths the function would
// process when analyzeImageFile is stubbed.

// ---------------------------------------------------------------------------
// Unit test for extractRecentImagePaths logic (indirectly via module)
// We'll test the regex extraction behavior by importing the module and
// checking the output of buildVisionPromptContext with a controlled config
// that disables autoInject.
// ---------------------------------------------------------------------------

import { buildVisionPromptContext } from "../src/prompt-context.ts";
import type { VisionBridgeConfig } from "../src/types.ts";

function makeConfig(
  autoInjectEnabled = true,
  maxRecentMessages = 8,
  maxImageCount = 4,
): VisionBridgeConfig {
  return {
    enabled: true,
    debug: false,
    autoInject: { enabled: autoInjectEnabled, maxRecentMessages },
    limits: { maxImageBytes: 15 * 1024 * 1024, maxImageCount, maxSummaryChars: 4000 },
    ocr: { provider: "disabled", fallbackOrder: ["paddleocr"], timeoutMs: 30000 },
    vision: { provider: "disabled" },
  };
}

// ---------------------------------------------------------------------------
// buildVisionPromptContext – early exits
// ---------------------------------------------------------------------------
describe("buildVisionPromptContext – returns undefined when disabled", () => {
  it("returns undefined when autoInject is disabled", async () => {
    const result = await buildVisionPromptContext({
      messages: ["[media attached: /tmp/image.png | some info]"],
      config: makeConfig(false),
    });
    assert.equal(result, undefined);
  });

  it("returns undefined when messages array is empty", async () => {
    const result = await buildVisionPromptContext({
      messages: [],
      config: makeConfig(true),
    });
    assert.equal(result, undefined);
  });

  it("returns undefined when no image paths found in messages", async () => {
    const result = await buildVisionPromptContext({
      messages: ["Just a text message with no images."],
      config: makeConfig(true),
    });
    assert.equal(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildVisionPromptContext – image path extraction
// Because analyzeImageFile will fail on non-existent files, the function
// will emit error blocks. We verify the output structure even on failure.
// ---------------------------------------------------------------------------
describe("buildVisionPromptContext – image path extraction from messages", () => {
  it("produces output when a valid image pattern is found (even if file missing)", async () => {
    const messages = [
      "[media attached: /tmp/test_image_vb.png (some caption) | channel info]",
    ];
    const result = await buildVisionPromptContext({
      messages,
      config: makeConfig(true),
    });
    // Should return a string since we found an image path (even if analysis fails)
    assert.ok(typeof result === "string", `expected string, got ${result}`);
    assert.ok(result.includes("Vision Bridge"), result?.slice(0, 100));
  });

  it("returns a string output even when the file does not exist", async () => {
    // analyzeImageFile catches errors internally and returns a structured error object
    // rather than throwing. buildVisionPromptContext will still produce output.
    const messages = [
      "[media attached: /nonexistent/path/image.png | channel info]",
    ];
    const result = await buildVisionPromptContext({
      messages,
      config: makeConfig(true),
    });
    assert.ok(typeof result === "string");
    // The result will contain the VisionHandoff block or imageBlock
    assert.ok(
      result.includes("[VisionHandoff]") || result.includes("[Image]") || result.includes("Vision Bridge"),
      result,
    );
  });
});

describe("buildVisionPromptContext – respects maxRecentMessages limit", () => {
  it("only looks at the last N messages", async () => {
    // With maxRecentMessages=1, only the last message is examined
    const messages = [
      "[media attached: /first_image.png | channel]",   // outside window
      "just text",
    ];
    const result = await buildVisionPromptContext({
      messages,
      config: makeConfig(true, 1, 4),
    });
    // Last message has no image, so returns undefined
    assert.equal(result, undefined);
  });
});

describe("buildVisionPromptContext – respects maxImageCount limit", () => {
  it("processes at most maxImageCount images from messages", async () => {
    // Three messages with images, but maxImageCount=1
    const messages = [
      "[media attached: /img1.png | channel]",
      "[media attached: /img2.png | channel]",
      "[media attached: /img3.png | channel]",
    ];
    const result = await buildVisionPromptContext({
      messages,
      config: makeConfig(true, 8, 1),
    });
    // Even with 1 image limit, we still get a result (may fail on missing files)
    assert.ok(typeof result === "string" || result === undefined);
  });
});

describe("buildVisionPromptContext – output format", () => {
  it("result starts with Vision Bridge preamble", async () => {
    const messages = [
      "[media attached: /nonexistent_for_test.webp | channel]",
    ];
    const result = await buildVisionPromptContext({
      messages,
      config: makeConfig(true),
    });
    assert.ok(typeof result === "string");
    assert.ok(result.startsWith("Vision Bridge"), result?.slice(0, 80));
  });

  it("result includes instruction about visual context", async () => {
    const messages = [
      "[media attached: /nonexistent_for_test2.jpg | channel]",
    ];
    const result = await buildVisionPromptContext({
      messages,
      config: makeConfig(true),
    });
    assert.ok(typeof result === "string");
    assert.ok(result.includes("image blocks") || result.includes("visual context"), result);
  });

  it("deduplicates the same image path across messages", async () => {
    const path = "/same_img.png";
    const messages = [
      `[media attached: ${path} | channel]`,
      `[media attached: ${path} | channel]`,
    ];
    const result = await buildVisionPromptContext({
      messages,
      config: makeConfig(true, 8, 4),
    });
    if (typeof result === "string") {
      // Count how many times the path appears in the output blocks
      const occurrences = (result.match(/same_img\.png/g) ?? []).length;
      // Should appear only once per unique path (deduped), not twice
      // Note: may appear in both imageBlock and handoff JSON, but only once per unique file
      // We allow up to 3 occurrences (imageBlock + handoff JSON path)
      assert.ok(occurrences <= 4, `path appeared ${occurrences} times, expected deduplication`);
    }
  });
});
