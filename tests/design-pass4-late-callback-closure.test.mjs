import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { optionCProgramIds } from './helpers/d2w-s9-contracts.mjs';

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => readFile(path.join(ROOT, relative), "utf8");
const count = (text, pattern) => (text.match(pattern) || []).length;

test("late callback source cleanup and capture proof bind to the canonical bytes", async () => {
  const [build, contentUpgrade, editorialCss, capture] = await Promise.all([
    read("scripts/build-staging.mjs"),
    read("src/content-upgrade.mjs"),
    read("assets/css-src/40-editorial.css"),
    read("scripts/capture-design-pass-evidence.mjs"),
  ]);
  assert.doesNotMatch(build, /reviewSheetStyle|const reviewSheet\s*=|legacy_v1/);
  assert.match(build, /const reviewSheetV2\s*=/);
  assert.match(contentUpgrade, /Start with \$\{esc\(breakdown\.affiliateOffer\.merchant\)\}/);
  assert.doesNotMatch(contentUpgrade, /See current \$\{esc\(breakdown\.affiliateOffer\.merchant\)\} terms/);
  assert.match(editorialCss, /\.capture-honeypot\s*\{[\s\S]*?left:\s*-10000px/);
  assert.match(capture, /name:\s*"bulk-hub",\s*route:\s*"\/bulk\/"/);
  assert.match(capture, /manifest\.current_byte_hashes/);
});

test("fixed-duration and brand cards enforce Option C with one primary conversion lane", async () => {
  for (const route of ["3-month", "6-month"]) {
    const html = await read(`public/${route}/index.html`);
    const cards = [...html.matchAll(/<article class="p3-provider-card\b[\s\S]*?<\/article>/g)].map((match) => match[0]);
    assert.ok(cards.length > 0, route);
    for (const card of cards) {
      assert.equal(count(card, /data-provider-card-contract="option-c"/g), 1, route);
      assert.equal(count(card, /<dt>Medications offered<\/dt>/g), 1, route);
      assert.equal(count(card, /<dt>Total monthly cost<\/dt>/g), 1, route);
      assert.equal(count(card, /<dt>Cancellation<\/dt>/g), 1, route);
      assert.equal(count(card, /data-analytics-event="affiliate_click"/g), 1, route);
      assert.doesNotMatch(card, /data-bulk-comparison-ledger|p3-dose-grid|UNKNOWN_NO_SOURCE|>Not published</);
    }
    assert.equal(count(html, /data-mode="bulk"/g), cards.length, route);
    assert.equal(count(html, new RegExp(`data-product-visual="bulk-${route}"`, "g")), 1, route);
    assert.doesNotMatch(html, /href="\/quiz\/provider-fit\/\?provider=/);
  }

  for (const route of ["ozempic", "wegovy", "wegovy-pill", "mounjaro", "zepbound"]) {
    const html = await read(`public/${route}/index.html`);
    const cards = [...html.matchAll(/<article class="p3-provider-card\b[\s\S]*?<\/article>/g)].map((match) => match[0]);
    assert.ok(cards.length > 0, route);
    for (const card of cards) {
      assert.equal(count(card, /data-provider-card-contract="option-c"/g), 1, route);
      assert.equal(count(card, /<dt>Medications offered<\/dt>/g), 1, route);
      assert.equal(count(card, /<dt>Total monthly cost<\/dt>/g), 1, route);
      assert.equal(count(card, /<dt>Cancellation<\/dt>/g), 1, route);
      assert.equal(count(card, /data-analytics-event="affiliate_click"/g), 1, route);
      assert.doesNotMatch(card, /data-brand-cost-ledger|data-insurance-provider\b|p3-dose-grid|UNKNOWN_NO_SOURCE|>Not published</);
    }
    assert.doesNotMatch(html, /href="\/quiz\/provider-fit\/\?provider=/);
  }
});

test("compounded state-unknown rows are separated and the provider directory enforces Option C", async () => {
  const compounded = await read("public/lp/best-providers/compounded-semaglutide/index.html");
  const remainderAt = compounded.indexOf("data-state-unverified-remainder");
  assert.ok(remainderAt > 0);
  const main = compounded.slice(0, remainderAt);
  const remainder = compounded.slice(remainderAt);
  assert.equal(count(main, /data-state-mode="unknown"/g), 0);
  assert.ok(count(main, /data-phase3-provider(?=[\s>])/g) > 0);
  assert.ok(count(remainder, /data-state-mode="unknown"/g) > 0);
  assert.match(remainder, /availability unverified/);

  const providers = javascriptProviderMarkup(await read("public/providers/index.html"));
  const payloadScript = providers.match(/<script\b[^>]*data-provider-card-payloads[^>]*>[\s\S]*?<\/script>/i)?.[0] || "";
  const payloadInline = payloadScript.match(/>([\s\S]*?)<\/script>/i)?.[1]?.trim() || "[]";
  const payloadSource = payloadScript.match(/\bdata-src="([^"]+)"/i)?.[1] || "";
  const deferredPayload = JSON.parse(payloadSource && payloadInline === "[]"
    ? await read(`public/${payloadSource.replace(/^\//, "")}`)
    : payloadInline);
  const providerMarkup = `${providers}${deferredPayload.join("")}`;
  const cards = new Set([...providers.matchAll(/data-phase3-provider\b[^>]*data-program="([^"]+)"/g)].map((match) => match[1]));
  const expectedIds = optionCProgramIds();
  const optionCExpected = expectedIds.length;
  assert.deepEqual([...cards].sort(), expectedIds.sort());
  assert.equal(cards.size, optionCExpected);
  assert.equal(count(providerMarkup, /data-provider-card-contract="option-c"/g), optionCExpected);
  assert.equal(count(providerMarkup, /<dt>Medications offered<\/dt>/g), optionCExpected);
  assert.equal(count(providerMarkup, /<dt>Total monthly cost<\/dt>/g), optionCExpected);
  assert.equal(count(providerMarkup, /<dt>Cancellation<\/dt>/g), optionCExpected);
  assert.doesNotMatch(providerMarkup, /class="p3-dose-grid"|UNKNOWN_NO_SOURCE|>Not published</);
  assert.doesNotMatch(providers, /data-provider-record=|Browse \d+ additional governed provider records/);
  for (const program of ["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review", "g-plan", "jrnys-review", "medvi-review"]) assert.equal(cards.has(program), false);
});

test("bulk hub previews and Wegovy Pill non-empty duration default are shipped", async () => {
  const [bulk, site] = await Promise.all([read("public/bulk/index.html"), read("assets/site.js")]);
  assert.equal(count(bulk, /class="p3-intent-preview"/g), 4);
  assert.equal(count(bulk, /source-backed provider row/g), 4);
  assert.doesNotMatch(bulk, /phase3-product--|data-representative-editorial-visual/);
  assert.match(site, /\['all', 'Any published duration'\]/);
});
import { javascriptProviderMarkup } from './helpers/d2p-noscript.mjs';
