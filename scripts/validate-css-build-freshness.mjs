import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCssBuildFreshness } from "../src/css-build-freshness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await validateCssBuildFreshness(ROOT, { requirePublic: !process.argv.includes("--source-only") });
process.stdout.write(`${JSON.stringify(result)}\n`);
