import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { productVisualId, renderProductComparisonPicture } from "../src/pass2-product-visuals.mjs";

const graph = JSON.parse(await readFile(new URL("../data/phase3-page-graph.json", import.meta.url), "utf8"));

test("every Pass 2 product route maps to one responsive original visual family", async () => {
  const rows = [
    ...graph.brand_pages.map((page) => [page, "brand"]),
    ...graph.compounded_pages.map((page) => [page, "compounded"]),
    ...graph.bulk_pages.map((page) => [page, "bulk"]),
  ];
  assert.equal(rows.length, 9);
  const ids = rows.map(([page, family]) => productVisualId(page, family));
  assert.equal(new Set(ids).size, 9);
  for (const [page, family] of rows) {
    const html = renderProductComparisonPicture(page, family);
    assert.match(html, /<picture class="p3-product-visual"/);
    const mobileWidth = page.slug === "wegovy" && family === "brand" ? 384 : 640;
    assert.match(html, new RegExp(`<source media="\\(max-width:760px\\)" srcset="[^\\s]+-${mobileWidth}\\.avif" type="image\\/avif">`));
    assert.match(html, /640\.avif 640w, [^\s]+-1280\.avif 1280w/);
    assert.match(html, new RegExp(`<source media="\\(max-width:760px\\)" srcset="[^\\s]+-${mobileWidth}\\.webp" type="image\\/webp">`));
    assert.ok(html.indexOf(`-${mobileWidth}.webp" type="image/webp">`) < html.indexOf(`-${mobileWidth}.avif" type="image/avif">`), "smaller, faster-decoding mobile WebP must be offered first");
    assert.match(html, /640\.webp 640w, [^\s]+-1280\.webp 1280w/);
    assert.match(html, /width="1280" height="720"/);
    assert.match(html, /loading="eager" fetchpriority="high" decoding="async"/);
    assert.match(html, /alt="Original editorial comparison scene for the /);
  }
  for (const extension of ["avif", "webp", "jpg"]) {
    const bytes = await readFile(new URL(`../assets/derivatives/product-comparison-pass2/brand-wegovy-384.${extension}`, import.meta.url));
    assert.ok(bytes.length > 0, `missing Wegovy 384px ${extension} derivative`);
  }
});
