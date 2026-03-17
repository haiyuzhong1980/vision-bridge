/**
 * Registers the .js→.ts resolver and SDK stub hooks before test files load.
 * Used via: node --import ./tests/register-loader.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./loader.mjs", import.meta.url).pathname).href);
