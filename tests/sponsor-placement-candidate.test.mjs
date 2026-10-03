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
  assert.match(graph, /<\/header>\$\{filterControls\}\$\{renderSponsorPlacementCandidate\(route, \{ preview: process\.env\.GLP327_SPONSOR_PLACEMENT_PREVIEW === "1" \}\)\}\$\{panel\}<section id="provider-results"/);
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
