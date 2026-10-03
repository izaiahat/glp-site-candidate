import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSponsorPlacementCandidate, SPONSOR_CANDIDATE_ROUTE, SPONSOR_CANDIDATE_SLOT } from "../src/sponsor-placement-candidate.mjs";

const graph = readFileSync(new URL("../src/phase3-page-graph.mjs", import.meta.url), "utf8");
const build = readFileSync(new URL("../scripts/build-staging.mjs", import.meta.url), "utf8");
test("nonproduction /providers/ slot is opt-in and separate from organic results", () => {
  assert.equal(SPONSOR_CANDIDATE_ROUTE, "/providers/");
  assert.equal(SPONSOR_CANDIDATE_SLOT, "after provider filters, before organic results");
  for (const route of ["/", "/self-pay/", "/wegovy/", "/pharmacies/"]) assert.equal(renderSponsorPlacementCandidate(route, { preview: true }), "");
  assert.equal(renderSponsorPlacementCandidate("/providers/"), "");
  const section = renderSponsorPlacementCandidate("/providers/", { preview: true });
  assert.match(section, /<span class="p3-chip p3-chip--status">Sponsored<\/span>/);
  assert.match(section, /Payment buys advertising space, not a recommendation or rank/);
  assert.doesNotMatch(section, /<a\b|href=|data-phase3-provider|data-program=|data-rank=|ItemList|\$\d+/);
  // Switch on: the preview composition. Switch off: the original composition.
  assert.match(graph, /const sponsorSlot = renderSponsorPlacementCandidate\(route, \{ preview: process\.env\.GLP327_SPONSOR_PLACEMENT_PREVIEW === "1" \}\);/);
  assert.match(graph, /data-sponsor-preview-intro><h1 data-state-heading data-state-title-template="Compare providers in \{state\}">Compare providers<\/h1>/);
  assert.match(graph, /\$\{filterControls\}\$\{sponsorSlot\}<div data-sponsor-preview-results-lead>/);
  assert.match(graph, /\$\{leadDisclosure\}\$\{registryScope\}\$\{atfPreview\}<\/div>\$\{panel\}\$\{results\}`/);
  assert.match(graph, /: `<header class="\$\{introClass\}">\$\{introHead\}\$\{registryScope\}\$\{leadDisclosure\}\$\{atfPreview\}<\/header>\$\{filterControls\}\$\{panel\}\$\{results\}`;/);
  assert.match(graph, /controls = providerHubControls\(providers, doseCapture, \{ compact: sponsorPreviewActive\(route\) \}\);/);
  assert.match(graph, /providers\.sort\(\(a, b\) => price\(a\) - price\(b\)/);
});
test("sponsor pages are built only behind the preview switch, noindex, through the shared shell", () => {
  const block = build.slice(build.indexOf('if (process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW === "1") {'));
  assert.ok(block.length > 0 && block.indexOf("}") > 0);
  const gated = block.slice(0, block.indexOf("\n  }\n"));
  assert.match(gated, /write\("sponsors\/rates\/index\.html", setRobots\(addSharedRuntime\(renderRateCard\(\)\), SPONSOR_ROBOTS\)\)/);
  assert.match(gated, /write\("sponsors\/example-provider\/index\.html", setRobots\(addSharedRuntime\(renderPromo\(\)\), SPONSOR_ROBOTS\)\)/);
  assert.equal((build.match(/sponsors\/rates\/index\.html/g) || []).length, 1, "not referenced by sitemap, nav or search index");
  assert.match(build, /\/\^\\\/\(\?:providers\|pharmacies\|sponsors\)\\\/\/\.test\(route\)/, "sponsor routes load site-p3.css like provider pages");
});
test("/providers/ captures finalize copy tokens through the build's registry-derived count path", async () => {
  // Reviewer defect (PR #20 at 26b0f80): the scoped /providers/ capture printed
  // the literal {{LIVE_PROVIDER_COUNT}}. The capture must use main()'s own
  // derivation and resolveDerivedCounts (with its tally gate), never a typed count.
  const { deriveLiveProviders, resolveDerivedCounts } = await import("../scripts/build-staging.mjs");
  const { projectProviderDisplayLedger } = await import("../src/provider-display-evidence.mjs");
  const graphModule = await import("../src/phase3-page-graph.mjs");
  const { loadGoPromotionAuthority } = await import("../src/go-runtime-selection.mjs");
  const json = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
  const programRegistry = json("program-registry.json");
  const ledgerPrograms = structuredClone(json("program-content-ledger.json").programs).map((row) => projectProviderDisplayLedger(row));
  const count = deriveLiveProviders(programRegistry, ledgerPrograms).liveProgramCount;
  assert.ok(Number.isInteger(count) && count > 0);
  assert.match(build, /const \{ providerIdentity, liveRegistryRows, liveAliasRows, liveProgramCount \} = deriveLiveProviders\(programRegistry, contentLedger\.programs\);/, "main() uses the same derivation");
  assert.match(build, /derivedTallies\.LIVE_PROVIDER_COUNT = liveProgramCount;/);
  const graph = json("phase3-page-graph.json");
  const listing = graphModule.renderConfiguredListing("E", { route: "/providers/", slug: "providers", name: "Compare weight loss providers" }, {
    graph, pharmacyInput: json("phase3-pharmacy-render-input.json"), pricingMatrix: json("provider-pricing-matrix.json"), registry: graphModule.phase3Registry(graph, programRegistry), coupons: {},
    doseCapture: graphModule.loadPass2DoseCapture(), logoManifest: graphModule.loadProviderLogoManifest(), articles: [], goAuthority: loadGoPromotionAuthority(),
  });
  assert.ok(listing.includes("{{LIVE_PROVIDER_COUNT}}"), "renderer emits the token; finalization owns the number");
  const finalized = resolveDerivedCounts(listing, "providers/index.html", { LIVE_PROVIDER_COUNT: count });
  assert.doesNotMatch(finalized, /\{\{[A-Z_]+\}\}/);
  assert.ok(finalized.includes(`We track <span data-live-provider-count>${count}</span> providers in total.`));
  assert.throws(() => resolveDerivedCounts(listing, "providers/index.html", {}), /tally_not_derived_yet:LIVE_PROVIDER_COUNT/);
  const capture = readFileSync(new URL("../scripts/glp327-capture.mjs", import.meta.url), "utf8");
  assert.match(capture, /tallies\.LIVE_PROVIDER_COUNT = deriveLiveProviders\(programRegistry, ledgerPrograms\)\.liveProgramCount;/);
  assert.match(capture, /"\/providers\/": finalize\("providers\/index\.html", addSharedRuntime\(/);
  assert.match(capture, /if \(dom\.unresolvedTokens\.length\) failures\.push\("unresolved build token"\);/);
  const result = JSON.parse(readFileSync(new URL("../reports/ops/sponsor-clean-layout-20261003/captures/CAPTURE.json", import.meta.url), "utf8"));
  assert.equal(result.status, "PASS");
  assert.ok(Number.isInteger(result.finalizedTallies?.LIVE_PROVIDER_COUNT));
  for (const check of result.checks) assert.deepEqual(check.dom.unresolvedTokens, [], `${check.surface} ${check.viewport}`);
});
