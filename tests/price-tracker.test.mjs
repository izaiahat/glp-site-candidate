import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildAlertIntents, buildPriceTrackerArtifacts, renderPriceTracker, validatePriceTracker } from "../src/price-tracker.mjs";
import config from "../data/price-tracker.json" with { type: "json" };

// Evaluation clock from the actual adopted rows; no capture timestamps are changed.
const NOW = new Date(Math.max(...config.records.map(row => Date.parse(row.checked_at)))).toISOString();
const alertNow = record => record.checked_at;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const copy = () => structuredClone(config);
const subscriber = (overrides = {}) => ({
  id: "sub-0123456789abcdef",
  provider_id: config.records[0].provider_id,
  active: true,
  consent: true,
  suppressed: false,
  unsubscribed: false,
  ...overrides,
});

function assertTrackerRejected(mutate, pattern) {
  const candidate = copy();
  mutate(candidate);
  assert.throws(() => validatePriceTracker(candidate, { now: NOW }), pattern);
}

test("price tracker validates four ledger-bound official-source records", () => {
  const result = validatePriceTracker(config, { now: NOW });
  assert.equal(result.status, "PASS");
  assert.equal(result.record_count, 4);
  assert.deepEqual(result.record_ids, ["ro-body-annual-prepay", "weightwatchers-ongoing-12", "lifemd-ongoing-monthly", "plushcare-initial-visit"]);
  assert.equal(new Set(result.source_scrape_ids).size, 4);
  assert.equal(config.records.some((record) => record.provider_id === "mochi"), false);
});

test("strict top-level, source-ledger, and row schemas reject every unknown or missing key", () => {
  for (const [mutate, pattern] of [
    [(x) => { x.unexpected = true; }, /tracker_top_level_schema_invalid/],
    [(x) => { delete x.methodology; }, /tracker_top_level_schema_invalid/],
    [(x) => { x.source_ledger.unexpected = true; }, /tracker_source_ledger_schema_invalid/],
    [(x) => { delete x.source_ledger.ledger_payload_sha256; }, /tracker_source_ledger_schema_invalid/],
    [(x) => { x.records[0].unexpected = true; }, /tracker_record_schema_invalid/],
    [(x) => { delete x.records[0].amount_qualifier; }, /tracker_record_schema_invalid/],
  ]) assertTrackerRejected(mutate, pattern);
});

test("source URLs are exact HTTPS first-party ledger URLs and reject hostile host tricks", () => {
  for (const url of [
    "https://ro.co.evil.test/weight-loss/pricing/",
    "https://evil.test/?next=https://ro.co/weight-loss/pricing/",
    "https://ro.co@evil.test/weight-loss/pricing/",
    "http://ro.co/weight-loss/pricing/",
    "https://www.ro.co/weight-loss/pricing/",
    "https://lifemd.com/weight-management/",
  ]) assertTrackerRejected((x) => { x.records[0].source_url = url; }, /tracker_source_invalid|tracker_evidence_binding_invalid/);
});

test("freshness is dynamic and fails closed for stale, future, or invalid clocks", () => {
  assert.throws(() => validatePriceTracker(config, { now: new Date(Date.parse(NOW) + 46 * 86400000).toISOString() }), /tracker_freshness_invalid/);
  assertTrackerRejected((x) => { x.records[0].checked_at = new Date(Date.parse(NOW) + 86400000).toISOString(); }, /tracker_timestamp_invalid/);
  assert.throws(() => validatePriceTracker(config, { now: "not-a-date" }), /tracker_now_invalid/);
  assert.doesNotThrow(() => validatePriceTracker(config, { now: NOW }));
});

test("accepted Firecrawl scrape ID, exact quote, quote hash, and frozen ledger binding cannot be self-recomputed", () => {
  assertTrackerRejected((x) => {
    x.records[0].quote = "A fabricated $1 price quote.";
    x.records[0].quote_sha256 = sha256(x.records[0].quote);
  }, /tracker_evidence_binding_invalid/);
  assertTrackerRejected((x) => { x.records[0].source_scrape_id = x.records[1].source_scrape_id; }, /tracker_evidence_binding_invalid/);
  assertTrackerRejected((x) => { x.source_ledger.ledger_payload_sha256 = "0".repeat(64); }, /tracker_source_ledger_binding_invalid/);
});

test("missing qualifiers, malformed term types, and unsupported medication inclusion fail closed", () => {
  for (const [mutate, pattern] of [
    [(x) => { x.records[0].amount_qualifier = ""; }, /tracker_text_invalid/],
    [(x) => { x.records[0].commitment_months = "12"; }, /tracker_terms_invalid/],
    [(x) => { x.records[0].prepayment = false; }, /tracker_terms_invalid/],
    [(x) => { x.records[0].billing_cadence = "year"; }, /tracker_terms_invalid/],
    [(x) => { x.records[0].commitment_type = "cancel_anytime"; }, /tracker_terms_invalid|tracker_evidence_binding_invalid/],
    [(x) => { x.records[0].medication_included = true; }, /tracker_evidence_binding_invalid/],
    [(x) => {
      x.records[0].quote = "The Ro Body membership costs $74 per month.";
      x.records[0].quote_sha256 = sha256(x.records[0].quote);
    }, /tracker_evidence_binding_invalid/],
  ]) assertTrackerRejected(mutate, pattern);
});

test("Ro $74 observation is bound to a 12-month annual-prepayment identity", () => {
  const ro = config.records.find((record) => record.provider_id === "ro");
  assert.equal(ro.amount_usd, 74);
  assert.equal(ro.commitment_type, "fixed");
  assert.equal(ro.commitment_months, 12);
  assert.equal(ro.prepayment, "annual_required");
  assert.match(ro.quote, /prepay for an annual plan/);
});

test("alert comparison rejects any term mutation that is not independently accepted evidence", () => {
  const [ro, weightwatchers, lifemd] = config.records;
  for (const [prior, mutate] of [
    [lifemd, (x) => { x.billing_cadence = "monthly_equivalent"; }],
    [weightwatchers, (x) => { x.commitment_months = 6; }],
    [weightwatchers, (x) => { x.price_phase = "initial"; }],
    [ro, (x) => { x.prepayment = "not_stated"; }],
    [ro, (x) => { x.medication_included = true; }],
  ]) {
    const current = structuredClone(prior); mutate(current);
    assert.throws(() => buildAlertIntents({ previous: [prior], current: [current], subscriptions: [subscriber({ provider_id: prior.provider_id })] }, { now: alertNow(prior) }), /alert_record_/);
  }
});

test("alert records enforce source host, time, quote hash, accepted row, and PII gates", () => {
  const prior = config.records[0];
  for (const [mutate, pattern] of [
    [(x) => { x.source_url = "https://evil.test/"; }, /tracker_source_invalid/],
    [(x) => { x.checked_at = "not-a-date"; }, /alert_record_freshness_invalid/],
    [(x) => { x.checked_at = "2026-10-01T00:00:00Z"; }, /alert_record_freshness_invalid/],
    [(x) => { x.quote_sha256 = "0".repeat(64); }, /alert_record_quote_hash_invalid/],
    [(x) => { x.quote = "person@example.com paid $74"; x.quote_sha256 = sha256(x.quote); }, /alert_record_pii_invalid/],
    [(x) => { x.quote = "A forged $74 quote"; x.quote_sha256 = sha256(x.quote); }, /alert_record_evidence_binding_invalid/],
    [(x) => { x.source_scrape_id = config.records[1].source_scrape_id; }, /alert_record_evidence_binding_invalid/],
    [(x) => { x.amount_usd = 73; }, /alert_record_evidence_binding_invalid/],
  ]) {
    const current = structuredClone(prior); mutate(current);
    assert.throws(() => buildAlertIntents({ previous: [prior], current: [current], subscriptions: [subscriber()] }, { now: alertNow(prior) }), pattern);
  }
  assert.throws(() => buildAlertIntents({ previous: [prior], current: [prior], subscriptions: [subscriber()] }, { now: "bad-clock" }), /tracker_now_invalid/);
});

test("alert batches require explicit consent state and remain dispatch-dark without a second accepted observation", () => {
  const record = config.records[0];
  assert.deepEqual(buildAlertIntents({ previous: [record], current: [record], subscriptions: [subscriber()] }, { now: alertNow(record) }), []);
  for (const sub of [
    subscriber({ active: false }), subscriber({ consent: false }), subscriber({ suppressed: true }), subscriber({ unsubscribed: true }),
  ]) assert.deepEqual(buildAlertIntents({ previous: [record], current: [record], subscriptions: [sub] }, { now: alertNow(record) }), []);
});

test("missing consent/suppression/unsubscribe fields, unknown keys, and PII reject the entire intent batch", () => {
  const record = config.records[0];
  for (const mutation of [
    (x) => { delete x.active; },
    (x) => { delete x.consent; },
    (x) => { delete x.suppressed; },
    (x) => { delete x.unsubscribed; },
    (x) => { x.email = "person@example.test"; },
    (x) => { x.id = "person@example.test"; },
  ]) {
    const sub = subscriber(); mutation(sub);
    assert.throws(() => buildAlertIntents({ previous: [record], current: [record], subscriptions: [sub] }, { now: alertNow(record) }), /alert_subscription_/);
  }
  assert.throws(() => buildAlertIntents({ previous: [record], current: [record], subscriptions: [subscriber()], email: "person@example.test" }, { now: alertNow(record) }), /alert_input_schema_invalid/);
});

test("duplicate comparable observations and record PII fail closed", () => {
  const record = config.records[0];
  assert.throws(() => buildAlertIntents({ previous: [record, structuredClone(record)], current: [record], subscriptions: [subscriber()] }, { now: alertNow(record) }), /alert_duplicate_comparison_identity/);
  assert.throws(() => buildAlertIntents({ previous: [{ ...record, email: "person@example.test" }], current: [record], subscriptions: [subscriber()] }, { now: alertNow(record) }), /alert_record_schema_invalid/);
});

test("rendered tracker is self-canonical, link-dark, noindex/nofollow, source-plain, and runtime-free", () => {
  const html = renderPriceTracker(config, { now: NOW });
  assert.match(html, /<link rel="canonical" href="https:\/\/glpclinicscout\.com\/tools\/glp-1-price-tracker\/">/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive">/);
  assert.match(html, /Research guidance, not medical advice/);
  assert.equal((html.match(/<tr data-record-id=/g) || []).length, 4);
  assert.equal((html.match(/data-source-reference/g) || []).length, 4);
  for (const record of config.records) assert.match(html, new RegExp(record.source_url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /<a\b|<form\b|<script\b|<link[^>]+stylesheet|\/go\/|gtag|googletagmanager|analytics\.js|consent\.js|site\.js/i);
});

test("manifest facts and hashes are derived from the validated config and rendered artifact", () => {
  const { html, manifest } = buildPriceTrackerArtifacts(config, { now: NOW });
  assert.equal(manifest.status, "PASS");
  assert.equal(manifest.record_count, 4);
  assert.deepEqual(manifest.record_ids, config.records.map((record) => record.id));
  assert.deepEqual(manifest.source_scrape_ids, config.records.map((record) => record.source_scrape_id));
  assert.equal(manifest.source_ledger_payload_sha256, config.source_ledger.ledger_payload_sha256);
  assert.equal(manifest.config_payload_sha256, sha256(canonical(config)));
  assert.equal(manifest.html_sha256, sha256(html));
  assert.equal(manifest.artifact_facts.canonical_url, "https://glpclinicscout.com/tools/glp-1-price-tracker/");
  assert.equal(manifest.artifact_facts.route, "/tools/glp-1-price-tracker/");
  assert.equal(manifest.artifact_facts.robots, "noindex,nofollow,noarchive");
  assert.equal(manifest.artifact_facts.rendered_record_count, 4);
  assert.equal(manifest.artifact_facts.source_reference_count, 4);
  assert.equal(manifest.artifact_facts.anchor_count, 0);
  assert.equal(manifest.artifact_facts.form_count, 0);
  assert.equal(manifest.artifact_facts.script_count, 0);
  assert.equal(manifest.artifact_facts.external_runtime_asset_count, 0);
  for (const forbidden of ["provider_calls", "email_sends", "provider_mutations", "spend_usd", "dispatch_authorized"]) assert.equal(Object.hasOwn(manifest, forbidden), false);
  const payload = structuredClone(manifest);
  const digest = payload.payload_sha256;
  delete payload.payload_sha256;
  assert.equal(digest, sha256(canonical(payload)));
  assert.match(digest, /^[a-f0-9]{64}$/);
});
