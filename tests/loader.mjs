/**
 * ESM hooks: rewrite .js imports to .ts so node --experimental-strip-types
 * can resolve TypeScript source files that use the conventional .js extension.
 * Also stubs out "openclaw/plugin-sdk" and "openclaw/plugin-sdk/core" so tests
 * can import index.ts without the full OpenClaw runtime.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const STUB_URL_PREFIX = "stub:openclaw-sdk";

export async function resolve(specifier, context, nextResolve) {
  // Stub out OpenClaw SDK imports
  if (
    specifier === "openclaw/plugin-sdk" ||
    specifier === "openclaw/plugin-sdk/core"
  ) {
    return { shortCircuit: true, url: `${STUB_URL_PREFIX}:${specifier}` };
  }

  // Remap .js -> .ts for relative imports so strip-types can resolve them
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const parentURL = context.parentURL ?? pathToFileURL(process.cwd() + "/").href;
    const parentDir = path.dirname(fileURLToPath(parentURL));
    const tsPath = path.resolve(parentDir, specifier.replace(/\.js$/, ".ts"));
    if (existsSync(tsPath)) {
      return { shortCircuit: true, url: pathToFileURL(tsPath).href };
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(STUB_URL_PREFIX)) {
    const source = `
export function emptyPluginConfigSchema() { return {}; }
export const SILENT_REPLY_TOKEN = "NO_REPLY";
`;
    return { shortCircuit: true, format: "module", source };
  }
  return nextLoad(url, context);
}
