import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

test("Pass 5 publishes one canonical dark comparison router with both decision paths", async () => {
  const [html, sitemap, searchIndex] = await Promise.all([
    read("public/compare/index.html"),
    read("public/sitemap.xml"),
    read("public/assets/search-index.json"),
  ]);
  assert.match(html, /<link rel="canonical" href="https:\/\/glpclinicscout\.com\/compare\/">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.match(html, /class="p3-page p5-compare-page"/);
  assert.match(html, /Medication first/);
  assert.match(html, /Provider first/);
  assert.match(html, /Compare all live providers/);
  assert.match(html, /site-p3\.css\?v=/);
  assert.match(sitemap, /<loc>https:\/\/glpclinicscout\.com\/compare\/<\/loc>/);
  assert.equal(JSON.parse(searchIndex).entries.some((entry) => entry.url === "/compare/"), true);
});

test("Pass 5 comparison router keeps all seven medication intents distinct", async () => {
  const html = await read("public/compare/index.html");
  const hrefs = [
    "/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&amp;form=COMPOUNDED&amp;sort=cheapest",
    "/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&amp;form=COMPOUNDED&amp;sort=cheapest",
    "/wegovy-pill/?drug=WEGOVY_PILL&amp;form=COMPOUNDED&amp;sort=cheapest",
    "/ozempic/?drug=OZEMPIC&amp;form=BRAND_NAME&amp;sort=cheapest",
    "/wegovy/?drug=WEGOVY&amp;form=BRAND_NAME&amp;sort=cheapest",
    "/mounjaro/?drug=MOUNJARO&amp;form=BRAND_NAME&amp;sort=cheapest",
    "/zepbound/?drug=ZEPBOUND&amp;form=BRAND_NAME&amp;sort=cheapest",
  ];
  for (const href of hrefs) assert.ok(html.includes(`href="${href}"`), href);
  assert.equal(new Set(hrefs).size, 7);
});