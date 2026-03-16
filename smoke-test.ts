import { analyzeImageFile } from "./src/analyze.ts";
import { defaultVisionBridgeConfig } from "./src/config.ts";

const filePath = process.argv[2];

if (!filePath) {
  console.error("usage: node --experimental-strip-types smoke-test.ts <image-path> [hint]");
  process.exit(2);
}

const hint = process.argv[3];

const result = await analyzeImageFile({
  filePath,
  hint,
  config: defaultVisionBridgeConfig,
});

console.log(result.imageBlock);
console.log("\nJSON:");
console.log(JSON.stringify(result.normalized, null, 2));
