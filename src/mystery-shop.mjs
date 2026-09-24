import { createHash } from "node:crypto";
import { applyStandaloneDarkTheme } from "./standalone-dark-theme.mjs";
import { authorityFor, materialQualificationsFor } from "/home/ubuntu/business/scripts/glp_evidence_ledger.mjs";
export { loadEvidenceInputs } from "/home/ubuntu/business/scripts/glp_evidence_ledger.mjs";

export const EVIDENCE_SCHEMA = "glp-clinic-scout-public-funnel-evidence-v2";
export const LEDGER_SCHEMA = "glp-wave4-firecrawl-source-capture-ledger-v1";
export const EXPECTED_LEDGER_PAYLOAD_SHA256 = "ef4d6c369a4706103c98e59022580fa892d25d66238f3a48bcbddcbb8ad54d2a";
export const EXPECTED_LEDGER_FILE_SHA256 = "65327bb0db8b99bd4cb556eb04619f63b6d9f3c86907bcfd8fea9d1427fea31c";
export const EXPECTED_LEDGER_CANONICAL_SHA256 = "f09630084cff2afce1c367edd12876a6f5acb37942bf134d91ba980e2bbe8efe";
export function evidenceLedgerAuthority(ledger) {
  return authorityFor(ledger) || {
    file_sha256: EXPECTED_LEDGER_FILE_SHA256,
    canonical_sha256: EXPECTED_LEDGER_CANONICAL_SHA256,
    payload_sha256: EXPECTED_LEDGER_PAYLOAD_SHA256,
    source_file: "data/wave4-source-capture-ledger.json",
  };
}
export const ROUTE = "/research/public-funnel-evidence/";
export const CANONICAL_URL = `https://glpclinicscout.com${ROUTE}`;
export const REDACTION_STATUS = "NOT_APPLICABLE_NO_PII_COLLECTED_OR_STORED";

const DAY_MS = 86_400_000;
const MAX_AGE_MS = 45 * DAY_MS;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[a-z0-9-]+$/;

const TOP_LEVEL_KEYS = Object.freeze([
  "schema",
  "evidence_scope",
  "public_only",
  "methodology",
  "source_capture_ledger",
  "review_rule_capture_id",
  "observations",
]);
const LEDGER_REFERENCE_KEYS = Object.freeze([
  "schema",
  "source_file",
  "generated_at_utc",
  "ledger_payload_sha256",
  "ledger_file_sha256",
]);
const OBSERVATION_KEYS = Object.freeze([
  "id",
  "provider_id",
  "page",
  "observed_at",
  "capture_provider",
  "capture_id",
  "scrape_id",
  "capture_disposition",
  "requested_url",
  "resolved_url",
  "status_code",
  "source_excerpt",
  "source_excerpt_sha256",
  "evidence_sha256",
  "contact_performed",
  "form_submission_performed",
  "account_created",
  "impersonation_performed",
  "clinical_questionnaire_performed",
  "payment_performed",
  "patient_experience_represented",
  "redaction_status",
]);
const ACTION_FLAGS = Object.freeze([
  "contact_performed",
  "form_submission_performed",
  "account_created",
  "impersonation_performed",
  "clinical_questionnaire_performed",
  "payment_performed",
  "patient_experience_represented",
]);
const LEDGER_TOP_LEVEL_KEYS = Object.freeze([
  "accepted_records",
  "effects",
  "generated_at_utc",
  "ledger_payload_sha256",
  "records",
  "rejected_records",
  "schema",
]);
const LEDGER_EFFECT_KEYS = Object.freeze([
  "accounts_created",
  "deployments",
  "emails",
  "provider_forms",
  "provider_writes",
  "spend_usd",
]);
const LEDGER_RECORD_KEYS = Object.freeze([
  "cached_at",
  "capture_id",
  "disposition",
  "exact_quote",
  "exact_quote_sha256",
  "provider",
  "requested_url",
  "resolved_url",
  "scrape_id",
  "status_code",
]);

// These digests and identifiers are independent pins from the authoritative
// Firecrawl ledger. Mutating a quote and recomputing adjacent hashes cannot
// create a newly accepted capture.
const ACCEPTED_CAPTURE_PINS = Object.freeze({
  "ro-weight-loss-pricing-20260802": Object.freeze({
    provider_id: "ro",
    scrape_id: "01a0a7c0-1a1b-7396-9b2a-3886b7bb9755",
    requested_url: "https://ro.co/weight-loss/pricing/",
    resolved_url: "https://ro.co/weight-loss/pricing/",
    exact_quote_sha256: "5a5fe716e62ea4e88d16b58f6e0bf9f022b9a95bca09fc172ce7e42f38644022",
    status_code: 200,
  }),
  "weightwatchers-clinic-pricing-20260802": Object.freeze({
    provider_id: "weightwatchers",
    scrape_id: "019fc020-fe2a-7747-b317-2c15ba8985ff",
    requested_url: "https://www.weightwatchers.com/us/clinic/weight-loss-medication",
    resolved_url: "https://www.weightwatchers.com/us/weight-loss-medication",
    exact_quote_sha256: "21647b079c6ec9d811db86d952cf62088a9271395ae8cb65f9449a9cbe7ab251",
    status_code: 200,
  }),
  "plushcare-glp1-pricing-20260802": Object.freeze({
    provider_id: "plushcare",
    scrape_id: "01a0a7ff-5b24-7516-9fdd-e798db145f11",
    requested_url: "https://plushcare.com/glp-1-prescription/",
    resolved_url: "https://plushcare.com/glp-1-prescription",
    exact_quote_sha256: "245f2f94013a8a529983d06d9d11f8ec6a4750ba50b514d9aadb3e54d5c6d203",
    status_code: 200,
  }),
  "ftc-fake-review-rule-20260802": Object.freeze({
    provider_id: "ftc",
    scrape_id: "01a0a7ff-6c54-741d-85f8-10e1063062d4",
    requested_url: "https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials",
    resolved_url: "https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials",
    exact_quote_sha256: "0c8ab5d2a6454903bd5d299318e142cbc0e887533746b74ca5e64fb55290944f",
    status_code: 200,
  }),
});

const OFFICIAL_HOSTS = Object.freeze({
  ro: new Set(["ro.co"]),
  weightwatchers: new Set(["www.weightwatchers.com"]),
  plushcare: new Set(["plushcare.com"]),
  ftc: new Set(["www.ftc.gov"]),
});

const PII_KEY = /^(?:email|e_mail|phone|telephone|mobile|address|street_address|patient_name|patient_email|patient_phone|full_name|first_name|last_name|dob|date_of_birth|ssn|social_security|payment_card|card_number|order_id|diagnosis|bmi|prescription_details)$/i;
const PII_VALUE_PATTERNS = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:^|\D)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?:\D|$)/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct)\b/i,
  /\b(?:patient|member)\s+(?:name|email|phone|address)\s*:/i,
]);
const UNSUPPORTED_CLAIM = /(?:\bI (?:was|am) (?:a )?patient\b|\bmy (?:doctor|clinician|provider|treatment|diagnosis)\b|\b(?:doctor|clinician|provider) (?:treated|diagnosed|prescribed)\b|\b(?:treatment|medicine|program) (?:was|is) (?:safe|effective|excellent)\b|\b(?:medical|clinical) outcome\b|\bpatient experience\b|\b(?:lost|gained) \d+(?:\.\d+)? (?:lb|lbs|pounds)\b|\b[1-5](?:\.\d+)?[- ]star(?:s)?\b|\b(?:customer|patient) review\b)/i;

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, expected, label) {
  if (!isPlainObject(value)) throw new Error(`${label}_object_invalid`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    const unknown = actual.filter((key) => !wanted.includes(key));
    const missing = wanted.filter((key) => !actual.includes(key));
    throw new Error(`${label}_schema_invalid:unknown=${unknown.join(",")}:missing=${missing.join(",")}`);
  }
}

function assertNoPii(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPii(item, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (PII_KEY.test(key)) throw new Error(`pii_key_forbidden:${path}.${key}`);
      assertNoPii(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && PII_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`pii_value_forbidden:${path}`);
  }
}

function parseFreshInstant(value, nowMs, label) {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) throw new Error(`${label}_timestamp_invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > nowMs || nowMs - parsed > MAX_AGE_MS) throw new Error(`${label}_freshness_invalid`);
  return parsed;
}

function parseHttpsUrl(value, providerId, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label}_url_invalid`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(`${label}_url_invalid`);
  const hosts = OFFICIAL_HOSTS[providerId];
  if (!hosts?.has(parsed.hostname)) throw new Error(`${label}_host_invalid`);
  return parsed;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateLedger(ledger, nowMs) {
  const authority = evidenceLedgerAuthority(ledger);
  assertNoPii(ledger, "$ledger");
  assertExactKeys(ledger, LEDGER_TOP_LEVEL_KEYS, "capture_ledger");
  assertExactKeys(ledger.effects, LEDGER_EFFECT_KEYS, "capture_ledger_effects");
  for (const key of LEDGER_EFFECT_KEYS) if (!Number.isInteger(ledger.effects[key]) || ledger.effects[key] !== 0) throw new Error(`capture_ledger_effect_nonzero:${key}`);
  if (sha256(canonicalJson(ledger)) !== authority.canonical_sha256) throw new Error("capture_ledger_canonical_binding_invalid");
  if (ledger.schema !== LEDGER_SCHEMA || ledger.ledger_payload_sha256 !== authority.payload_sha256) throw new Error("capture_ledger_authority_invalid");
  parseFreshInstant(ledger.generated_at_utc, nowMs, "capture_ledger_generated_at");
  if (!Array.isArray(ledger.records) || ledger.records.length !== ledger.accepted_records + ledger.rejected_records) throw new Error("capture_ledger_counts_invalid");
  const records = new Map();
  for (const row of ledger.records) {
    assertExactKeys(row, LEDGER_RECORD_KEYS, "capture_ledger_record");
    if (!ID.test(row.capture_id) || records.has(row.capture_id) || !UUID.test(row.scrape_id)) throw new Error("capture_ledger_record_identity_invalid");
    if (row.provider !== "firecrawl" || !["ACCEPTED", "REJECTED_SOURCE_404"].includes(row.disposition)) throw new Error("capture_ledger_record_disposition_invalid");
    if (!SHA256.test(row.exact_quote_sha256) || sha256(row.exact_quote) !== row.exact_quote_sha256) throw new Error("capture_ledger_quote_hash_invalid");
    if (row.cached_at !== null) parseFreshInstant(row.cached_at, nowMs, "capture_cached_at");
    records.set(row.capture_id, row);
  }
  const accepted = [...records.values()].filter((row) => row.disposition === "ACCEPTED");
  if (accepted.length !== ledger.accepted_records) throw new Error("capture_ledger_accepted_count_invalid");
  for (const [captureId, pin] of Object.entries(ACCEPTED_CAPTURE_PINS)) {
    const row = records.get(captureId);
    if (!row || row.disposition !== "ACCEPTED") throw new Error(`accepted_capture_missing:${captureId}`);
    for (const [key, expected] of Object.entries({
      scrape_id: pin.scrape_id,
      requested_url: pin.requested_url,
      resolved_url: pin.resolved_url,
      exact_quote_sha256: pin.exact_quote_sha256,
      status_code: pin.status_code,
    })) if (row[key] !== expected) throw new Error(`accepted_capture_pin_invalid:${captureId}:${key}`);
    parseHttpsUrl(row.requested_url, pin.provider_id, "capture_requested");
    parseHttpsUrl(row.resolved_url, pin.provider_id, "capture_resolved");
  }
  return records;
}

export function buildEvidenceProvenanceTuple(config, row, capture) {
  return {
    evidence_schema: config.schema,
    evidence_scope: config.evidence_scope,
    public_only: config.public_only,
    source_capture_ledger: config.source_capture_ledger,
    observation: Object.fromEntries(Object.entries(row).filter(([key]) => key !== "evidence_sha256")),
    accepted_firecrawl_capture: {
      provider: capture.provider,
      capture_id: capture.capture_id,
      scrape_id: capture.scrape_id,
      disposition: capture.disposition,
      requested_url: capture.requested_url,
      resolved_url: capture.resolved_url,
      status_code: capture.status_code,
      exact_quote: capture.exact_quote,
      exact_quote_sha256: capture.exact_quote_sha256,
    },
  };
}

export function computeEvidenceSha256(config, row, capture) {
  return sha256(canonicalJson(buildEvidenceProvenanceTuple(config, row, capture)));
}


// ONE selector, used by the validator AND the renderer. Duplicating the filter let them diverge: the
// validator filtered on capture_id and fetched_at while the renderer used the raw list with .find(),
// so a qualification missing ONE field was skipped by the validator, slipped past the ambiguity
// check, and was still picked by the renderer -- validating $84 and publishing $999. A shared
// selector makes that class of divergence unrepresentable.
function selectQualifications(ledger) {
  const usable = materialQualificationsFor(ledger).filter(
    (q) => q && q.material && q.material.observation_id && q.material.capture_id
           && typeof q.fetched_at === "string");
  // ANY duplicate observation_id is refused, counted on the RAW list so dropping a field cannot hide
  // a second claimant from the ambiguity check.
  const rawIds = materialQualificationsFor(ledger)
    .map((q) => q && q.material && q.material.observation_id).filter(Boolean);
  if (new Set(rawIds).size !== rawIds.length) throw new Error("observation_qualification_ambiguous");
  // A qualification that is present but unusable is a defect, never something to silently skip.
  if (usable.length !== rawIds.length) throw new Error("observation_qualification_malformed");
  return new Map(usable.map((q) => [q.material.observation_id, q]));
}

export function validateMysteryShop(config, ledger, { now = new Date().toISOString(), ledgerFileSha256 } = {}) {
  const authority = evidenceLedgerAuthority(ledger);
  ledgerFileSha256 ??= authority.file_sha256;
  if (typeof now !== "string" || !ISO_INSTANT.test(now) || !Number.isFinite(Date.parse(now))) throw new Error("validation_clock_invalid");
  const nowMs = Date.parse(now);
  assertNoPii(config);
  assertExactKeys(config, TOP_LEVEL_KEYS, "evidence_top_level");
  assertExactKeys(config.source_capture_ledger, LEDGER_REFERENCE_KEYS, "evidence_ledger_reference");
  if (config.schema !== EVIDENCE_SCHEMA || config.evidence_scope !== "PUBLIC_UNAUTHENTICATED_PAGE_CAPTURE_AUDIT" || config.public_only !== true) throw new Error("evidence_authority_invalid");
  if (config.methodology !== "Only public, unauthenticated pages were captured. No staff contact, form submission, account creation, impersonation, clinical questionnaire, payment, or patient experience occurred or was represented.") throw new Error("evidence_methodology_invalid");
  if (config.source_capture_ledger.schema !== LEDGER_SCHEMA || config.source_capture_ledger.source_file !== authority.source_file || config.source_capture_ledger.ledger_payload_sha256 !== authority.payload_sha256 || config.source_capture_ledger.ledger_file_sha256 !== authority.file_sha256 || ledgerFileSha256 !== authority.file_sha256) throw new Error("evidence_ledger_binding_invalid");
  parseFreshInstant(config.source_capture_ledger.generated_at_utc, nowMs, "evidence_ledger_generated_at");
  const records = validateLedger(ledger, nowMs);
  if (config.source_capture_ledger.generated_at_utc !== ledger.generated_at_utc) throw new Error("evidence_ledger_timestamp_mismatch");
  const reviewRule = records.get(config.review_rule_capture_id);
  if (!reviewRule || config.review_rule_capture_id !== "ftc-fake-review-rule-20260802" || reviewRule.disposition !== "ACCEPTED") throw new Error("review_rule_capture_invalid");
  if (!Array.isArray(config.observations) || config.observations.length !== 3) throw new Error("observations_count_invalid");
  const ids = new Set();
  const captures = new Set();
  // A qualification may only relax the observation it actually belongs to. Keying on
  // material.observation_id alone let a qualification for one observation carry another's clock --
  // the consumer is an INDEPENDENT check and must not rely on the chain's validator for this.
  const observationQualifications = selectQualifications(ledger);
  const qualificationCaptureFor = (observationId) => {
    const q = observationQualifications.get(observationId);
    return q ? q.material.capture_id : null;
  };
  for (const row of config.observations) {
    assertExactKeys(row, OBSERVATION_KEYS, "observation");
    if (typeof row.id !== "string" || !ID.test(row.id) || ids.has(row.id)) throw new Error("evidence_id_invalid");
    ids.add(row.id);
    if (typeof row.provider_id !== "string" || !OFFICIAL_HOSTS[row.provider_id]) throw new Error("provider_id_invalid");
    if (typeof row.page !== "string" || row.page.length < 3 || row.page.length > 100 || /[<>]/.test(row.page)) throw new Error("page_label_invalid");
    // SHAPE and FUTURE-DATE are checked on observed_at ALWAYS -- an earlier attempt routed around
    // parseFreshInstant entirely here and left observed_at validated by nothing, so "2099-01-01" and
    // "not-a-timestamp" both rendered verbatim on the page (ORACLE-REVIEW-RESULT.json, 2026-09-16).
    const observedMs = Date.parse(row.observed_at);
    if (!ISO_INSTANT.test(row.observed_at) || !Number.isFinite(observedMs) || observedMs > nowMs) {
      throw new Error("observation_timestamp_invalid");
    }
    // Only the AGE is measured against a different clock, and only for an observation whose capture
    // carries an authenticated material QUALIFICATION. create_successor records such an observation as
    // HISTORICAL_LINEAGE_PRESERVED and never advances observed_at, and the card renders it under
    // "Historical quote - not current renewal pricing", so dating its age from a timestamp the design
    // deliberately freezes made the build certain to fail 45 days after every qualification. A stale or
    // absent qualification still fails, and an unqualified observation is unchanged.
    const qualification = observationQualifications.get(row.id);
    if (qualification && qualificationCaptureFor(row.id) !== row.capture_id) {
      throw new Error("observation_qualification_capture_mismatch");
    }
    if (qualification) {
      // The preserved observation must be BOUNDED BY the qualification, or measuring its age against
      // the qualification's clock lets it be backdated arbitrarily: with adjacent hashes recomputed,
      // observed_at "1970-01-01" passed. A preserved historical quote must (a) predate the
      // qualification that supersedes it, and (b) have still been FRESH when that qualification was
      // taken -- which is what makes it a lineage predecessor rather than an unrelated old date.
      const qualifiedMs = Date.parse(qualification.fetched_at);
      if (!Number.isFinite(qualifiedMs) || observedMs > qualifiedMs) throw new Error("observation_after_qualification_invalid");
      if (qualifiedMs - observedMs > MAX_AGE_MS) throw new Error("observation_qualification_lineage_invalid");
    }
    parseFreshInstant(qualification ? qualification.fetched_at : row.observed_at, nowMs, "observation");
    if (!qualification && observedMs > Date.parse(config.source_capture_ledger.generated_at_utc)) throw new Error("observation_after_ledger_invalid");
    if (row.capture_provider !== "firecrawl" || row.capture_disposition !== "ACCEPTED" || !UUID.test(row.scrape_id) || row.status_code !== 200) throw new Error("observation_capture_invalid");
    if (captures.has(row.capture_id)) throw new Error("observation_capture_reused");
    captures.add(row.capture_id);
    const pin = ACCEPTED_CAPTURE_PINS[row.capture_id];
    const capture = records.get(row.capture_id);
    if (!pin || !capture || pin.provider_id !== row.provider_id || capture.disposition !== "ACCEPTED") throw new Error("observation_capture_unaccepted");
    parseHttpsUrl(row.requested_url, row.provider_id, "observation_requested");
    parseHttpsUrl(row.resolved_url, row.provider_id, "observation_resolved");
    const exactBindings = {
      scrape_id: capture.scrape_id,
      requested_url: capture.requested_url,
      resolved_url: capture.resolved_url,
      status_code: capture.status_code,
      source_excerpt: capture.exact_quote,
      source_excerpt_sha256: capture.exact_quote_sha256,
    };
    for (const [key, expected] of Object.entries(exactBindings)) if (row[key] !== expected) throw new Error(`observation_capture_binding_invalid:${row.id}:${key}`);
    if (!SHA256.test(row.source_excerpt_sha256) || sha256(row.source_excerpt) !== row.source_excerpt_sha256) throw new Error("source_excerpt_hash_invalid");
    if (UNSUPPORTED_CLAIM.test(`${row.page}\n${row.source_excerpt}`)) throw new Error("unsupported_clinical_or_review_claim");
    for (const flag of ACTION_FLAGS) if (row[flag] !== false) throw new Error(`public_only_flag_invalid:${flag}`);
    if (row.redaction_status !== REDACTION_STATUS) throw new Error("redaction_status_invalid");
    if (!SHA256.test(row.evidence_sha256) || computeEvidenceSha256(config, row, capture) !== row.evidence_sha256) throw new Error("evidence_provenance_hash_invalid");
  }
  return {
    status: "PASS_CLEAN_ROOM_PUBLIC_EVIDENCE",
    observations: config.observations.length,
    evidence_status: "UNTESTED_PUBLIC_PAGE_CAPTURE",
    tested_observations: 0,
    untested_observations: config.observations.length,
    public_only: true,
    accepted_firecrawl_captures: config.observations.length,
  };
}

function sourceBlock(row, qualification, now) {
  let qualificationHtml = "";
  if (qualification) {
    parseFreshInstant(qualification.fetched_at, Date.parse(now), "renewal_qualification");
    const terms = qualification.material.renewal_terms.map(term => `${esc(term.term_months)}-month plan: $${esc(term.monthly_usd)}/month`).join("; ");
    qualificationHtml = `<section data-renewal-qualification><h3>Renewal pricing qualified by plan term</h3><p>After the first month and at auto-renewal: ${terms}. Cost of GLP-1 medications not included.</p><blockquote>${esc(qualification.material.exact_quote)}</blockquote><p data-source-reference>First-party source (plain text): ${esc(qualification.source_url)} · captured ${esc(qualification.fetched_at)} · Firecrawl scrape ID ${esc(qualification.scrape_id)} · content SHA-256 ${esc(qualification.content_sha256)} · capture SHA-256 ${esc(qualification.capture_sha256)}</p></section><h3>Historical quote — not current renewal pricing</h3>`;
  }
  return `<article class="observation" data-observation data-evidence-status="UNTESTED_PUBLIC_PAGE_CAPTURE"><p class="eyebrow">${esc(row.provider_id)} · ${esc(row.page)}</p><p class="evidence-status"><strong>Evidence status: UNTESTED</strong> · Public-page capture only; no staff, account, checkout, payment, or patient-experience test occurred.</p>${qualificationHtml}<blockquote>${esc(row.source_excerpt).replaceAll("\n", "<br>")}</blockquote><dl><div><dt>Observed</dt><dd>${esc(row.observed_at)}</dd></div><div><dt>Firecrawl scrape ID</dt><dd><code>${esc(row.scrape_id)}</code></dd></div><div><dt>Exact excerpt SHA-256</dt><dd><code>${esc(row.source_excerpt_sha256)}</code></dd></div><div><dt>Complete provenance SHA-256</dt><dd><code>${esc(row.evidence_sha256)}</code></dd></div><div><dt>First-party source (plain text)</dt><dd><code data-source-reference>${esc(row.resolved_url)}</code></dd></div></dl></article>`;
}

function renderMysteryShopUnthemed(config, ledger, { now = new Date().toISOString() } = {}) {
  validateMysteryShop(config, ledger, now ? { now } : {});
  const reviewRule = ledger.records.find((row) => row.capture_id === config.review_rule_capture_id);
  const qualifications = selectQualifications(ledger);
  const cards = config.observations.map(row => sourceBlock(row, qualifications.get(row.id), now)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><link rel="canonical" href="${CANONICAL_URL}"><title>Public-page evidence audit · Clinic Scout</title><style>:root{color-scheme:light;--ink:#17313d;--navy:#0c2130;--paper:#f5f0e7;--panel:#fffdfa;--line:#d5d9d6;--sage:#315f55}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,sans-serif}main{width:min(980px,calc(100% - 32px));margin:auto;padding:48px 0 80px}h1,h2{color:var(--navy);line-height:1.1}h1{font-size:clamp(2.25rem,6vw,4.5rem);max-width:16ch}.eyebrow{color:var(--sage);font-size:.78rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.notice,.observation{margin:24px 0;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}.observations{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:18px}.observations .observation{margin:0}blockquote{margin:18px 0;white-space:normal}.evidence-status{padding:10px 12px;border-left:3px solid var(--sage);background:#edf4f0}dl div{padding:10px 0;border-top:1px solid var(--line)}dt{font-weight:750}dd{margin:4px 0 0;overflow-wrap:anywhere}code{font:12px/1.5 ui-monospace,monospace}small{color:#53666d}p,li,dd,dt,blockquote,code,h1,h2{overflow-wrap:anywhere}</style></head><body><main><header><p class="eyebrow">Wave 4 · clean-room public evidence</p><h1>Public-page evidence audit—not mystery shopping or a patient review.</h1><p>${esc(config.methodology)}</p><p class="evidence-status" data-evidence-status="UNTESTED_PUBLIC_PAGE_CAPTURE"><strong>Evidence status: UNTESTED_PUBLIC_PAGE_CAPTURE.</strong> All observations below are public-page captures. Tested staff, account, checkout, payment, and patient-experience evidence count: 0.</p></header><aside class="notice"><h2>What this evidence cannot establish</h2><p>Captured public pricing text does not establish treatment quality, clinician competence, medical outcomes, checkout completion, customer sentiment, or first-person experience.</p><p><strong>Redaction status:</strong> ${esc(REDACTION_STATUS)}. No PII was collected or stored, so no redaction was performed.</p></aside><section aria-labelledby="observations-title"><h2 id="observations-title">Accepted Firecrawl captures</h2><div class="observations">${cards}</div></section><section class="notice" aria-labelledby="method-title"><h2 id="method-title">Method and review-rule boundary</h2><p>The evidence was limited to exact excerpts from accepted public-page captures. Source references are deliberately plain text and non-actionable.</p><p><strong>FTC rule source (plain text):</strong> <code data-source-reference>${esc(reviewRule.resolved_url)}</code></p><p><strong>FTC Firecrawl scrape ID:</strong> <code>${esc(reviewRule.scrape_id)}</code></p><p><small>Link-dark review candidate. No forms, scripts, analytics runtime, consent runtime, provider runtime, account flow, payment flow, or outbound action is present on this route.</small></p></section></main><footer><p>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</p></footer></body></html>`;
}

export function renderMysteryShop(config, ledger, { now } = {}) {
  return applyStandaloneDarkTheme(renderMysteryShopUnthemed(config, ledger, { now }), "public-funnel-evidence");
}

export function deriveSurfaceFacts(html) {
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1] || null;
  const robots = html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i)?.[1] || null;
  return {
    canonical,
    robots,
    scripts: (html.match(/<script\b/gi) || []).length,
    forms: (html.match(/<form\b/gi) || []).length,
    actionable_source_links: (html.match(/<a\b/gi) || []).length,
    network_capable_embeds: (html.match(/<(?:img|iframe|video|audio|source|object|embed)\b|<link\b(?![^>]*\brel="canonical")/gi) || []).length,
    go_route_references: (html.match(/\/go\//gi) || []).length,
    analytics_runtime_references: (html.match(/GCS_ANALYTICS|analytics\.js|gtag\(|clarity\(/gi) || []).length,
    provider_runtime_references: (html.match(/provider[_-](?:runtime|call)|\/api\//gi) || []).length,
    review_or_rating_schema: /AggregateRating|ReviewRating|"@type"\s*:\s*"Review"|itemprop="ratingValue"/i.test(html),
  };
}

export function validateRenderedSurface(html) {
  const facts = deriveSurfaceFacts(html);
  if (facts.canonical !== CANONICAL_URL) throw new Error("surface_canonical_invalid");
  if (facts.robots !== "noindex,nofollow,noarchive,nosnippet") throw new Error("surface_robots_invalid");
  for (const key of ["scripts", "forms", "actionable_source_links", "network_capable_embeds", "go_route_references", "analytics_runtime_references", "provider_runtime_references"]) {
    if (facts[key] !== 0) throw new Error(`surface_forbidden:${key}`);
  }
  if (facts.review_or_rating_schema) throw new Error("surface_review_rating_schema_forbidden");
  return facts;
}

function deriveEffects(observations) {
  return Object.fromEntries(ACTION_FLAGS.map((flag) => [flag, observations.filter((row) => row[flag] === true).length]));
}

export function buildMysteryShopArtifacts(config, ledger, { now } = {}) {
  const validation = validateMysteryShop(config, ledger, now ? { now } : {});
  const html = renderMysteryShop(config, ledger, { now });
  const surface = validateRenderedSurface(html);
  const effects = deriveEffects(config.observations);
  if (Object.values(effects).some((count) => count !== 0)) throw new Error("derived_effects_nonzero");
  return {
    html,
    manifest: {
      schema: "wave4-public-funnel-evidence-build-v2",
      status: "PASS_CLEAN_ROOM_LOCAL_VALIDATION_PROVIDER_DEPLOY_HELD",
      route: ROUTE,
      publication_state: "LINK_DARK_BRIDGE_REVIEW_REQUIRED",
      evidence_schema: config.schema,
      source_capture_ledger_payload_sha256: config.source_capture_ledger.ledger_payload_sha256,
      source_capture_ledger_file_sha256: config.source_capture_ledger.ledger_file_sha256,
      observations: validation.observations,
      accepted_firecrawl_captures: validation.accepted_firecrawl_captures,
      evidence_status: validation.evidence_status,
      tested_observations: validation.tested_observations,
      untested_observations: validation.untested_observations,
      public_only: validation.public_only,
      redaction_status: REDACTION_STATUS,
      effects,
      surface,
      observation_evidence_sha256: config.observations.map((row) => ({ id: row.id, evidence_sha256: row.evidence_sha256 })),
      rendered_html_sha256: sha256(html),
    },
  };
}
