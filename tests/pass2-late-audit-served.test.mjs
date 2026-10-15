import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";

import { createReviewServer } from "../scripts/serve-review.mjs";
import { assertGuideResourceCapture } from "./helpers/guide-resource-capture.mjs";

const ROOT = new URL("../", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);
let server;
let baseUrl;

before(async () => {
  server = await createReviewServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function fetchText(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  return { response, html: await response.text() };
}

async function htmlFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await htmlFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".html")) output.push(target);
  }
  return output;
}

const sharedReviewEvidence = new Map([
  ["/reviews/coivas/", "Monthly equivalents are not monthly billing"],
  ["/reviews/direct-meds/", "does not bind that figure to one medication"],
  ["/reviews/mangorx/", "MangoRx weight-loss pricing is unknown"],
  ["/reviews/sprout-health/", "not proof of a $110 first payment"],
]);

test("served legacy reviews use the shared current review shell and retain owned evidence", async () => {
  for (const [route, evidence] of sharedReviewEvidence) {
    const { response, html } = await fetchText(route);
    assert.equal(response.status, 200, route);
    assert.match(html, /<html[^>]*data-cs-template="review"/i, `${route}: html template marker`);
    assert.match(html, /<body[^>]*data-cs-template="review"/i, `${route}: body template marker`);
    assert.match(html, /class="cs-search-toggle"/, `${route}: search control`);
    assert.match(html, /id="cs-drawer"/, `${route}: drawer`);
    assert.match(html, /<script[^>]+src="\/assets\/site\.js\?v=[^"]+"/i, `${route}: site runtime`);
    assert.match(html, /<script[^>]+src="\/assets\/motion-loader\.js\?v=[^"]+"/i, `${route}: conditional motion loader`);
    assert.doesNotMatch(html, /<script[^>]+src="\/assets\/motion\.js\?v=[^"]+"/i, `${route}: motion runtime must not load unconditionally`);
    if (route === "/reviews/coivas/") {
      assert.match(html, /class="ready6-provider-mark provider-logo provider-logo--light"/, `${route}: canonical logo chip`);
      assert.match(html, /<img src="\/assets\/provider-logos\/coivas\.svg" alt="Coivas logo"/, `${route}: canonical logo asset`);
    } else {
      assert.match(html, /class="ready6-provider-mark provider-logo provider-logo--wordmark"/, `${route}: provider identity fallback`);
    }
    assert.match(html, /class="ready6-jump-nav"/, `${route}: owned review section navigation`);
    assert.ok(html.includes(evidence), `${route}: governed evidence copy missing`);
  }
});

test("G08a served medication owners are indexable 200 pages; paid listings stay separate", async () => {
  for (const medication of ["semaglutide", "tirzepatide"]) {
    const route = `/${medication}/`;
    const first = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
    assert.equal(first.status, 200, route);
    assert.equal(first.headers.get("location"), null, route);
    const html = await first.text();
    assert.ok(html.includes(`<link rel="canonical" href="https://glpclinicscout.com${route}">`));
    assert.match(html, /name="robots" content="index,follow,max-image-preview:large"/);
    assert.ok(html.includes(`data-g08-medication="${medication}"`));
    const paid = await fetch(`${baseUrl}/lp/best-providers/compounded-${medication}/`, { redirect: "manual" });
    assert.equal(paid.status, 200);
    assert.match(await paid.text(), /name="robots" content="noindex/);
  }
});

test("served home uses D36 replay-on-re-entry entrance markers", async () => {
  const { response, html } = await fetchText("/");
  assert.equal(response.status, 200);
  assert.match(html, /cs-home2-hero__copy[^>]*data-motion="rise" data-motion-once="true"/);
  for (const card of ["shipping", "schedule"]) assert.match(html, new RegExp(`data-h17-card="${card}"[^>]*data-motion="slide-from-(?:left|right)" data-motion-once="false"`));
  assert.match(html, /cs-home2-help[^>]*data-motion="rise" data-motion-once="true"/);
});

test("all built subscription and capture surfaces have passive consent with hidden capture metadata intact", async () => {
  const visibleConsentCheckbox = /<input\b(?=[^>]*\btype=["']checkbox["'])(?=[^>]*\bname=["'](?:email_consent|marketing_consent|privacy_consent|subscribe_consent)["'])[^>]*>/i;
  const files = await htmlFiles(PUBLIC.pathname);
  let surfaces = 0;
  let contentUpgradeForms = 0;

  for (const file of files) {
    const html = await readFile(file, "utf8");
    if (!html.includes("/api/content-upgrade") && !html.includes("data-subscribe-form")) continue;
    surfaces += 1;
    assert.doesNotMatch(html, visibleConsentCheckbox, path.relative(PUBLIC.pathname, file));

    for (const match of html.matchAll(/<form\b[^>]*(?:action=["']\/api\/content-upgrade["']|data-content-upgrade-form(?:-inline)?)[^>]*>[\s\S]*?<\/form>/gi)) {
      contentUpgradeForms += 1;
      const form = match[0];
      assert.match(form, /<input[^>]+type=["']hidden["'][^>]+name=["']consent_version["']/i, `${file}: consent_version`);
      assert.match(form, /<input[^>]+type=["']hidden["'][^>]+name=["']source_page["']/i, `${file}: source_page`);
      assert.match(form, /name=["']company["']/i, `${file}: honeypot`);
      assert.match(form, /href=["']\/privacy\/["']/i, `${file}: passive privacy copy`);
      assert.doesNotMatch(form, visibleConsentCheckbox, `${file}: visible consent control`);
    }
  }

  assert.ok(surfaces > 20, `capture/subscription sweep unexpectedly small: ${surfaces}`);
  assert.ok(contentUpgradeForms > 20, `content-upgrade form sweep unexpectedly small: ${contentUpgradeForms}`);

  const { response, html } = await fetchText("/guides/mounjaro-coupon/");
  assert.equal(response.status, 200);
  assert.doesNotMatch(html, visibleConsentCheckbox);
  // GLP73 guide delivery is resource-only, not the commercial v2 checklist.
  assertGuideResourceCapture(html, "/guides/mounjaro-coupon/");
  assert.match(html, /referrerPolicy:'no-referrer'/);
  assert.match(html, /payload\.email_consent='true'/);
});

test("focused served checks run against this candidate's public tree", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "glp-clinic-scout-phase2-content-staging");
  assert.equal(new URL("../package.json", import.meta.url).pathname, new URL("package.json", ROOT).pathname);
  assert.equal(PUBLIC.pathname, new URL("public/", ROOT).pathname);
});
