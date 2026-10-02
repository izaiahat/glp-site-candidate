import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import { loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";
import { deriveGoEntriesFromRegistry } from "../src/program-registry.mjs";
import { goCommercialLabels } from "../src/go-commercial-labels.mjs";
import { manifestJsonText, renderGoRuntimeManifestModule, assertCurrentHoldGoSuccessor } from "../src/go-runtime-manifest.mjs";
const holdsOnly = process.argv.includes('--current-holds-only');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await readFile(path.join(ROOT, "data", "program-registry.json"), "utf8"));
const ledger = JSON.parse(await readFile(path.join(ROOT, "data", "program-content-ledger.json"), "utf8"));
const commercialLabels = goCommercialLabels(JSON.parse(await readFile(path.join(ROOT, "data", "affiliate-held-link-manifest.json"), "utf8")));
// GO_RUNTIME_PROMOTION_AUTHORITY_V1: missing authority means every route stays held.
const goPromotionAuthority = loadGoPromotionAuthority(ROOT);
// Materialize the same complete receipts for legacy raw-JSON refresh readers.
// Otherwise the next governed wire-in refresh would silently withdraw this cohort.
const authorityPath = path.join(ROOT, 'data/go-runtime-promotion-authority.json');
const authorityText = JSON.stringify(goPromotionAuthority, null, 2) + '\n';
if (!holdsOnly && await readFile(authorityPath, 'utf8') !== authorityText) {
  const temporary = `${authorityPath}.tmp-${process.pid}`;
  await writeFile(temporary, authorityText, { mode: 0o644 });
  await rename(temporary, authorityPath);
}
const manifest = {
  schema: "affiliate-worker-staging-v3-registry",
  program_registry_schema: registry.schema,
  site_profile: "glp-clinic-scout",
  internal_fallback: "https://glpclinicscout.com/providers/",
  programs: deriveGoEntriesFromRegistry(registry, "glp-clinic-scout", ledger.programs, loadAffiliateLinkMap("compare"), goPromotionAuthority, commercialLabels),
};
if (holdsOnly) {
  const {GO_RUNTIME_MANIFEST: before} = await import('../functions/go/program-manifest.js');
  const held = new Set(Object.entries(goPromotionAuthority.programs).filter(([, row]) => row.status === 'WITHHELD').map(([id]) => id));
  assertCurrentHoldGoSuccessor(before, manifest, held);
}
await writeFile(path.join(ROOT, "functions", "go", "program-manifest.js"), renderGoRuntimeManifestModule(manifest));
if (!holdsOnly) await writeFile(path.join(ROOT, "artifacts", "ops", "worker-manifest.staging.json"), manifestJsonText(manifest));
console.log(JSON.stringify({ status: "PASS", programs: manifest.programs.length, verified_candidates: manifest.programs.filter((program) => program.status === "live_operator_approved").length }));
