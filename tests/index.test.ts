import { describe, it } from "node:test";
import assert from "node:assert/strict";
import plugin from "../index.ts";
import type { VisionBridgeConfig } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Mock PluginApi
// ---------------------------------------------------------------------------
function makeMockApi(configOverrides: Partial<VisionBridgeConfig> = {}) {
  const registeredTools: Array<{ factory: () => unknown; meta: unknown }> = [];
  const config: VisionBridgeConfig = {
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
    ...configOverrides,
  };

  return {
    _registeredTools: registeredTools,
    config: {
      plugins: {
        entries: {
          "vision-bridge": {
            config,
          },
        },
      },
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerTool(factory: () => unknown, meta: unknown) {
      registeredTools.push({ factory, meta });
    },
    on() {},
    registerCommand() {},
    registerService() {},
  };
}

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------
describe("plugin metadata", () => {
  it("has correct id", () => {
    assert.equal(plugin.id, "vision-bridge");
  });

  it("has correct name", () => {
    assert.equal(plugin.name, "Vision Bridge");
  });

  it("has a register function", () => {
    assert.equal(typeof plugin.register, "function");
  });
});

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
describe("vision_analyze tool handler", () => {
  it("returns error response for missing file path", async () => {
    const api = makeMockApi();
    plugin.register(api as Parameters<typeof plugin.register>[0]);

    const analyzeTool = api._registeredTools.find(
      (t) => (t.meta as { name: string }).name === "vision_analyze",
    );
    assert.ok(analyzeTool, "vision_analyze tool should be registered");

    const toolDef = (analyzeTool.factory as () => { execute: (id: string, args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> })();
    const result = await toolDef.execute("call-1", { filePath: "" });

    assert.ok(result.content.length > 0, "should return content");
    assert.ok(
      result.content[0].text.includes("vision_analyze requires"),
      `unexpected text: ${result.content[0].text}`,
    );
  });

  it("returns error response for non-existent file", async () => {
    const api = makeMockApi();
    plugin.register(api as Parameters<typeof plugin.register>[0]);

    const analyzeTool = api._registeredTools.find(
      (t) => (t.meta as { name: string }).name === "vision_analyze",
    );
    assert.ok(analyzeTool, "vision_analyze tool should be registered");

    const toolDef = (analyzeTool.factory as () => { execute: (id: string, args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> })();
    const result = await toolDef.execute("call-2", { filePath: "/tmp/definitely_nonexistent_vb_test_xyz.png" });

    assert.ok(result.content.length > 0, "should return content");
    // Either an error flag from analyzeImageFile or a caught exception message
    assert.ok(result.content[0].text.length > 0, "should have non-empty text");
  });
});

describe("vision_compare tool handler", () => {
  it("returns error response for empty filePaths array", async () => {
    const api = makeMockApi();
    plugin.register(api as Parameters<typeof plugin.register>[0]);

    const compareTool = api._registeredTools.find(
      (t) => (t.meta as { name: string }).name === "vision_compare",
    );
    assert.ok(compareTool, "vision_compare tool should be registered");

    const toolDef = (compareTool.factory as () => { execute: (id: string, args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> })();
    const result = await toolDef.execute("call-3", { filePaths: [] });

    assert.ok(result.content.length > 0, "should return content");
    assert.ok(
      result.content[0].text.includes("vision_compare requires"),
      `unexpected text: ${result.content[0].text}`,
    );
  });

  it("returns error response for single file path (needs at least 2)", async () => {
    const api = makeMockApi();
    plugin.register(api as Parameters<typeof plugin.register>[0]);

    const compareTool = api._registeredTools.find(
      (t) => (t.meta as { name: string }).name === "vision_compare",
    );
    assert.ok(compareTool, "vision_compare tool should be registered");

    const toolDef = (compareTool.factory as () => { execute: (id: string, args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> })();
    const result = await toolDef.execute("call-4", { filePaths: ["/tmp/single.png"] });

    assert.ok(result.content.length > 0, "should return content");
    assert.ok(
      result.content[0].text.includes("vision_compare requires"),
      `unexpected text: ${result.content[0].text}`,
    );
  });
});
