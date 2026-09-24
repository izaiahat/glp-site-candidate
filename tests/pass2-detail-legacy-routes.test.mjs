import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReady6ReviewModels,
  loadReady6EditorialInputs,
  renderReady6ReviewPage,
} from "../src/ready6-editorial.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const LEGACY = ["coivas", "direct-meds", "mangorx", "sprout-health"];

test("PASS 2 legacy review routes render with the current review anatomy", async () => {
  const inputs = await loadReady6EditorialInputs(ROOT);
  const models = buildReady6ReviewModels(inputs);
  const byRoute = new Map(models.map((model) => [model.route, model]));

  for (const slug of LEGACY) {
    const route = `/reviews/${slug}/`;
    const model = byRoute.get(route);
    assert.ok(model, `${route} remains in the governed READY6 set`);
    const html = renderReady6ReviewPage(model);

    assert.ok(html.includes(`<link rel="canonical" href="https://glpclinicscout.com${route}">`));
    assert.match(html, /<html lang="en" data-release="release-ready">/);
    assert.match(html, /<body data-cs-template="review">/);
    assert.match(html, /class="gcs-nav"/);
    assert.doesNotMatch(html, /class="cs-drawer"/);
    assert.match(html, /class="breadcrumbs"/);
    assert.match(html, /ready6-provider-mark provider-logo provider-logo--wordmark/);
    assert.match(html, /class="ready6-jump-nav"/);
    assert.match(html, /id="bottom-line"/);
    assert.match(html, /id="pricing"/);
    assert.match(html, /id="score-rubric"/);
    assert.match(html, /class="site-footer ready6-trust-footer"/);
    assert.equal((html.match(/<script\b/g) || []).length, 1);
    assert.match(html, /<script type="application\/ld\+json">/);
    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /logo-mark\.svg/);
    assert.doesNotMatch(html, /<div class="topbar">/);
    assert.doesNotMatch(html, /\b\d+(?:\.\d+)?\/5 from \d+ reviews\b/i);
  }
});
