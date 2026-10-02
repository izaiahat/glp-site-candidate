import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTalliesDerived, isTallyGatedRoute } from "../src/surface-tallies.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const report = JSON.parse(await readFile(path.join(ROOT, "artifacts", "ops", "build-report.json"), "utf8"));
const derivations = report.surface_derivations || {};
const derived = { LIVE_PROVIDER_COUNT: derivations.live_provider_count, COMPARISON_CARD_COUNT: derivations.price_state_tallies?.COMPARISON_CARD_COUNT, COMPARISON_PAGE_COUNT: derivations.comparison_page_count, RESEARCH_GUIDE_COUNT: derivations.research_guide_count };
if (Object.values(derived).some((value) => !Number.isInteger(value) || value < 0)) throw new Error("program_count_derivation_missing");
if (!Number.isInteger(derivations.token_substitutions?.LIVE_PROVIDER_COUNT) || derivations.token_substitutions.LIVE_PROVIDER_COUNT < 1) throw new Error("live_program_count_not_injected");
const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) await walk(absolute);
    else if (item.name === "index.html") files.push(absolute);
  }
}
await walk(PUBLIC);
let gated = 0;
const requiredRoutes = new Set(['semaglutide/index.html','tirzepatide/index.html','providers/index.html','lp/quiz/index.html']);
const checkedRequired = [];
for (const absolute of files) {
  const relative = path.relative(PUBLIC, absolute).replaceAll(path.sep, "/");
  if (!isTallyGatedRoute(relative)) continue;
  assertTalliesDerived(relative, await readFile(absolute, "utf8"), derived);
  if (requiredRoutes.has(relative)) checkedRequired.push(relative);
  gated += 1;
}
if (!gated) throw new Error("program_count_validator_no_surfaces");
if (checkedRequired.length !== requiredRoutes.size) throw new Error('program_count_required_surface_missing');
process.stdout.write(JSON.stringify({required_routes:checkedRequired.sort()})+'\n');
process.stdout.write(JSON.stringify({ status: "PASS", live_provider_count: derived.LIVE_PROVIDER_COUNT, gated_routes: gated, token_substitutions: derivations.token_substitutions.LIVE_PROVIDER_COUNT }) + "\n");
