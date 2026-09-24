import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateApprovedProgramCoverage, loadApprovedProgramCoverage } from "../src/approved-program-coverage.mjs";
import { buildReady6EditorialPages, READY6_KEYS, READY6_ROUTES } from "../src/ready6-editorial.mjs";
import { applyMeritScores, meritScore } from "../src/merit-ranking.mjs";
import { deriveIdentityGroups } from "../src/provider-identity.mjs";
import { loadGoSelection } from "../src/go-runtime-selection.mjs";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The renderer's score and alias inputs are the same ones the build derives:
// merit criteria off the content ledger, alias grouping off the registry. Rebuilt
// here independently so a byte comparison against the shipped page is meaningful.
const registryForBuild = JSON.parse(await readFile(path.join(ROOT, "data", "program-registry.json"), "utf8"));
const ledgerForBuild = JSON.parse(await readFile(path.join(ROOT, "data", "program-content-ledger.json"), "utf8")).programs;
const calculatorForBuild = JSON.parse(await readFile(path.join(ROOT, "data", "cost-calculator.json"), "utf8"));
const logoManifestForBuild = JSON.parse(await readFile(path.join(ROOT, "assets", "provider-logos", "manifest.json"), "utf8"));
const { comparablePriceProviderIds } = await import("../src/provider-dynamic-profiles.mjs");
applyMeritScores(ledgerForBuild, {
  comparablePriceIds: comparablePriceProviderIds(registryForBuild, "glp-clinic-scout", {
    asOf: new Date(`${registryForBuild.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
  }),
});
for (const program of ledgerForBuild) {
  const score = meritScore(program);
  if (score === null) throw new Error(`merit_score_underivable:${program.program_id}`);
  program.score = score;
}
const identityForBuild = deriveIdentityGroups(registryForBuild, "glp-clinic-scout", ledgerForBuild);
const logoForBuildByCanonicalId = new Map((logoManifestForBuild.logos || []).map((logo) => [logo.program_id, logo]));
const canonicalLogoIdByRegistryId = new Map(Object.values(registryForBuild.provider_dynamic_profiles?.profiles || {}).flatMap((profile) =>
  (profile.registry_program_ids || []).map((registryId) => [registryId, profile.program_id])));
const logoForBuildByRegistryId = Object.fromEntries(registryForBuild.programs.flatMap((program) => {
  const canonicalId = canonicalLogoIdByRegistryId.get(program.program_id)
    || identityForBuild.canonicalOf.get(program.program_id)
    || program.program_id;
  const logo = logoForBuildByCanonicalId.get(canonicalId);
  if (!logo) return [];
  return [[program.program_id, {
    path: logo.public_path,
    alt: `${logo.provider} logo`,
    width: logo.width,
    height: logo.height,
    treatment: logo.logo_treatment,
    content_scale: logo.logo_fit?.content_scale,
    runtime_remote_load: logo.runtime_remote_load,
  }]];
}));
// The build publishes the READY6 lane through the site registry, so this
// independent rebuild must use the same input or its byte comparison is
// meaningless. A program the network paused is out of the registry and therefore
// out of the published set, while the sealed contract below is still checked in
// full against all six adjudicated records.
const built = await buildReady6EditorialPages(ROOT, {
  activeRegistryIds: registryForBuild.programs.map((program) => program.program_id),
  ledgerPrograms: ledgerForBuild,
  aliases: Object.fromEntries([...identityForBuild.aliasIds].map((aliasId) => {
    const canonical = registryForBuild.programs.find((program) => program.program_id === identityForBuild.canonicalOf.get(aliasId));
    return [aliasId, { brand: canonical.display_name, route: canonical.review_path }];
  })),
  logoByRegistryId: logoForBuildByRegistryId,
  shell: "shared-interactive",
});
// PUBLISHED set = adjudicated set minus anything the site registry no longer
// carries. Both are asserted: the adjudicated total never moves, the published
// total is derived, and every suppressed route must really be gone from the tree.
const publishedKeys = READY6_KEYS.filter((key, index) => registryForBuild.programs.some((program) => program.review_path === READY6_ROUTES[index]));
const publishedRoutes = READY6_ROUTES.filter((route) => registryForBuild.programs.some((program) => program.review_path === route));
assert.equal(built.pages.length, publishedKeys.length);
assert.deepEqual(built.models.map((row) => row.program_key), publishedKeys);
assert.deepEqual(built.pages.map((row) => row.route), publishedRoutes);
assert.deepEqual(built.suppressed_routes, READY6_ROUTES.filter((route) => !publishedRoutes.includes(route)));
assert.deepEqual(built.state_counts, { research_records_total: 32, ready_editorial_direct: 6, adjacent_sister_pool: 25, drop_genuine_legal_route_block: 1, held: 0, published: publishedRoutes.length, suppressed_network_paused: READY6_ROUTES.length - publishedRoutes.length });
assert.deepEqual(new Set(Object.values(built.effects)), new Set([0]));

const registry = registryForBuild;
const goSelection = loadGoSelection(ROOT);
const readyRows = registry.programs.filter((program) => program.source_kind === "approved53_ready6");
assert.deepEqual(readyRows.map((program) => program.review_path), publishedRoutes);
for (const [index, program] of readyRows.entries()) {
  const routeSlug = publishedRoutes[index].split("/")[2];
  const profile = program.profiles["glp-clinic-scout"];
  assert.equal(program.review_slug, routeSlug);
  assert.equal(program.go.route, `/go/${routeSlug}`);
  assert.equal(program.commercial_state, "live");
  const promoted = goSelection?.programs?.[program.program_id]?.status === 'VERIFIED';
  assert.equal(program.go.entry_state, promoted ? 'server_redirect' : 'held');
  if (promoted) {
    const entry = GO_RUNTIME_MANIFEST.programs[routeSlug];
    assert.equal(entry.status, 'live_operator_approved');
    assert.equal(entry.operator_selection_receipt_sha256, goSelection.selection_sha256);
    assert.equal(entry.tracking.base_url, goSelection.programs[program.program_id].issued_link);
  }
  // 2026-08-06 surface unification: READY6 providers are on compare and quiz with
  // everyone else, ranked by the derived merit score. The only surface they are
  // still off is the opaque /go route, which stays held by production authority
  // and must keep its written reason.
  // 2026-08-06 cluster 1: one exception to "on compare and quiz with everyone
  // else" - a row declared an ALIAS of another merchant. Katalys 1516 ("SHED")
  // and Awin `shedrx` ("Shed") are one provider; the alias must be off every
  // LIST, or the site shows one merchant twice. That is only allowed with the
  // written canonical_identity declaration below.
  // SHED-301 (2026-08-06): the alias's editorial record stays in the tree and
  // byte-asserted, but its ROUTE is a permanent redirect to the canonical
  // review and it leaves the sitemap: one merchant, one indexable review.
  const alias = profile.canonical_identity?.role === "alias";
  assert.equal(profile.surfaces.review, true);
  assert.equal(profile.surfaces.sitemap, !alias, `${program.program_id}:sitemap_surface`);
  assert.equal(profile.surfaces.go, promoted);
  if (alias) {
    assert.ok(profile.canonical_identity.canonical_program_id, `${program.program_id}:alias_canonical_missing`);
    assert.ok(profile.canonical_identity.reason.length > 40, `${program.program_id}:alias_reason_missing`);
  }
  assert.equal(profile.surfaces.compare, !alias, `${program.program_id}:compare_missing`);
  assert.equal(profile.surfaces.quiz, !alias, `${program.program_id}:quiz_missing`);
  if (promoted) assert.equal(profile.exceptions.go, undefined);
  else {
    assert.equal(profile.exceptions.go.enabled, true, `${program.program_id}:go:exception_disabled`);
    assert.ok(profile.exceptions.go.reason.length > 20, `${program.program_id}:go:exception_reason_missing`);
  }
  for (const surface of ["compare", "quiz"]) {
    if (alias) assert.equal(profile.exceptions[surface]?.enabled, true, `${program.program_id}:${surface}:alias_exception_missing`);
    else assert.equal(profile.exceptions[surface], undefined, `${program.program_id}:${surface}:stale_exception`);
  }
  assert.equal(profile.wired, true);
}
const coverage = validateApprovedProgramCoverage(await loadApprovedProgramCoverage(ROOT));
assert.equal(coverage.existing4_active_unchanged, 3);
// 2026-08-18 content-fit LIFT (BRIDGE-20260818-AFF-TRT-001-CONTENT-FIT-LIFT):
// the one link-dark content-fit hold moved to the lifted partition after a
// receipted link-click QA. READY6's own six are untouched by that.
assert.equal(coverage.existing4_editorial_link_dark_content_fit_hold, 0);
assert.equal(coverage.existing4_content_fit_lifted_qa_verified, 1);
assert.equal(coverage.ready6_production_review_indexable, 6);
assert.equal(coverage.scaffold_pending_evidence_review, 43);
assert.equal(coverage.coverage_gate.status, "BLOCKED");

const sitemap = await readFile(path.join(PUBLIC, "sitemap.xml"), "utf8");
const redirects = await readFile(path.join(PUBLIC, "_redirects"), "utf8");
const routeHashes = {};
const providerUrlHashes = {};
for (const page of built.pages) {
  const filePath = path.join(PUBLIC, page.route.replace(/^\//, ""), "index.html");
  const canonical = `https://glpclinicscout.com${page.route}`;
  const model = built.models.find((row) => row.route === page.route);
  // SHED-301: an alias route is out of the sitemap and permanently redirected to
  // its canonical record — both the brand route and the network-id route, each
  // straight to the canonical so no redirect chains. It must not ship a shadowing
  // index file because Cloudflare Pages serves that file before consulting redirects.
  assert.equal(sitemap.split(`<loc>${canonical}</loc>`).length - 1, model.alias_of ? 0 : 1, `${page.route}:sitemap_bijection_invalid`);
  if (model.alias_of) {
    await assert.rejects(readFile(filePath), (error) => error?.code === "ENOENT", `${page.route}:alias_shadow_file_present`);
    assert.ok(redirects.includes(`${page.route} ${model.alias_of.route} 301`), `${page.route}:alias_route_redirect_missing`);
    assert.ok(redirects.includes(`/reviews/${model.registry_id}/ ${model.alias_of.route} 301`), `${page.route}:alias_id_redirect_missing`);
    routeHashes[page.route] = "REDIRECT_ONLY_NO_SHADOW_FILE";
    providerUrlHashes[page.route] = { provider_url: "[REDACTED]", sha256: model.cta.href_sha256 };
    continue;
  }
  const bytes = await readFile(filePath);
  const actual = bytes.toString("utf8");
  const governedCore = page.html.match(/<header class="ready6-review-hero">[\s\S]*<\/main>/)?.[0];
  const governedSchema = page.html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)?.[0];
  const governedStyle = page.html.match(/<style data-preserve data-ready6-review>[\s\S]*?<\/style>/)?.[0];
  assert.ok(governedCore && governedSchema && governedStyle, `${page.route}:shared_renderer_contract_missing`);
  const actualCore = actual.match(/<header class="ready6-review-hero">[\s\S]*<\/main>/)?.[0];
  assert.ok(actualCore, `${page.route}:built_editorial_core_missing`);
  const normalizedExpectedCore = governedCore
    .replace('class="eyebrow"', 'class="gcs-kicker"')
    .replace('<main id="main" class="ready6-review">', '<main id="main" class="ready6-review" data-cs-template="review">');
  const actualGovernedCore = actualCore.replace(/<aside class="panel evidence-line inline-capture"[\s\S]*?<\/aside>(?=<\/main>)/, "");
  assert.equal(actualGovernedCore, normalizedExpectedCore, `${page.route}:governed_editorial_core_drift`);
  assert.ok(actual.includes(governedSchema), `${page.route}:governed_schema_drift`);
  assert.ok(actual.includes(governedStyle), `${page.route}:governed_style_drift`);
  assert.match(actual, /<html[^>]*data-cs-template="review"/);
  assert.equal((actual.match(/class="cs-search-toggle"/g) || []).length, 1, `${page.route}:shared_search_missing_or_duplicated`);
  assert.equal((actual.match(/class="cs-drawer"/g) || []).length, 1, `${page.route}:shared_drawer_missing_or_duplicated`);
  assert.equal((actual.match(/<script src="\/assets\/motion-loader\.js\?v=[a-f0-9]+" defer><\/script>/g) || []).length, 1, `${page.route}:shared_motion_loader_missing_or_duplicated`);
  assert.equal((actual.match(/<script src="\/assets\/motion\.js\?v=/g) || []).length, 0, `${page.route}:unconditional_motion_runtime_present`);
  assert.equal((actual.match(/<script src="\/assets\/vendor\/(?:gsap|lenis)\//g) || []).length, 0, `${page.route}:unconditional_motion_vendor_present`);
  assert.equal((actual.match(/<script src="\/assets\/site\.js\?v=[a-f0-9]+" defer><\/script>/g) || []).length, 1, `${page.route}:shared_site_runtime_missing_or_duplicated`);
  routeHashes[page.route] = sha256(bytes);
  providerUrlHashes[page.route] = { provider_url: "[REDACTED]", sha256: model.cta.href_sha256 };
}
process.stdout.write(`${JSON.stringify({ status: "PASS_READY6_PRODUCTION_REVIEW_INDEXABLE_NOT_DEPLOYED", candidate_id: built.inputs.contract.candidate_id, routes: publishedRoutes, suppressed_routes: built.suppressed_routes, source_hashes: Object.fromEntries(Object.entries(built.inputs.contract.source_contracts).map(([key, value]) => [key, value.sha256])), provider_url_hashes: providerUrlHashes, route_byte_hashes: routeHashes, state_counts: { existing4_active_unchanged: 3, existing4_editorial_link_dark_content_fit_hold: 1, ready6_production_review_indexable: 6, ready6_published_routes: publishedRoutes.length, scaffold_pending_evidence_review: 43, research: built.state_counts }, effects: built.effects })}\n`);
