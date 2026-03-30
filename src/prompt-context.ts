import path from "node:path";
import { analyzeImageFile } from "./analyze.ts";
import { serializeVisionHandoff } from "./handoff.ts";
import type { VisionBridgeConfig } from "./types.ts";

const MEDIA_IMAGE_PATH_RE =
  /\[media attached:\s*([^\n|]+?\.(?:png|jpe?g|webp|gif|heic|heif|bmp|tiff?|avif|svg))(?:\s*\([^)]+\))?\s*\|/gi;
export const AUTO_CONTEXT_MAX_CONCURRENCY = 2;
export const AUTO_CONTEXT_MIN_TIMEOUT_MS = 3_000;
export const AUTO_CONTEXT_MAX_TIMEOUT_MS = 12_000;

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

  const timeoutMs = resolveAutoContextTimeoutMs(params.config);
  const results = await mapWithConcurrency(paths, AUTO_CONTEXT_MAX_CONCURRENCY, (filePath) =>
    buildPromptContextEntry(filePath, params.config, timeoutMs),
  );

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

export function resolveAutoContextTimeoutMs(config: VisionBridgeConfig): number {
  return Math.max(
    AUTO_CONTEXT_MIN_TIMEOUT_MS,
    Math.min(config.ocr.timeoutMs, AUTO_CONTEXT_MAX_TIMEOUT_MS),
  );
}

export function buildAutoContextFallbackEntry(
  filePath: string,
  reason: "analysis_failed" | "analysis_timed_out",
  detail: string,
): string {
  const fileName = path.basename(filePath);
  if (reason === "analysis_timed_out") {
    return [
      "[Image]",
      "Kind: analysis_timed_out",
      `Summary: Auto image analysis timed out for ${fileName}; continuing without OCR-backed context.`,
      `Warnings: ${detail}`,
    ].join("\n");
  }

  return [
    "[Image]",
    "Kind: analysis_failed",
    `Summary: Failed to analyze ${fileName}.`,
    `Warnings: ${detail}`,
  ].join("\n");
}

async function buildPromptContextEntry(
  filePath: string,
  config: VisionBridgeConfig,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await analyzeImageFile({
      filePath,
      config,
      hint: "auto_inbound_context",
      signal: controller.signal,
    });
    if (result.error || !result.imageBlock.trim()) {
      return buildAutoContextFallbackEntry(
        filePath,
        "analysis_failed",
        result.message ?? "structured analysis returned no image block",
      );
    }
    return `${result.imageBlock}\n\n${serializeVisionHandoff(result.handoff)}`;
  } catch (error) {
    if (controller.signal.aborted) {
      return buildAutoContextFallbackEntry(
        filePath,
        "analysis_timed_out",
        `auto_context_timeout_${timeoutMs}ms`,
      );
    }
    return buildAutoContextFallbackEntry(
      filePath,
      "analysis_failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
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

function collectTextChunks(value: unknown, depth = 0): string[] {
  if (depth > 8) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextChunks(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  return Object.values(record).flatMap((item) => collectTextChunks(item, depth + 1));
}
