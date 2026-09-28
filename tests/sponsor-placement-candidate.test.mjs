import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSponsorPlacementCandidate, SPONSOR_CANDIDATE_ROUTE, SPONSOR_CANDIDATE_SLOT } from "../src/sponsor-placement-candidate.mjs";

const graph = readFileSync(new URL("../src/phase3-page-graph.mjs", import.meta.url), "utf8");
const preview = readFileSync(new URL("../reports/glp327/preview.html", import.meta.url), "utf8");
test("nonproduction /providers/ slot is opt-in and separate from organic results", () => {
  assert.equal(SPONSOR_CANDIDATE_ROUTE, "/providers/");
  assert.equal(SPONSOR_CANDIDATE_SLOT, "after provider filters, before organic results");
  for (const route of ["/", "/self-pay/", "/wegovy/", "/pharmacies/"]) assert.equal(renderSponsorPlacementCandidate(route, { preview: true }), "");
  assert.equal(renderSponsorPlacementCandidate("/providers/"), "");
  const section = renderSponsorPlacementCandidate("/providers/", { preview: true });
  assert.match(section, /Advertisement · paid placement/);
  assert.match(section, /payment for this space will not change the order/);
  assert.doesNotMatch(section, /<a\b|href=|data-phase3-provider|data-program=|data-rank=|ItemList|\$\d+/);
  assert.match(graph, /<\/header>\$\{filterControls\}\$\{renderSponsorPlacementCandidate\(route, \{ preview: process\.env\.GLP327_SPONSOR_PLACEMENT_PREVIEW === "1" \}\)\}\$\{panel\}<section id="provider-results"/);
  assert.match(graph, /providers\.sort\(\(a, b\) => price\(a\) - price\(b\)/);
});
test("view-only exhibit keeps captured organic card order outside sponsor", () => {
  assert.equal((preview.match(/data-sponsor-placement-candidate/g) || []).length, 1);
  assert.ok(preview.indexOf("data-sponsor-placement-candidate") < preview.indexOf('id="provider-results"'));
  assert.ok(preview.indexOf('data-program="snagrx"') < preview.indexOf('data-program="yucca-health-xentraffic-offer-3117"'));
  assert.equal((preview.match(/\sdata-phase3-provider(?=\s)/g) || []).length, 2);
  for (const price of ["$99", "$149", "$146", "$258"]) assert.ok(preview.includes(`<strong>${price}</strong>`), `captured ${price} remains`);
  assert.match(preview, /Advertisement · paid placement/);
  assert.match(preview, /Sources and checked dates/);
  assert.match(preview, /Not a full directory or launch preview/);
  assert.doesNotMatch(preview, /<a\b|<button\b|<form\b|<script\b|<iframe\b|<input\b/i);
});
