import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizePriceIndexBuild4Semantics } from "../src/price-index-semantic-preservation.mjs";

const page = ({ copy = "Protected price table", surface = "old", behavior = "old", version = "aaaaaaaaaaaaaaaa" } = {}) => `<!doctype html><main><h1>${copy}</h1><table><tr><td>$199</td></tr></table><aside class="panel" data-p1-capture-surface>${surface}</aside></main><script src="/assets/site.js?v=${version}"></script><script data-p1-content-upgrade>${behavior}</script>`;

test("Build 4 preservation permits the explicit PASS 2 opt-in surface migration", () => {
  const preserved = page({ surface: '<label><input type="checkbox" name="email_consent" required>Old consent</label>', behavior: "old checkbox behavior" });
  const generated = page({ surface: '<p class="capture-consent-note">Submitting is consent.</p>', behavior: "new passive consent behavior", version: "bbbbbbbbbbbbbbbb" });
  assert.equal(normalizePriceIndexBuild4Semantics(generated), normalizePriceIndexBuild4Semantics(preserved));
});

test("Build 4 preservation treats versioned analytics filenames as transport-only", () => {
  const preserved = page().replace("</main>", "</main><script src=\"/assets/analytics.js?v=aaaaaaaaaaaaaaaa\"></script>");
  const generated = page().replace("</main>", "</main><script src=\"/assets/analytics.b76e4da4f953494a.js\"></script>");
  assert.equal(normalizePriceIndexBuild4Semantics(generated), normalizePriceIndexBuild4Semantics(preserved));
});

test("Build 4 preservation remains strict for protected price-index content", () => {
  const preserved = page();
  const changedPrice = page().replace("$199", "$299");
  const changedCopy = page({ copy: "Changed price table" });
  assert.notEqual(normalizePriceIndexBuild4Semantics(changedPrice), normalizePriceIndexBuild4Semantics(preserved));
  assert.notEqual(normalizePriceIndexBuild4Semantics(changedCopy), normalizePriceIndexBuild4Semantics(preserved));
});

test("Build 4 preservation permits only marked shared-shell migration", () => {
  const oldShell = '<body><nav class="gcs-nav"><a href="/best/online-glp-1-providers/">Compare</a></nav><main><h1>Protected price table</h1><table><tr><td>$199</td></tr></table></main><footer class="gcs-footer"><a href="/guides/">Research</a></footer></body>';
  const pass2Shell = '<body><div class="cs-topstrip" aria-hidden="true"></div><nav class="gcs-nav"><a href="/providers/">Compare</a></nav><main><h1>Protected price table</h1><table><tr><td>$199</td></tr></table></main><footer class="gcs-footer"><a href="/insights/">Insights</a></footer></body>';
  assert.equal(normalizePriceIndexBuild4Semantics(pass2Shell), normalizePriceIndexBuild4Semantics(oldShell));
  assert.notEqual(
    normalizePriceIndexBuild4Semantics(pass2Shell.replace("$199", "$299")),
    normalizePriceIndexBuild4Semantics(oldShell),
  );
});

test("PASS 2 build writes the regenerated shell only after semantic comparison", async () => {
  const source = await readFile(new URL("../scripts/build-staging.mjs", import.meta.url), "utf8");
  assert.match(source, /const pass2ShellRefresh = true;/);
  assert.match(source, /if \(priceIndexRefresh \|\| pass2ShellRefresh\)/);
  assert.match(source, /stableSha256\(stripPriceIndexTransportHashes\(priceIndex\.manifest\)\)/);
});

test("Build 4 preservation permits date-label wording but not date drift", () => {
  const checked = page().replace("Protected price table", "Checked 2026-08-06");
  const current = page().replace("Protected price table", "Current as of 2026-08-06");
  const drifted = page().replace("Protected price table", "Current as of 2026-08-07");
  assert.equal(normalizePriceIndexBuild4Semantics(current), normalizePriceIndexBuild4Semantics(checked));
  assert.notEqual(normalizePriceIndexBuild4Semantics(drifted), normalizePriceIndexBuild4Semantics(checked));
});

test("Build 4 preservation permits only the declared retired-route migrations", () => {
  const oldLinks = page().replace("Protected price table", '<a href="/best/online-glp-1-providers/">Ranked</a><a href="/guides/">Research</a>');
  const newLinks = page().replace("Protected price table", '<a href="/providers/">Ranked</a><a href="/insights/">Research</a>');
  const wrongLink = page().replace("Protected price table", '<a href="/tools/">Ranked</a><a href="/insights/">Research</a>');
  assert.equal(normalizePriceIndexBuild4Semantics(newLinks), normalizePriceIndexBuild4Semantics(oldLinks));
  assert.notEqual(normalizePriceIndexBuild4Semantics(wrongLink), normalizePriceIndexBuild4Semantics(oldLinks));
});

test("Build 4 preservation does not hide a removed or newly injected opt-in surface", () => {
  const preserved = page();
  const removed = preserved.replace(/<aside[\s\S]*?<\/aside>/, "");
  assert.notEqual(normalizePriceIndexBuild4Semantics(removed), normalizePriceIndexBuild4Semantics(preserved));
});
