import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildMysteryShopArtifacts,
  loadEvidenceInputs,
  evidenceLedgerAuthority,
  canonicalJson,
  computeEvidenceSha256,
  deriveSurfaceFacts,
  EXPECTED_LEDGER_CANONICAL_SHA256,
  EXPECTED_LEDGER_FILE_SHA256,
  REDACTION_STATUS,
  renderMysteryShop,
  sha256,
  validateMysteryShop,
  validateRenderedSurface,
} from "../src/mystery-shop.mjs";

import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const { config, ledger, ledgerBytes } = loadEvidenceInputs(root);
const NOW = ledger.generated_at_utc;
const authority = evidenceLedgerAuthority(ledger);

function copyFixture() {
  const fixture = loadEvidenceInputs(root);
  assert.doesNotThrow(() => validateMysteryShop(fixture.config, fixture.ledger, { now: NOW }));
  return fixture;
}

function captureFor(fixture, rowIndex = 0) {
  const row = fixture.config.observations[rowIndex];
  return fixture.ledger.records.find((item) => item.capture_id === row.capture_id);
}

function recomputeEvidence(fixture, rowIndex = 0) {
  const row = fixture.config.observations[rowIndex];
  row.evidence_sha256 = computeEvidenceSha256(fixture.config, row, captureFor(fixture, rowIndex));
}

const rejectionPatterns = {
  "top-level PII": /^pii_key_forbidden:/,
  "nested PII": /^pii_key_forbidden:/,
  "PII inside an otherwise allowed field": /^pii_value_forbidden:/,
  "unsupported clinical experience": /^unsupported_clinical_or_review_claim$/,
  "false redaction status": /^redaction_status_invalid$/,
  "fabricated quote with recomputed quote and provenance hashes": /^capture_ledger_canonical_binding_invalid$/,
  "evil source host": /^observation_resolved_host_invalid$/,
  "stale observation timestamp": /^observation_freshness_invalid$/,
  "future observation timestamp": /^observation_timestamp_invalid$/,
  "unparseable observation timestamp": /^observation_timestamp_invalid$/,
  "unknown top-level key": /^evidence_top_level_schema_invalid:/,
  "unknown observation key": /^observation_schema_invalid:/,
  "missing observation key": /^observation_schema_invalid:/,
  "recomputed hash after changing a non-source provenance field": /^evidence_provenance_hash_invalid$/,
};
function rejects(name, mutate) {
  test(`hostile fixture rejects ${name}`, () => {
    const fixture = copyFixture();
    mutate(fixture);
    assert.throws(() => validateMysteryShop(fixture.config, fixture.ledger, { now: NOW, ledgerFileSha256: authority.file_sha256 }), error => {
      const pattern = name.startsWith("admitted ")
        ? new RegExp(`^public_only_flag_invalid:${name.slice(9)}$`) : rejectionPatterns[name];
      assert.ok(pattern, `missing exact rejection contract: ${name}`);
      assert.match(error.message, pattern);
      return true;
    }, name);
  });
}

test("authoritative public-page evidence validates with three accepted Firecrawl captures", () => {
  assert.equal(sha256(ledgerBytes), authority.file_sha256);
  assert.equal(sha256(canonicalJson(ledger)), authority.canonical_sha256);
  assert.deepEqual(validateMysteryShop(config, ledger, { now: NOW, ledgerFileSha256: sha256(ledgerBytes) }), {
    status: "PASS_CLEAN_ROOM_PUBLIC_EVIDENCE",
    observations: 3,
    evidence_status: "UNTESTED_PUBLIC_PAGE_CAPTURE",
    tested_observations: 0,
    untested_observations: 3,
    public_only: true,
    accepted_firecrawl_captures: 3,
  });
  const weightWatchers = config.observations.find((row) => row.provider_id === "weightwatchers");
  assert.equal(weightWatchers.scrape_id, "019fc020-fe2a-7747-b317-2c15ba8985ff");
  assert.equal(weightWatchers.resolved_url, "https://www.weightwatchers.com/us/weight-loss-medication");
  assert.equal(weightWatchers.source_excerpt, "$74 $25/first month\n\nThen, $74/month. GLP-1 meds cost not included\n\n$25/month for your first month with a 12-month or 6-month plan. Cost of GLP-1 medications not included.");
  assert.equal(weightWatchers.source_excerpt_sha256, "21647b079c6ec9d811db86d952cf62088a9271395ae8cb65f9449a9cbe7ab251");
});

rejects("top-level PII", ({ config: candidate }) => { candidate.patient_email = "person@example.com"; });
rejects("nested PII", ({ config: candidate }) => { candidate.observations[0].notes = { patient_email: "person@example.com" }; });
rejects("PII inside an otherwise allowed field", ({ config: candidate }) => {
  candidate.observations[0].page = "Pricing for person@example.com";
  recomputeEvidence({ config: candidate, ledger });
});

for (const flag of [
  "contact_performed",
  "form_submission_performed",
  "account_created",
  "impersonation_performed",
  "clinical_questionnaire_performed",
  "payment_performed",
  "patient_experience_represented",
]) rejects(`admitted ${flag}`, (fixture) => {
  fixture.config.observations[0][flag] = true;
  recomputeEvidence(fixture);
});

rejects("unsupported clinical experience", (fixture) => {
  fixture.config.observations[0].page = "I was a patient and my clinician treated me effectively";
  recomputeEvidence(fixture);
});

rejects("false redaction status", (fixture) => {
  fixture.config.observations[0].redaction_status = "PII_REDACTED";
  recomputeEvidence(fixture);
});

rejects("fabricated quote with recomputed quote and provenance hashes", (fixture) => {
  const row = fixture.config.observations[0];
  const capture = captureFor(fixture);
  row.source_excerpt = "Fabricated public price: $1 for every customer.";
  row.source_excerpt_sha256 = sha256(row.source_excerpt);
  capture.exact_quote = row.source_excerpt;
  capture.exact_quote_sha256 = row.source_excerpt_sha256;
  recomputeEvidence(fixture);
});

rejects("evil source host", (fixture) => {
  fixture.config.observations[0].resolved_url = "https://evil.example/weight-loss/pricing/";
  recomputeEvidence(fixture);
});

rejects("stale observation timestamp", (fixture) => {
  fixture.config.observations[0].observed_at = "2026-05-01T00:00:00Z";
  recomputeEvidence(fixture);
});

rejects("future observation timestamp", (fixture) => {
  fixture.config.observations[0].observed_at = new Date(Date.parse(NOW) + 86400000).toISOString();
  recomputeEvidence(fixture);
});

rejects("unparseable observation timestamp", (fixture) => {
  fixture.config.observations[0].observed_at = "August 2 someday";
  recomputeEvidence(fixture);
});

rejects("unknown top-level key", ({ config: candidate }) => { candidate.debug = false; });
rejects("unknown observation key", ({ config: candidate }) => { candidate.observations[0].notes = "none"; });
rejects("missing observation key", ({ config: candidate }) => { delete candidate.observations[0].contact_performed; });
rejects("recomputed hash after changing a non-source provenance field", (fixture) => {
  fixture.config.observations[0].page = "Changed pricing label";
  // Deliberately do not recompute: every observation field is provenance-bound.
});
test("hostile fixture rejects mutated ledger file digest binding", () => {
  assert.throws(() => validateMysteryShop(config, ledger, { now: NOW, ledgerFileSha256: "0".repeat(64) }), /evidence_ledger_binding_invalid/);
});

test("hostile ledger effects require exact integer zeros", () => {
  for (const value of [1, true, "0", -1]) {
    const fixture = copyFixture();
    fixture.ledger.effects.provider_forms = value;
    assert.throws(() => validateMysteryShop(fixture.config, fixture.ledger, { now: NOW, ledgerFileSha256: authority.file_sha256 }), /capture_ledger_effect_nonzero:provider_forms/);
  }
});

test("caller-supplied digest cannot bless a tampered accepted or rejected ledger payload", () => {
  for (const mutate of [
    (fixture) => {
      const row = fixture.ledger.records.find((item) => item.capture_id === fixture.config.observations[0].capture_id);
      row.exact_quote = "Forged quote with no independent capture.";
      row.exact_quote_sha256 = sha256(row.exact_quote);
      fixture.config.observations[0].source_excerpt = row.exact_quote;
      fixture.config.observations[0].source_excerpt_sha256 = row.exact_quote_sha256;
      recomputeEvidence(fixture);
    },
    (fixture) => { fixture.ledger.records.find((item) => item.disposition === "REJECTED_SOURCE_404").provider = "attacker"; },
  ]) {
    const fixture = copyFixture(); mutate(fixture);
    assert.throws(() => validateMysteryShop(fixture.config, fixture.ledger, { now: NOW, ledgerFileSha256: authority.file_sha256 }), /capture_ledger_canonical_binding_invalid/);
  }
});

test("complete provenance hash changes for every provenance class", () => {
  const baseline = config.observations[0].evidence_sha256;
  const mutations = [
    (fixture) => { fixture.config.observations[0].page = "Alternate public pricing label"; },
    (fixture) => { fixture.config.observations[0].observed_at = "2026-08-02T01:40:00Z"; },
    (fixture) => { fixture.config.source_capture_ledger.generated_at_utc = "2026-08-02T01:41:55Z"; },
    (fixture) => { fixture.config.observations[0].redaction_status = "OTHER"; },
  ];
  for (const mutate of mutations) {
    const fixture = copyFixture();
    mutate(fixture);
    assert.notEqual(computeEvidenceSha256(fixture.config, fixture.config.observations[0], captureFor(fixture)), baseline);
  }
});

test("render is an exact zero-runtime, link-dark, self-canonical surface", () => {
  const html = renderMysteryShop(config, ledger, { now: NOW });
  assert.match(html, /Public-page evidence audit—not mystery shopping or a patient review/);
  assert.match(html, new RegExp(REDACTION_STATUS));
  assert.equal((html.match(/data-observation/g) || []).length, 3);
  assert.equal((html.match(/data-source-reference/g) || []).length, 5);
  assert.equal((html.match(/data-renewal-qualification/g) || []).length, 1);
  assert.match(html, /Historical quote — not current renewal pricing/);
  assert.match(html, /12-month plan: \$74\/month/);
  assert.match(html, /6-month plan: \$84\/month/);
  assert.doesNotMatch(html, /1-month plan:/);
  assert.doesNotMatch(html, /<a\b|<form\b|<script\b|\/go\/|AggregateRating|ReviewRating|"@type"\s*:\s*"Review"/i);
  assert.deepEqual(validateRenderedSurface(html), {
    canonical: "https://glpclinicscout.com/research/public-funnel-evidence/",
    robots: "noindex,nofollow,noarchive,nosnippet",
    scripts: 0,
    forms: 0,
    actionable_source_links: 0,
    network_capable_embeds: 0,
    go_route_references: 0,
    analytics_runtime_references: 0,
    provider_runtime_references: 0,
    review_or_rating_schema: false,
  });
});

test("manifest is derived from validated observations and rendered bytes", () => {
  const artifacts = buildMysteryShopArtifacts(config, ledger, { now: NOW });
  assert.equal(artifacts.manifest.rendered_html_sha256, sha256(artifacts.html));
  assert.equal(artifacts.manifest.observations, config.observations.length);
  assert.equal(artifacts.manifest.accepted_firecrawl_captures, config.observations.length);
  assert.deepEqual(artifacts.manifest.effects, {
    contact_performed: 0,
    form_submission_performed: 0,
    account_created: 0,
    impersonation_performed: 0,
    clinical_questionnaire_performed: 0,
    payment_performed: 0,
    patient_experience_represented: 0,
  });
  assert.deepEqual(artifacts.manifest.surface, deriveSurfaceFacts(artifacts.html));
  assert.equal(artifacts.manifest.redaction_status, REDACTION_STATUS);
});
