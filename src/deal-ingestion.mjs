import { createHash } from "node:crypto";
import { applyStandaloneDarkTheme } from "./standalone-dark-theme.mjs";
import { fileURLToPath } from "node:url";
import { loadEvidenceInputs, materialOffersFor } from "../scripts/glp_evidence_ledger.mjs";
const derivedAuthorities = new WeakMap();
const evaluationClockAuthorities = new WeakMap();

// The frozen map carries display data; its private reader binding is authority.
// Serialized or reconstructed maps cannot be consumed by the renderer.
export function resolveDealEvaluationClocks(config, { preservedNow, evidenceInputs } = {}) {
  parseIso(preservedNow, 'offers_preserved_now');
  validateDeals(config, { now: preservedNow });
  const inputs = evidenceInputs ?? loadEvidenceInputs(fileURLToPath(new URL('../', import.meta.url)));
  const clocks = Object.fromEntries(config.offers.map(offer => [offer.id, Object.freeze({
    evaluated_at: preservedNow,
    basis: 'preserved',
    acceptance: null,
  })]));
  for (const receipt of materialOffersFor(inputs)) {
    const material = receipt.material;
    const offer = config.offers.find(item => item.id === material.offer_id);
    if (!offer || sha256(canonicalJson(offer)) !== material.parent_offer_sha256 || offer.source.capture_id !== material.capture_id) throw new Error('material_offer_parent_binding_invalid');
    clocks[offer.id] = Object.freeze({
      evaluated_at: receipt.fetched_at,
      basis: 'accepted_material',
      acceptance: Object.freeze({
        capture_id: material.capture_id,
        capture_sha256: receipt.capture_sha256,
        content_sha256: receipt.content_sha256,
        parent_offer_sha256: material.parent_offer_sha256,
        source_url: receipt.source_url,
        scrape_id: receipt.scrape_id,
      }),
    });
  }
  evaluationClockAuthorities.set(clocks, { preservedNow, inputs, configDigest: sha256(canonicalJson(config)) });
  return Object.freeze(clocks);
}

function requireEvaluationClocks(config, clocks) {
  const authority = evaluationClockAuthorities.get(clocks);
  if (!authority) throw new Error('offer_evaluation_clocks_unauthenticated');
  const base = derivedAuthorities.get(config)?.base ?? config;
  if (sha256(canonicalJson(base)) !== authority.configDigest) throw new Error('offer_evaluation_clocks_config_mismatch');
  return authority;
}

function evaluationAt(now, offerId) {
  return evaluationClockAuthorities.has(now) ? now[offerId].evaluated_at : now;
}

// Only an authenticated reader result can qualify a successor. Callers cannot
// supply authority in deal JSON; the normal build uses the fixed external log.
export function resolveAcceptedDeals(config, { now = new Date().toISOString(), evidenceInputs } = {}) {
  if (derivedAuthorities.has(config)) return config;
  const clocks = evaluationClockAuthorities.has(now) ? requireEvaluationClocks(config, now) : null;
  validateDeals(config, { now: clocks?.preservedNow ?? now });
  const inputs = evidenceInputs ?? clocks?.inputs ?? loadEvidenceInputs(fileURLToPath(new URL('../', import.meta.url)));
  const accepted = materialOffersFor(inputs);
  if (!accepted.length) return config;
  const result = structuredClone(config);
  for (const receipt of accepted) {
    const m = receipt.material;
    const offer = result.offers.find(o => o.id === m.offer_id);
    if (!offer || sha256(canonicalJson(offer)) !== m.parent_offer_sha256 || offer.source.capture_id !== m.capture_id) throw new Error('material_offer_parent_binding_invalid');
    const [pen, kwik] = m.limits;
    offer.fill_limit = {count: pen.count, period: 'prescription fills per calendar year',
      qualifier: `${pen.formulation}: up to (separate ${kwik.formulation} limit: up to ${kwik.count} prescription fills per calendar year; no additional price or eligibility lane)`};
    offer.source = {capture_id: m.capture_id, scrape_id: receipt.scrape_id, url: receipt.source_url,
      exact_quote: m.exact_quote, exact_quote_sha256: sha256(m.exact_quote)};
    offer.checked_at = receipt.fetched_at;
  }
  derivedAuthorities.set(result, {base: structuredClone(config), digest: sha256(canonicalJson(result))});
  validateDeals(result, {now});
  return result;
}

const DAY_MS = 86_400_000;
const MAX_EVIDENCE_AGE_DAYS = 45;
const ROUTE = "/tools/glp-1-savings-offer-monitor/";
const CANONICAL_URL = `https://glpclinicscout.com${ROUTE}`;

const TOP_LEVEL_KEYS = ["schema", "publication_state", "ledger", "offers"];
const LEDGER_KEYS = ["schema", "generated_at", "payload_sha256"];
const OFFER_KEYS = ["id", "offer_owner", "offer_name", "product", "formulation", "doses_mg", "coverage_lane", "eligibility", "pricing", "fill_limit", "expires_at", "expiry_display", "checked_at", "source", "status"];
const ELIGIBILITY_KEYS = ["prescription_required", "insurance_requirement", "government_program_rule", "outside_insurance_required", "reimbursement_prohibited", "insurance_limit_application_prohibited", "new_patient_requirement", "fda_approved_use_required"];
const PRICING_KEYS = ["current_terms", "transition_terms", "post_offer_terms", "max_savings_usd_per_month"];
const PRICE_TERM_KEYS = ["label", "amount_usd", "unit", "valid_from", "expires_at"];
const FILL_LIMIT_KEYS = ["count", "period", "qualifier"];
const SOURCE_KEYS = ["capture_id", "scrape_id", "url", "exact_quote", "exact_quote_sha256"];
const UNSUPPORTED_NOVOCARE_CLAIM = /\btablet(?:s)?\b|\breimburse(?:ment|d|able)?\b|\binsurance[- ]limit\b/i;

const AUTHORITY = Object.freeze({
  ledger: Object.freeze({
    schema: "glp-wave4-firecrawl-source-capture-ledger-v1",
    generated_at: "2026-08-02T01:41:56.582193Z",
    payload_sha256: "ef4d6c369a4706103c98e59022580fa892d25d66238f3a48bcbddcbb8ad54d2a",
  }),
  records: Object.freeze({
    "wegovy-commercial-covered-2026": "ef3bd1940794144075cb98935486feb3471b0191eef70b84b33990b5ede562c7",
    "wegovy-self-pay-dose-pricing-2026": "56761bb00220e9a08ea17726bd39680604cca6c2f6869cb26d25068ba488e46f",
    "wegovy-new-patient-two-fill-2026": "9c52e5753213bfa0e8378b0d28dbc61b9aefdf541244402e6941f7007022866a",
    "zepbound-commercially-uncovered-single-dose-pen-2026": "69ecd6b44f33757566755031c1a5b51037da765f3e573833aff9629107882b50",
  }),
  sources: Object.freeze({
    "wegovy-savings-20260802": Object.freeze({
      scrape_id: "019fc021-2897-712d-9095-6a0244b9d37c",
      url: "https://www.novocare.com/patient/medicines/wegovy/savings-offer.html",
      quote_sha256: "51375a466c3176daca317e26bc8e7b0d4597ef9a495cd9ae561f1babd1d7ee96",
    }),
    "zepbound-savings-20260802": Object.freeze({
      scrape_id: "019fc021-964c-72fd-9dbb-405c4d7ddc48",
      url: "https://zepbound.lilly.com/savings",
      quote_sha256: "12999960ffb0ed895f1b5986695e4d5745642e01b8b2edf70ec458bc864f8a2c",
    }),
  }),
});

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => Array.isArray(value)
  ? `[${value.map(canonicalJson).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_object_invalid`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label}_schema_invalid`);
}

function parseIso(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) throw new Error(`${label}_invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}_invalid`);
  return parsed;
}

function assertSafeText(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !value.trim() || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label}_unsafe`);
}

function validatePriceTerm(term, label) {
  assertExactKeys(term, PRICE_TERM_KEYS, label);
  assertSafeText(term.label, `${label}_label`);
  assertSafeText(term.unit, `${label}_unit`);
  if (!Number.isFinite(term.amount_usd) || term.amount_usd <= 0) throw new Error(`${label}_amount_invalid`);
  const from = parseIso(term.valid_from, `${label}_valid_from`, { nullable: true });
  const until = parseIso(term.expires_at, `${label}_expires_at`, { nullable: true });
  if (from !== null && until !== null && from >= until) throw new Error(`${label}_window_invalid`);
}

function validateSource(source) {
  assertExactKeys(source, SOURCE_KEYS, "offer_source");
  const authority = AUTHORITY.sources[source.capture_id];
  if (!authority || source.scrape_id !== authority.scrape_id || source.url !== authority.url || source.exact_quote_sha256 !== authority.quote_sha256) throw new Error("offer_source_binding_invalid");
  if (!/^[0-9a-f-]{36}$/.test(source.scrape_id) || !/^[a-f0-9]{64}$/.test(source.exact_quote_sha256)) throw new Error("offer_source_identifier_invalid");
  assertSafeText(source.exact_quote, "offer_source_quote");
  if (sha256(source.exact_quote) !== source.exact_quote_sha256) throw new Error("offer_source_quote_tampered");
  const url = new URL(source.url);
  const allowedHosts = new Set(["www.novocare.com", "zepbound.lilly.com"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error("offer_source_url_invalid");
}

function validateOfferShape(offer) {
  assertExactKeys(offer, OFFER_KEYS, "offer");
  if (!/^[a-z0-9-]+$/.test(offer.id)) throw new Error("offer_id_invalid");
  for (const field of ["offer_owner", "offer_name", "product", "formulation", "coverage_lane", "expiry_display"]) assertSafeText(offer[field], `offer_${field}`);
  if (!Array.isArray(offer.doses_mg) || offer.doses_mg.some((dose) => !Number.isFinite(dose) || dose <= 0)) throw new Error("offer_doses_invalid");

  assertExactKeys(offer.eligibility, ELIGIBILITY_KEYS, "offer_eligibility");
  for (const field of ["prescription_required", "outside_insurance_required", "reimbursement_prohibited", "insurance_limit_application_prohibited", "fda_approved_use_required"]) {
    if (typeof offer.eligibility[field] !== "boolean") throw new Error(`offer_eligibility_${field}_invalid`);
  }
  for (const field of ["insurance_requirement", "government_program_rule"]) assertSafeText(offer.eligibility[field], `offer_eligibility_${field}`);
  assertSafeText(offer.eligibility.new_patient_requirement, "offer_eligibility_new_patient_requirement", { nullable: true });

  assertExactKeys(offer.pricing, PRICING_KEYS, "offer_pricing");
  for (const group of ["current_terms", "transition_terms", "post_offer_terms"]) {
    if (!Array.isArray(offer.pricing[group])) throw new Error(`offer_pricing_${group}_invalid`);
    offer.pricing[group].forEach((term, index) => validatePriceTerm(term, `offer_pricing_${group}_${index}`));
  }
  if (!offer.pricing.current_terms.length) throw new Error("offer_pricing_current_terms_empty");
  if (offer.pricing.max_savings_usd_per_month !== null && (!Number.isFinite(offer.pricing.max_savings_usd_per_month) || offer.pricing.max_savings_usd_per_month <= 0)) throw new Error("offer_pricing_max_savings_invalid");

  if (offer.fill_limit !== null) {
    assertExactKeys(offer.fill_limit, FILL_LIMIT_KEYS, "offer_fill_limit");
    if (!Number.isInteger(offer.fill_limit.count) || offer.fill_limit.count <= 0) throw new Error("offer_fill_limit_count_invalid");
    assertSafeText(offer.fill_limit.period, "offer_fill_limit_period");
    assertSafeText(offer.fill_limit.qualifier, "offer_fill_limit_qualifier");
  }
  parseIso(offer.expires_at, "offer_expires_at", { nullable: true });
  parseIso(offer.checked_at, "offer_checked_at");
  if (offer.status !== "VERIFIED") throw new Error("offer_status_invalid");
  validateSource(offer.source);
  if (offer.source.capture_id === "wegovy-savings-20260802") {
    const publishedClaims = [
      offer.offer_name, offer.formulation, offer.expiry_display, offer.eligibility.insurance_requirement,
      offer.eligibility.government_program_rule, offer.eligibility.new_patient_requirement,
      ...offer.pricing.current_terms.flatMap((term) => [term.label, term.unit]),
      ...offer.pricing.transition_terms.flatMap((term) => [term.label, term.unit]),
      ...offer.pricing.post_offer_terms.flatMap((term) => [term.label, term.unit]),
    ].filter((value) => typeof value === "string");
    if (publishedClaims.some((value) => UNSUPPORTED_NOVOCARE_CLAIM.test(value))) throw new Error("offer_unsupported_novocare_claim");
    if (offer.coverage_lane === "self_pay_outside_insurance" && (offer.eligibility.reimbursement_prohibited !== false || offer.eligibility.insurance_limit_application_prohibited !== false)) throw new Error("offer_unsupported_novocare_claim");
  }
}

export function validateDeals(config, { now = new Date().toISOString() } = {}) {
  const clocks = evaluationClockAuthorities.has(now) ? requireEvaluationClocks(config, now) : null;
  const derived = derivedAuthorities.get(config);
  if (derived) {
    const validation = validateDeals(derived.base, {now: clocks?.preservedNow ?? now});
    if (sha256(canonicalJson(config)) !== derived.digest) throw new Error('material_derived_offer_tampered');
    for (const offer of config.offers) {
      const nowMs = parseIso(evaluationAt(now, offer.id), 'offers_now');
      const checkedMs = parseIso(offer.checked_at, 'offer_checked_at');
      if (checkedMs > nowMs) throw new Error(`offer_evidence_future:${offer.id}`);
      if (nowMs - checkedMs > MAX_EVIDENCE_AGE_DAYS * DAY_MS) throw new Error(`offer_evidence_stale:${offer.id}`);
    }
    return validation;
  }
  assertExactKeys(config, TOP_LEVEL_KEYS, "offers_authority");
  if (config.schema !== "glp-clinic-scout-manufacturer-offer-evidence-v2" || config.publication_state !== "LINK_DARK_REVIEW_REQUIRED") throw new Error("offers_authority_invalid");
  assertExactKeys(config.ledger, LEDGER_KEYS, "offers_ledger");
  if (canonicalJson(config.ledger) !== canonicalJson(AUTHORITY.ledger)) throw new Error("offers_ledger_binding_invalid");
  if (!Array.isArray(config.offers) || !config.offers.length) throw new Error("offers_records_invalid");

  const ids = new Set();
  for (const offer of config.offers) {
    const nowMs = parseIso(evaluationAt(now, offer.id), "offers_now");
    validateOfferShape(offer);
    if (ids.has(offer.id)) throw new Error("offer_id_duplicate");
    ids.add(offer.id);
    const expectedDigest = AUTHORITY.records[offer.id];
    if (!expectedDigest || sha256(canonicalJson(offer)) !== expectedDigest) throw new Error(`offer_authority_drift:${offer.id}`);
    const checkedMs = Date.parse(offer.checked_at);
    if (checkedMs > nowMs) throw new Error(`offer_evidence_future:${offer.id}`);
    if (nowMs - checkedMs > MAX_EVIDENCE_AGE_DAYS * DAY_MS) throw new Error(`offer_evidence_stale:${offer.id}`);
  }
  if (ids.size !== Object.keys(AUTHORITY.records).length || Object.keys(AUTHORITY.records).some((id) => !ids.has(id))) throw new Error("offer_authority_record_set_invalid");
  return { status: "PASS", records: config.offers.length, sources: new Set(config.offers.map((offer) => offer.source.capture_id)).size };
}

export function offerIsWithinWindow(offer, now = new Date().toISOString()) {
  const nowMs = parseIso(now, "offer_window_now");
  return offer.status === "VERIFIED" && (offer.expires_at === null || nowMs < Date.parse(offer.expires_at));
}

export function activeDeals(config, now = new Date().toISOString()) {
  validateDeals(config, { now });
  return config.offers.filter((offer) => offerIsWithinWindow(offer, now));
}

function termIsCurrent(term, nowMs) {
  return (term.valid_from === null || Date.parse(term.valid_from) <= nowMs) && (term.expires_at === null || nowMs < Date.parse(term.expires_at));
}

function renderPriceTerm(term) {
  return `<li><strong>$${esc(term.amount_usd)}</strong> ${esc(term.unit)} — ${esc(term.label)}</li>`;
}

function renderEligibility(offer) {
  const rules = [
    "Valid prescription required.",
    `Insurance lane: ${offer.eligibility.insurance_requirement}.`,
    `Government-program rule: ${offer.eligibility.government_program_rule}.`,
  ];
  if (offer.eligibility.outside_insurance_required) rules.push("The transaction must be processed outside insurance.");
  if (offer.eligibility.reimbursement_prohibited) rules.push("The patient must not seek insurance reimbursement.");
  if (offer.eligibility.insurance_limit_application_prohibited) rules.push("The expense must not be applied to an insurance limit.");
  if (offer.eligibility.new_patient_requirement) rules.push(`New-patient condition: ${offer.eligibility.new_patient_requirement}.`);
  if (offer.eligibility.fda_approved_use_required) rules.push("The prescription must be for an approved use consistent with FDA-approved product labeling.");
  if (offer.fill_limit) rules.push(`Fill limit: ${offer.fill_limit.qualifier} ${offer.fill_limit.count} ${offer.fill_limit.period}.`);
  return rules.map((rule) => `<li>${esc(rule)}</li>`).join("");
}

function renderOffer(offer, nowMs) {
  const current = [...offer.pricing.current_terms, ...offer.pricing.transition_terms].filter((term) => termIsCurrent(term, nowMs));
  const futureTransitions = offer.pricing.transition_terms.filter((term) => term.valid_from !== null && Date.parse(term.valid_from) > nowMs);
  const transition = futureTransitions.length ? `<h3>Scheduled transition in the accepted capture</h3><ul>${futureTransitions.map(renderPriceTerm).join("")}</ul>` : "";
  const postOffer = offer.pricing.post_offer_terms.length ? `<h3>Prices stated after the two-fill offer</h3><ul>${offer.pricing.post_offer_terms.map(renderPriceTerm).join("")}</ul>` : "";
  const maxSavings = offer.pricing.max_savings_usd_per_month === null ? "" : `<p>Maximum stated savings: <strong>$${esc(offer.pricing.max_savings_usd_per_month)} per month</strong>.</p>`;
  const quote = esc(offer.source.exact_quote).replaceAll("\n", "<br>");
  return `<article class="panel" data-offer-id="${esc(offer.id)}"><p class="eyebrow">${esc(offer.product)} · ${esc(offer.coverage_lane.replaceAll("_", " "))}</p><h2>${esc(offer.offer_name)}</h2><p><strong>Formulation:</strong> ${esc(offer.formulation)}${offer.doses_mg.length ? ` · <strong>Doses:</strong> ${offer.doses_mg.map((dose) => `${esc(dose)} mg`).join(", ")}` : ""}</p><h3>Current price terms</h3><ul>${current.map(renderPriceTerm).join("")}</ul>${maxSavings}${transition}${postOffer}<h3>Eligibility and limits</h3><ul>${renderEligibility(offer)}</ul><p><strong>Expiry:</strong> ${esc(offer.expiry_display)}</p><details><summary>Accepted source capture and exact quote</summary><blockquote data-exact-source-quote>${quote}</blockquote><p data-source-reference>Official source reference (plain text only): ${esc(offer.source.url)} · Firecrawl scrape ID ${esc(offer.source.scrape_id)} · quote SHA-256 ${esc(offer.source.exact_quote_sha256)} · evidence dated ${esc(offer.checked_at)}</p></details></article>`;
}

function renderDealsUnthemed(config, now = new Date().toISOString()) {
  validateDeals(config, { now });
  const offers = config.offers.filter((offer) => offerIsWithinWindow(offer, evaluationAt(now, offer.id)));
  const cards = offers.map((offer) => renderOffer(offer, Date.parse(evaluationAt(now, offer.id)))).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><meta name="referrer" content="no-referrer"><link rel="canonical" href="${CANONICAL_URL}"><title>Manufacturer savings terms monitor · Clinic Scout</title></head><body><main id="main"><section class="page-band"><p class="eyebrow">Wave 4 candidate · link-dark · source-capture only</p><h1>Current manufacturer savings terms, with the eligibility attached.</h1><p>Eligibility controls every displayed offer. These are not universal prices. Clinic Scout does not determine eligibility, distribute savings cards, accept applications, or connect visitors to a manufacturer or provider.</p><p>Terms may change. This page fails closed when its accepted evidence is future-dated, older than ${MAX_EVIDENCE_AGE_DAYS} days, expired, host-invalid, schema-invalid, or hash-invalid.</p></section><aside class="notice"><h2>Commercial evidence—not medical advice</h2><p>A savings term does not establish that a product is appropriate, available, covered, or prescribed for you.</p></aside><section aria-label="Current accepted manufacturer terms">${cards}</section><section><h2>Evidence boundary</h2><p>Every record is bound to an accepted Firecrawl scrape ID, the exact captured quote, and the ledger’s quote hash. Source addresses are shown only as plain, non-clickable references. This route has no forms, action links, scripts, analytics runtime, application path, or provider connection.</p></section></main><footer><p>Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.</p></footer></body></html>`;
}

export function renderDeals(config, now = new Date().toISOString()) {
  config = resolveAcceptedDeals(config, {now});
  return applyStandaloneDarkTheme(renderDealsUnthemed(config, now), "savings-monitor");
}

function htmlFacts(html) {
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]);
  return {
    action_links: anchors.length,
    outbound_action_links: anchors.filter((anchor) => /href=["']https?:/i.test(anchor)).length,
    forms: (html.match(/<form\b/gi) || []).length,
    scripts: (html.match(/<script\b/gi) || []).length,
    runtime_assets: (html.match(/<(?:script|link)\b[^>]*(?:src=|rel=["']stylesheet)/gi) || []).length,
    go_links: anchors.filter((anchor) => /href=["']\/go\//i.test(anchor)).length,
    checkout_links: anchors.filter((anchor) => /(?:checkout|buy\.stripe\.com)/i.test(anchor)).length,
  };
}

function deriveManifest(config, html, now) {
  const clocks = evaluationClockAuthorities.get(now);
  const active = config.offers.filter((offer) => offerIsWithinWindow(offer, evaluationAt(now, offer.id)));
  const captures = [...new Set(config.offers.map((offer) => offer.source.capture_id))].sort();
  const scrapes = [...new Set(config.offers.map((offer) => offer.source.scrape_id))].sort();
  const quoteHashes = [...new Set(config.offers.map((offer) => offer.source.exact_quote_sha256))].sort();
  return {
    schema: "wave4-manufacturer-offer-build-v2",
    status: "PASS_LOCAL_REVIEW_HELD",
    evaluated_at: clocks?.preservedNow ?? now,
    ...(clocks ? { evaluation_mode: 'per_offer', offer_evaluation_clocks: now } : {}),
    route: ROUTE,
    publication_state: config.publication_state,
    record_count: config.offers.length,
    active_record_count: active.length,
    active_record_ids: active.map((offer) => offer.id),
    source_count: captures.length,
    source_capture_ids: captures,
    source_scrape_ids: scrapes,
    source_quote_sha256: quoteHashes,
    source_ledger: { ...config.ledger },
    html_facts: htmlFacts(html),
    effects: { provider_calls: 0, checkout_attempts: 0, deployments: 0, emails: 0, spend_usd: 0 },
  };
}

export function buildDealArtifacts(config, { now, evidenceInputs, evaluationClocks } = {}) {
  if (evaluationClocks !== undefined) {
    const authority = requireEvaluationClocks(config, evaluationClocks);
    if (now !== undefined && now !== authority.preservedNow) throw new Error('offer_evaluation_clocks_scalar_conflict');
    if (evidenceInputs !== undefined && evidenceInputs !== authority.inputs) throw new Error('offer_evaluation_clocks_reader_conflict');
    now = evaluationClocks;
    evidenceInputs = authority.inputs;
  } else {
    if (now === undefined) now = new Date().toISOString();
  }
  config = resolveAcceptedDeals(config, {now, evidenceInputs});
  validateDeals(config, { now });
  const html = renderDeals(config, now);
  const manifest = deriveManifest(config, html, now);
  if (Object.values(manifest.html_facts).some((count) => count !== 0)) throw new Error("offer_route_action_or_runtime_detected");
  return { html, manifest };
}

export const dealIngestionContract = Object.freeze({
  route: ROUTE,
  canonicalUrl: CANONICAL_URL,
  maximumEvidenceAgeDays: MAX_EVIDENCE_AGE_DAYS,
  allowedOfficialHosts: Object.freeze(["www.novocare.com", "zepbound.lilly.com"]),
});
