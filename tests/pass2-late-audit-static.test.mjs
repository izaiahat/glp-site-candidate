import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { applyWave2P1Surfaces } from "../src/wave2-p1-surfaces.mjs";
import {
  buildReady6ReviewModels,
  loadReady6EditorialInputs,
  renderReady6ReviewPage,
} from "../src/ready6-editorial.mjs";

const ROOT = new URL("../", import.meta.url);
const LEGACY_REVIEW_ROUTES = [
  "/reviews/coivas/",
  "/reviews/direct-meds/",
  "/reviews/mangorx/",
  "/reviews/sprout-health/",
];

const legacyCaptureFixture = `<!doctype html><html><head><link rel="canonical" href="https://glpclinicscout.com/guides/mounjaro-coupon/"></head><body><main><form action="/api/content-upgrade" method="post" data-content-upgrade-form-inline><input type="hidden" name="source_page" value="guides-mounjaro-coupon"><input type="hidden" name="lead_magnet_key" value="guides-mounjaro-coupon-terms-checklist"><input type="hidden" name="consent_version" value="glp-content-upgrade-v2-20260801"><label>Email<input type="email" name="email" required></label><label class="capture-consent"><input type="checkbox" name="email_consent" value="true" required><span>Email me this checklist under the <a href="/privacy/">Privacy Policy</a>. Unsubscribe anytime.</span></label><button type="submit">Email me the checklist</button><label class="capture-honeypot" aria-hidden="true">Leave blank<input type="text" name="company" tabindex="-1"></label></form></main><script>const payload=Object.fromEntries(new FormData(form).entries());</script></body></html>`;

test("O-28 normalizes preserved and inline email capture without losing passive consent metadata", () => {
  const output = applyWave2P1Surfaces(legacyCaptureFixture, "guides/mounjaro-coupon/index.html");
  assert.doesNotMatch(output, /<input\b(?=[^>]*type=["']checkbox["'])(?=[^>]*name=["'](?:email_consent|marketing_consent|privacy_consent|subscribe_consent)["'])/i);
  assert.match(output, /name="source_page" value="guides-mounjaro-coupon"/);
  assert.match(output, /name="consent_version" value="glp-content-upgrade-v2-20260801"/);
  assert.match(output, /class="capture-honeypot"[\s\S]*?name="company"/);
  assert.match(output, /class="capture-consent-note"[\s\S]*?href="\/privacy\/"[\s\S]*?Unsubscribe anytime/);
  assert.match(output, /payload\.email_consent='true'/);
  assert.equal(applyWave2P1Surfaces(output, "guides/mounjaro-coupon/index.html"), output, "normalization must be idempotent");
});

test("G-1 shared-interactive READY6 mode yields shell-ready bodies and retains governed evidence", async () => {
  const inputs = await loadReady6EditorialInputs(ROOT);
  const models = buildReady6ReviewModels(inputs);
  const byRoute = new Map(models.map((model) => [model.route, model]));

  for (const route of LEGACY_REVIEW_ROUTES) {
    const model = byRoute.get(route);
    assert.ok(model, `${route}: governed model missing`);
    const html = renderReady6ReviewPage(model, new Set(), { shell: "shared-interactive" });
    assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${route}">`));
    assert.doesNotMatch(html, /<body[^>]*data-cs-template=/, `${route}: shared wrapper must own the body template marker`);
    assert.doesNotMatch(html, /class="gcs-nav"|class="cs-drawer"/, `${route}: renderer must not duplicate shared chrome`);
    assert.match(html, /<style data-preserve data-ready6-review>/);
    assert.match(html, /class="ready6-provider-mark provider-logo provider-logo--wordmark"/);
    assert.match(html, /class="ready6-jump-nav"/);
    assert.match(html, /id="bottom-line"/);
    assert.match(html, /id="pricing"/);
    assert.match(html, /id="score-rubric"/);
    assert.match(html, /id="sources"/);
    assert.match(html, /Affiliate disclosure:/);
    assert.ok(model.page.bottom_line.length > 40 && html.includes(model.page.bottom_line.replaceAll("&", "&amp;").replaceAll("'", "&#39;")), `${route}: owned bottom-line copy missing`);
  }
});

test("O-17 READY6 network IDs resolve canonical provider logos before wordmark fallback", async () => {
  const inputs = await loadReady6EditorialInputs(ROOT);
  const models = buildReady6ReviewModels(inputs);
  const coivas = models.find((model) => model.registry_id === "awin-128761");
  assert.ok(coivas, "Coivas READY6 model missing");
  const html = renderReady6ReviewPage(coivas, new Set(), {
    shell: "shared-interactive",
    logoByRegistryId: {
      "awin-128761": {
        path: "/assets/provider-logos/coivas.svg",
        alt: "Coivas logo",
        width: 504,
        height: 111,
        treatment: "light-chip",
        content_scale: 1,
        runtime_remote_load: false,
      },
    },
  });
  assert.match(html, /class="ready6-provider-mark provider-logo provider-logo--light"/);
  assert.match(html, /<img src="\/assets\/provider-logos\/coivas\.svg" alt="Coivas logo" width="504" height="111"/);
  assert.doesNotMatch(html, /ready6-provider-mark provider-logo provider-logo--wordmark/);
});

test("G08a source contract refuses organic medication alias collisions and retains D36 replay entrances", async () => {
  const build = await readFile(new URL("../scripts/build-staging.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(build, /redirectMap\.set\("\/(?:semaglutide|tirzepatide)\/"/);
  assert.match(build, /organic_category_redirect_collision/);
  assert.match(build, /shell: "shared-interactive"/);
  assert.doesNotMatch(build, /\.replaceAll\('data-motion-once="true"', 'data-motion-once="false"'\)/);
  for (const card of ["shipping", "schedule"]) assert.match(build, new RegExp(`data-h17-card="${card}"[^>]*data-motion="slide-from-(?:left|right)" data-motion-once="false"`));
  assert.match(build, /cs-home2-hero__copy[^>]*data-motion="rise" data-motion-once="true"/);
});
