import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyImage, refineClassificationWithOcr } from "./classifier.ts";
import { buildImageInput } from "./files.ts";
import { buildVisionHandoffRecord } from "./handoff.ts";
import { normalizeImageAnalysis, serializeImageBlock } from "./normalize.ts";
import { runPaddleOcr } from "./ocr/paddleocr.ts";
import type { AnalyzeImageResult, VisionBridgeConfig } from "./types.ts";
import { runVisionProvider } from "./vision/provider.ts";

type AnalyzeOutcome = AnalyzeImageResult & { error?: true; message?: string };

const analysisCache = new Map<string, Promise<AnalyzeOutcome>>();
const ANALYSIS_CACHE_MAX = 32;
const ANALYSIS_DISK_CACHE_SCHEMA = "vision-bridge/analyze-cache@v1";
const ANALYSIS_DISK_CACHE_MAX = 64;

export async function analyzeImageFile(params: {
  filePath: string;
  hint?: string;
  config: VisionBridgeConfig;
  signal?: AbortSignal;
}): Promise<AnalyzeOutcome> {
  if (params.signal?.aborted) {
    throw buildAbortError();
  }
  const input = await buildImageInput(params.filePath, params.hint, params.config).catch((error) =>
    buildAnalyzeFailure(error),
  );
  if ("error" in input) {
    return input;
  }
  const cacheKey = buildAnalysisCacheKey(input, params.config);

  const diskCached = await readAnalysisDiskCache(cacheKey);
  if (diskCached) {
    if (!params.signal) {
      const execution = Promise.resolve(diskCached);
      rememberAnalysisExecution(cacheKey, execution);
      return execution;
    }
    return diskCached;
  }

  if (params.signal) {
    const result = await runAnalysis(input, params.config, params.signal);
    if (!result.error) {
      await writeAnalysisDiskCache(cacheKey, result).catch(() => {});
    }
    return result;
  }

  const cached = analysisCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const execution = runAnalysis(input, params.config).then(async (result) => {
    if (!result.error) {
      await writeAnalysisDiskCache(cacheKey, result).catch(() => {});
    }
    return result;
  });
  rememberAnalysisExecution(cacheKey, execution);
  return execution;
}

function rememberAnalysisExecution(
  cacheKey: string,
  execution: Promise<AnalyzeOutcome>,
): void {
  if (analysisCache.size >= ANALYSIS_CACHE_MAX) {
    const oldestKey = analysisCache.keys().next().value;
    if (oldestKey) {
      analysisCache.delete(oldestKey);
    }
  }
  analysisCache.set(cacheKey, execution);
}

async function runAnalysis(
  input: Awaited<ReturnType<typeof buildImageInput>>,
  config: VisionBridgeConfig,
  signal?: AbortSignal,
): Promise<AnalyzeOutcome> {
  try {
    if (signal?.aborted) {
      throw buildAbortError();
    }
    const initialClassification = classifyImage(input);
    const ocr = await runPaddleOcr(input, config, signal);
    const classification = refineClassificationWithOcr(initialClassification, input, ocr);
    const vision = await runVisionProvider(input, classification, ocr, config);
    const normalized = normalizeImageAnalysis({
      input,
      classification,
      ocr,
      vision,
      config,
    });
    const handoff = buildVisionHandoffRecord(normalized);

    return {
      normalized,
      handoff,
      imageBlock: serializeImageBlock(normalized),
    };
  } catch (err) {
    if (signal && isAbortLikeError(err)) {
      throw err;
    }
    return buildAnalyzeFailure(err);
  }
}

function buildAnalyzeFailure(error: unknown): AnalyzeOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: true,
    message,
    normalized: {
      kind: "mixed_unknown",
      summary: "",
      ocrText: "",
      entities: [],
      uiElements: [],
      riskFlags: [],
      keyFields: {},
      layoutHints: [],
      tableHints: [],
      chartHints: [],
      tablePreview: [],
      chartSignals: [],
      confidence: 0,
      warnings: [message],
      source: { fileName: "", mimeType: "", sizeBytes: 0 },
    },
    handoff: {
      schema: "vision-bridge/handoff@v1",
      kind: "mixed_unknown",
      title: "",
      summary: "",
      tags: [],
      saveHints: { suggestedTarget: "none", reason: "", confidence: 0 },
      extracted: {
        keyFields: {},
        entities: [],
        uiElements: [],
        riskFlags: [],
        tablePreview: [],
        chartSignals: [],
      },
      source: { fileName: "", mimeType: "", sizeBytes: 0 },
    },
    imageBlock: "",
  };
}

function buildAbortError(): Error {
  const error = new Error("analysis aborted");
  error.name = "AbortError";
  return error;
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const details = error as Error & { code?: string };
  return (
    error.name === "AbortError" ||
    details.code === "ABORT_ERR" ||
    error.message.toLowerCase().includes("aborted")
  );
}

export function buildAnalysisCacheKey(
  input: Awaited<ReturnType<typeof buildImageInput>>,
  config: VisionBridgeConfig,
): string {
  return JSON.stringify({
    filePath: input.filePath,
    sizeBytes: input.sizeBytes,
    modifiedMs: input.modifiedMs,
    hint: input.hint ?? "",
    ocr: config.ocr,
    vision: config.vision,
  });
}

export function getAnalysisCacheDirectory(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.cache/analyses");
}

export function buildAnalysisCacheFilePath(cacheKey: string): string {
  return path.join(
    getAnalysisCacheDirectory(),
    `${createHash("sha1").update(cacheKey).digest("hex")}.json`,
  );
}

async function readAnalysisDiskCache(cacheKey: string): Promise<AnalyzeOutcome | undefined> {
  const cachePath = buildAnalysisCacheFilePath(cacheKey);
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as { schema?: string; result?: AnalyzeOutcome };
    if (parsed.schema !== ANALYSIS_DISK_CACHE_SCHEMA || !parsed.result) {
      return undefined;
    }
    return parsed.result;
  } catch {
    return undefined;
  }
}

async function writeAnalysisDiskCache(cacheKey: string, result: AnalyzeOutcome): Promise<void> {
  const cacheDir = getAnalysisCacheDirectory();
  await mkdir(cacheDir, { recursive: true });
  const cachePath = buildAnalysisCacheFilePath(cacheKey);
  const payload = JSON.stringify(
    {
      schema: ANALYSIS_DISK_CACHE_SCHEMA,
      cachedAt: new Date().toISOString(),
      result,
    },
    null,
    2,
  );
  await writeFile(cachePath, payload, "utf8");
  await pruneAnalysisDiskCache(cacheDir);
}

async function pruneAnalysisDiskCache(cacheDir: string): Promise<void> {
  const entries = await readdir(cacheDir).catch(() => []);
  if (entries.length <= ANALYSIS_DISK_CACHE_MAX) {
    return;
  }

  const fileStats = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(cacheDir, entry);
      const fileStat = await stat(filePath).catch(() => null);
      return fileStat ? { filePath, modifiedMs: fileStat.mtimeMs } : null;
    }),
  );

  const staleEntries = fileStats
    .filter((entry): entry is { filePath: string; modifiedMs: number } => entry !== null)
    .sort((left, right) => right.modifiedMs - left.modifiedMs)
    .slice(ANALYSIS_DISK_CACHE_MAX);

  await Promise.all(staleEntries.map((entry) => rm(entry.filePath, { force: true })));
}
