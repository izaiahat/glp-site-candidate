import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { upgradePhase3PageVisuals } from "../src/pass2-page-visual-upgrades.mjs";

const graph = JSON.parse(await readFile(new URL("../data/phase3-page-graph.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../data/program-registry.json", import.meta.url), "utf8"));

test("phase3 visual upgrader wires governed provider and product visual families", () => {
  const program = registry.programs[0];
  const provider = upgradePhase3PageVisuals('<main><section class="p3-index-hero"><h1>Provider</h1></section></main>', { family: "provider-detail", route: `/providers/${program.program_id}/`, graph, registry });
  assert.match(provider, /p3-index-hero--visual/);
  assert.match(provider, new RegExp(`data-provider-visual="${program.program_id}"`));
  const addition = graph.provider_work_order_additions[0];
  const addedProvider = upgradePhase3PageVisuals('<main><section class="p3-index-hero"><h1>Added provider</h1></section></main>', { family: "provider-detail", route: `/providers/${addition.program_id}/`, graph, registry });
  assert.match(addedProvider, new RegExp(`data-provider-visual="${addition.program_id}"`));

  const brandPage = graph.brand_pages[0];
  const brand = upgradePhase3PageVisuals('<main><section class="p3-product-hero"><picture class="p3-product-float"><img src="old.jpg"></picture></section></main>', { family: "brand-product", route: brandPage.route, graph, registry });
  assert.match(brand, new RegExp(`data-product-visual="brand-${brandPage.slug}"`));
  assert.doesNotMatch(brand, /old\.jpg/);

  const compoundedPage = graph.compounded_pages[0];
  const compounded = upgradePhase3PageVisuals('<main><section class="p3-category-hero"><div>Copy</div><div class="p3-category-orb" aria-hidden="true"></div></section></main>', { family: "compounded-category", route: compoundedPage.route, graph, registry });
  assert.match(compounded, new RegExp(`data-product-visual="compounded-${compoundedPage.medication_id}"`));
  assert.doesNotMatch(compounded, /p3-category-orb/);

  const bulkPage = graph.bulk_pages[0];
  const nonpriced = '<section data-unpublished-provider-section><h2>Records without a comparable price</h2><article data-phase3-provider data-program="fixture-source-backed" data-price=""><p>No comparable price is published.</p><a href="/reviews/fixture-source-backed/">Read review</a><noscript><p>The source-backed record remains accessible.</p></noscript></article></section>';
  const empty = '<section data-listing-results><div data-phase3-provider-grid></div><p data-filter-empty>No comparable price matches those filters.</p></section>';
  const bulkInput = '<main class="listing"><header class="listing__intro"><h1>Bulk</h1><p class="listing__support"><span class="listing__count" data-filter-result>0 comparable price results</span></p></header>' + empty + nonpriced + '</main>';
  const bulk = upgradePhase3PageVisuals(bulkInput, { family: "bulk-intent", route: bulkPage.route, graph, registry });
  assert.match(bulk, /<header class="listing__intro listing__intro--bulk-visual">/);
  assert.match(bulk, new RegExp(`data-product-visual="bulk-${bulkPage.duration_months}-month"`));
  assert.match(bulk, /data-filter-result>0 comparable price results<\/span>/);
  assert.equal((bulk.match(/data-filter-result/g) || []).length, 1, 'one live supporting-line count');
  assert.match(bulk, /listing__support[^]*?data-filter-result[^]*?<\/header>/);
  assert.ok(bulk.includes(empty), 'empty numeric section is preserved verbatim');
  assert.ok(bulk.includes(nonpriced), 'separate nonpriced record, action and no-JS content are preserved verbatim');
  assert.ok(bulk.indexOf(nonpriced) > bulk.indexOf(empty) + empty.length - 1);
  assert.throws(() => upgradePhase3PageVisuals('<main><section class="p3-bulk-hero"><h1>Bulk</h1></section></main>', { family: "bulk-intent", route: bulkPage.route, graph, registry }), /pass2_bulk_visual_hero_missing/);
});

test("phase3 visual upgrader leaves unrelated families byte-identical", () => {
  const html = '<main><section>Unrelated</section></main>';
  assert.equal(upgradePhase3PageVisuals(html, { family: "pharmacy-detail", route: "/pharmacies/example/", graph, registry }), html);
});
