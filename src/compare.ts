import { analyzeImageFile } from "./analyze.ts";
import type { AnalyzeImageResult, VisionCompareResult, VisionBridgeConfig } from "./types.ts";

export async function compareImageFiles(params: {
  filePaths: string[];
  hint?: string;
  config: VisionBridgeConfig;
}): Promise<{ analyses: AnalyzeImageResult[]; comparison: VisionCompareResult; block: string }> {
  const analyses = await Promise.all(
    params.filePaths.map((filePath) =>
      analyzeImageFile({
        filePath,
        hint: params.hint,
        config: params.config,
      }),
    ),
  );

  const comparison = buildComparison(analyses);
  return {
    analyses,
    comparison,
    block: serializeCompareBlock(comparison),
  };
}

export function serializeCompareBlock(result: VisionCompareResult): string {
  const lines = [
    "[ImageCompare]",
    `Summary: ${result.summary}`,
    `SameKind: ${result.sameKind}`,
    `Kinds: ${result.commonKinds.length ? result.commonKinds.join(", ") : "(mixed)"}`,
    `Similarities: ${result.similarities.length ? result.similarities.join(" | ") : "(none)"}`,
    `Differences: ${result.differences.length ? result.differences.join(" | ") : "(none)"}`,
    `SaveRecommendation: ${result.saveRecommendation}`,
    `Compared: ${result.compared.map((item) => `${item.fileName}:${item.kind}`).join(" | ")}`,
  ];
  return lines.join("\n");
}

export function buildComparison(analyses: AnalyzeImageResult[]): VisionCompareResult {
  const kinds = analyses.map((item) => item.normalized.kind);
  const uniqueKinds = [...new Set(kinds)];
  const sameKind = uniqueKinds.length === 1;
  const similarities = buildSimilarities(analyses, sameKind);
  const differences = buildDifferences(analyses, sameKind);
  const saveRecommendation = resolveSaveRecommendation(analyses);

  return {
    schema: "vision-bridge/compare@v1",
    summary: buildSummary(analyses, sameKind, uniqueKinds),
    commonKinds: uniqueKinds,
    sameKind,
    similarities,
    differences,
    saveRecommendation,
    compared: analyses.map((item) => ({
      fileName: item.normalized.source.fileName,
      kind: item.normalized.kind,
      title: item.handoff.title,
    })),
  };
}

function buildSummary(
  analyses: AnalyzeImageResult[],
  sameKind: boolean,
  uniqueKinds: string[],
): string {
  if (sameKind) {
    return `Compared ${analyses.length} images of the same kind: ${uniqueKinds[0]}.`;
  }
  return `Compared ${analyses.length} images across kinds: ${uniqueKinds.join(", ")}.`;
}

function buildSimilarities(analyses: AnalyzeImageResult[], sameKind: boolean): string[] {
  const similarities: string[] = [];
  if (sameKind) {
    similarities.push(`all images classified as ${analyses[0]?.normalized.kind}`);
  }
  const sharedEntities = intersectMany(analyses.map((item) => item.normalized.entities));
  if (sharedEntities.length) similarities.push(`shared entities: ${sharedEntities.join(", ")}`);
  const sharedTags = intersectMany(analyses.map((item) => item.handoff.tags));
  if (sharedTags.length) similarities.push(`shared tags: ${sharedTags.join(", ")}`);
  return similarities;
}

function buildDifferences(analyses: AnalyzeImageResult[], sameKind: boolean): string[] {
  const differences: string[] = [];
  if (!sameKind) {
    differences.push(
      `kind mismatch: ${analyses.map((item) => item.normalized.kind).join(" vs ")}`,
    );
  }
  const titles = analyses.map((item) => item.handoff.title);
  if (new Set(titles).size > 1) {
    differences.push(`titles differ: ${titles.join(" vs ")}`);
  }
  const saveTargets = analyses.map((item) => item.handoff.saveHints.suggestedTarget);
  if (new Set(saveTargets).size > 1) {
    differences.push(`save targets differ: ${saveTargets.join(" vs ")}`);
  }
  return differences;
}

function resolveSaveRecommendation(
  analyses: AnalyzeImageResult[],
): VisionCompareResult["saveRecommendation"] {
  const targets = analyses.map((item) => item.handoff.saveHints.suggestedTarget);
  if (targets.every((item) => item === "knowledge")) return "knowledge";
  if (targets.every((item) => item === "memory")) return "memory";
  if (targets.includes("knowledge")) return "knowledge";
  if (targets.includes("memory")) return "memory";
  return "none";
}

function intersectMany(groups: string[][]): string[] {
  if (groups.length === 0) return [];
  return [...new Set(groups[0])].filter((value) => groups.every((group) => group.includes(value)));
}
