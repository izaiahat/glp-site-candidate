import { effectiveAffiliateRegistry } from '../src/affiliate-relationship-sync.mjs';
import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import {
  collectCoverageInputs,
  deriveProfileSurfaceSets,
  goSurfaceFromManifest,
  validateProgramCoverage,
} from "../src/program-registry.mjs";
import { renderGoRuntimeManifestModule } from "../src/go-runtime-manifest.mjs";

const root = new URL("../", import.meta.url);
const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, root), "utf8"));
const clone = (value) => structuredClone(value);

async function loadFixture() {
  const [registry, money, quiz, calculatorConfig, providerContracts, providerFastpath, phase3Config, buildReport] = await Promise.all([
    readJson("data/program-registry.json"),
    readJson("data/money-page-specs.json"),
    readJson("data/quiz-config.json"),
    readJson("data/cost-calculator.json"),
    readJson("data/provider-page-contracts.json"),
    readJson("data/provider-fastpath-contract.json"),
    readJson("data/phase3-page-graph.json"),
    readJson("artifacts/ops/build-report.json"),
  ]);
  // Mirrors scripts/validate-program-coverage.mjs: READY6 and the Phase 3 page
  // graph are candidate-additive; redirect sources leave the indexable set.
  // Surface projection must use the unchanged program-authority profile.
  const canonicalRouteAliases = ["/cost/"];
  const redirected = new Set([
    ...[...phase3Config.retired_evidence_wall_redirects, ...phase3Config.legacy_redirects].map(([from]) => from),
    ...canonicalRouteAliases,
  ]);
  const paidLandingRoutes = new Set(phase3Config.compounded_pages.filter((page) => page.route.startsWith("/lp/")).map((page) => page.route));
  assert.ok(Number.isInteger(phase3Config.expected_indexable_routes));
  assert.equal(buildReport.phase3.generated_routes, phase3Config.expected_indexable_routes);
  assert.equal(buildReport.phase3.redirects, redirected.size);
  assert.equal(buildReport.phase3.indexable_routes, phase3Config.expected_indexable_routes - paidLandingRoutes.size);
  assert.ok(Number.isInteger(buildReport.indexable_routes));
  const inputs = await collectCoverageInputs({
    root: new URL("../", import.meta.url),
    registry,
    profileId: "glp-clinic-scout",
    money,
    quiz,
    calculatorConfig,
    providerContracts,
    providerFastpath,
  });
  inputs.registry = effectiveAffiliateRegistry(clone(registry));
  inputs.registry.site_profiles["glp-clinic-scout"].expected_sitemap_routes = buildReport.indexable_routes;
  return inputs;
}

test("one data registry is the sole program membership authority", async () => {
  const registry = await readJson("data/program-registry.json");
  assert.equal(registry.schema, "site-program-registry-v1");
  assert.equal(registry.site_profiles["glp-clinic-scout"].auto_generate, false);
  assert.equal(registry.site_profiles["glp-clinic-scout"].auto_publish, false);
  assert.equal(new Set(registry.programs.map((program) => program.program_id)).size, registry.programs.length);
  await assert.rejects(access(new URL("src/affiliate-programs.json", root), constants.F_OK), /ENOENT/);
});

test("production-successor profile satisfies every required registry surface", async () => {
  const inputs = await loadFixture();
  const result = validateProgramCoverage(inputs);
  assert.equal(result.status, "PASS");
  assert.equal(result.profile_id, "glp-clinic-scout");
  // The generated route graph changes this total. Bind the assertion to the
  // build's authoritative route receipt instead of re-pinning a stale literal.
  assert.equal(result.sitemap_routes, inputs.registry.site_profiles["glp-clinic-scout"].expected_sitemap_routes);
  // One tier: every live, vertical-fit, wired provider is on compare and quiz -
  // counted once per MERCHANT. A row declared an alias of another merchant
  // (Katalys 1516 "SHED" = Awin `shedrx` "Shed") keeps its built review record —
  // now behind a permanent redirect to the canonical review — and is
  // deliberately absent from every list surface (2026-08-06 cluster 1 + SHED-301).
  const liveIds = inputs.registry.programs.filter((program) => {
    const profile = program.profiles["glp-clinic-scout"];
    return program.commercial_state === "live" && profile?.vertical_fit === true && profile?.wired === true
      && profile.surfaces.review === true && profile.canonical_identity?.role !== "alias";
  });
  assert.equal(result.money_programs, liveIds.length);
  // OPERATOR MODEL 2026-08-13: conversion pools equal the live-eligible set.
  // trt-nation used to be the one program scoped out of the quiz pool, because
  // it was editorial_link_dark and a pool may not recommend what a reader cannot
  // act on. The 2026-08-18 content-fit lift made it live-eligible, so its
  // restriction exceptions were removed rather than left behind as a false
  // statement. The RULE is unchanged and still enforced here: a program may sit
  // outside a conversion pool only behind a written surface_restriction_basis.
  const conversionScopedIds = liveIds.filter((program) => {
    const exception = program.profiles["glp-clinic-scout"].exceptions?.quiz;
    return exception?.enabled === true && exception.surface_restriction_basis;
  });
  assert.deepEqual(conversionScopedIds.map((program) => program.program_id), []);
  for (const program of liveIds) {
    const profile = program.profiles["glp-clinic-scout"];
    for (const surface of ["quiz", "calculator"]) {
      if (profile.surfaces[surface] === true) continue;
      const exception = profile.exceptions?.[surface];
      assert.equal(exception?.enabled, true, `${program.program_id}:${surface}:undocumented_pool_absence`);
      assert.ok(String(exception.surface_restriction_basis || "").trim(), `${program.program_id}:${surface}:basis_missing`);
    }
  }
  assert.equal(result.quiz_candidates, liveIds.length - conversionScopedIds.length);
  // 38 -> 35 on 2026-08-17: the three Katalys-paused programs' review pages.
  // 37 -> 34 on 2026-08-18: the three niche-fit review pages (Paternity Lab,
  // Advanced Trichology, LyfeFuel) came off this site by operator ruling.
  assert.equal(result.review_pages, 59); // 2026-08-27 live-head merge: +nu-image
  assert.equal(result.live_money_programs, liveIds.length);
  // measured left the live fast-path set on 2026-08-13 (operator rejected the
  // Awin 126727 terms) and REJOINED it on 2026-08-31 when he rescinded that in
  // his own words. 39 -> 40, and no contract is held any more: its /go authority
  // is still withheld, so it is live on the provider-issued DIRECT link.
  const contracts = await readJson('data/provider-page-contracts.json');
  const registryLive = new Set(inputs.registry.programs.filter(p => p.commercial_state === 'live').map(p => p.program_id));
  const liveContracts = contracts.providers.filter(p => registryLive.has(p.program_id));
  assert.ok(liveContracts.length > 0);
  assert.equal(result.live_fastpath_programs, liveContracts.length);
  assert.deepEqual(result.held_contract_programs.sort(), contracts.providers.filter(p => !registryLive.has(p.program_id)).map(p => p.program_id).sort());
  assert.deepEqual(result.held_contract_programs, ['pallas-health-review', 'telos-rx']);
});

test("hostile omission of a required compare surface fails closed", async () => {
  const inputs = await loadFixture();
  inputs.money.pages = inputs.money.pages.map((page) => ({
    ...page,
    rows: page.rows.filter((row) => row.program_id !== "found-health"),
  }));
  assert.throws(
    () => validateProgramCoverage(inputs),
    /coverage_missing:glp-clinic-scout:found-health:compare/,
  );
});

test("hostile omission of a required generated go entry fails closed", async () => {
  const inputs = await loadFixture();
  inputs.actual.goManifest = clone(inputs.actual.goManifest);
  inputs.actual.goManifest.programs = inputs.actual.goManifest.programs.filter((entry) => entry.program_id !== "found-health");
  inputs.actual.go = goSurfaceFromManifest(inputs.actual.goManifest, "glp-clinic-scout");
  inputs.actual.goRuntimeManifestText = renderGoRuntimeManifestModule(inputs.actual.goManifest);
  assert.throws(
    () => validateProgramCoverage(inputs),
    /coverage_missing:glp-clinic-scout:found-health:go/,
  );
});

test("runtime manifest byte drift fails closed", async () => {
  const inputs = await loadFixture();
  inputs.actual.goRuntimeManifestText += "// drift\n";
  assert.throws(
    () => validateProgramCoverage(inputs),
    /coverage_go_runtime_manifest_mismatch:glp-clinic-scout/,
  );
});

test("generated go manifest rejects wrong profile, duplicate ids, and route drift", () => {
  const valid = {
    schema: "affiliate-worker-staging-v3-registry",
    program_registry_schema: "site-program-registry-v1",
    site_profile: "glp-clinic-scout",
    programs: [{ program_id: "found-health", route: "/go/found-health" }],
  };
  assert.deepEqual([...goSurfaceFromManifest(valid, "glp-clinic-scout")], ["found-health"]);
  assert.throws(
    () => goSurfaceFromManifest({ ...valid, site_profile: "other" }, "glp-clinic-scout"),
    /coverage_go_manifest_invalid:glp-clinic-scout/,
  );
  assert.throws(
    () => goSurfaceFromManifest({ ...valid, programs: [...valid.programs, ...valid.programs] }, "glp-clinic-scout"),
    /coverage_go_manifest_entry_invalid:glp-clinic-scout:found-health/,
  );
  assert.throws(
    () => goSurfaceFromManifest({ ...valid, programs: [{ program_id: "found-health", route: "/go/wrong" }] }, "glp-clinic-scout"),
    /coverage_go_manifest_entry_invalid:glp-clinic-scout:found-health/,
  );
});

test("exception flags fail when the reason is empty", async () => {
  const inputs = await loadFixture();
  inputs.registry = clone(inputs.registry);
  // Picks whichever program currently carries a written exception rather than
  // naming one: this used to hard-code trt-nation, and the 2026-08-18 lift
  // removed its exceptions, which silently turned a hostile test into a crash
  // instead of a check. The rule under test belongs to no particular program.
  const withException = inputs.registry.programs.find((program) => {
    const exceptions = program.profiles["glp-clinic-scout"]?.exceptions || {};
    return Object.values(exceptions).some((exception) => exception?.enabled === true);
  });
  assert.ok(withException, "no registry row carries a written surface exception to test");
  const surface = Object.keys(withException.profiles["glp-clinic-scout"].exceptions)
    .find((key) => withException.profiles["glp-clinic-scout"].exceptions[key]?.enabled === true);
  withException.profiles["glp-clinic-scout"].exceptions[surface].reason = "  ";
  assert.throws(
    () => validateProgramCoverage(inputs),
    new RegExp(`coverage_exception_reason_missing:glp-clinic-scout:${withException.program_id}:${surface}`),
  );
});

test("surface derivation is profile-keyed and rejects unknown sister profiles", async () => {
  const inputs = await loadFixture();
  const surfaces = deriveProfileSurfaceSets(inputs.registry, "glp-clinic-scout");
  assert.ok(surfaces.review.has("mademed"));
  assert.ok(surfaces.review.has("trt-nation"));
  assert.ok(surfaces.compare.has("found-health"));
  assert.ok(surfaces.compare.has("mademed"));
  // katalys-1518 (Breeze Meds) was paused by Katalys on 2026-08-17 and is out of
  // the registry entirely, so it must claim no surface at all.
  assert.equal(surfaces.review.has("katalys-1518"), false);
  for (const id of ["awin-128761", "katalys-1286", "katalys-647", "katalys-1304", "katalys-1516"]) {
    assert.equal(surfaces.review.has(id), true);
    // SHED-301: the katalys-1516 alias review route is a permanent redirect and
    // leaves the sitemap; every other READY6 route stays sitemap-listed.
    assert.equal(surfaces.sitemap.has(id), id !== "katalys-1516");
    assert.equal(surfaces.go.has(id), id !== 'katalys-1516');
    if (id !== 'katalys-1516') {
      const selected = loadGoSelection(root).programs[id];
      assert.equal(selected.status, 'VERIFIED');
      assert.equal(GO_RUNTIME_MANIFEST.programs[selected.render_id].tracking.base_url, selected.issued_link);
    }
  }
  assert.throws(() => deriveProfileSurfaceSets(inputs.registry, "unknown-sister"), /site_profile_unknown:unknown-sister/);
});

test("network program identity is decoupled from exact brand review and go slugs", async () => {
  const registry = await readJson("data/program-registry.json");
  const expected = new Map([
    ["awin-128761", "coivas"],
    ["katalys-1286", "sprout-health"],
    ["katalys-647", "mangorx"],
    ["katalys-1304", "direct-meds"],
    ["katalys-1516", "shed"],
  ]);
  // katalys-1518 -> breezemeds was here until Katalys paused the program on
  // 2026-08-17; the row is gone, so the identity mapping must be gone too.
  assert.equal(registry.programs.some((row) => row.program_id === "katalys-1518"), false);
  for (const [programId, slug] of expected) {
    const program = registry.programs.find((row) => row.program_id === programId);
    assert.equal(program.review_slug, slug);
    assert.equal(program.review_path, `/reviews/${slug}/`);
    assert.equal(program.go.route, `/go/${slug}`);
  }

  const hostile = clone(registry);
  const row = hostile.programs.find((program) => program.program_id === "awin-128761");
  row.review_slug = row.program_id;
  row.review_path = `/reviews/${row.program_id}/`;
  row.go.route = `/go/${row.program_id}`;
  assert.throws(
    () => deriveProfileSurfaceSets(hostile, "glp-clinic-scout"),
    /coverage_network_id_review_slug_forbidden:glp-clinic-scout:awin-128761:awin-128761/,
  );
});
