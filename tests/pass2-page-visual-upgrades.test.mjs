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
  const bulk = upgradePhase3PageVisuals('<main><section class="p3-bulk-hero"><h1>Bulk</h1></section></main>', { family: "bulk-intent", route: bulkPage.route, graph, registry });
  assert.equal(bulk, '<main><section class="p3-bulk-hero"><h1>Bulk</h1></section></main>');
  assert.doesNotMatch(bulk, /data-product-visual|p3-bulk-hero--visual/);
});

test("phase3 visual upgrader leaves unrelated families byte-identical", () => {
  const html = '<main><section>Unrelated</section></main>';
  assert.equal(upgradePhase3PageVisuals(html, { family: "pharmacy-detail", route: "/pharmacies/example/", graph, registry }), html);
});
