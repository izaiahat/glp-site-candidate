import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { javascriptProviderMarkup } from "./helpers/d2p-noscript.mjs";
const source = await readFile(new URL("../src/phase3-page-graph.mjs", import.meta.url), "utf8");
const start = source.indexOf("function renderBrandPage(");
const end = source.indexOf("function renderCompoundedPage(", start);
const brand = source.slice(start, end);
test("F03 every deferred body has a no-JS twin, regardless of shell visibility", async () => {
  assert.match(brand, /if \(page\.slug !== "wegovy"\) return fullCard;/);
  for (const route of ["wegovy", "providers", "mounjaro"]) {
    const html = await readFile(new URL(`../public/${route}/index.html`, import.meta.url), "utf8");
    const projected = javascriptProviderMarkup(html);
    const shells = [...projected.matchAll(/<article\b[^>]*data-provider-lazy-index="\d+"[^>]*>/g)];
    const twins = [...html.matchAll(/<noscript>\s*<article\b[^>]*data-provider-noscript-card[^>]*>/g)];
    assert.equal(twins.length, shells.length, route + ": exactly one twin per deferred shell");
    if (route === "wegovy") {
      assert.deepEqual(shells.map(x => x[0].match(/data-program="([^"]+)"/)[1]), ["futurhealth-wegovy-pillform"], 'S30 removed unsupported rxspan/orderly pricing; their directory identities remain eligible');
      assert.ok(shells.every(x => !/\shidden(?=[\s>])/.test(x[0])));
    }
    if (route === "mounjaro") assert.equal(twins.length, 0, "server-rendered bodies have no twin");
  }
});
test("F03 rejects missing, duplicate, orphaned or placeholder-only no-JS bodies", () => {
  const body = '<p>Reported information</p><a data-provider-card-contract="option-c" href="/reviews/example/">Read review</a>';
  for (const hidden of ["", " hidden"]) {
    const shell = `<article data-program="example"${hidden} data-provider-lazy-index="0"><p data-provider-lazy-placeholder>Example</p></article>`;
    const twin = `<noscript><article data-program="example" data-provider-noscript-card>${body}</article></noscript>`;
    assert.equal(javascriptProviderMarkup(twin + shell), shell);
    assert.throws(() => javascriptProviderMarkup(shell));
    assert.throws(() => javascriptProviderMarkup(twin + twin + shell));
    assert.throws(() => javascriptProviderMarkup(twin + '<article data-program="example">' + body + '</article>'));
    assert.throws(() => javascriptProviderMarkup(twin.replace(body, '<p data-provider-lazy-placeholder>Example</p>') + shell));
  }
});
