import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEvidenceInputs, materialQualificationsFor } from "../../../../../scripts/glp_evidence_ledger.mjs";
import { applyStandaloneDarkTheme } from "./standalone-dark-theme.mjs";

const ROUTE = "/tools/glp-1-price-tracker/";
const CANONICAL_URL = `https://glpclinicscout.com${ROUTE}`;
const MAX_AGE_MS = 45 * 86_400_000;
const LEDGER_BINDING = Object.freeze({
  schema: "glp-wave4-firecrawl-source-capture-ledger-v1",
  ledger_payload_sha256: "ef4d6c369a4706103c98e59022580fa892d25d66238f3a48bcbddcbb8ad54d2a",
  generated_at_utc: "2026-08-02T01:41:56.582193Z",
});
const TOP_LEVEL_KEYS = ["alert_dispatch_state", "methodology", "price_index", "publication_state", "records", "schema", "source_ledger"];
const SOURCE_LEDGER_KEYS = ["generated_at_utc", "ledger_payload_sha256", "schema"];
const RECORD_KEYS = [
  "amount_qualifier", "amount_usd", "billing_cadence", "checked_at", "commitment_months", "commitment_type", "id",
  "medication_included", "prepayment", "price_phase", "price_type", "program_name", "provider_id", "provider_name",
  "quote", "quote_sha256", "source_capture_id", "source_scrape_id", "source_url",
];
const ALERT_INPUT_KEYS = ["current", "previous", "subscriptions"];
const SUBSCRIPTION_KEYS = ["active", "consent", "id", "provider_id", "suppressed", "unsubscribed"];
const ALLOWED_SOURCE_HOSTS = new Set(["ro.co", "www.weightwatchers.com", "lifemd.com", "plushcare.com"]);
const FORBIDDEN_PII_KEYS = /^(diagnosis|bmi|insurance|medication_history|eligibility_answers|email|phone|patient|dose|name|address)$/i;
const FORBIDDEN_PII_VALUES = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:patient|diagnos(?:is|ed)|medical record|member id|date of birth|dob|bmi)\b)/i;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,127}$/;
const OPAQUE_SUBSCRIPTION_ID = /^sub-[a-f0-9]{16,64}$/;
const BILLING_CADENCES = new Set(["monthly", "monthly_equivalent", "one_time"]);
const COMMITMENT_TYPES = new Set(["fixed", "cancel_anytime", "one_time"]);
const PRICE_PHASES = new Set(["initial", "ongoing"]);
const PREPAYMENT_TYPES = new Set(["annual_required", "not_stated", "not_applicable"]);

const ACCEPTED_ROWS = [
  {
    id: "ro-body-annual-prepay", provider_id: "ro", provider_name: "Ro Body", program_name: "Body Program", price_type: "membership", amount_usd: 74,
    amount_qualifier: "monthly equivalent after the first month; 12-month plan prepaid annually; selected plan determines the $74–$149 range",
    billing_cadence: "monthly_equivalent", commitment_type: "fixed", commitment_months: 12, price_phase: "ongoing", prepayment: "annual_required", medication_included: false,
    quote: "First month for $39\n\nAfter your first month, you’ll be charged $74-149/mo depending on the plan you choose.\n\nThe Ro Body membership costs $39 for the first month and as low as $74/month when you prepay for an annual plan.\n\nPlease note that the cost of GLP-1 medication is not included in the membership cost.",
    quote_sha256: "5a5fe716e62ea4e88d16b58f6e0bf9f022b9a95bca09fc172ce7e42f38644022", source_url: "https://ro.co/weight-loss/pricing/", source_capture_id: "ro-weight-loss-pricing-20260802", source_scrape_id: "019fc020-f65c-771b-a062-2308edec20fa", checked_at: "2026-08-02T00:59:14.957Z",
  },
  {
    id: "weightwatchers-ongoing-12", provider_id: "weightwatchers", provider_name: "WeightWatchers Clinic", program_name: "GLP-1 Program", price_type: "membership", amount_usd: 74,
    amount_qualifier: "then $74 per month on a 12-month plan after a $25 first month; medication excluded",
    billing_cadence: "monthly", commitment_type: "fixed", commitment_months: 12, price_phase: "ongoing", prepayment: "not_stated", medication_included: false,
    quote: "$74 $25/first month\n\nThen, $74/month. GLP-1 meds cost not included\n\n$25/month for your first month with a 12-month or 6-month plan. Cost of GLP-1 medications not included.",
    quote_sha256: "21647b079c6ec9d811db86d952cf62088a9271395ae8cb65f9449a9cbe7ab251", source_url: "https://www.weightwatchers.com/us/clinic/weight-loss-medication", source_capture_id: "weightwatchers-clinic-pricing-20260802", source_scrape_id: "019fc020-fe2a-7747-b317-2c15ba8985ff", checked_at: "2026-08-02T01:41:56.582193Z",
  },
  {
    id: "lifemd-ongoing-monthly", provider_id: "lifemd", provider_name: "LifeMD", program_name: "Weight Management Program", price_type: "membership", amount_usd: 149,
    amount_qualifier: "after a $39 first month; monthly thereafter; cancel anytime; medication excluded",
    billing_cadence: "monthly", commitment_type: "cancel_anytime", commitment_months: null, price_phase: "ongoing", prepayment: "not_stated", medication_included: false,
    quote: "Our program starts as low as $39 for your first month, and just $149 a month thereafter with the flexibility to cancel anytime.\n\nMedication cost is not included and varies based on insurance coverage or self-pay options.",
    quote_sha256: "013b98d6db18ca35a78c166548cd83cd37e89ec79e44b61939858581d025e3d1", source_url: "https://lifemd.com/weight-management/", source_capture_id: "lifemd-weight-management-20260802", source_scrape_id: "019fc021-0b6e-76c8-92bd-9935423835b8", checked_at: "2026-08-01T17:13:43.040Z",
  },
  {
    id: "plushcare-initial-visit", provider_id: "plushcare", provider_name: "PlushCare", program_name: "GLP-1 prescription visit", price_type: "visit", amount_usd: 129,
    amount_qualifier: "initial visit; medication and lab work excluded",
    billing_cadence: "one_time", commitment_type: "one_time", commitment_months: null, price_phase: "initial", prepayment: "not_applicable", medication_included: false,
    quote: "$129\n\nInitial visits are $129.\n\nPlease note that any medication or lab work costs are not included.",
    quote_sha256: "245f2f94013a8a529983d06d9d11f8ec6a4750ba50b514d9aadb3e54d5c6d203", source_url: "https://plushcare.com/glp-1-prescription/", source_capture_id: "plushcare-glp1-pricing-20260802", source_scrape_id: "019fc021-215f-728c-854a-b1f09ca8c764", checked_at: "2026-08-02T00:15:58.903Z",
  },
];
function acceptedPriceTrackerRows() {
  const { ledger } = loadEvidenceInputs(fileURLToPath(new URL("../", import.meta.url)));
  return ACCEPTED_ROWS.map((original) => {
    const capture = ledger.records.find((row) => row.capture_id === original.source_capture_id);
    if (!capture || capture.disposition !== "ACCEPTED" || capture.requested_url !== original.source_url
        || capture.exact_quote !== original.quote || capture.exact_quote_sha256 !== original.quote_sha256) {
      throw new Error("tracker_accepted_capture_terms_changed");
    }
    // A qualification-only acceptance does not refresh the historical price.
    if (capture.scrape_id === original.source_scrape_id) return { ...original };
    return { ...original, quote: capture.exact_quote, quote_sha256: capture.exact_quote_sha256,
      source_capture_id: capture.capture_id, source_scrape_id: capture.scrape_id,
      checked_at: capture.cached_at };
  });
}

export function refreshPriceTrackerRecords(config) {
  const accepted = acceptedPriceTrackerRows();
  if (!Array.isArray(config.records)) throw new Error("tracker_records_invalid");
  const records = config.records.map((record) => {
    const original = ACCEPTED_ROWS.find((row) => row.id === record.id);
    // Refresh evidence clocks/identities, never silently change economic terms.
    if (!original || canonical({ ...record, source_scrape_id: original.source_scrape_id,
      checked_at: original.checked_at }) !== canonical(original)) throw new Error("tracker_evidence_binding_invalid");
    return { ...record, ...accepted.find((row) => row.id === record.id) };
  });
  const refreshed = { ...config, records };
  validatePriceTracker(refreshed);
  return refreshed;
}

const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const countMatches = (text, pattern) => (text.match(pattern) || []).length;

function assertExactKeys(value, expected, code) {
  if (!isObject(value) || canonical(Object.keys(value).sort()) !== canonical([...expected].sort())) throw new Error(code);
}

function validateTerms(record, code = "tracker_terms_invalid") {
  if (!BILLING_CADENCES.has(record.billing_cadence) || !COMMITMENT_TYPES.has(record.commitment_type) || !PRICE_PHASES.has(record.price_phase) || !PREPAYMENT_TYPES.has(record.prepayment)) throw new Error(code);
  if (record.commitment_type === "fixed") {
    if (!Number.isInteger(record.commitment_months) || record.commitment_months < 1 || record.commitment_months > 120) throw new Error(code);
  } else if (record.commitment_months !== null) throw new Error(code);
  if (record.billing_cadence === "one_time" && (record.commitment_type !== "one_time" || record.prepayment !== "not_applicable")) throw new Error(code);
  if (record.commitment_type === "one_time" && record.billing_cadence !== "one_time") throw new Error(code);
  if (record.prepayment === "annual_required" && (record.commitment_type !== "fixed" || record.commitment_months < 12 || record.billing_cadence !== "monthly_equivalent")) throw new Error(code);
  if (record.prepayment === "not_applicable" && record.commitment_type !== "one_time") throw new Error(code);
}

function validateTextFields(record, code = "tracker_text_invalid") {
  for (const key of ["id", "provider_id", "provider_name", "program_name", "price_type", "amount_qualifier", "quote", "quote_sha256", "source_capture_id", "source_scrape_id", "checked_at"]) {
    if (typeof record[key] !== "string" || record[key].trim() !== record[key] || record[key].length < 1 || record[key].length > 4000 || /[<>]/.test(record[key])) throw new Error(code);
  }
  if (!SAFE_ID.test(record.id) || !SAFE_ID.test(record.provider_id) || !SAFE_ID.test(record.source_capture_id)) throw new Error(code);
  if (!/^[a-f0-9]{64}$/.test(record.quote_sha256) || !/^[0-9a-f-]{36}$/.test(record.source_scrape_id)) throw new Error(code);
}

function validateRecordShape(record, schemaCode = "tracker_record_schema_invalid") {
  assertExactKeys(record, RECORD_KEYS, schemaCode);
  validateTextFields(record, schemaCode === "alert_record_schema_invalid" ? schemaCode : "tracker_text_invalid");
  if (!["membership", "visit"].includes(record.price_type) || !Number.isFinite(record.amount_usd) || record.amount_usd <= 0 || record.amount_usd > 100_000 || typeof record.medication_included !== "boolean") throw new Error(schemaCode === "alert_record_schema_invalid" ? schemaCode : "tracker_amount_or_inclusion_invalid");
  validateTerms(record, schemaCode === "alert_record_schema_invalid" ? schemaCode : "tracker_terms_invalid");
}

function validateSource(record) {
  let source;
  try { source = new URL(record.source_url); } catch { throw new Error("tracker_source_invalid"); }
  if (source.protocol !== "https:" || source.username || source.password || source.port || !ALLOWED_SOURCE_HOSTS.has(source.hostname)) throw new Error("tracker_source_invalid");
}

function parseNow(value) {
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("tracker_now_invalid");
  return milliseconds;
}

export function validatePriceTracker(config, { now = Date.now() } = {}) {
  const ACCEPTED_BY_SCRAPE_ID = new Map(acceptedPriceTrackerRows().map((row) => [row.source_scrape_id, row]));
  assertExactKeys(config, TOP_LEVEL_KEYS, "tracker_top_level_schema_invalid");
  if (config.schema !== "glp-clinic-scout-price-tracker-v2" || config.publication_state !== "LINK_DARK_REVIEW_REQUIRED" || config.alert_dispatch_state !== "HELD_NO_SEND") throw new Error("tracker_authority_invalid");
  if (typeof config.methodology !== "string" || config.methodology.length < 40 || /[<>]/.test(config.methodology)) throw new Error("tracker_methodology_invalid");
  assertExactKeys(config.source_ledger, SOURCE_LEDGER_KEYS, "tracker_source_ledger_schema_invalid");
  if (canonical(config.source_ledger) !== canonical(LEDGER_BINDING)) throw new Error("tracker_source_ledger_binding_invalid");
  if (!Array.isArray(config.records) || config.records.length !== ACCEPTED_ROWS.length) throw new Error("tracker_records_invalid");

  const nowMs = parseNow(now);
  const ids = new Set();
  const scrapeIds = new Set();
  // Keyed by the capture the qualification actually names, so a receipt cannot relax a different row.
  const trackerQualifications = new Map(
    materialQualificationsFor(loadEvidenceInputs(fileURLToPath(new URL("../", import.meta.url))).ledger)
      .filter((q) => q.material && q.material.capture_id && typeof q.fetched_at === "string")
      .map((q) => [q.material.capture_id, q]));
  for (const record of config.records) {
    validateRecordShape(record);
    validateSource(record);
    if (ids.has(record.id) || scrapeIds.has(record.source_scrape_id)) throw new Error("tracker_record_duplicate");
    ids.add(record.id); scrapeIds.add(record.source_scrape_id);
    // A qualification-only acceptance deliberately keeps the HISTORICAL price and its historical
    // checked_at (acceptedPriceTrackerRows returns the original unchanged, by design). Dating freshness
    // from that frozen timestamp made such a row certain to expire with no registered way to refresh
    // it -- weightwatchers-ongoing-12 did exactly that. The DISPLAYED checked_at stays historical,
    // because that IS when this price was checked; only the AGE is measured against the qualification's
    // own authenticated fetch. Same shape as the observation clock, and bounded the same way.
    const checkedMs = Date.parse(record.checked_at);
    if (!Number.isFinite(checkedMs) || checkedMs > nowMs) throw new Error("tracker_timestamp_invalid");
    const qualification = trackerQualifications.get(record.source_capture_id);
    if (qualification) {
      const qualifiedMs = Date.parse(qualification.fetched_at);
      if (!Number.isFinite(qualifiedMs) || checkedMs > qualifiedMs) throw new Error("tracker_after_qualification_invalid");
      if (qualifiedMs - checkedMs > MAX_AGE_MS) throw new Error("tracker_qualification_lineage_invalid");
      if (nowMs - qualifiedMs > MAX_AGE_MS) throw new Error("tracker_freshness_invalid");
    } else if (nowMs - checkedMs > MAX_AGE_MS) {
      throw new Error("tracker_freshness_invalid");
    }
    if (sha256(record.quote) !== record.quote_sha256) throw new Error("tracker_quote_hash_invalid");
    const accepted = ACCEPTED_BY_SCRAPE_ID.get(record.source_scrape_id);
    if (!accepted || canonical(record) !== canonical(accepted)) throw new Error("tracker_evidence_binding_invalid");
  }
  if (scrapeIds.size !== ACCEPTED_BY_SCRAPE_ID.size || [...ACCEPTED_BY_SCRAPE_ID.keys()].some((id) => !scrapeIds.has(id))) throw new Error("tracker_evidence_coverage_invalid");

  return {
    status: "PASS",
    record_count: config.records.length,
    record_ids: config.records.map((record) => record.id),
    source_scrape_ids: config.records.map((record) => record.source_scrape_id),
    source_ledger_payload_sha256: config.source_ledger.ledger_payload_sha256,
  };
}

function validateAlertRecord(record, nowMs) {
  const ACCEPTED_BY_SCRAPE_ID = new Map(acceptedPriceTrackerRows().map((row) => [row.source_scrape_id, row]));
  validateRecordShape(record, "alert_record_schema_invalid");
  if (Object.keys(record).some((key) => FORBIDDEN_PII_KEYS.test(key))) throw new Error("alert_record_schema_invalid");
  if (Object.values(record).some((value) => typeof value === "string" && FORBIDDEN_PII_VALUES.test(value))) throw new Error("alert_record_pii_invalid");
  validateSource(record);
  const checkedMs = Date.parse(record.checked_at);
  if (!Number.isFinite(checkedMs) || checkedMs > nowMs || nowMs - checkedMs > MAX_AGE_MS) throw new Error("alert_record_freshness_invalid");
  if (sha256(record.quote) !== record.quote_sha256) throw new Error("alert_record_quote_hash_invalid");
  const accepted = ACCEPTED_BY_SCRAPE_ID.get(record.source_scrape_id);
  if (!accepted || canonical(record) !== canonical(accepted)) throw new Error("alert_record_evidence_binding_invalid");
}

function comparisonIdentity(record) {
  return [
    record.provider_id, record.program_name, record.price_type, record.billing_cadence, record.commitment_type,
    record.commitment_months === null ? "none" : record.commitment_months, record.price_phase, record.prepayment,
    String(record.medication_included),
  ].join("|");
}

export function buildAlertIntents(input, { now = Date.now() } = {}) {
  assertExactKeys(input, ALERT_INPUT_KEYS, "alert_input_schema_invalid");
  const { previous, current, subscriptions } = input;
  if (![previous, current, subscriptions].every(Array.isArray)) throw new Error("alert_input_schema_invalid");
  const nowMs = parseNow(now);

  const prior = new Map();
  for (const record of previous) {
    validateAlertRecord(record, nowMs);
    const identity = comparisonIdentity(record);
    if (prior.has(identity)) throw new Error("alert_duplicate_comparison_identity");
    prior.set(identity, record);
  }
  const currentIdentities = new Set();
  for (const record of current) {
    validateAlertRecord(record, nowMs);
    const identity = comparisonIdentity(record);
    if (currentIdentities.has(identity)) throw new Error("alert_duplicate_comparison_identity");
    currentIdentities.add(identity);
  }

  const subscriptionIds = new Set();
  for (const subscription of subscriptions) {
    assertExactKeys(subscription, SUBSCRIPTION_KEYS, "alert_subscription_schema_invalid");
    if (!OPAQUE_SUBSCRIPTION_ID.test(subscription.id) || !SAFE_ID.test(subscription.provider_id) || [subscription.active, subscription.consent, subscription.suppressed, subscription.unsubscribed].some((value) => typeof value !== "boolean") || subscriptionIds.has(subscription.id)) throw new Error("alert_subscription_invalid");
    subscriptionIds.add(subscription.id);
  }

  const intents = [];
  for (const record of current) {
    const old = prior.get(comparisonIdentity(record));
    if (!old || record.amount_usd >= old.amount_usd) continue;
    for (const subscription of subscriptions) {
      if (subscription.provider_id !== record.provider_id || subscription.active !== true || subscription.consent !== true || subscription.suppressed !== false || subscription.unsubscribed !== false) continue;
      const payload = {
        subscription_id: subscription.id,
        record_id: record.id,
        prior_amount_usd: old.amount_usd,
        current_amount_usd: record.amount_usd,
        checked_at: record.checked_at,
        dispatch_authorized: false,
      };
      intents.push({ ...payload, intent_id: sha256(canonical(payload)) });
    }
  }
  return intents.sort((left, right) => left.intent_id.localeCompare(right.intent_id));
}

function renderTerms(record) {
  const commitment = record.commitment_type === "fixed" ? `${record.commitment_months}-month commitment` : record.commitment_type === "cancel_anytime" ? "cancel anytime" : "one-time visit";
  const prepayment = record.prepayment === "annual_required" ? "annual prepayment required" : record.prepayment === "not_stated" ? "prepayment not stated" : "prepayment not applicable";
  return `${record.billing_cadence.replaceAll("_", " ")}; ${commitment}; ${prepayment}; ${record.price_phase} phase`;
}

function renderPriceTrackerUnthemed(config, options = {}) {
  validatePriceTracker(config, options);
  const rows = config.records.map((record) => `<tr data-record-id="${esc(record.id)}"><th scope="row">${esc(record.provider_name)}<br><small>${esc(record.program_name)}</small></th><td>$${esc(record.amount_usd)}</td><td>${esc(record.amount_qualifier)}<br><small>${esc(renderTerms(record))}</small></td><td>${record.medication_included ? "Included" : "Not included"}</td><td><code data-source-reference>${esc(record.source_url)}</code><br><small>Firecrawl scrape ${esc(record.source_scrape_id)} · checked ${esc(record.checked_at.slice(0, 10))}</small><details><summary>Captured quote</summary><blockquote>${esc(record.quote).replaceAll("\n", "<br>")}</blockquote></details></td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><link rel="canonical" href="${CANONICAL_URL}"><title>GLP-1 price tracker candidate · Clinic Scout</title><style>body{margin:0;background:#f7f4ed;color:#17313d;font:16px/1.55 system-ui,sans-serif}main{width:min(1120px,calc(100% - 32px));margin:auto;padding:48px 0 80px}h1{max-width:18ch;font:700 clamp(2.3rem,6vw,5rem)/1.02 Georgia,serif}section,aside{margin:28px 0;padding:24px;border:1px solid #ccd5cf;border-radius:18px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:14px;text-align:left;vertical-align:top;border-bottom:1px solid #dce2de}code{white-space:normal;overflow-wrap:anywhere}blockquote{margin:12px 0 0;padding-left:14px;border-left:3px solid #7a9b8b}@media(max-width:760px){table{display:block;overflow-x:auto}main{width:min(100% - 20px,1120px)}}</style></head><body><main><section><p>Wave 4 candidate · link-dark</p><h1>Track published GLP-1 program prices without missing key terms.</h1><p>These observations preserve the billing, commitment, phase, prepayment, and medication terms supported by each captured first-party source.</p></section><aside><h2>Research guidance, not medical advice</h2><p>This tracker does not determine eligibility, recommend a medicine, compare doses, or predict outcomes. Confirm care decisions with a licensed clinician.</p></aside><section><h2>Source-dated observations</h2><table><thead><tr><th>Program</th><th>Observed price</th><th>Commercial terms</th><th>Medication</th><th>Plain-text evidence reference</th></tr></thead><tbody>${rows}</tbody></table></section><section><h2>Alert status</h2><p>Alert dispatch state: ${esc(config.alert_dispatch_state)}. This link-dark artifact contains no signup form or dispatch control.</p></section></main><footer><p>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</p></footer></body></html>`;
}

export function renderPriceTracker(config, options = {}) {
  const currentCopy = renderPriceTrackerUnthemed(config, options).replace(/\bchecked (?=2026-\d{2}-\d{2})/g, "current as of ");
  return applyStandaloneDarkTheme(currentCopy, "price-tracker");
}

function deriveArtifactFacts(html) {
  const canonicalUrl = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1] || null;
  const robots = html.match(/<meta name="robots" content="([^"]+)">/)?.[1] || null;
  return {
    canonical_url: canonicalUrl,
    route: canonicalUrl ? new URL(canonicalUrl).pathname : null,
    robots,
    rendered_record_count: countMatches(html, /<tr data-record-id=/g),
    source_reference_count: countMatches(html, /data-source-reference/g),
    anchor_count: countMatches(html, /<a\b/gi),
    form_count: countMatches(html, /<form\b/gi),
    script_count: countMatches(html, /<script\b/gi),
    external_runtime_asset_count: countMatches(html, /<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"|<(?:img|iframe)\b[^>]*\bsrc=/gi),
  };
}

export function buildPriceTrackerArtifacts(config, options = {}) {
  const validation = validatePriceTracker(config, options);
  const html = renderPriceTracker(config, options);
  const artifactFacts = deriveArtifactFacts(html);
  if (artifactFacts.route !== ROUTE || artifactFacts.rendered_record_count !== validation.record_count || artifactFacts.source_reference_count !== validation.record_count || artifactFacts.robots !== "noindex,nofollow,noarchive" || artifactFacts.anchor_count !== 0 || artifactFacts.form_count !== 0 || artifactFacts.script_count !== 0 || artifactFacts.external_runtime_asset_count !== 0) throw new Error("tracker_render_contract_invalid");
  const payload = {
    schema: "wave4-price-tracker-build-v2",
    status: validation.status,
    route: artifactFacts.route,
    publication_state: config.publication_state,
    alert_dispatch_state: config.alert_dispatch_state,
    record_count: validation.record_count,
    record_ids: validation.record_ids,
    source_scrape_ids: validation.source_scrape_ids,
    source_ledger_payload_sha256: validation.source_ledger_payload_sha256,
    config_payload_sha256: sha256(canonical(config)),
    html_sha256: sha256(html),
    artifact_facts: artifactFacts,
  };
  return { html, manifest: { ...payload, payload_sha256: sha256(canonical(payload)) } };
}
