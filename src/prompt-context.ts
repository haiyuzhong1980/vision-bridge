import { analyzeImageFile } from "./analyze.ts";
import { serializeVisionHandoff } from "./handoff.ts";
import type { VisionBridgeConfig } from "./types.ts";

const MEDIA_IMAGE_PATH_RE =
  /\[media attached:\s*([^\n|]+?\.(?:png|jpe?g|webp|gif))(?:\s*\([^)]+\))?\s*\|/gi;

export async function buildVisionPromptContext(params: {
  messages: unknown[];
  config: VisionBridgeConfig;
}): Promise<string | undefined> {
  if (!params.config.autoInject.enabled) {
    return undefined;
  }

  const paths = extractRecentImagePaths(params.messages, {
    maxMessages: params.config.autoInject.maxRecentMessages,
    maxImages: params.config.limits.maxImageCount,
  });
  if (paths.length === 0) {
    return undefined;
  }

  const analyzed = await Promise.all(
    paths.map(async (filePath) => {
      try {
        const result = await analyzeImageFile({
          filePath,
          config: params.config,
          hint: "auto_inbound_context",
        });
        return `${result.imageBlock}\n\n${serializeVisionHandoff(result.handoff)}`;
      } catch (error) {
        return `[Image]\nKind: analysis_failed\nSummary: Failed to analyze ${filePath}.\nWarnings: ${String(error)}`;
      }
    }),
  );
  const results = analyzed;

  if (results.length === 0) {
    return undefined;
  }

  return [
    "Vision Bridge auto-analyzed recent inbound images.",
    "Use these image blocks as high-priority visual context for the current turn.",
    "",
    results.join("\n\n"),
  ].join("\n");
}

function extractRecentImagePaths(
  messages: unknown[],
  limits: { maxMessages: number; maxImages: number },
): string[] {
  const recent = messages.slice(-limits.maxMessages);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    for (const text of collectTextChunks(message)) {
      for (const match of text.matchAll(MEDIA_IMAGE_PATH_RE)) {
        const filePath = match[1]?.trim();
        if (!filePath || seen.has(filePath)) {
          continue;
        }
        seen.add(filePath);
        paths.push(filePath);
        if (paths.length >= limits.maxImages) {
          return paths.reverse();
        }
      }
    }
  }
  return paths.reverse();
}

function collectTextChunks(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextChunks(item));
  }
  const record = value as Record<string, unknown>;
  return Object.values(record).flatMap((item) => collectTextChunks(item));
}
