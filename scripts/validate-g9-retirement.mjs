import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OPS = path.join(ROOT, "artifacts", "ops");
// SHED-301 (2026-08-06): the READY6 redirect contract is registry-derived — an
// alias merchant's routes 301 straight to its canonical review. G9's concern is
// unchanged: G9 itself must not mutate that contract, so the expected list is
// derived exactly the way the build derives it rather than pinned by hand here.
const REGISTRY = JSON.parse(await readFile(path.join(ROOT, "data", "program-registry.json"), "utf8"));
const PHASE3 = JSON.parse(await readFile(path.join(ROOT, "data", "phase3-page-graph.json"), "utf8"));
const ALIAS_TARGET = new Map();
for (const program of REGISTRY.programs) {
  const declaration = program.profiles?.["glp-clinic-scout"]?.canonical_identity;
  if (declaration?.role !== "alias") continue;
  const canonical = REGISTRY.programs.find((row) => row.program_id === declaration.canonical_program_id);
  assert.ok(canonical?.review_path, `alias_canonical_unresolved:${program.program_id}`);
  // S9-7: an identity-only alias declares no review surface; its legacy review
  // route derives from its id and still 301s to the canonical record.
  ALIAS_TARGET.set(program.review_path || `/reviews/${program.program_id}/`, canonical.review_path);
}
const LEGACY_PAIRS = [
  ["/reviews/awin-128761/", "/reviews/coivas/"],
  ["/reviews/katalys-1286/", "/reviews/sprout-health/"],
  ["/reviews/katalys-647/", "/reviews/mangorx/"],
  ["/reviews/katalys-1304/", "/reviews/direct-meds/"],
  ["/reviews/katalys-1516/", "/reviews/shed/"],
  ["/reviews/katalys-1518/", "/reviews/breezemeds/"],
];
// Consolidation 2026-08-15 (strategy rule R1): duplicate-intent URLs 301 to
// their single canonical; part of the frozen redirect contract from this date.
const CONSOLIDATION_PAIRS = [
  ["/guides/healthrx-vs-agelessrx/", "/compare/healthrx-vs-agelessrx/"],
  ["/guides/wellorithm-vs-enhance-md/", "/compare/wellorithm-vs-enhance-md/"],
  ["/guides/cheapest-glp1/", "/cost/online-glp-1-programs/"],
  ["/guides/compare-online-glp-1-provider-fees/", "/cost/online-glp-1-programs/"],
  ["/guides/glp-1-program-total-cost-comparison/", "/cost/online-glp-1-programs/"],
];
// 2026-08-17 network pause (Katalys 1518/1519/1520): the paused programs' review
// routes and the comparison page written about two of them are no longer built,
// so they 301 to the live comparison. A legacy network-id route whose brand route
// is now retired resolves straight to the retirement target - never a chain.
// Mirrors scripts/build-staging.mjs RETIRED_PROGRAM_ROUTES, in the same order.
const RETIRED_PROGRAM_ROUTES = [
  ["/reviews/synergy-rx/", "/providers/"],
  ["/reviews/care-bare-rx-glp1/", "/providers/"],
  ["/reviews/breezemeds/", "/providers/"],
  ["/compare/synergy-rx-vs-carebarerx/", "/providers/"],
  // 2026-08-18 niche-fit removal (operator ruling): three non-GLP programs left
  // this site; their review routes 301 rather than 404.
  ["/reviews/paternity-lab/", "/providers/"],
  ["/reviews/advanced-trichology/", "/providers/"],
  ["/reviews/lyfefuel-us/", "/providers/"],
];
const RETIRED_TARGET = new Map(RETIRED_PROGRAM_ROUTES);
const resolveTarget = (to) => {
  const aliased = ALIAS_TARGET.get(to) || to;
  return RETIRED_TARGET.get(aliased) || aliased;
};
const LEGACY_FROM = new Set(LEGACY_PAIRS.map(([from]) => from));
// Design pass 2026-08-20 (Fable edit 1): additive short nav aliases. The frozen
// READY6 contract above is unchanged - this is a separate, explicitly declared
// list that mirrors SHORT_NAV_ALIASES in scripts/build-staging.mjs, in the same
// order, so G9 still fails closed if the build mutates the redirect file at all.
const SHORT_NAV_ALIASES = [
  ["/quiz/", "/quiz/provider-fit/"],
];
const BASE_REDIRECT_PAIRS = [
  ...LEGACY_PAIRS.map(([from, to]) => [from, resolveTarget(to)]),
  ...RETIRED_PROGRAM_ROUTES.filter(([from]) => !LEGACY_FROM.has(from)),
  ...CONSOLIDATION_PAIRS,
  ...ALIAS_TARGET,
  ...SHORT_NAV_ALIASES,
];
// W11 extends, rather than weakens, the READY6/G9 preserve list. Exact ordered
// equality remains mandatory, and all targets resolve to a final non-redirect.
const REDIRECT_MAP = new Map(BASE_REDIRECT_PAIRS);
for (const [from, to] of [...PHASE3.retired_evidence_wall_redirects, ...PHASE3.legacy_redirects]) REDIRECT_MAP.set(from, to);
// PASS2 §1b plus packs-cost route hygiene: exact aliases are additive,
// nonindexable, and resolve in one hop to their canonical documents. Keep this
// in lockstep with src/phase3-page-graph.mjs.
for (const [from, to] of [
  ["/cost/", "/providers/"],
]) REDIRECT_MAP.set(from, to);
// MUSTFIX: linked provider-detail aliases resolve directly to their standing
// review routes and remain outside the Phase 3 sitemap denominator.
for (const [from, to] of [
  ["/providers/coivas/", "/reviews/coivas/"],
  ["/providers/sprout-health/", "/reviews/sprout-health/"],
  ["/providers/direct-meds/", "/reviews/direct-meds/"],
  ["/providers/mangorx/", "/reviews/mangorx/"],
]) REDIRECT_MAP.set(from, to);
// PASS 5 preserves the frozen Google OAuth support document while repairing its
// linked public support route in one hop to the canonical support boundary.
REDIRECT_MAP.set("/support/", "/privacy/lead-capture/");
// MUSTFIX: the retired comparison route is handled by a query-aware Pages
// Function. A static redirect would erase medication intent and shadow it.
REDIRECT_MAP.delete("/best/online-glp-1-providers/");
const finalTarget = (source) => {
  const seen = new Set([source]);
  let target = REDIRECT_MAP.get(source);
  while (REDIRECT_MAP.has(target)) {
    assert.equal(seen.has(target), false, `redirect_cycle:${[...seen, target].join("->")}`);
    seen.add(target);
    target = REDIRECT_MAP.get(target);
  }
  return target;
};
const REQUIRED_REDIRECTS = [...REDIRECT_MAP].map(([from]) => `${from} ${finalTarget(from)} 301`);

async function htmlFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await htmlFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".html")) output.push(absolute);
  }
  return output.sort();
}

const redirects = (await readFile(path.join(PUBLIC, "_redirects"), "utf8")).trim().split(/\r?\n/).filter(Boolean);
assert.deepEqual(redirects, REQUIRED_REDIRECTS, "G9 must not mutate the frozen READY6 redirect contract");
const clinicsPrefix = path.join(PUBLIC, "clinics");
const directoryPrefix = path.join(PUBLIC, "directory");
const publicFiles = await htmlFiles(PUBLIC);
const retiredRouteFiles = publicFiles.filter((file) => {
  const relative = path.relative(PUBLIC, file).replaceAll(path.sep, "/");
  return relative === "clinics/index.html" || relative.startsWith("clinics/") || relative === "directory/index.html" || relative.startsWith("directory/");
});
assert.equal(retiredRouteFiles.length, 0, "G9 retired route files must not be published");
const sitemap = await readFile(path.join(PUBLIC, "sitemap.xml"), "utf8");
assert.equal((sitemap.match(/https:\/\/glpclinicscout\.com\/(?:clinics|directory)\//g) || []).length, 0, "G9 retired routes must not enter sitemap");
const staleReferences = [];
for (const file of publicFiles) {
  const html = await readFile(file, "utf8");
  if (/(?:href|action|canonical)="\/(?:clinics|directory)(?:\/|"|#)/i.test(html)) staleReferences.push(path.relative(PUBLIC, file));
}
assert.deepEqual(staleReferences, [], "G9 retired routes must not remain in generated nav/action/canonical attributes");
const fourOhFour = await readFile(path.join(PUBLIC, "404.html"), "utf8");
assert.match(fourOhFour, /404|not found|page could not be found/i, "G9 requires the static 404 target to exist");
const result = {
  status: "PASS_G9_STATIC_MISSING_PATH_404",
  retired_prefixes: ["/clinics/", "/directory/"],
  prior_city_pages: 250,
  published_city_pages: 0,
  directory_landing_published: false,
  sitemap_retired_route_matches: 0,
  stale_nav_action_canonical_references: 0,
  redirect_policy: "frozen_ready6_plus_phase3_preserve_list_exact_no_chains",
  non_success_semantics: "STATIC_MISSING_PATH_404",
  tested: ["no route files", "no sitemap entries", "no generated nav/action/canonical references", "404.html exists", "no SPA fallback redirect"],
};
await mkdir(OPS, { recursive: true });
await writeFile(path.join(OPS, "g9-route-retirement.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
