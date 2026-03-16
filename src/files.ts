import { stat } from "node:fs/promises";
import path from "node:path";
import type { ImageInput, VisionBridgeConfig } from "./types.ts";

export function inferMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

export async function buildImageInput(
  filePath: string,
  hint: string | undefined,
  config: VisionBridgeConfig,
): Promise<ImageInput> {
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(`not a file: ${filePath}`);
  }
  if (info.size === 0) {
    throw new Error(`Image file is empty (0 bytes): ${filePath}`);
  }
  if (info.size > config.limits.maxImageBytes) {
    throw new Error(`image too large: ${info.size} bytes > ${config.limits.maxImageBytes}`);
  }
  const mimeType = inferMimeType(filePath);
  if (!mimeType.startsWith("image/")) {
    throw new Error(`unsupported image type: ${filePath}`);
  }
  return {
    filePath,
    fileName: path.basename(filePath),
    mimeType,
    sizeBytes: info.size,
    hint,
  };
}
