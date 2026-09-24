import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");
const [builder, runtime, home, wegovy, pill] = await Promise.all([
  read("scripts/build-staging.mjs"),
  read("assets/site.js"),
  read("public/index.html"),
  read("public/wegovy/index.html"),
  read("public/wegovy-pill/index.html"),
]);

const destinations = [
  "/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest",
  "/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest",
  "/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest",
  "/ozempic/?drug=OZEMPIC&form=BRAND_NAME&sort=cheapest",
  "/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest",
  "/mounjaro/?drug=MOUNJARO&form=BRAND_NAME&sort=cheapest",
  "/zepbound/?drug=ZEPBOUND&form=BRAND_NAME&sort=cheapest",
];

const htmlHref = (href) => `href="${href.replaceAll("&", "&amp;")}"`;

test("Pass 5 keeps the seven operator-mapped medication destinations canonical", () => {
  assert.match(builder, /const PASS5_MEDICATION_DESTINATIONS = Object\.freeze/);
  for (const href of destinations) {
    assert.ok(builder.includes(`"${href}"`), `builder is missing ${href}`);
    assert.ok(home.includes(htmlHref(href)), `home is missing ${href}`);
  }
});

test("Pass 5 price choices move the CTA to the selected medication destination", () => {
  assert.match(home, /data-price-choice[^>]+data-price-href=/);
  assert.match(home, /data-price-destination/);
  assert.match(runtime, /destination\.href = choice\.dataset\.priceHref/);
  const priceRegion = home.match(/<section class="cs-home2-section cs-home2-pricing"[\s\S]*?<\/section>/)?.[0] || "";
  assert.doesNotMatch(priceRegion, /data-price-destination href="\/providers\/"/);
});

test("Pass 5 medication family tabs preserve drug, form, and cheapest-sort intent", () => {
  assert.ok(wegovy.includes(htmlHref("/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest")));
  assert.ok(wegovy.includes(htmlHref("/ozempic/?drug=OZEMPIC&form=BRAND_NAME&sort=cheapest")));
  assert.ok(pill.includes(htmlHref("/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest")));
});
