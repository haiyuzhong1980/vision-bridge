import type { PluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { analyzeImageFile } from "./src/analyze.ts";
import { compareImageFiles, serializeCompareBlock } from "./src/compare.ts";
import {
  defaultVisionBridgeConfig,
  loadVisionBridgeConfig,
  validateVisionBridgeConfig,
} from "./src/config.ts";
import { serializeVisionHandoff } from "./src/handoff.ts";
import { prewarmOcrRuntime } from "./src/ocr/paddleocr.ts";
import { buildVisionPromptContext } from "./src/prompt-context.ts";

const VISION_BRIDGE_PROMPT_GUIDANCE = [
  "Vision Bridge is available for deterministic image understanding.",
  "Use `vision_analyze` when the user asks you to analyze a local image file or re-check an existing image artifact.",
  "Use `vision_compare` when the user asks you to compare two or more local image files.",
  "Prefer `vision_analyze` for screenshots, scans, receipts, charts, or mixed images when structured output helps.",
].join("\n");

function createVisionAnalyzeTool(api: PluginApi) {
  return () => ({
    name: "vision_analyze",
    label: "Vision Analyze",
    description: "Analyze a local image file and return a normalized image understanding block.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Absolute path to the local image file.",
        },
        hint: {
          type: "string",
          description: "Optional hint about the image type or task.",
        },
      },
      required: ["filePath"],
    },
    execute: async (_toolCallId: string, args: unknown) => {
      try {
        const filePath =
          typeof (args as Record<string, unknown>).filePath === "string"
            ? ((args as Record<string, unknown>).filePath as string).trim()
            : "";
        const hint =
          typeof (args as Record<string, unknown>).hint === "string"
            ? ((args as Record<string, unknown>).hint as string).trim()
            : undefined;

        if (!filePath) {
          return {
            content: [{ type: "text", text: "vision_analyze requires a non-empty filePath." }],
          };
        }

        const config = loadVisionBridgeConfig(api);
        const result = await analyzeImageFile({ filePath, hint, config });
        if (config.debug) {
          api.logger.info(
            `vision_analyze kind=${result.normalized.kind} file=${result.normalized.source.fileName}`,
          );
        }
        return {
          content: [
            {
              type: "text",
              text: `${result.imageBlock}\n\n${serializeVisionHandoff(result.handoff)}\n\nJSON:\n${JSON.stringify(result.normalized, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Vision analysis failed: ${String(error)}` }],
        };
      }
    },
  });
}

function createVisionCompareTool(api: PluginApi) {
  return () => ({
    name: "vision_compare",
    label: "Vision Compare",
    description: "Compare two or more local image files and summarize similarities, differences, and save recommendations.",
    parameters: {
      type: "object",
      properties: {
        filePaths: {
          type: "array",
          items: { type: "string" },
          description: "Absolute paths to local image files.",
          minItems: 2,
        },
        hint: {
          type: "string",
          description: "Optional comparison hint.",
        },
      },
      required: ["filePaths"],
    },
    execute: async (_toolCallId: string, args: unknown) => {
      try {
        const rawFilePaths = Array.isArray((args as Record<string, unknown>).filePaths)
          ? ((args as Record<string, unknown>).filePaths as unknown[])
          : [];
        const filePaths = rawFilePaths
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        const hint =
          typeof (args as Record<string, unknown>).hint === "string"
            ? ((args as Record<string, unknown>).hint as string).trim()
            : undefined;

        if (filePaths.length < 2) {
          return {
            content: [{ type: "text", text: "vision_compare requires at least two non-empty file paths." }],
          };
        }

        const config = loadVisionBridgeConfig(api);
        const result = await compareImageFiles({ filePaths, hint, config });
        return {
          content: [
            {
              type: "text",
              text:
                `${result.block}\n\nJSON:\n${JSON.stringify(result.comparison, null, 2)}\n\nAnalyses:\n` +
                result.analyses
                  .map(
                    (item) =>
                      `${item.imageBlock}\n\n${serializeVisionHandoff(item.handoff)}\n\nJSON:\n${JSON.stringify(item.normalized, null, 2)}`,
                  )
                  .join("\n\n---\n\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Vision analysis failed: ${String(error)}` }],
        };
      }
    },
  });
}

const plugin = {
  id: "vision-bridge",
  name: "Vision Bridge",
  description: "Cross-channel image understanding bridge for OpenClaw.",
  configSchema: emptyPluginConfigSchema(),
  register(api: PluginApi) {
    const config = loadVisionBridgeConfig(api);

    if (!config.enabled) {
      api.logger.info("Vision Bridge is disabled");
      return;
    }

    const validation = validateVisionBridgeConfig(config);
    if (!validation.valid) {
      api.logger.error(`Vision Bridge disabled due to invalid config: ${validation.errors.join("; ")}`);
      return;
    }

    api.logger.info("Vision Bridge loaded");
    api.registerTool(createVisionAnalyzeTool(api), { name: "vision_analyze" });
    api.registerTool(createVisionCompareTool(api), { name: "vision_compare" });

    api.on("before_prompt_build", async () => ({
      prependSystemContext: VISION_BRIDGE_PROMPT_GUIDANCE,
    }));

    api.on("before_prompt_build", async (event) => {
      const prependContext = await buildVisionPromptContext({
        messages: event.messages,
        config,
      });
      return prependContext ? { prependContext } : undefined;
    });

    api.registerCommand({
      name: "visionbridge-status",
      description: "Show Vision Bridge status",
      handler: () => ({
        text: JSON.stringify(
          {
            enabled: config.enabled,
            debug: config.debug,
            autoInject: config.autoInject,
            ocrProvider: config.ocr.provider,
            ocrFallbackOrder: config.ocr.fallbackOrder,
            visionProvider: config.vision.provider,
            maxImageBytes: config.limits.maxImageBytes,
            maxImageCount: config.limits.maxImageCount,
          },
          null,
          2,
        ),
      }),
    });

    api.registerCommand({
      name: "visionbridge-sample-config",
      description: "Print the plugin default config template",
      handler: () => ({ text: JSON.stringify(defaultVisionBridgeConfig, null, 2) }),
    });

    api.registerCommand({
      name: "visionbridge-smoke",
      description: "Run a lightweight runtime smoke check",
      handler: () => ({
        text: JSON.stringify(
          {
            ok: true,
            checks: {
              enabled: config.enabled,
              autoInjectEnabled: config.autoInject.enabled,
              hasOcrProvider: Boolean(config.ocr.provider),
              hasVisionProvider: Boolean(config.vision.provider),
            },
            notes: [
              "Phase-1 image pipeline is live",
              "Recent inbound images are auto-analyzed into prompt context",
              "Vision provider is deterministic heuristic + OCR driven",
            ],
          },
          null,
          2,
        ),
      }),
    });

    api.registerService({
      id: "vision-bridge-runtime",
      start: () => {
        api.logger.info("Vision Bridge runtime started");
        void prewarmOcrRuntime(config, api.logger);
      },
      stop: () => {
        api.logger.info("Vision Bridge runtime stopped");
      },
    });
  },
};

export default plugin;
