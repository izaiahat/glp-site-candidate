import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { activeDeals, buildDealArtifacts, resolveDealEvaluationClocks, dealIngestionContract, offerIsWithinWindow, renderDeals, validateDeals } from "../src/deal-ingestion.mjs";
import config from "../data/deals.json" with { type: "json" };

import { readFileSync } from "node:fs";
const preservedManifest = JSON.parse(readFileSync(new URL("../artifacts/ops/wave4-deal-ingestion-manifest.json", import.meta.url)));
const NOW = "2026-08-02T01:52:00Z";
const clocksAt = preservedNow => resolveDealEvaluationClocks(config, { preservedNow });
const clone = () => structuredClone(config);
const expectRejected = (mutate, pattern = /invalid|drift|tampered|future|stale/) => {
  const copy = clone();
  mutate(copy);
  assert.throws(() => validateDeals(copy, { now: NOW }), pattern);
};

test("accepted NovoCare and Lilly records validate with pinned capture bindings", () => {
  assert.deepEqual(validateDeals(config, { now: NOW }), { status: "PASS", records: 4, sources: 2 });
  assert.equal(activeDeals(config, NOW).length, 4);
  assert.deepEqual([...new Set(config.offers.map((offer) => offer.source.scrape_id))].sort(), [
    "019fc021-2897-712d-9095-6a0244b9d37c",
    "019fc021-964c-72fd-9dbb-405c4d7ddc48",
  ]);
  for (const offer of config.offers) {
    assert.equal(createHash("sha256").update(offer.source.exact_quote).digest("hex"), offer.source.exact_quote_sha256);
  }
});

test("top-level, record, and nested schemas reject every unknown key", () => {
  expectRejected((copy) => { copy.recomputed = true; }, /schema_invalid/);
  expectRejected((copy) => { copy.offers[0].coupon_code = "FREE"; }, /schema_invalid/);
  expectRejected((copy) => { copy.offers[0].eligibility.enrollment_url = "https://example.test"; }, /schema_invalid/);
  expectRejected((copy) => { copy.offers[0].pricing.current_terms[0].dose = "all"; }, /schema_invalid/);
  expectRejected((copy) => { copy.offers[2].fill_limit.rollover = true; }, /schema_invalid/);
  expectRejected((copy) => { copy.offers[0].source.provider = "firecrawl"; }, /schema_invalid/);
});

test("commercial-covered Wegovy lane cannot be weakened or conflated with self-pay", () => {
  const covered = config.offers.find((offer) => offer.id === "wegovy-commercial-covered-2026");
  assert.equal(covered.coverage_lane, "commercial_covered");
  assert.equal(covered.eligibility.insurance_requirement, "commercial non-government insurance");
  assert.equal(covered.eligibility.outside_insurance_required, false);
  assert.equal(covered.pricing.current_terms[0].amount_usd, 25);
  assert.equal(covered.pricing.max_savings_usd_per_month, 100);
  expectRejected((copy) => { copy.offers[0].coverage_lane = "self_pay_outside_insurance"; });
  expectRejected((copy) => { copy.offers[0].eligibility.insurance_requirement = "any insurance or cash"; });
  expectRejected((copy) => { copy.offers[0].pricing.max_savings_usd_per_month = null; });
});

test("Wegovy self-pay government rule is limited to outside-insurance processing without unsupported reimbursement or limit claims", () => {
  for (const offer of config.offers.filter((item) => item.coverage_lane === "self_pay_outside_insurance")) {
    assert.equal(offer.eligibility.government_program_rule, "government-insured patients permitted only outside insurance");
    assert.equal(offer.eligibility.outside_insurance_required, true);
    assert.equal(offer.eligibility.reimbursement_prohibited, false);
    assert.equal(offer.eligibility.insurance_limit_application_prohibited, false);
  }
  expectRejected((copy) => { copy.offers[1].eligibility.outside_insurance_required = false; });
  expectRejected((copy) => { copy.offers[1].eligibility.reimbursement_prohibited = true; }, /unsupported_novocare_claim/);
  expectRejected((copy) => { copy.offers[2].eligibility.insurance_limit_application_prohibited = true; }, /unsupported_novocare_claim/);
  expectRejected((copy) => { copy.offers[2].eligibility.government_program_rule = "government programs excluded"; });
});

test("Wegovy dose pricing and August 31 transition remain form-agnostic and time-aware", () => {
  const pricing = config.offers.find((offer) => offer.id === "wegovy-self-pay-dose-pricing-2026");
  assert.equal(pricing.formulation, "dose form not stated in the accepted capture");
  assert.deepEqual(pricing.doses_mg, [1.5, 4]);
  assert.deepEqual(pricing.pricing.current_terms.map(({ label, amount_usd, expires_at }) => ({ label, amount_usd, expires_at })), [
    { label: "Wegovy 1.5 mg", amount_usd: 149, expires_at: null },
    { label: "Wegovy 4 mg", amount_usd: 149, expires_at: "2026-09-01T00:00:00Z" },
  ]);
  assert.deepEqual(pricing.pricing.transition_terms[0], {
    label: "Wegovy 4 mg",
    amount_usd: 199,
    unit: "per month",
    valid_from: "2026-09-01T00:00:00Z",
    expires_at: null,
  });
  const august = renderDeals(config, clocksAt("2026-08-31T23:59:59Z"));
  const september = renderDeals(config, clocksAt("2026-09-01T00:00:00Z"));
  assert.match(august, /\$149<\/strong> per month — Wegovy 4 mg/);
  assert.match(august, /Scheduled transition[\s\S]*\$199<\/strong> per month — Wegovy 4 mg/);
  const septemberCard = september.match(/data-offer-id="wegovy-self-pay-dose-pricing-2026"[\s\S]*?<\/article>/)?.[0] || "";
  assert.doesNotMatch(septemberCard, /\$149<\/strong> per month — Wegovy 4 mg/);
  assert.match(septemberCard, /\$199<\/strong> per month — Wegovy 4 mg/);
  assert.doesNotMatch(septemberCard, /tablet|reimburse|insurance[- ]limit/i);
  expectRejected((copy) => { copy.offers[1].formulation = "tablet"; }, /unsupported_novocare_claim/);
  expectRejected((copy) => { copy.offers[1].offer_name += " tablets"; }, /unsupported_novocare_claim/);
  expectRejected((copy) => { copy.offers[1].pricing.current_terms[0].label += " tablet"; }, /unsupported_novocare_claim/);
  expectRejected((copy) => { copy.offers[1].doses_mg = [0.25, 0.5]; });
  expectRejected((copy) => { copy.offers[1].pricing.transition_terms[0].valid_from = "2026-08-31T00:00:00Z"; });
});

test("new-patient two-fill terms, deadline, and post-offer prices remain exact", () => {
  const offer = config.offers.find((item) => item.id === "wegovy-new-patient-two-fill-2026");
  assert.equal(offer.eligibility.new_patient_requirement, "new to the Wegovy Savings offer or NovoCare Pharmacy");
  assert.deepEqual(offer.doses_mg, [0.25, 0.5]);
  assert.equal(offer.pricing.current_terms[0].amount_usd, 199);
  assert.deepEqual(offer.fill_limit, { count: 2, period: "monthly fills", qualifier: "maximum during the offer period" });
  assert.equal(offer.expires_at, "2027-01-01T00:00:00Z");
  assert.deepEqual(offer.pricing.post_offer_terms.map(({ amount_usd, label }) => ({ amount_usd, label })), [
    { amount_usd: 349, label: "Wegovy 0.25 mg, 0.5 mg, 1 mg, 1.7 mg, or 2.4 mg after the offer" },
    { amount_usd: 399, label: "Wegovy HD 7.2 mg after the offer" },
  ]);
  assert.equal(offerIsWithinWindow(offer, "2026-12-31T23:59:59Z"), true);
  assert.equal(offerIsWithinWindow(offer, "2027-01-01T00:00:00Z"), false);
  expectRejected((copy) => { copy.offers[2].fill_limit.count = 3; });
  expectRejected((copy) => { copy.offers[2].pricing.post_offer_terms[0].amount_usd = 399; });
  expectRejected((copy) => { copy.offers[2].expires_at = "2027-01-02T00:00:00Z"; });
});

test("Zepbound $499 lane is single-dose pen only with uncovered commercial insurance, 11 fills, and 2026 expiry", () => {
  const offer = config.offers.find((item) => item.id === "zepbound-commercially-uncovered-single-dose-pen-2026");
  assert.equal(offer.formulation, "single-dose pen");
  assert.deepEqual(offer.doses_mg, []);
  assert.equal(offer.coverage_lane, "commercial_not_covered");
  assert.equal(offer.eligibility.insurance_requirement, "commercial drug insurance that does not cover Zepbound single-dose pen");
  assert.equal(offer.eligibility.fda_approved_use_required, true);
  assert.equal(offer.pricing.current_terms[0].amount_usd, 499);
  assert.equal(offer.fill_limit.count, 11);
  assert.equal(offerIsWithinWindow(offer, "2026-12-31T23:59:59Z"), true);
  assert.equal(offerIsWithinWindow(offer, "2027-01-01T00:00:00Z"), false);
  expectRejected((copy) => { copy.offers[3].formulation = "KwikPen or vial"; });
  expectRejected((copy) => { copy.offers[3].doses_mg = [2.5]; });
  expectRejected((copy) => { copy.offers[3].fill_limit.count = 13; });
  expectRejected((copy) => { copy.offers[3].expires_at = null; });
});

test("future, stale, evil-host, unsafe-text, and evidence-tampering mutations fail closed", () => {
  assert.throws(() => validateDeals(config, { now: "2026-08-02T01:41:56Z" }), /offer_evidence_future/);
  assert.throws(() => validateDeals(config, { now: "2026-09-17T01:41:57Z" }), /offer_evidence_stale/);
  expectRejected((copy) => { copy.offers[0].source.url = "https://www.novocare.com.evil.example/patient/medicines/wegovy/savings-offer.html"; });
  expectRejected((copy) => { copy.offers[0].source.url = "http://www.novocare.com/patient/medicines/wegovy/savings-offer.html"; });
  expectRejected((copy) => { copy.offers[0].offer_name = "<img src=x onerror=alert(1)>"; }, /unsafe/);
  expectRejected((copy) => { copy.offers[0].source.exact_quote += " altered"; }, /tampered|drift/);
  expectRejected((copy) => {
    copy.offers[0].source.exact_quote += " altered and recomputed";
    copy.offers[0].source.exact_quote_sha256 = createHash("sha256").update(copy.offers[0].source.exact_quote).digest("hex");
  }, /binding_invalid|drift/);
  expectRejected((copy) => { copy.ledger.payload_sha256 = "0".repeat(64); }, /ledger_binding_invalid/);
});

test("rendered route has plain evidence references and zero action/runtime surfaces", () => {
  const evaluationClocks = clocksAt(preservedManifest.evaluated_at);
  const { html, manifest } = buildDealArtifacts(config, { evaluationClocks });
  assert.deepEqual(manifest.offer_evaluation_clocks, preservedManifest.offer_evaluation_clocks);
  assert.equal(manifest.evaluation_mode, "per_offer");
  assert.match(html, /Eligibility controls every displayed offer/);
  assert.match(html, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${dealIngestionContract.canonicalUrl.replaceAll("/", "\\/")}">`));
  assert.match(html, /Official source reference \(plain text only\)/);
  assert.doesNotMatch(html, /tablet|reimburse(?:ment|d|able)?|insurance[- ]limit/i);
  assert.doesNotMatch(html, /<a\b|<form\b|<script\b|rel="stylesheet"|href="\/go\/|buy\.stripe\.com|googletagmanager|google-analytics|clarity\.ms/i);
  assert.doesNotMatch(html, /checkout|enrollment/i);
  assert.deepEqual(manifest.html_facts, {
    action_links: 0,
    outbound_action_links: 0,
    forms: 0,
    scripts: 0,
    runtime_assets: 0,
    go_links: 0,
    checkout_links: 0,
  });
  assert.equal(manifest.evaluated_at, preservedManifest.evaluated_at);
  assert.equal(manifest.record_count, config.offers.length);
  assert.equal(manifest.active_record_count, activeDeals(config, NOW).length);
  assert.equal(manifest.source_count, new Set(config.offers.map((offer) => offer.source.capture_id)).size);
  assert.deepEqual(manifest.effects, { provider_calls: 0, checkout_attempts: 0, deployments: 0, emails: 0, spend_usd: 0 });
});
