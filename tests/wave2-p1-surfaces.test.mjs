import test from "node:test";
import assert from "node:assert/strict";
import {
  addP1AffiliatePreconnect,
  addP1ContentUpgradeSurface,
  addP1IntentBridge,
  sourceSlugForRoute,
} from "../src/wave2-p1-surfaces.mjs";
import { validateContentUpgrade } from "../src/content-upgrade.mjs";

const frame = (route, body = "<main><p>Body</p></main>") => `<!doctype html><html><head><link rel="canonical" href="https://glpclinicscout.com${route}"></head><body>${body}</body></html>`;

test("all added capture surfaces use a clear consent note and hidden v2 version", () => {
  const html = addP1ContentUpgradeSurface(frame("/guides/example-guide/"));
  assert.equal((html.match(/action="\/api\/content-upgrade"/g) || []).length, 1);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 0);
  assert.doesNotMatch(html, /name="email_consent"/);
  assert.match(html, /<input type="hidden" name="consent_version" value="glp-content-upgrade-v2-20260801">/);
  assert.match(html, /class="capture-consent-note"[\s\S]*?By submitting your email,[\s\S]*?Privacy Policy[\s\S]*?Unsubscribe anytime/i);
  assert.equal((html.match(/payload\.email_consent='true'/g) || []).length, 1);
  assert.match(html, />Email me the source-checked guide<\/button>/);
  assert.doesNotMatch(html, /name="(?:privacy_consent|marketing_consent)"/);
});

test("quiz capture is inserted inside the result surface", () => {
  const html = addP1ContentUpgradeSurface(frame("/quiz/provider-fit/", '<main><section id="result" hidden><h2>Results</h2><form id="lead-form"><input name="phone"><input name="state"></form><p class="gcs-note">Not medical advice.</p></section></main><script>document.querySelector(\'#lead-form\').addEventListener(\'submit\',event=>event.preventDefault())</script>'));
  const result = html.slice(html.indexOf('<section id="result"'), html.indexOf("</section>") + 10);
  assert.match(result, /data-p1-capture-surface/);
  assert.match(result, /Save your matched-provider checklist/);
  assert.match(result, /Email me my match checklist/);
  assert.match(result, /quiz-provider-fit-match-checklist/);
  assert.match(result, /name="match_program_ids" value=""/);
  assert.match(result, /data-p1-quiz-retake>Change my answers/);
  assert.doesNotMatch(html, /id="lead-form"|name="phone"|name="state"/);
});

test("calculator capture is inserted inside the result surface", () => {
  const html = addP1ContentUpgradeSurface(frame("/tools/glp-1-cost-calculator/", '<main><aside id="cost-result"><h2>Estimate</h2></aside></main>'));
  const result = html.slice(html.indexOf('<aside id="cost-result"'), html.indexOf("</aside>") + 8);
  assert.match(result, /data-p1-capture-surface/);
  assert.match(result, /Email me this cost breakdown/);
  assert.match(result, /tools-glp-1-cost-calculator-cost-breakdown/);
  assert.match(result, /name="cost_total_usd"/);
  assert.match(html, /cost_first_month_usd:displayedMoney\('#result-first'\)/);
  assert.match(html, /cost_checked_as_of/);
});

test("capture consent precedes submit without redundant trust copy", () => {
  const html = addP1ContentUpgradeSurface(frame("/guides/example/", "<main><section><h2>One</h2><h2>Two</h2></section></main>"));
  const form = html.match(/<form[^>]*action="\/api\/content-upgrade"[\s\S]*?<\/form>/)[0];
  assert.notEqual(form.indexOf("capture-consent-note"), -1);
  assert.notEqual(form.indexOf('type="submit"'), -1);
  assert.ok(form.indexOf("capture-consent-note") < form.indexOf('type="submit"'));
  assert.match(form, /By submitting your email,[\s\S]*?Privacy Policy[\s\S]*?Unsubscribe anytime/i);
  assert.doesNotMatch(form, /never sell or share your email/i);
  assert.match(html, /content_upgrade_submit/);
  assert.match(html, /content_upgrade_success/);
  assert.match(html, /Done — your cost breakdown was emailed\./);
  assert.match(html, /Saved — email delivery is not active yet\./);
  assert.match(html, /Saved, but email delivery failed\./);
});

test("existing money forms are normalized without adding a third form", () => {
  const legacy = frame("/best/online-glp-1-providers/", '<main><form action="/api/content-upgrade"><input name="consent_version" value="glp-content-upgrade-v1-20260724"><div class="capture-consents"><label class="capture-consent"><input type="checkbox" name="privacy_consent" value="true" required></label><label class="capture-consent"><input type="checkbox" name="marketing_consent" value="true" required></label></div><button>Save request</button></form></main>');
  const html = addP1ContentUpgradeSurface(legacy);
  assert.equal((html.match(/action="\/api\/content-upgrade"/g) || []).length, 1);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 0);
  assert.doesNotMatch(html, /name="(?:email_consent|privacy_consent|marketing_consent)"/);
  assert.match(html, /<input name="consent_version" value="glp-content-upgrade-v2-20260801">/);
  assert.match(html, /class="capture-consent-note"[\s\S]*?By submitting your email,[\s\S]*?Privacy Policy[\s\S]*?Unsubscribe anytime/i);
});

test("surface transforms are idempotent across generated and legacy inputs", () => {
  const generated = addP1ContentUpgradeSurface(frame("/guides/idempotent/"));
  assert.equal(addP1ContentUpgradeSurface(generated), generated);
  const legacy = frame("/best/idempotent/", '<main><form action="/api/content-upgrade" data-content-upgrade-form-inline><input name="email"><button type="submit">Save request</button><div class="capture-consents"><label><input type="checkbox" name="privacy_consent"></label><label><input type="checkbox" name="marketing_consent"></label></div></form></main><script>const payload={source_page:"x"};try{const response=await fetch(form.action);window.GCSAnalytics&&window.GCSAnalytics.event&&window.GCSAnalytics.event(\'content_upgrade_complete\',{page_slug:slug})</script>');
  const normalized = addP1ContentUpgradeSurface(legacy);
  assert.equal(addP1ContentUpgradeSurface(normalized), normalized);
  assert.equal((normalized.match(/content_upgrade_submit/g) || []).length, 1);
});

test("new and cached legacy consent payloads are both accepted under their own versions", () => {
  const base = { email: "reader@example.test", source_page: "guide-example", lead_magnet_key: "guide-example-terms-checklist", company: "" };
  assert.equal(validateContentUpgrade({ ...base, email_consent: true, consent_version: "glp-content-upgrade-v2-20260801" }).consentVersion, "glp-content-upgrade-v2-20260801");
  assert.equal(validateContentUpgrade({ ...base, privacy_consent: true, marketing_consent: true, consent_version: "glp-content-upgrade-v1-20260724" }).consentVersion, "glp-content-upgrade-v1-20260724");
  assert.throws(() => validateContentUpgrade({ ...base, email_consent: true, consent_version: "glp-content-upgrade-v1-20260724" }), /consent_version_invalid/);
});

test("duplicate-intent pairs receive reciprocal, differentiated bridges", () => {
  const guide = addP1IntentBridge(frame("/guides/healthrx-vs-agelessrx/", "<main><h1>Old guide</h1></main>").replace("</head>", "<title>Old guide</title></head>"));
  const compare = addP1IntentBridge(frame("/compare/healthrx-vs-agelessrx/", "<main><h1>Old comparison</h1></main>").replace("</head>", "<title>Old comparison</title></head>"));
  assert.match(guide, /href="\/compare\/healthrx-vs-agelessrx\/"/);
  assert.match(compare, /href="\/guides\/healthrx-vs-agelessrx\/"/);
  assert.match(guide, /Billing Evidence Guide/);
  assert.match(compare, /Price &amp; Service Comparison|Price & Service Comparison/);
  assert.notEqual(guide.match(/<a[^>]*>(.*?)<\/a>/)?.[1], compare.match(/<a[^>]*>(.*?)<\/a>/)?.[1]);
});

test("affiliate anchors preserve navigation without pre-consent network hints", () => {
  const html = frame("/reviews/found-health/", '<main><a href="https://track.revoffers.com/click">Start</a></main>');
  assert.equal(addP1AffiliatePreconnect(html), html);
  const legacy = html.replace('</head>', '<link rel="preconnect" href="https://track.revoffers.com" crossorigin><link rel="dns-prefetch" href="//track.revoffers.com"></head>');
  assert.equal(addP1AffiliatePreconnect(legacy), html);
  assert.equal(addP1AffiliatePreconnect(addP1AffiliatePreconnect(legacy)), html);
  assert.doesNotMatch(addP1AffiliatePreconnect(frame("/guides/example/")), /track\.revoffers\.com/);
});

test("route slugs remain deterministic and API-safe", () => {
  assert.equal(sourceSlugForRoute("/tools/glp-1-cost-calculator/"), "tools-glp-1-cost-calculator");
  assert.equal(sourceSlugForRoute("/"), "home");
});
