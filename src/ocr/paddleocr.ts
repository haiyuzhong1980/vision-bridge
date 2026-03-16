import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import type { ImageInput, OcrResult, VisionBridgeConfig } from "../types.ts";

const execFileAsync = promisify(execFile);

type OcrProviderName = "paddleocr" | "macos_vision";

export async function runPaddleOcr(
  input: ImageInput,
  config: VisionBridgeConfig,
): Promise<OcrResult> {
  if (config.ocr.provider === "disabled") {
    return buildEmptyOcrResult("disabled", "OCR provider is disabled");
  }

  const providers = resolveProviderOrder(config);
  const warnings: string[] = [];

  for (const provider of providers) {
    const result = await runProvider(provider, input, config);
    if (hasOcrText(result.text) || result.lines.length > 0) {
      return {
        ...result,
        warnings: [...warnings, ...result.warnings],
      };
    }
    warnings.push(...result.warnings);
  }

  return {
    provider: providers[0] ?? "ocr",
    text: "",
    lines: [],
    warnings: warnings.length ? warnings : ["OCR returned no text"],
  };
}

async function runProvider(
  provider: OcrProviderName,
  input: ImageInput,
  config: VisionBridgeConfig,
): Promise<OcrResult> {
  if (provider === "macos_vision") {
    return runMacOsVision(input, config);
  }
  return runPaddleProvider(input, config);
}

async function runPaddleProvider(
  input: ImageInput,
  config: VisionBridgeConfig,
): Promise<OcrResult> {
  const pythonScript = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../scripts/paddleocr_cli.py",
  );
  const pythonCmd = await resolvePythonCommand(pythonScript);

  try {
    const { stdout } = await execFileAsync(pythonCmd, [pythonScript, input.filePath], {
      timeout: config.ocr.timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
      env: {
        ...process.env,
        DISABLE_MODEL_SOURCE_CHECK: "True",
        OMP_NUM_THREADS: "1",
        MKL_NUM_THREADS: "1",
      },
    });
    const parsed = JSON.parse(stdout) as {
      provider?: string;
      text?: string;
      lines?: Array<{ text?: string }>;
    };
    const result = normalizeProviderPayload(parsed, "paddleocr");
    if (!hasOcrText(result.text) && result.lines.length === 0) {
      return {
        ...result,
        warnings: ["PaddleOCR returned no text"],
      };
    }
    return result;
  } catch (error) {
    return buildEmptyOcrResult("paddleocr", `PaddleOCR failed: ${summarizeExecError(error)}`);
  }
}

async function runMacOsVision(
  input: ImageInput,
  config: VisionBridgeConfig,
): Promise<OcrResult> {
  if (process.platform !== "darwin") {
    return buildEmptyOcrResult("macos_vision", "macOS Vision OCR unavailable on this platform");
  }
  const swiftScript = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../scripts/macos_vision_ocr.swift",
  );
  try {
    const { stdout } = await execFileAsync("swift", [swiftScript, input.filePath], {
      timeout: config.ocr.timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
    });
    const parsed = JSON.parse(stdout) as {
      provider?: string;
      text?: string;
      lines?: Array<{ text?: string }>;
    };
    const result = normalizeProviderPayload(parsed, "macos_vision");
    if (!hasOcrText(result.text) && result.lines.length === 0) {
      return {
        ...result,
        warnings: ["macOS Vision OCR returned no text"],
      };
    }
    return result;
  } catch (error) {
    return buildEmptyOcrResult("macos_vision", `macOS Vision OCR failed: ${summarizeExecError(error)}`);
  }
}

function normalizeProviderPayload(
  parsed: { provider?: string; text?: string; lines?: Array<{ text?: string }> },
  fallbackProvider: OcrProviderName,
): OcrResult {
  return {
    provider: parsed.provider || fallbackProvider,
    text: typeof parsed.text === "string" ? parsed.text : "",
    lines: Array.isArray(parsed.lines)
      ? parsed.lines
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .filter((item) => item.length > 0)
      : [],
    warnings: [],
  };
}

function resolveProviderOrder(config: VisionBridgeConfig): OcrProviderName[] {
  if (config.ocr.provider === "paddleocr") return ["paddleocr"];
  if (config.ocr.provider === "macos_vision") return ["macos_vision"];
  if (config.ocr.provider === "auto") {
    return uniqueProviders(config.ocr.fallbackOrder);
  }
  return [];
}

function uniqueProviders(providers: Array<"paddleocr" | "macos_vision">): OcrProviderName[] {
  return [...new Set(providers)];
}

async function resolvePythonCommand(pythonScript: string): Promise<string> {
  const envPython = process.env.VISION_BRIDGE_PYTHON?.trim();
  if (envPython) {
    return envPython;
  }
  const extensionRoot = path.resolve(path.dirname(pythonScript), "..");
  const localVenvPython = path.join(extensionRoot, ".venv", "bin", "python");
  if (await exists(localVenvPython)) {
    return localVenvPython;
  }
  return "python3";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function summarizeExecError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "OCR execution failed";
  }
  const details = error as Error & {
    code?: string | number;
    signal?: string;
    killed?: boolean;
  };
  if (details.signal === "SIGTERM" || details.killed) {
    return "timed out";
  }
  const firstLine = error.message.split("\n")[0]?.trim();
  return firstLine || "OCR execution failed";
}

export function isConfiguredOcrProvider(config: VisionBridgeConfig): boolean {
  return config.ocr.provider !== "disabled";
}

export function getOcrProviderName(config: VisionBridgeConfig): string {
  return config.ocr.provider;
}

export function getEffectiveOcrProviderLabel(config?: VisionBridgeConfig): string {
  if (config?.ocr.provider && config.ocr.provider !== "auto") {
    return config.ocr.provider;
  }
  return process.platform === "darwin" ? "macos_vision_then_paddleocr" : "paddleocr";
}

export function summarizeOcrLines(lines: string[]): string {
  return lines.join("\n");
}

export function hasOcrText(text: string): boolean {
  return text.trim().length > 0;
}

export function truncateOcrWarnings(warnings: string[]): string[] {
  return warnings.slice(0, 5);
}

export function ensureOcrWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => warning.trim().length > 0);
}

export function mergeOcrWarnings(...groups: string[][]): string[] {
  return ensureOcrWarnings(groups.flat());
}

export function normalizeOcrText(text: string): string {
  return text.trim();
}

export function normalizeOcrLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

export function buildEmptyOcrResult(provider: string, warning: string): OcrResult {
  return {
    provider,
    text: "",
    lines: [],
    warnings: [warning],
  };
}
