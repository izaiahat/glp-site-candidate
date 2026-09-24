import { createHash } from "node:crypto";
import { applyStandaloneDarkTheme } from "./standalone-dark-theme.mjs";

const TOP_LEVEL_KEYS = ["as_of_utc", "canonical_url", "methodology", "publication_state", "rows", "schema", "source_ledger", "sources", "study_id", "title"];
const LEDGER_KEYS = ["generated_at_utc", "ledger_payload_sha256", "schema"];
const METHODOLOGY_KEYS = ["collection_ended_at", "collection_started_at", "comparison_rule", "contains_personal_health_data", "exclusion_rule", "freshness_max_age_hours", "inclusion_rule", "limitations", "sample_size", "sampling_frame"];
const SOURCE_KEYS = ["capture_id", "checked_at", "disposition", "exact_quote", "exact_quote_sha256", "first_party_url", "requested_url", "scrape_id", "source_id", "status_code"];
const ROW_KEYS = ["billing_period", "displayed_amount_max_usd", "displayed_amount_min_usd", "medication_included", "price_basis", "provider_id", "provider_name", "qualifier", "source_id"];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SCRAPE_UUID_V7 = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const formulaDangerous = /^[\u0000-\u0020]*[=+\-@]/;
const clinicalOrPii = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d ().-]{7,}\d|patients?\s+(?:lost|gained|reversed|cured)|clinically\s+proven|safest|most\s+effective|guaranteed\s+(?:result|weight\s+loss))/i;
const highRiskString = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{3}-\d{2}-\d{4}\b|(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}|\b(?:clinically proven|guaranteed (?:result|weight loss)|safest|most effective|cures?|reverses? disease)\b|\b(?:everyone|all patients|anyone) (?:qualifies|is eligible)|\buniversal eligibility\b|\b(?:representative of|average for|typical of) (?:the )?(?:market|industry)\b|\bno commitment required\b)/i;
const CANONICAL_URL = "https://glpclinicscout.com/research/original-data/public-glp-1-program-pricing-sample/";
const LEDGER_PAYLOAD_SHA256 = "ef4d6c369a4706103c98e59022580fa892d25d66238f3a48bcbddcbb8ad54d2a";

// Immutable bindings transcribed from the authoritative Wave 4 Firecrawl ledger.
// The quote hash is pinned independently, so changing a quote and recomputing its hash fails closed.
const CAPTURE_PINS = Object.freeze({
  "ro-pricing": Object.freeze({ capture_id: "ro-weight-loss-pricing-20260802", scrape_id: "019fc020-f65c-771b-a062-2308edec20fa", requested_url: "https://ro.co/weight-loss/pricing/", first_party_url: "https://ro.co/weight-loss/pricing/", checked_at: "2026-08-02T01:40:13.532Z", exact_quote_sha256: "5a5fe716e62ea4e88d16b58f6e0bf9f022b9a95bca09fc172ce7e42f38644022" }),
  "ww-pricing": Object.freeze({ capture_id: "weightwatchers-clinic-pricing-20260802", scrape_id: "019fc020-fe2a-7747-b317-2c15ba8985ff", requested_url: "https://www.weightwatchers.com/us/clinic/weight-loss-medication", first_party_url: "https://www.weightwatchers.com/us/weight-loss-medication", checked_at: "2026-08-02T01:40:15.530Z", exact_quote_sha256: "21647b079c6ec9d811db86d952cf62088a9271395ae8cb65f9449a9cbe7ab251" }),
  "lifemd-pricing": Object.freeze({ capture_id: "lifemd-weight-management-20260802", scrape_id: "019fc021-0b6e-76c8-92bd-9935423835b8", requested_url: "https://lifemd.com/weight-management/", first_party_url: "https://lifemd.com/weight-management/", checked_at: "2026-08-02T01:40:18.926Z", exact_quote_sha256: "013b98d6db18ca35a78c166548cd83cd37e89ec79e44b61939858581d025e3d1" }),
  "plushcare-pricing": Object.freeze({ capture_id: "plushcare-glp1-pricing-20260802", scrape_id: "019fc021-215f-728c-854a-b1f09ca8c764", requested_url: "https://plushcare.com/glp-1-prescription/", first_party_url: "https://plushcare.com/glp-1-prescription", checked_at: "2026-08-02T01:40:24.543Z", exact_quote_sha256: "245f2f94013a8a529983d06d9d11f8ec6a4750ba50b514d9aadb3e54d5c6d203" }),
});

const METHODOLOGY_BINDING = Object.freeze({
  collection_started_at: "2026-08-02T01:40:13.532Z",
  collection_ended_at: "2026-08-02T01:40:24.543Z",
  freshness_max_age_hours: 24,
  sample_size: 4,
  sampling_frame: "Four named U.S.-facing first-party program pages with ACCEPTED captures in the bounded Wave 4 source ledger; this purposive sample is neither random nor a market census.",
  inclusion_rule: "Include an ACCEPTED first-party capture only when its quoted page text explicitly states a numeric recurring program-membership amount or one-time initial-visit amount and explicitly states whether medication is included.",
  exclusion_rule: "Exclude rejected captures, product-only drug savings or cash-price pages, regulator policy pages, and pages without both a qualifying program or visit amount and explicit medication-inclusion language. A rejected 404 capture is not a source or row.",
  comparison_rule: "Keep recurring memberships separate from one-time initial visits. Report row counts and basis-specific displayed bounds only; do not calculate a combined price statistic across unlike bases.",
  limitations: "This small purposive disclosure sample describes captured page text at one time. Plan duration, introductory terms, visits, medication, labs, insurance, eligibility, and later page changes can alter cost. It supports no market-wide, clinical, quality, outcome, eligibility, or treatment inference.",
  contains_personal_health_data: false,
});
const ROW_SOURCE_BINDINGS = Object.freeze({
  "ro-pricing": Object.freeze({ provider_id: "ro", provider_name: "Ro Body", price_basis: "recurring_membership", billing_period: "month" }),
  "ww-pricing": Object.freeze({ provider_id: "weightwatchers", provider_name: "WeightWatchers Clinic", price_basis: "recurring_membership", billing_period: "month" }),
  "lifemd-pricing": Object.freeze({ provider_id: "lifemd", provider_name: "LifeMD", price_basis: "recurring_membership", billing_period: "month" }),
  "plushcare-pricing": Object.freeze({ provider_id: "plushcare", provider_name: "PlushCare", price_basis: "one_time_initial_visit", billing_period: "visit" }),
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const jsonForHtml = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

function assertNoHighRiskStrings(value) {
  if (typeof value === "string") {
    if (highRiskString.test(value)) throw new Error("study_high_risk_string_invalid");
    return;
  }
  if (Array.isArray(value)) return value.forEach(assertNoHighRiskStrings);
  if (value && typeof value === "object") for (const nested of Object.values(value)) assertNoHighRiskStrings(nested);
}

export const csvCell = (value) => {
  let text = String(value ?? "");
  if (formulaDangerous.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function assertExactKeys(value, keys, error) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(error);
}

function parseUtc(value, error) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(error);
  return Date.parse(value);
}

function assertFirstPartyUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("study_source_url_invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) throw new Error("study_source_url_invalid");
  return parsed;
}

function uuidV7Timestamp(scrapeId) {
  if (!SCRAPE_UUID_V7.test(scrapeId)) throw new Error("study_scrape_id_invalid");
  const milliseconds = Number.parseInt(scrapeId.replaceAll("-", "").slice(0, 12), 16);
  return new Date(milliseconds).toISOString();
}

function assertCapturePin(source) {
  const pin = CAPTURE_PINS[source.source_id];
  if (!pin) throw new Error("study_capture_unaccepted");
  for (const [key, expected] of Object.entries(pin)) if (source[key] !== expected) throw new Error("study_capture_binding_invalid");
  if (source.disposition !== "ACCEPTED" || source.status_code !== 200) throw new Error("study_capture_not_accepted");
  if (uuidV7Timestamp(source.scrape_id) !== source.checked_at) throw new Error("study_capture_time_invalid");
}

function quoteContainsAmount(quote, amount) {
  return new RegExp(`(?:\\$)?${amount}(?!\\d)`).test(quote);
}

export function validateStudy(study) {
  assertNoHighRiskStrings(study);
  assertExactKeys(study, TOP_LEVEL_KEYS, "study_schema_fields_invalid");
  if (study.schema !== "glp-clinic-scout-original-data-study-v2" || study.publication_state !== "HELD_IZAIAH_EDITORIAL_REVIEW") throw new Error("study_authority_invalid");
  if (!/^[a-z0-9-]+$/.test(study.study_id) || typeof study.title !== "string" || study.title.length < 20 || /[<>]/.test(study.title)) throw new Error("study_identity_invalid");
  if (study.canonical_url !== CANONICAL_URL) throw new Error("study_canonical_invalid");

  assertExactKeys(study.source_ledger, LEDGER_KEYS, "study_ledger_schema_invalid");
  if (study.source_ledger.schema !== "glp-wave4-firecrawl-source-capture-ledger-v1" || study.source_ledger.ledger_payload_sha256 !== LEDGER_PAYLOAD_SHA256 || study.source_ledger.generated_at_utc !== study.as_of_utc) throw new Error("study_ledger_binding_invalid");
  if (!SHA256.test(study.source_ledger.ledger_payload_sha256)) throw new Error("study_ledger_hash_invalid");
  const asOf = parseUtc(study.as_of_utc, "study_as_of_invalid");

  assertExactKeys(study.methodology, METHODOLOGY_KEYS, "study_methodology_schema_invalid");
  if (canonicalJson(study.methodology) !== canonicalJson(METHODOLOGY_BINDING)) throw new Error("study_methodology_binding_invalid");
  const start = parseUtc(study.methodology.collection_started_at, "study_collection_start_invalid");
  const end = parseUtc(study.methodology.collection_ended_at, "study_collection_end_invalid");
  if (start > end || end > asOf || !Number.isInteger(study.methodology.freshness_max_age_hours) || study.methodology.freshness_max_age_hours < 1 || study.methodology.freshness_max_age_hours > 168) throw new Error("study_collection_window_invalid");
  if (study.methodology.contains_personal_health_data !== false) throw new Error("study_sensitive_data_invalid");
  for (const field of ["sampling_frame", "inclusion_rule", "exclusion_rule", "comparison_rule", "limitations"]) if (typeof study.methodology[field] !== "string" || study.methodology[field].length < 30 || /[<>]/.test(study.methodology[field])) throw new Error("study_methodology_text_invalid");

  if (!Array.isArray(study.sources) || !Array.isArray(study.rows) || study.rows.length !== 4 || study.sources.length !== 4 || study.methodology.sample_size !== 4) throw new Error("study_denominator_invalid");
  const sourceIds = new Set();
  const captureIds = new Set();
  const scrapeIds = new Set();
  const checkedTimes = [];
  const sourcesById = new Map();
  for (const source of study.sources) {
    assertExactKeys(source, SOURCE_KEYS, "study_source_schema_invalid");
    if (!/^[a-z0-9-]+$/.test(source.source_id) || sourceIds.has(source.source_id) || captureIds.has(source.capture_id) || scrapeIds.has(source.scrape_id)) throw new Error("study_source_identity_invalid");
    assertFirstPartyUrl(source.requested_url);
    assertFirstPartyUrl(source.first_party_url);
    const checkedAt = parseUtc(source.checked_at, "study_checked_at_invalid");
    if (checkedAt > asOf) throw new Error("study_source_future");
    if (asOf - checkedAt > study.methodology.freshness_max_age_hours * 3_600_000) throw new Error("study_source_stale");
    if (source.disposition !== "ACCEPTED" || source.status_code !== 200 || !SHA256.test(source.exact_quote_sha256) || typeof source.exact_quote !== "string" || source.exact_quote.length < 40) throw new Error("study_source_capture_invalid");
    if (sha256(source.exact_quote) !== source.exact_quote_sha256) throw new Error("study_quote_hash_mismatch");
    assertCapturePin(source);
    sourceIds.add(source.source_id); captureIds.add(source.capture_id); scrapeIds.add(source.scrape_id); checkedTimes.push(checkedAt); sourcesById.set(source.source_id, source);
  }
  if (Math.min(...checkedTimes) !== start || Math.max(...checkedTimes) !== end) throw new Error("study_collection_capture_mismatch");
  if (sourceIds.size !== Object.keys(CAPTURE_PINS).length || [...Object.keys(CAPTURE_PINS)].some((id) => !sourceIds.has(id))) throw new Error("study_capture_set_invalid");

  const providerIds = new Set();
  const usedSources = new Set();
  for (const row of study.rows) {
    assertExactKeys(row, ROW_KEYS, "study_row_schema_invalid");
    if (!/^[a-z0-9-]+$/.test(row.provider_id) || providerIds.has(row.provider_id) || usedSources.has(row.source_id) || !sourcesById.has(row.source_id)) throw new Error("study_row_source_identity_invalid");
    if (!["recurring_membership", "one_time_initial_visit"].includes(row.price_basis)) throw new Error("study_price_basis_invalid");
    if ((row.price_basis === "recurring_membership" && row.billing_period !== "month") || (row.price_basis === "one_time_initial_visit" && row.billing_period !== "visit")) throw new Error("study_billing_period_invalid");
    if (!Number.isInteger(row.displayed_amount_min_usd) || !Number.isInteger(row.displayed_amount_max_usd) || row.displayed_amount_min_usd <= 0 || row.displayed_amount_max_usd < row.displayed_amount_min_usd) throw new Error("study_amount_invalid");
    if (row.medication_included !== false) throw new Error("study_medication_status_invalid");
    if (typeof row.provider_name !== "string" || typeof row.qualifier !== "string" || formulaDangerous.test(row.provider_name) || formulaDangerous.test(row.qualifier) || /[<>]/.test(`${row.provider_name}${row.qualifier}`) || clinicalOrPii.test(`${row.provider_name} ${row.qualifier}`)) throw new Error("study_row_text_invalid");
    const source = sourcesById.get(row.source_id);
    const binding = ROW_SOURCE_BINDINGS[row.source_id];
    if (!binding || row.provider_id !== binding.provider_id || row.provider_name !== binding.provider_name || row.price_basis !== binding.price_basis || row.billing_period !== binding.billing_period) throw new Error("study_provider_binding_invalid");
    if (row.qualifier !== source.exact_quote) throw new Error("study_qualifier_quote_mismatch");
    if (!quoteContainsAmount(source.exact_quote, row.displayed_amount_min_usd) || !quoteContainsAmount(source.exact_quote, row.displayed_amount_max_usd)) throw new Error("study_amount_quote_mismatch");
    if (!/(?:medication|meds)[\s\S]{0,80}not included|not included[\s\S]{0,80}(?:medication|meds)/i.test(source.exact_quote)) throw new Error("study_medication_quote_mismatch");
    if (row.price_basis === "recurring_membership" && !/(?:\/mo|a month|\/month|monthly)/i.test(source.exact_quote)) throw new Error("study_recurring_basis_quote_mismatch");
    if (row.price_basis === "one_time_initial_visit" && !/initial visits?/i.test(source.exact_quote)) throw new Error("study_visit_basis_quote_mismatch");
    providerIds.add(row.provider_id); usedSources.add(row.source_id);
  }
  if (usedSources.size !== sourceIds.size || [...sourceIds].some((id) => !usedSources.has(id))) throw new Error("study_source_row_bijection_invalid");
  return { status: "PASS", rows: study.rows.length, sources: study.sources.length };
}

export function deriveDisclosureSummary(study) {
  validateStudy(study);
  const recurring = study.rows.filter((row) => row.price_basis === "recurring_membership");
  const initial = study.rows.filter((row) => row.price_basis === "one_time_initial_visit");
  const bounds = (rows) => rows.length ? { displayed_min_usd: Math.min(...rows.map((row) => row.displayed_amount_min_usd)), displayed_max_usd: Math.max(...rows.map((row) => row.displayed_amount_max_usd)) } : null;
  return {
    sampled_page_count: study.rows.length,
    recurring_membership_row_count: recurring.length,
    one_time_initial_visit_row_count: initial.length,
    recurring_membership_displayed_bounds: bounds(recurring),
    one_time_initial_visit_displayed_bounds: bounds(initial),
    all_sampled_pages_explicitly_excluded_medication_at_capture: study.rows.every((row) => row.medication_included === false),
  };
}

function displayAmount(row) {
  return row.displayed_amount_min_usd === row.displayed_amount_max_usd ? `$${row.displayed_amount_min_usd}` : `$${row.displayed_amount_min_usd}–$${row.displayed_amount_max_usd}`;
}

function deriveRouteCapabilities(html) {
  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  return {
    form_count: (html.match(/<form\b/gi) || []).length,
    executable_script_count: scriptTags.filter((tag) => !/type="application\/ld\+json"/i.test(tag)).length,
    external_script_count: (html.match(/<script\b[^>]*\bsrc=["']https?:\/\//gi) || []).length,
    external_clickable_link_count: (html.match(/<a\b[^>]*\bhref=["'](?:https?:|\/\/)/gi) || []).length,
    contact_link_count: (html.match(/<a\b[^>]*\bhref=["'](?:mailto:|tel:)/gi) || []).length,
    network_api_token_count: (html.match(/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/g) || []).length,
    analytics_token_count: (html.match(/\b(?:gtag|googletagmanager|clarity|analytics\.js|meta-pixel)\b/gi) || []).length,
  };
}

export function buildStudyArtifacts(study) {
  validateStudy(study);
  const summary = deriveDisclosureSummary(study);
  const sourceById = new Map(study.sources.map((source) => [source.source_id, source]));
  const publicRows = study.rows.map((row) => ({ ...row, source: sourceById.get(row.source_id) }));
  const dataset = {
    schema: "glp-clinic-scout-public-pricing-disclosure-dataset-v2",
    study_id: study.study_id,
    title: study.title,
    publication_state: study.publication_state,
    as_of_utc: study.as_of_utc,
    summary,
    rows: publicRows,
  };
  const methodology = {
    schema: "glp-clinic-scout-study-methodology-v2",
    study_id: study.study_id,
    title: study.title,
    as_of_utc: study.as_of_utc,
    source_ledger: study.source_ledger,
    methodology: study.methodology,
    derived_summary: summary,
    source_bindings: study.sources.map(({ source_id, capture_id, scrape_id, first_party_url, checked_at, exact_quote_sha256 }) => ({ source_id, capture_id, scrape_id, first_party_url, checked_at, exact_quote_sha256 })),
    field_definitions: {
      price_basis: "recurring_membership means a repeating program fee; one_time_initial_visit means a single first-visit fee.",
      displayed_amount_min_usd: "Lowest captured numeric amount for the row's stated basis, in U.S. dollars.",
      displayed_amount_max_usd: "Highest captured numeric amount for the row's stated basis, in U.S. dollars; equal to the minimum for a single displayed amount.",
      medication_included: "False only when the bound exact quote explicitly says medication is not included.",
    },
    correction_policy: "A correction requires a newly accepted capture, new immutable binding, versioned study input, regenerated downloads, and fresh editorial review.",
  };
  const columns = ["provider_id", "provider_name", "price_basis", "billing_period", "displayed_amount_min_usd", "displayed_amount_max_usd", "medication_included", "qualifier", "source_id", "capture_id", "scrape_id", "requested_url", "first_party_url", "checked_at", "disposition", "status_code", "exact_quote", "exact_quote_sha256"];
  const csvRows = publicRows.map((row) => {
    const flattened = { ...row, ...row.source };
    delete flattened.source;
    return columns.map((column) => csvCell(flattened[column])).join(",");
  });
  const csv = `${columns.join(",")}\n${csvRows.join("\n")}\n`;

  const tableRows = publicRows.map((row) => `<tr><th scope="row">${esc(row.provider_name)}</th><td>${row.price_basis === "recurring_membership" ? "Recurring membership" : "One-time initial visit"}</td><td>${esc(displayAmount(row))} per ${esc(row.billing_period)}</td><td>Explicitly excluded</td><td>${esc(row.qualifier)}</td><td><code>${esc(row.source.capture_id)}</code></td></tr>`).join("");
  const sourceRows = publicRows.map((row) => `<li><strong>${esc(row.provider_name)}:</strong> <code>${esc(row.source.capture_id)}</code> · scrape <code>${esc(row.source.scrape_id)}</code> · evidence dated ${esc(row.source.checked_at)}<br><span>First-party URL: <code>${esc(row.source.first_party_url)}</code></span><blockquote>${esc(row.source.exact_quote)}</blockquote><span>Quote SHA-256: <code>${esc(row.source.exact_quote_sha256)}</code></span></li>`).join("");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: study.title,
    description: "A bounded descriptive sample of three recurring program-membership disclosures and one one-time initial-visit disclosure, kept separate by price basis.",
    url: study.canonical_url,
    dateModified: study.as_of_utc,
    temporalCoverage: `${study.methodology.collection_started_at}/${study.methodology.collection_ended_at}`,
    isAccessibleForFree: true,
    measurementTechnique: study.methodology.comparison_rule,
    variableMeasured: ["Displayed amount by price basis", "Explicit medication exclusion at capture"],
    isBasedOn: study.sources.map((source) => source.first_party_url),
    distribution: [
      { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: "https://glpclinicscout.com/data/public-glp-1-program-pricing-sample.csv" },
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://glpclinicscout.com/data/public-glp-1-program-pricing-sample.json" },
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://glpclinicscout.com/data/public-glp-1-program-pricing-sample-methodology.json" },
    ],
  };
  const recurringBounds = summary.recurring_membership_displayed_bounds;
  const initialBounds = summary.one_time_initial_visit_displayed_bounds;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><link rel="canonical" href="${study.canonical_url}"><title>${esc(study.title)} · Clinic Scout</title><style>body{margin:0;background:#f6f4ef;color:#172536;font:17px/1.55 system-ui,sans-serif}main{width:min(1100px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}h1,h2{line-height:1.15}h1{max-width:19ch;font-size:clamp(2.2rem,6vw,4.5rem)}section,aside{background:#fff;border:1px solid #d8d4cb;border-radius:16px;padding:24px;margin:20px 0}.eyebrow{font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#8b3d2e}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.summary div{background:#eef3ef;border-radius:12px;padding:18px}.summary strong{display:block;font-size:1.45rem}table{width:100%;border-collapse:collapse;min-width:880px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:12px}a{color:#174f7a}code{overflow-wrap:anywhere}p,li,dd,dt,blockquote,h1,h2{overflow-wrap:anywhere}li{margin:0 0 28px}blockquote{white-space:pre-line;border-left:4px solid #b9cbbf;margin:10px 0;padding:8px 16px;background:#f7faf8}</style><script type="application/ld+json">${jsonForHtml(jsonLd)}</script></head><body><main><header><p class="eyebrow">Bounded descriptive dataset · held for editorial review</p><h1>${esc(study.title)}</h1><p>This page describes four accepted first-party captures as of ${esc(study.as_of_utc)}. It is a purposive disclosure sample, not a market estimate or treatment comparison.</p></header><aside><strong>Method boundary:</strong> Recurring program memberships and a one-time initial visit are different price bases. They remain separate throughout this dataset; no combined price statistic is calculated.</aside><section><h2>What the four captured pages disclosed</h2><div class="summary"><div><strong>${summary.recurring_membership_row_count} recurring membership rows</strong><span>Displayed bounds: $${recurringBounds.displayed_min_usd}–$${recurringBounds.displayed_max_usd} per month.</span></div><div><strong>${summary.one_time_initial_visit_row_count} initial-visit row</strong><span>Displayed amount: $${initialBounds.displayed_min_usd} per visit.</span></div><div><strong>4 of 4 pages</strong><span>At capture time, every sampled page explicitly said medication was not included.</span></div></div></section><section><h2>Captured disclosure rows</h2><div style="overflow:auto"><table><thead><tr><th>Program</th><th>Price basis</th><th>Displayed amount</th><th>Medication</th><th>Qualifier</th><th>Capture reference</th></tr></thead><tbody>${tableRows}</tbody></table></div><p><a download href="/data/public-glp-1-program-pricing-sample.csv">Download CSV</a> · <a download href="/data/public-glp-1-program-pricing-sample.json">Download JSON</a> · <a download href="/data/public-glp-1-program-pricing-sample-methodology.json">Download methodology</a></p></section><section><h2>Methodology and limitations</h2><p>${esc(study.methodology.sampling_frame)}</p><p><strong>Included:</strong> ${esc(study.methodology.inclusion_rule)}</p><p><strong>Excluded:</strong> ${esc(study.methodology.exclusion_rule)}</p><p><strong>Comparison rule:</strong> ${esc(study.methodology.comparison_rule)}</p><p><strong>Limitations:</strong> ${esc(study.methodology.limitations)}</p></section><section><h2>Plain source references</h2><p>References below are non-clickable and bound to accepted capture IDs, scrape IDs, exact quotes, and quote hashes.</p><ol>${sourceRows}</ol></section></main><footer><p>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</p></footer></body></html>`;

  const themedHtml = applyStandaloneDarkTheme(html, "original-data");
  const datasetText = jsonText(dataset);
  const methodologyText = jsonText(methodology);
  const routeCapabilities = deriveRouteCapabilities(themedHtml);
  const downloadHashes = { csv_sha256: sha256(csv), dataset_sha256: sha256(datasetText), methodology_sha256: sha256(methodologyText) };
  const core = {
    schema: "wave4-original-data-build-v2",
    study_id: study.study_id,
    title: study.title,
    publication_authorized: false,
    publication_gate: "Izaiah editorial review",
    summary,
    provenance: { ledger_schema: study.source_ledger.schema, ledger_payload_sha256: study.source_ledger.ledger_payload_sha256, capture_ids: study.sources.map((source) => source.capture_id) },
    route_capabilities: routeCapabilities,
    route_sha256: sha256(themedHtml),
    ...downloadHashes,
  };
  const manifest = { ...core, payload_sha256: sha256(canonicalJson(core)) };
  return { html: themedHtml, csv, dataset, methodology, datasetText, methodologyText, manifest };
}
