import { WORDMARK_CSS, defaultMetrics, fitWordmark } from "./provider-wordmark.mjs";
import { subidAttributes } from "./affiliate-subid.mjs";
import { selectedGoOutbound } from "./go-render-selection.mjs";
// DESIGN WAVE 2026-08-06: compare-page heading, browsable tables, no horizontal scroll.
import { buildSchemaGraph } from "./schema.mjs";
import { collectEvidenceDates, deriveMoneyPageFreshness } from "./freshness.mjs";
import { CITATION_REASONS, renderCitationAnchor } from "./citation-attribution.mjs";
import { THERAPEUTIC_FILTERS, TREATMENT_FILTERS } from "./therapeutic-taxonomy.mjs";
import { CARDS_VISIBLE_BEFORE_DISCLOSURE, renderCompareCard, renderCompareGrid } from "./provider-compare-card.mjs";

const FTC = "Clinic Scout may earn commissions from provider links. Check the ordering method stated for each comparison. Payment is not evidence of quality, safety or medical suitability.";
const LEAD_DISCLOSURE = "Lead generation, not advertising. Free · No commitment · 30 seconds. We do not share contact details unless the person separately requests matching and gives explicit consent.";
const AFFILIATE_MICRO_DISCLOSURE = `Clinic Scout is independent and reader-supported — we may earn a commission at no extra cost to you. The scored comparison uses the published evidence rubric, not a clinical assessment. <a href="/how-we-make-money/">How we make money</a>.`;
const CTA_COPY = Object.freeze({
  start: (name) => `Start with ${name} →`,
  visit: (name) => `Visit ${name} ↗`,
  price: (name) => `Check current price at ${name} ↗`,
  // ED 3.5/3.6: the guide offer modules send a reader to the provider's own terms
  // and pricing page - which is exactly what the surrounding guide told them to go
  // read. The label promises a document to inspect, not an outcome.
  terms: (name) => `See current terms & pricing at ${name} \u2197`,
  // ADS surface only (SPEC-ADS §3.1.4, CR-8): paid landing pages use
  // qualification framing from day one. Organic surfaces never use this key.
  qualify: (name) => `See if you qualify at ${name} \u2192`,
});
const POSITIONS = ["intro", "pros", "pricing", "conclusion"];
const SCORE_WEIGHTS = Object.freeze({
  price_transparency: 30,
  medical_oversight: 25,
  insurance_support: 15,
  public_reviews: 15,
  shipping_transparency: 15,
});
const SCORE_LABELS = Object.freeze({
  price_transparency: "Price transparency",
  medical_oversight: "Care-process visibility",
  insurance_support: "Insurance support",
  public_reviews: "Public reviews",
  shipping_transparency: "Shipping transparency",
});
const HUMAN_BEST_FOR = Object.freeze({
  "found-health": "Insurance navigation",
  "yourera-program": "Month-to-month self-pay",
  "trimi-glp-1": "Annual-plan pricing",
  shedrx: "Published cancellation terms",
  "gala-health": "Flat annual-plan pricing",
  "oak-weight-loss-program": "Shipping details",
  healthrx: "Clinician workflow",
  "try-ageless": "Delivery-window clarity",
  wellorithm: "Service-area clarity",
  "enhance-md": "Recurring-price clarity",
  "synergy-rx": "Direct verification",
  "care-bare-rx-glp1": "Published shipping terms",
  "serena-health": "Review-process clarity",
});

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeProgramId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id)) throw new Error("program_id_invalid");
  return id;
}

function providerName(row) {
  return row?.provider || row?.display_name || row?.program_id || "Provider pending";
}

function validateLogo(logo) {
  if (!logo || !/^\/assets\/provider-logos\/[a-z0-9.-]+\.(?:svg|webp)$/.test(logo.path || "") || !logo.alt || !Number.isInteger(logo.width) || logo.width < 1 || !Number.isInteger(logo.height) || logo.height < 1 || !/^[a-f0-9]{64}$/.test(logo.sha256 || "") || logo.runtime_remote_load !== false || !["light", "dark"].includes(logo.surface)) {
    throw new Error("provider_logo_contract_invalid");
  }
}

function renderLogo(row, placement = "card") {
  // A provider whose brand mark we have not captured and verified gets a plain
  // wordmark, not a stand-in logo. Drawing something logo-shaped for a brand we
  // never fetched would be inventing a provider fact, and gating the row on a
  // missing image is what kept these providers off the page in the first place.
  //
  // 2026-08-18: the wordmark is FITTED, not a fixed size - src/provider-chip.mjs
  // computes the largest size that provably fits this chip from the real font
  // metrics, so a long name can no longer overflow or break mid-word. The chip
  // SURFACE is likewise derived from the asset's measured ink
  // (`logo.treatment`), not from which page we captured the mark on, so a
  // white logo gets the dark chip instead of vanishing into the paper one.
  if (!row.logo) return renderWordmark(row, placement);
  validateLogo(row.logo);
  const loading = ["verdict", "table"].includes(placement) ? "eager" : "lazy";
  const chip = row.logo.chip_class || (row.logo.treatment === "dark-chip" ? "dark" : "light");
  const scale = Number(row.logo.content_scale) > 1
    ? ` style="--logo-content-scale:${Number(row.logo.content_scale).toFixed(3)}"` : "";
  return `<span class="provider-logo provider-logo--${esc(placement)} provider-logo--${esc(chip)}"${scale}><img src="${esc(row.logo.path)}" alt="${esc(row.logo.alt)}" width="${esc(row.logo.width)}" height="${esc(row.logo.height)}" loading="${loading}" decoding="async"></span>`;
}

/** One uniform, fitted wordmark. Identical markup and type on every surface. */
export function renderWordmark(row, placement = "card") {
  const name = providerName(row);
  // The build pre-computes every fit (src/provider-chip.mjs). A caller that
  // renders one row directly still gets a FITTED wordmark rather than the
  // unfitted raw text this replaced, so the defect cannot come back through a
  // side door.
  const fit = row.wordmark?.[placement] || row.wordmark?.card
    || fitWordmark(defaultMetrics(), name, placement in { card: 1, table: 1, verdict: 1, intent: 1, decision: 1, quiz: 1 } ? placement : "card");
  const lines = fit.lines.map((line) => `<span>${esc(line)}</span>`).join("");
  return `<span class="provider-logo provider-logo--${esc(placement)} provider-logo--wordmark"><span class="provider-wordmark" style="font-size:${Number(fit.px)}px">${lines}</span></span>`;
}

// 2026-08-06 cluster 1. "Sources checked <one date>" was a hand-frozen literal,
// and after a provider wave it under-reported the page's own freshness by two
// weeks. It is now derived, and it states a WINDOW when the page's sources were
// not all checked on the same day - a single date would claim a sweep that did
// not happen. Each source still carries its own date in the ledger below.
function sourceWindow(spec) {
  const from = spec.source_checked_from;
  const through = spec.source_checked_through || spec.date_modified;
  return from && through
    ? `Prices checked <span data-prices-checked-date>${esc(from)} – ${esc(through)}</span>`
    : "Price-check range unavailable";
}

function sourceForRow(spec, row) {
  const source = (spec.sources || []).find((item) => item.source_id === row.citation_source_id && item.url === row.source_url);
  if (!source) throw new Error("provider_citation_source_invalid");
  return source;
}

function renderCitation(spec, row, label = "Source") {
  const source = sourceForRow(spec, row);
  const number = Number(source.source_id.replace("source-", ""));
  return `<sup class="inline-citation"><a href="#${esc(source.source_id)}" aria-label="${esc(label)} ${esc(number)}">${esc(number)}</a></sup>`;
}

function claimQualification(row, value) {
  const note = row.therapeutic_taxonomy?.claim_qualification;
  return note && /\b(?:zepbound|mounjaro|wegovy)\b/i.test(String(value))
    ? `<span class="therapeutic-summary__qualification">${esc(note)}</span>` : "";
}

function citedFact(spec, row, value, label = "Source") {
  return `${esc(value)}${renderCitation(spec, row, label)}${label === "Service source" ? "" : claimQualification(row, value)}`;
}

function validatePromo(promo) {
  if (!promo || !["VERIFIED", "NOT_VERIFIED"].includes(promo.status) || !promo.label || !promo.verified_as_of) throw new Error("promo_contract_invalid");
  if (promo.status === "VERIFIED" && (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(promo.code || "") || !/^https:\/\//.test(promo.source_url || ""))) throw new Error("verified_promo_incomplete");
  if (promo.status === "NOT_VERIFIED" && (promo.code !== null || promo.source_url !== null)) throw new Error("unverified_promo_must_be_empty");
}

function renderPromo(row, compact = false) {
  validatePromo(row.promo);
  if (row.promo.status === "VERIFIED") return `<div class="promo-field${compact ? " compact" : ""}" data-promo-status="verified"><span>Verified current offer</span><strong>${esc(row.promo.code)}</strong><a href="${esc(row.promo.source_url)}" rel="noopener">Source</a></div>`;
  return "";
}

function listItems(items, className = "", citation = "", row = null) {
  return items.map((item) => `<li${className ? ` class="${className}"` : ""}>${esc(item)}${citation}${row ? claimQualification(row, item) : ""}</li>`).join("");
}

function hasComparableReviewEvidence(row) {
  return row.social_proof?.status === "VERIFIED" && Number(row.criteria_scores?.public_reviews) > 0;
}

function scoreableCriteria(row) {
  return Object.entries(SCORE_WEIGHTS).filter(([key]) => key !== "public_reviews" || hasComparableReviewEvidence(row));
}

function humanBestFor(row) {
  if (HUMAN_BEST_FOR[row.program_id]) return HUMAN_BEST_FOR[row.program_id];
  const fallback = String(row.best_for || "Published terms")
    .replace(/^Stronger published\s+/i, "")
    .replace(/\s+evidence in this comparison$/i, "")
    .replaceAll("-", " ")
    .trim();
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

function commercialSummary(row) {
  return `${providerName(row)}'s strongest documented category is ${humanBestFor(row).toLowerCase()}. Verify current price and terms at the source before enrolling.`;
}

export function scoreProvider(row) {
  const scores = row?.criteria_scores || {};
  if (Object.keys(SCORE_WEIGHTS).some((key) => !Number.isFinite(scores[key]) || scores[key] < 0 || scores[key] > 100)) return null;
  const criteria = scoreableCriteria(row);
  const availableWeight = criteria.reduce((total, [, weight]) => total + weight, 0);
  return Math.round(criteria.reduce((total, [key, weight]) => total + scores[key] * weight, 0) / availableWeight);
}

function renderStars(score) {
  if (score === null) return `<span class="score-pending">Score pending evidence</span>`;
  const outOfTen = (score / 10).toFixed(1);
  const outOfFive = (score / 20).toFixed(1);
  return `<span class="score-lockup"><strong class="score-ten">${outOfTen}<span>/10</span></strong><span class="stars" role="img" aria-label="${outOfTen} out of 10; visualized as ${outOfFive} out of 5 stars"><span aria-hidden="true">★★★★★</span><span class="stars-fill" style="width:${score}%" aria-hidden="true">★★★★★</span></span></span>`;
}

function validateSocialProof(proof) {
  if (!proof || !["VERIFIED", "NOT_VERIFIED_COMPARABLE"].includes(proof.status)) throw new Error("social_proof_status_invalid");
  if (proof.status === "VERIFIED") {
    if (!proof.source_name || !proof.source_url || !proof.verified_as_of || !Number.isFinite(proof.rating) || proof.rating < 0 || proof.rating > 5 || !Number.isInteger(proof.review_count) || proof.review_count < 1) {
      throw new Error("verified_social_proof_incomplete");
    }
  } else if (!proof.explanation || !proof.methodology_path || !proof.verified_as_of) {
    throw new Error("unavailable_social_proof_incomplete");
  }
}

function renderSocialProof(row, compact = false) {
  const proof = row.social_proof;
  validateSocialProof(proof);
  if (proof.status === "VERIFIED") {
    const count = new Intl.NumberFormat("en-US").format(proof.review_count);
    return `<div class="social-proof${compact ? " compact" : ""}" data-proof-status="verified"><span class="proof-label">${esc(proof.label || "Public review signal")}</span><strong>${esc(proof.rating.toFixed(1))}/5 · ${esc(count)} reviews</strong><a href="${esc(proof.source_url)}" rel="noopener">${esc(proof.source_name)}</a></div>`;
  }
  return "";
}

function transparentAffiliateHref(program) {
  if (program?.affiliate_link_mode !== "transparent_direct" || !program?.affiliate_href) throw new Error("affiliate_direct_link_contract_invalid");
  const url = new URL(program.affiliate_href);
  // Network programs pin to the network's own tracking host. A provider-issued
  // direct link (OrderlyMeds, GobyMeds) has no network host, so the row declares
  // the host its own contract published and we pin to that - the link still can
  // never point somewhere the provider artifact did not name.
  const expectedHost = program.affiliate_network === "Katalys" ? "track.revoffers.com"
    : program.affiliate_network === "Awin" ? "www.awin1.com"
    : program.affiliate_tracking_host || null;
  if (url.protocol !== "https:" || !expectedHost || url.hostname !== expectedHost) throw new Error("affiliate_direct_link_host_invalid");
  return url.toString();
}

function pageTypeOf(spec) {
  const path = String(spec?.path || "");
  if (path.startsWith("/best/")) return "comparison";
  if (path.startsWith("/cost/")) return "cost";
  if (path.startsWith("/compare/")) return "versus";
  // ED B-13: guides became a monetized surface. They get their own page type so the
  // guide-table/offer-module click quality is measurable against the money pages
  // rather than being silently pooled with them.
  if (path.startsWith("/guides/")) return "guide";
  return "money";
}

function rankPositionOf(spec, program) {
  if (!Array.isArray(spec?.rows) || !program?.program_id) return 0;
  const index = rankRows(spec.rows, spec).findIndex((row) => row.program_id === program.program_id);
  return index < 0 ? 0 : index + 1;
}

export function affiliateCta(spec, program, position, copy = "visit", variant = "a", extra = "") {
  const selected = selectedGoOutbound(program, `lp-compare.lp${rankPositionOf(spec, program)}`);
  const active = Boolean(spec.live_link_allowed && spec.operator_gate_receipt && (selected ? !selected.held : program?.live_link_allowed && program?.promotion_authorized));
  const programId = safeProgramId(program?.program_id || "pending");
  const name = providerName(program);
  const label = (CTA_COPY[copy] || CTA_COPY.visit)(name);
  const common = `data-program="${esc(programId)}" data-link-position="${esc(position)}" data-variant="${esc(variant)}" ${extra}`.trim();
  if (!active) {
    const reviewPath = program?.review_path || `/reviews/${programId}/`;
    return `<a class="cta internal affiliate-fallback" href="${esc(reviewPath)}" data-affiliate-state="unavailable" ${common}>Read ${esc(name)} review</a>`;
  }
  const attributionMonth = String(spec.date_modified || spec.source_checked_through || "").slice(0, 7).replace("-", "");
  if (!/^\d{6}$/.test(attributionMonth)) throw new Error("affiliate_subid_month_invalid");
  const subid = selected?.surfaceCode || `${spec.page_slug}-${position}-${attributionMonth}`;
  const validatedInputHref = transparentAffiliateHref(program);
  const href = selected?.href || validatedInputHref;
  // CR-5 / B-01: rank + element + page identity ride the anchor so the runtime
  // can build sub1..sub4 and fire one canonical event to GA4 and PostHog.
  const subids = subidAttributes({
    network: selected?.network || program.affiliate_network,
    position,
    rankPosition: rankPositionOf(spec, program),
    pageSlug: spec.page_slug,
    pageType: pageTypeOf(spec),
    providerSlug: program.review_slug || programId,
  });
  return `<a class="cta primary affiliate" href="${esc(href)}" rel="sponsored nofollow noopener" data-analytics-event="affiliate_click" data-link-mode="${selected ? 'server-redirect' : 'transparent-direct'}" data-affiliate-state="live" data-merchant="${esc(program.provider || program.display_name || programId)}" data-page-slug="${esc(spec.page_slug)}" data-subid="${esc(subid)}" ${subids} ${common}>${esc(label)}</a>`;
}

function leadCta(program, position, extra = "", label = "Find my match") {
  const id = safeProgramId(program?.program_id || "general");
  return `<a class="cta lead" href="/quiz/provider-fit/?source=${esc(position)}&amp;provider=${esc(id)}" data-lead-cta="true" ${extra}>${esc(label)}</a>`;
}

function internalReviewCta(row) {
  const path = row.review_path || "#sources";
  const label = row.review_path ? `Read ${row.provider} review` : "Review cited sources";
  return `<a class="cta internal" href="${esc(path)}">${esc(label)}</a>`;
}

function titleFocusRows(spec) {
  if (!String(spec?.path || "").startsWith("/compare/")) return [];
  const title = String(spec.h1 || spec.title || "").toLowerCase().replaceAll(/[^a-z0-9]+/g, " ");
  return spec.rows.filter((row) => title.includes(providerName(row).toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim()));
}

function rankRows(rows, spec = null) {
  const sorted = [...rows].sort((left, right) => {
    const a = scoreProvider(left);
    const b = scoreProvider(right);
    if (a === null && b === null) return providerName(left).localeCompare(providerName(right));
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a || providerName(left).localeCompare(providerName(right));
  });
  const focus = spec ? titleFocusRows(spec) : [];
  if (focus.length < 2) return sorted;
  const focusedIds = new Set(focus.map((row) => row.program_id));
  return sorted.filter((row) => focusedIds.has(row.program_id)).concat(sorted.filter((row) => !focusedIds.has(row.program_id)));
}

function validateProviderCard(row) {
  safeProgramId(row.program_id);
  if (!row.provider || !row.best_for || !row.bottom_line) throw new Error("provider_card_copy_incomplete");
  if (!Array.isArray(row.pros) || row.pros.length < 2 || row.pros.length > 5) throw new Error("provider_card_pros_invalid");
  if (!Array.isArray(row.cons) || row.cons.length < 2 || row.cons.length > 5) throw new Error("provider_card_cons_invalid");
  validateSocialProof(row.social_proof);
}

const THERAPEUTIC_LABELS = new Map(THERAPEUTIC_FILTERS.map((item) => [item.value, item.label]));
const TREATMENT_LABELS = new Map(TREATMENT_FILTERS.filter((item) => !["all", "either"].includes(item.value)).map((item) => [item.value, item.label]));

function therapeuticMeta(row) {
  const taxonomy = row.therapeutic_taxonomy;
  if (!taxonomy) return { attrs: "", summary: "" };
  const tokens = [
    ...(taxonomy.molecule_tags || []),
    ...(taxonomy.brand_name_tags || []),
    ...(taxonomy.delivery_form_tags || []),
  ];
  const treatments = taxonomy.treatment_type_tags || [];
  const labels = tokens.map((token) => THERAPEUTIC_LABELS.get(token) || token);
  const treatmentLabel = treatments.length
    ? `Treatment type: ${treatments.map((token) => TREATMENT_LABELS.get(token) || token).join(", ")}`
    : "Treatment type not verified";
  return {
    attrs: ` data-therapeutic="${esc(tokens.join(" "))}" data-treatment="${esc(treatments.join(" "))}" data-treatment-verified="${taxonomy.treatment_type_state === "verified" ? "true" : "false"}" data-taxonomy-sha="${esc(taxonomy.normalized_sha256)}"`,
    summary: `<span class="therapeutic-summary"><span class="therapeutic-summary__verified">${taxonomy.claim_qualification ? "Reported options (conditional advertisement)" : "Verified options"}: ${esc(labels.join(", "))}</span>${taxonomy.claim_qualification ? `<span class="therapeutic-summary__qualification">${esc(taxonomy.claim_qualification)}</span>` : ""}<span class="therapeutic-summary__treatment${treatments.length ? "" : " therapeutic-summary__treatment--unknown"}">${esc(treatmentLabel)}</span></span>`,
  };
}

import { isTypedPrice, renderTypedPrice } from "./typed-price-labels.mjs";
import {priceStateText} from './price-state.mjs';

export function renderComparisonTable(spec) {
  // 2026-08-06 surface unification: the cap used to be 16, which is how a 29-provider
  // site shipped a 13-provider table. The table carries every live provider now; the
  // floor stays so a page can never render as a stub.
  if (!Array.isArray(spec.rows) || spec.rows.length < 4 || spec.rows.length > 64) throw new Error("comparison_row_count_invalid");
  const p1MoneyPage = spec.template_revision === "money-page-p1-v2-wave0";
  const showWait = spec.rows.some((row) => !/^(?:not stated|pending|unknown)$/i.test(String(row.average_wait || "").trim()));
  const rows = rankRows(spec.rows, spec).map((sourceRow) => {
    const row = {
      ...sourceRow,
      provider: sourceRow.render_provider || providerName(sourceRow),
      social_proof: sourceRow.social_proof || {
        status: "NOT_VERIFIED_COMPARABLE",
        label: "Independent public reviews",
        explanation: "No comparable independent public-review dataset was verified for this comparison.",
        methodology_path: "/how-we-rate/",
        verified_as_of: spec.source_checked_through || spec.date_modified || "page evidence date not stated",
      },
    };
    const typedRows = (spec.pricing_matrix?.providers?.[matrixKey(row)]?.medications || []).filter(isTypedPrice);
    const missingPrice = priceStateText(spec.pricing_matrix?.providers?.[matrixKey(row)]);
    const typedBlock = missingPrice ? `<span data-price-state="not-attested">${esc(missingPrice)}</span>` : typedRows.map(row => renderTypedPrice(row, { showDate: false })).join("");
    const score = scoreProvider(row);
    const therapeutic = therapeuticMeta(row);
    if (p1MoneyPage) return `<tr data-score="${score ?? -1}" ${typedRows.length ? 'data-price-state="informational"' : `data-price="${esc(row.starting_price_sort ?? -1)}"`} data-program="${esc(row.program_id)}" data-provider="${esc(row.provider)}"${therapeutic.attrs}><td>${renderLogo(row, "table")}</td><th scope="row"><a href="#provider-${esc(row.program_id)}">${esc(row.provider)}</a> <span class="partner-badge" title="Approved commercial relationship; commission may apply.">affiliate relationship · commission may apply</span></th><td data-label="Starting price">${typedBlock || citedFact(spec, row, row.starting_price, "Price source")}</td><td data-label="Medications offered">${citedFact(spec, row, row.meds_offered, "Service source")}${therapeutic.summary}</td><td data-label="Insurance">${citedFact(spec, row, row.insurance, "Payment source")}</td>${showWait ? `<td data-label="Average wait">${citedFact(spec, row, row.average_wait, "Timing source")}</td>` : ""}<td data-label="Evidence score">${renderStars(score)}</td><td data-label="Next steps"><div class="dual-cta">${affiliateCta(spec, row, "pricing", "price")}${leadCta(row, "comparison-table")}</div></td></tr>`;
    return `<tr data-score="${score ?? -1}" ${typedRows.length ? 'data-price-state="informational"' : `data-price="${esc(row.starting_price_sort ?? -1)}"`} data-program="${esc(row.program_id)}" data-provider="${esc(row.provider)}"${therapeutic.attrs}><th scope="row">${esc(row.provider)}</th><td data-label="Starting price">${typedBlock || esc(row.starting_price)}</td><td data-label="Medications offered">${esc(row.meds_offered)}${therapeutic.summary}</td><td data-label="Insurance">${esc(row.insurance)}</td><td data-label="Average wait">${esc(row.average_wait)}</td><td data-label="Clinic Scout score">${renderStars(score)}</td><td data-label="Public review signal">${renderSocialProof(row, true)}</td><td data-label="Next steps"><div class="dual-cta">${affiliateCta(spec, row, "pricing", "price")}${leadCta(row, "comparison-table")}</div></td></tr>`;
  }).join("");
  const headers = p1MoneyPage ? `<th class="visually-hidden">Provider logo</th><th>Provider</th><th>Starting price</th><th>Medications offered</th><th>Insurance</th>${showWait ? "<th>Average wait</th>" : ""}<th>Evidence score</th><th>Next steps</th>` : "<th>Provider</th><th>Starting price</th><th>Medications offered</th><th>Insurance</th><th>Average wait</th><th>Clinic Scout score</th><th>Public review signal</th><th>Next steps</th>";
  const facetAttr = spec.rows.every((row) => row.therapeutic_taxonomy) ? " data-therapeutic-facets=\"true\"" : "";
  const consumerFilterAttr = facetAttr && Array.isArray(spec.consumer_therapeutic_filters)
    ? ` data-consumer-therapeutics="${esc(spec.consumer_therapeutic_filters.join(","))}" data-consumer-authority-schema="${esc(spec.consumer_therapeutic_authority_schema || "")}"`
    : "";
  const canonicalProfileAttr = facetAttr && Array.isArray(spec.canonical_provider_ids) && spec.canonical_provider_ids.length
    ? ` data-canonical-provider-ids="${esc(spec.canonical_provider_ids.join(","))}" data-provider-dynamic-profile-schema="${esc(spec.provider_dynamic_profile_schema || "")}"`
    : "";
  return `<div class="table-controls" aria-label="Sort comparison"><button type="button" data-sort="score" aria-pressed="true">Sort by score</button><button type="button" data-sort="price" aria-pressed="false">Sort by price</button></div><div class="table-wrap responsive-table" data-analytics-event="comparison_table_view" data-table-id="primary-comparison" aria-label="Provider comparison table"><table class="cs-table--stack" data-sortable="true" data-sorted-by="score"${facetAttr}${consumerFilterAttr}${canonicalProfileAttr}><caption>Published program terms and normalized evidence scores; unsupported fields are omitted rather than shown as zero.</caption><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderBestForBox(spec) {
  if (!Array.isArray(spec.best_for) || spec.best_for.length < 2 || spec.best_for.length > 4) throw new Error("best_for_contract_invalid");
  const byId = new Map(spec.rows.map((row) => [row.program_id, row]));
  const focus = titleFocusRows(spec);
  const items = focus.length >= 2 ? focus.map((row) => ({ program_id: row.program_id, provider: row.provider, intent_label: humanBestFor(row), one_line: commercialSummary(row) })) : spec.best_for;
  const cards = items.map((item) => {
    const row = byId.get(item.program_id);
    if (!row || item.provider !== row.provider || !item.intent_label || !item.one_line) throw new Error("best_for_reference_invalid");
    return `<article class="intent-card">${renderLogo(row, "intent")}<p class="eyebrow">Best for ${esc(humanBestFor(row))}</p><h3><a href="#provider-${esc(row.program_id)}">${esc(row.provider)}</a></h3>${renderStars(scoreProvider(row))}<p>${citedFact(spec, row, commercialSummary(row), "Selection source")}</p><div class="dual-cta">${affiliateCta(spec, row, "intro", "visit")}${leadCta(row, "best-for")}</div></article>`;
  }).join("");
  return `<section id="best-for" class="best-for-section anchor-section" aria-labelledby="best-for-title"><div class="section-heading"><p class="eyebrow">Choose by intent</p><h2 id="best-for-title">Best for what matters to you</h2><p>Jump to the scored card, verify the cited terms, or use the private matching path. A commercial fit is not a treatment recommendation.</p></div><div class="best-for-grid">${cards}</div></section>`;
}

export function renderProviderCards(spec) {
  return rankRows(spec.rows, spec).map((row, index) => {
    validateProviderCard(row);
    const score = scoreProvider(row);
    const rank = index + 1;
    const subscores = scoreableCriteria(row).map(([key]) => {
      const value = row.criteria_scores?.[key];
      return Number.isFinite(value)
        ? `<li><span>${esc(SCORE_LABELS[key])}</span><strong>${esc((value / 10).toFixed(1))}/10</strong><meter min="0" max="100" value="${esc(value)}">${esc(value)}%</meter></li>`
        : `<li><span>${esc(SCORE_LABELS[key])}</span><strong>Pending evidence</strong></li>`;
    }).join("");
    const citation = renderCitation(spec, row, "Provider source");
    // REPAIR A (progressive disclosure, the 47,592px defect): the summary row
    // is the collapsed identity strip - rank, logo, name, merit score, the
    // dated starting-price line, and a text expand affordance (the open/close
    // chevron itself is CSS on .cs-details, 01-primitives.css). It has to be
    // phrasing-content-only (native <summary> constraint), so every wrapper
    // here is a <span>, never a <div>/<p> - renderLogo/renderStars/
    // datedPriceLine(...,"span") already return spans.
    const summary = `<summary class="provider-card-head"><span class="cs-provider-deep__rank" aria-hidden="true">#${rank}</span>${renderLogo(row, "card")}<span class="cs-provider-deep__id"><span class="eyebrow">#${rank} · Best for ${esc(humanBestFor(row))}</span><h3>${esc(row.provider)}</h3></span>${renderStars(score)}${datedPriceLine(spec, row, "span")}<span class="cs-provider-deep__affordance">Full breakdown</span></summary>`;
    // Everything that used to sit directly in the card - social proof, promo,
    // subscores, pros/cons, bottom line, triple CTA - is unchanged, just
    // re-parented into the disclosure body. No visitor copy is removed; it
    // moves from "always visible" to "visible by default on the top two,
    // one click/tap/Enter away on the rest" (GOAL:625-626).
    const body = `<div class="cs-provider-deep__body">${renderSocialProof(row)}${renderPromo(row)}<div class="subscore-block"><h4>How ${esc(row.provider)} scored</h4><ul>${subscores}</ul></div><div class="pros-cons"><section><h4>Why we picked it</h4><ul>${listItems(row.pros, "", citation, row)}</ul></section><section><h4>Watch-outs</h4><ul>${listItems(row.cons, "", citation, row)}</ul></section></div><div class="bottom-line"><p class="eyebrow">Bottom line</p><p>${citedFact(spec, row, commercialSummary(row), "Bottom-line source")}</p></div><div class="triple-cta">${affiliateCta(spec, row, "pros", index === 0 ? "start" : "visit")}${leadCta(row, "provider-card")}${internalReviewCta(row)}</div></div>`;
    // First two cards open (top-pick context); id/data-rank/data-program stay
    // on the SAME element the sticky-CTA IntersectionObserver and jump-nav
    // anchors already target (`.provider-card[data-program]`,
    // `#provider-<id>`) - scripts/validate-sticky-cta-follow.mjs observes this
    // selector regardless of open/closed state, since <details> always keeps
    // its <summary> rendered with real geometry.
    return `<details id="provider-${esc(row.program_id)}" class="provider-card anchor-section cs-details cs-provider-deep${index === 0 ? " provider-card--winner" : ""}" data-rank="${rank}" data-program="${esc(row.program_id)}"${rank <= 2 ? " open" : ""}>${summary}${body}</details>`;
  }).join("");
}

// The lead paragraph used to name the #1 provider in prose, in a data file, by
// hand. It said "HealthRX ranks first" for as long as nobody re-typed it. It is
// derived from the ranking now, so it cannot outlive the ranking.
function rankLeadParagraph(spec) {
  const ranked = rankRows(spec.rows, spec).slice(0, 3);
  if (ranked.length < 3) throw new Error("rank_lead_requires_three_rows");
  const strongest = (row) => {
    const [key] = scoreableCriteria(row)
      .map(([criterion]) => [criterion, Number(row.criteria_scores?.[criterion] ?? -1)])
      .sort((left, right) => right[1] - left[1])[0];
    return SCORE_LABELS[key].toLowerCase();
  };
  const outOfTen = (row) => (scoreProvider(row) / 10).toFixed(1);
  const [first, second, third] = ranked;
  return `${providerName(first)} ranks first in this snapshot at ${outOfTen(first)}/10, strongest on ${strongest(first)}. `
    + `${providerName(second)} (${outOfTen(second)}/10) and ${providerName(third)} (${outOfTen(third)}/10) follow, strongest on ${strongest(second)} and ${strongest(third)}. `
    + `The order is computed at build time from the five published criteria below — it is not a hand-kept list, and it moves when a provider publishes more or less. `
    + `Every price shown is a dated advertisement, not a quote or a coverage promise.`;
}

// SPEC-CRO §4.2 / B-12: the ATF used to be 100% prose - the single most important
// number on a price-comparison page (the top pick's actual price) was absent from
// the first viewport while an email-capture button was the first interactive
// element a visitor met. The verdict card now leads with a dated price line in the
// M1 grammar, and the price carries its `checked` date - the moat made visible at
// exactly the point of comparison.
// `tag` defaults to "p" (the verdict's own block-level usage). The deep
// provider-card summary reuses the identical dated-price grammar inside a
// native <summary> element, whose content model is phrasing-only, so that
// call site passes "span" - same classes, same data, just an inline wrapper.
function datedPriceLine(spec, row, tag = "p") {
  const price = String(row?.starting_price || "").trim();
  const figure = price.match(/\$[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month))?/i)?.[0];
  if (!figure) return "";
  return `<${tag} class="verdict-price" data-top-match-price><strong class="verdict-price-figure">Starting at ${esc(figure.replace(/\s+/g, ""))}</strong><span class="verdict-price-basis">published starting price</span></${tag}>`;
}

// MOAT INVARIANT (non-regressable): "disclosure above results".
// B-12 reordered the ATF so the dated-price verdict card leads the page. That moved
// the first money element (the $ figure and the sponsored CTA) ABOVE the affiliate
// micro-disclosure, which had only ever lived inside the #methodology trust block.
// The card stays exactly as B-12 built it; the SAME disclosure element is re-parented
// to the page header, ahead of every money element in DOM order. Same copy, same class
// - a reorder, not a rewrite. tests/browser/atf-money-conversion.spec.mjs asserts the
// ordering in a real browser so it cannot regress silently again.
function renderAtfDisclosure() {
  return `<p class="byline affiliate-note" data-atf-disclosure>${AFFILIATE_MICRO_DISCLOSURE}</p>`;
}

function renderVerdict(spec, topProgram) {
  return `<section id="quick-answer" class="verdict anchor-section" aria-labelledby="verdict-title"><div class="verdict-grid"><div>${renderLogo(topProgram, "verdict")}<p class="eyebrow">Top pick · ${esc(topProgram.provider)}</p><h2 id="verdict-title">${esc(topProgram.provider)} leads this comparison</h2>${datedPriceLine(spec, topProgram)}<p>${citedFact(spec, topProgram, commercialSummary(topProgram), "Verdict source")}</p>${renderStars(scoreProvider(topProgram))}</div></div><div class="dual-cta hero-ctas" data-top-match>${affiliateCta(spec, topProgram, "intro", "start")}${leadCta(topProgram, "verdict", "", "Get matched free")}</div></section>`;
}

function renderTrustBlock(spec, identity) {
  const sourceCount = new Set((spec.sources || []).map((item) => item.url)).size;
  const criterionCount = scoreableCriteria(spec.rows[0]).length;
  return `<section id="methodology" class="trust-block anchor-section" aria-labelledby="trust-title"><div><p class="eyebrow">How we evaluated · why trust this</p><h2 id="trust-title">The counts are visible. Unsupported fields are omitted.</h2><p>We compared <strong>${spec.rows.length} providers</strong>, checked <strong>${sourceCount} dated sources</strong>, and applied <strong>${criterionCount} published criteria</strong>. Scores normalize across evidence-backed criteria only. Commission is excluded from scoring.</p><p class="byline">By the <a href="${esc(identity.author.bio_path)}">${esc(identity.author.display_name)}</a> · Updated <time datetime="${esc(spec.date_modified)}" data-page-updated>${esc(spec.date_modified)}</time></p></div><dl class="trust-metrics"><div><dt>Providers</dt><dd>${spec.rows.length}</dd></div><div><dt>Sources</dt><dd>${sourceCount}</dd></div><div><dt>Scored criteria</dt><dd>${criterionCount}</dd></div><div><dt>Score scale</dt><dd>0–10</dd></div></dl><p class="lead-disclosure">${esc(LEAD_DISCLOSURE)}</p><a class="text-link" href="/how-we-rate/">Read the full scoring method</a></section>`;
}

function winnerSections(spec) {
  if (!Array.isArray(spec.decision_matrix) || spec.decision_matrix.length < 3) throw new Error("decision_matrix_contract_invalid");
  const byId = new Map(spec.rows.map((row) => [row.program_id, row]));
  const seen = new Set();
  const focus = titleFocusRows(spec);
  const items = focus.length >= 2 ? focus.map((row) => ({ program_id: row.program_id, provider: row.provider, want: humanBestFor(row), reason: commercialSummary(row) })) : spec.decision_matrix;
  return items.map((item) => {
    const row = byId.get(item.program_id);
    if (!row || item.provider !== row.provider || !item.want || !item.reason) throw new Error("decision_matrix_reference_invalid");
    let label = humanBestFor(row);
    if (seen.has(label)) label = `${row.provider}: ${label}`;
    seen.add(label);
    return `<section class="winner decision-matrix-row" data-decision-program="${esc(row.program_id)}">${renderLogo(row, "decision")}<p class="eyebrow">Best for ${esc(label)}</p><h3>Choose ${esc(item.provider)}</h3><p>${citedFact(spec, row, commercialSummary(row), "Decision source")}</p>${internalReviewCta(row)}</section>`;
  }).join("");
}

// REBUILD B-15 (LAY §4 C1 + §5 T2, CRO §4.2): the card-grammar comparison grid.
//
// Feature pills are DERIVED from the row fields the comparison already carries
// and already cites. Nothing here paraphrases a provider claim into a promise:
// a pill either restates a published fact in three words or it does not ship.
function featurePills(row) {
  const pills = [];
  const insurance = String(row.insurance || "");
  const meds = String(row.meds_offered || "").toLowerCase();
  if (/compounded semaglutide/.test(meds)) pills.push("Compounded semaglutide");
  if (/compounded tirzepatide/.test(meds)) pills.push("Compounded tirzepatide");
  if (/brand(ed)?[ -]/.test(meds)) pills.push("Brand-name options");
  if (/self-pay/i.test(insurance)) pills.push("Self-pay");
  if (/hsa|fsa/i.test(insurance)) pills.push("HSA/FSA noted");
  if (/insurance check|carrier support|prior auth/i.test(insurance)) pills.push("Insurance support");
  if (!/^(?:not stated|pending|unknown)$/i.test(String(row.average_wait || "").trim())) pills.push("Start time published");
  return pills;
}

//: The medication filter chips are the medications this page's providers
//: actually have a captured price for - never a fixed menu that can render a
//: chip filtering to nothing.
function compareMedications(spec) {
  const labels = new Map();
  for (const row of spec.rows) {
    const entry = spec.pricing_matrix?.providers?.[matrixKey(row)];
    for (const med of entry?.medications || []) {
      if (!Object.hasOwn(med, "price_kind") && !Number.isFinite(med.ongoing_usd)) continue;
      labels.set(med.medication_id, med.label);
    }
  }
  return [...labels].map(([value, label]) => ({ value, label }));
}

function matrixKey(row) {
  return String(row.review_path || "").replace(/^\/reviews\//, "").replace(/\/$/, "") || row.program_id;
}

export function renderCompareCards(spec) {
  if (!spec.pricing_matrix) return "";
  const cards = rankRows(spec.rows, spec).map((row, index) => {
    const entry = spec.pricing_matrix.providers?.[matrixKey(row)] || null;
    return renderCompareCard({
      row: { ...row, feature_pills: featurePills(row) },
      entry,
      rank: index + 1,
      featured: index === 0,
      // Progressive disclosure, same contract as the comparison table: every card
      // ships in the DOM (crawlers and no-JS readers see all 33), but a phone does
      // not open a 145,000px page. Reproducing glpwinner's 24,894px mobile
      // homepage is a documented anti-pattern (LAY §T1, §0.4 perf budget).
      hidden: index >= CARDS_VISIBLE_BEFORE_DISCLOSURE,
      logo: renderLogo(row, "card"),
      reviewPath: row.review_path || "",
      coupon: spec.coupon_offers_by_program?.[row.program_id] || null,
      cta: affiliateCta(spec, row, "pricing", index === 0 ? "start" : "visit", "a", 'data-compare-card-cta="true"'),
    });
  }).join("");
  return renderCompareGrid({ cards, medications: compareMedications(spec), total: spec.rows.length });
}

function renderJumpNav() {
  return `<nav class="jump-nav" aria-label="On this page"><div class="jump-nav-scroll"><span>Jump to</span><a href="#methodology">How we evaluated</a><a href="#quick-answer">Quick answer</a><a href="#best-for">Best for</a><a href="#compare-cards">Cards</a><a href="#compare">Compare</a><a href="#provider-reviews">Provider cards</a><a href="#faq">FAQ</a><a href="#sources">Sources</a></div></nav>`;
}

function renderInteractionScript() {
  return `<script>(()=>{document.documentElement.style.scrollBehavior='auto';document.documentElement.style.overflowAnchor='none';document.body.style.overflowAnchor='none';const table=document.querySelector('table[data-sortable]');if(!table)return;const tbody=table.tBodies[0];function refreshSticky(row){if(!row)return;const program=row.dataset.program;const provider=row.dataset.provider;const stickyAffiliate=document.querySelector('[data-sticky-affiliate]');const stickyLead=document.querySelector('[data-sticky-lead]');if(stickyAffiliate){const sourceAffiliate=row.querySelector('.cta.affiliate[href][data-link-mode=\"transparent-direct\"],.cta.affiliate-fallback[href]');if(!sourceAffiliate)throw new Error('sticky_action_source_missing');const unavailable=sourceAffiliate.dataset.affiliateState==='unavailable';stickyAffiliate.href=sourceAffiliate.href;stickyAffiliate.dataset.program=program;stickyAffiliate.dataset.affiliateState=unavailable?'unavailable':'live';stickyAffiliate.textContent=unavailable?'Read '+provider+' review':'Start with '+provider+' →';stickyAffiliate.className=unavailable?'cta internal affiliate-fallback':'cta primary affiliate'}if(stickyLead){stickyLead.href='/quiz/provider-fit/?source=sticky&provider='+encodeURIComponent(program);stickyLead.textContent='Find my match'}}
  let pinnedAt=null;
  const controls=[...document.querySelectorAll('[data-sort]')];const applySort=key=>{const rows=[...tbody.rows];rows.sort((a,b)=>{const av=Number(a.dataset[key]);const bv=Number(b.dataset[key]);if(key==='price'){if(av<0)return 1;if(bv<0)return -1;return (av-bv)||(Number(b.dataset.score)-Number(a.dataset.score))||a.dataset.provider.localeCompare(b.dataset.provider)}return (bv-av)||(Number(a.dataset.price)-Number(b.dataset.price))||a.dataset.provider.localeCompare(b.dataset.provider)});rows.forEach(row=>tbody.append(row));controls.forEach(c=>c.setAttribute('aria-pressed',c.dataset.sort===key?'true':'false'));table.setAttribute('data-sorted-by',key);refreshSticky(tbody.rows[0]);pinnedAt=window.scrollY;};controls.forEach(button=>button.addEventListener('click',()=>applySort(button.dataset.sort)));refreshSticky(tbody.rows[0]);
  /* The sticky CTA follows whatever provider the reader is actually looking at.
     It used to observe ONLY .provider-card elements. On the ranked pages those
     start about 40% of the way down - AFTER the whole comparison table - so a
     reader scrolling the 33-row table (which is what these pages are for) read
     past every provider while the button still said the rank-1 merchant. That
     is ~39,000px of stuck CTA on /best/online-glp-1-providers/ and ~70,000px on
     /cost/online-glp-1-programs/: every one of those readers was funnelled to
     one provider, and their clicks were attributed to it.
     So the table ROWS and the best-for decision cards are observed too, and the
     winner is the target nearest the focus line rather than whichever entry the
     callback happened to list first - with several short rows in the band at
     once, "first entry" flickers. */
  const rowFor=p=>[...tbody.rows].find(r=>r.dataset.program===p);
  const programOf=el=>el.dataset.program||el.dataset.decisionProgram||'';
  const targets=[...tbody.rows,...document.querySelectorAll('[data-decision-program]'),...document.querySelectorAll('.provider-card[data-program]')];
  if('IntersectionObserver'in window&&targets.length){const visible=new Set();
    const settle=()=>{if(pinnedAt!==null){if(Math.abs(window.scrollY-pinnedAt)<8)return;pinnedAt=null}
      const focus=window.innerHeight*0.45;let best=null,bestDist=Infinity;
      for(const el of visible){const r=el.getBoundingClientRect();const d=Math.abs((r.top+r.bottom)/2-focus);if(d<bestDist){bestDist=d;best=el}}
      if(!best)return;const row=best.tagName==='TR'?best:rowFor(programOf(best));if(row)refreshSticky(row)};
    const follow=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visible.add(entry.target);else visible.delete(entry.target)}settle()},{rootMargin:'-30% 0px -30% 0px',threshold:0});
    targets.forEach(target=>follow.observe(target));
    /* A long card can hold the band for thousands of pixels without firing an
       intersection change, so re-settle on scroll as well. */
    addEventListener('scroll',settle,{passive:true})}})();</script>`;
}

function renderPageScript({ captureEnabled = true } = {}) {
  if (!captureEnabled) return renderInteractionScript();
  const capture = `<button type="button" class="exit-capture-trigger" data-exit-open aria-controls="content-upgrade-capture" aria-expanded="false">Get the source-check checklist</button><aside id="content-upgrade-capture" class="exit-capture" hidden aria-labelledby="exit-capture-title" data-capture-status="live"><div class="exit-capture-panel" role="dialog" aria-modal="true"><button type="button" class="exit-capture-close" data-exit-close aria-label="Close checklist form">×</button><p class="eyebrow">Free source-check tool</p><h2 id="exit-capture-title">Get the 7-point provider terms checklist</h2><p>Before choosing a provider, check total cost, commitment, eligibility, shipping, support, cancellation, and when the information was checked.</p><form action="/api/content-upgrade" method="post" data-content-upgrade-form><input type="hidden" name="source_page" value=""><input type="hidden" name="lead_magnet_key" value=""><input type="hidden" name="consent_version" value="glp-content-upgrade-v1-20260724"><label>Email<input type="email" name="email" autocomplete="email" required maxlength="254"></label><div class="capture-consents"><label class="capture-consent"><input type="checkbox" name="privacy_consent" value="true" required><span>I agree to the <a href="/privacy/">privacy policy</a> so Clinic Scout can store this request.</span></label><label class="capture-consent"><input type="checkbox" name="marketing_consent" value="true" required><span>Email me the checklist plus occasional provider-comparison research. I can unsubscribe anytime.</span></label></div><label class="capture-honeypot" aria-hidden="true">Leave blank<input type="text" name="company" tabindex="-1" autocomplete="off"></label><button type="submit" class="cta lead">Send me the checklist</button><p class="capture-status" role="status" aria-live="polite"></p></form></div></aside>`;
  const behavior = `<script>(()=>{const panel=document.getElementById('content-upgrade-capture');const forms=[...document.querySelectorAll('[data-content-upgrade-form],[data-content-upgrade-form-inline]')];const form=(panel&&panel.querySelector('[data-content-upgrade-form]'))||forms[0];if(!forms.length)return;const triggers=[...document.querySelectorAll('[data-exit-open]')];const slug=document.body.dataset.pageSlug||'unknown';forms.forEach(f=>{f.elements.source_page.value=slug;f.elements.lead_magnet_key.value=slug+'-terms-checklist';});const key='glp-content-upgrade-dismissed-at';const sevenDays=604800000;let dismissed=Number(localStorage.getItem(key)||0);let opened=false;const open=force=>{if(!panel.hidden)return;if(!force&&(opened||Date.now()-dismissed<sevenDays))return;opened=true;panel.hidden=false;triggers.forEach(button=>button.setAttribute('aria-expanded','true'));document.body.classList.add('capture-open');form.elements.email.focus();window.GCSAnalytics&&window.GCSAnalytics.event&&window.GCSAnalytics.event('content_upgrade_view',{page_slug:slug});};const close=()=>{panel.hidden=true;triggers.forEach(button=>button.setAttribute('aria-expanded','false'));document.body.classList.remove('capture-open');dismissed=Date.now();localStorage.setItem(key,String(dismissed));};triggers.forEach(button=>button.addEventListener('click',()=>open(true)));document.querySelectorAll('[data-exit-close]').forEach(button=>button.addEventListener('click',close));panel.addEventListener('click',event=>{if(event.target===panel)close();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)close();});document.addEventListener('mouseout',event=>{if(event.clientY<=0&&!event.relatedTarget)open(false);});forms.forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const status=form.querySelector('.capture-status');if(document.documentElement.dataset.release!=='live'){status.textContent='This form is not available right now.';return;}const payload=Object.fromEntries(new FormData(form).entries());try{const response=await fetch(form.action,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'capture_failed');window.GCSAnalytics&&window.GCSAnalytics.event&&window.GCSAnalytics.event('content_upgrade_complete',{page_slug:slug});status.textContent='Done — your checklist is on its way to your inbox.';form.reset();dismissed=Date.now();localStorage.setItem(key,String(dismissed));}catch(error){status.textContent='Unable to save this request. Please try again later.';}}));})();</script>`;
  return `${capture}${behavior}${renderInteractionScript()}`;
}

function validatePage(spec) {
  if (!spec?.verdict || !Array.isArray(spec.cons) || spec.cons.length < 2 || spec.cons.length > 3) throw new Error("money_page_contract_invalid");
  if (!Array.isArray(spec.rows) || spec.rows.length < 4 || spec.rows.length > 64) throw new Error("comparison_row_count_invalid");
  if (!Array.isArray(spec.outcome_ctas) || spec.outcome_ctas.length !== 4 || spec.outcome_ctas.some((item, index) => item.position !== POSITIONS[index])) throw new Error("outcome_cta_contract_invalid");
  for (const row of spec.rows) validateProviderCard(row);
  renderBestForBox(spec);
}

export function renderMoneyPage(spec, identity) {
  validatePage(spec);
  // The ledger may predate matrix evidence: include the cards' existing dates
  // before consolidation, using the same min/max freshness derivation.
  const priceRows = spec.rows.flatMap(row => spec.pricing_matrix?.providers?.[matrixKey(row)]?.medications || []);
  const priceWitnesses = priceRows.flatMap(row => [...(row.evidence || []), ...(row.identity_evidence || []), ...Object.values(row.facts || {}).flatMap(fact => fact.evidence || [])]);
  const dates = collectEvidenceDates({ rowChecks: spec.rows.flatMap(row => [row.price_checked_on, row.promo?.verified_as_of, row.social_proof?.verified_as_of, row.therapeutic_taxonomy?.verified_as_of, ...(row.source_links || []).map(source => source.verified_as_of)]), priceChecks: priceRows.map(row => row.captured_on), priceCaptures: priceWitnesses.map(witness => String(witness.captured_at_utc).slice(0, 10)) });
  spec = { ...spec, ...deriveMoneyPageFreshness({ ...spec, sources: [...(spec.sources || []), ...[...dates].map(verified_as_of => ({ verified_as_of }))] }) };
  const focus = titleFocusRows(spec);
  // The top pick is whatever the ranking says, never a pinned program_id. A
  // pinned verdict is a manual rank array with one entry.
  const topProgram = focus.length >= 2 ? rankRows(focus)[0] : rankRows(spec.rows, spec)[0];
  const url = `https://glpclinicscout.com${spec.path}`;
  const evidenceReview = {
    status: spec.sources?.length ? "PASS" : "HELD",
    source_urls: (spec.sources || []).map((item) => item.url),
  };
  const schema = buildSchemaGraph({
    url,
    title: spec.title,
    description: spec.description,
    datePublished: spec.date_published,
    dateModified: spec.date_modified,
    author: identity.author,
    evidenceReview,
    faqs: spec.faq,
    breadcrumbs: [{ name: "Home", path: "/" }, { name: "Best providers", path: spec.path }],
    // ItemList position must be the position the reader sees, which is merit order.
    rankedItems: rankRows(spec.rows, spec).map((row, index) => ({ position: index + 1, name: providerName(row), path: row.review_path })),
  });
  const intro = (spec.intro || [])
    .map((paragraph) => (paragraph === "{{RANK_LEAD_PARAGRAPH}}" ? rankLeadParagraph(spec) : paragraph))
    .map((paragraph) => `<p>${esc(paragraph)}</p>`).join("");
  const faq = spec.faq.map((item) => `<details class="faq-item"><summary>${esc(item.q)}</summary><div>${esc(item.a)}</div></details>`).join("");
  const sources = (spec.sources || []).map((item, index) => {
    const expectedId = `source-${index + 1}`;
    if (item.source_id !== expectedId) throw new Error("numbered_source_contract_invalid");
    return `<li id="${esc(item.source_id)}"><span>${index + 1}</span>${renderCitationAnchor({ url: item.url, label: item.publisher, reason: CITATION_REASONS.COMPARISON_SOURCE_LEDGER })}<small>Checked ${esc(item.verified_as_of)}</small></li>`;
  }).join("");
  const pageCss = `<style>
    :root{--ink:#11213a;--paper:#fbfaf6;--card:#fff;--line:#d6dee8;--green:#0c6b54;--blue:#174ea6;--amber:#fff1c8;--gold:#d99a22;--muted:#5b6676}
    *{box-sizing:border-box}html,body{overflow-x:clip}.money-header,main{max-width:1120px;margin:auto;padding:24px}.money-header{padding-top:56px}.money-header-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;margin-bottom:6px}.money-header-meta .affiliate-note{margin:0;font-size:.84rem;line-height:1.45;color:var(--muted)}.money-header h1{max-width:17ch}.dek{max-width:68ch;font-size:1.15rem;color:var(--muted)}
    .disclosure,.evidence,.provenance,.verdict,.trust-block,.provider-card,.intent-card,.winner{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:clamp(20px,3vw,30px);margin:22px 0}.verdict{border-left:7px solid var(--green)}
    .jump-nav{position:sticky;top:76px;z-index:60;display:block;width:100%;max-width:100vw;min-width:0;overflow:hidden;border-block:1px solid var(--line);background:rgba(251,250,246,.97);backdrop-filter:blur(12px)}.jump-nav-scroll{display:flex;width:100%;max-width:100%;min-width:0;align-items:center;gap:8px;overflow-x:auto;padding:10px max(16px,calc((100% - 1120px)/2));white-space:nowrap}.jump-nav span{font-weight:900}.jump-nav a{display:inline-flex;min-height:44px;align-items:center;padding:6px 10px;border-radius:999px;text-decoration:none;font-weight:750}.jump-nav a:hover{background:#e8f0eb}
    .anchor-section{scroll-margin-top:148px}.section-heading{display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr);column-gap:32px;align-items:end}.section-heading .eyebrow{grid-column:1}.section-heading h2{grid-column:1;margin:.2rem 0}.section-heading>p:last-child{grid-column:2;grid-row:1/3;margin:0;color:var(--muted)}
    .best-for-section{margin:64px 0}.best-for-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.intent-card{display:flex;flex-direction:column;margin:0}.intent-card h3{margin:.2rem 0}.intent-card .dual-cta{margin-top:auto}
    .verdict-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(250px,.7fr);gap:26px;align-items:start}.hero-ctas{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:18px}
    .score-lockup{display:inline-flex;align-items:center;gap:12px;flex-wrap:wrap}.score-ten{font-size:1.55rem;line-height:1;color:var(--ink)}.score-ten span{font-size:.72em;color:var(--muted)}.stars{position:relative;display:inline-block;color:#d3d8de;font-size:1.15rem;letter-spacing:.08em;line-height:1}.stars-fill{position:absolute;inset:0 auto 0 0;overflow:hidden;color:var(--gold);white-space:nowrap}.score-pending{font-weight:800;color:var(--muted)}
    .social-proof{display:grid;gap:3px;padding:14px;border:1px solid var(--line);border-radius:14px;background:#f8faf8}.social-proof.compact{min-width:190px;padding:10px;font-size:.82rem}.proof-label{font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.social-proof small{color:var(--muted)}
    .provider-logo{display:grid;place-items:center;width:150px;max-width:100%;height:58px;padding:8px;border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden}.provider-logo--light{background:#fff}.provider-logo--dark{background:#12243a;border-color:#2c4460}.provider-logo img{display:block;width:100%;height:100%;object-fit:contain;transform:scale(var(--logo-content-scale,1))}.provider-logo--table{width:112px;height:48px}.provider-logo--verdict{width:180px;height:68px;margin-bottom:16px}.provider-logo--intent,.provider-logo--decision{margin-bottom:12px}.provider-logo--card{flex:0 0 auto}${WORDMARK_CSS}.inline-citation{margin-left:.16em;font-size:.72em;vertical-align:super}.inline-citation a{display:inline-grid;min-width:1.3em;height:1.3em;place-items:center;border-radius:50%;background:#e8eef8;color:var(--blue);font-weight:900;text-decoration:none}.inline-citation a:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
    .trust-block{display:grid;grid-template-columns:1.2fr .8fr;gap:28px;background:linear-gradient(135deg,#eef4ef,#fff)}.trust-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0}.trust-metrics div{padding:14px;border:1px solid var(--line);border-radius:14px;background:#fff}.trust-metrics dt{font-size:.72rem;font-weight:900;text-transform:uppercase;color:var(--muted)}.trust-metrics dd{margin:2px 0 0;font-size:1.25rem;font-weight:900}.lead-disclosure,.text-link{grid-column:1/-1}.byline{font-size:.9rem;color:var(--muted)}
    .table-wrap{width:100%;max-width:100%;min-width:0;contain:inline-size paint;overflow-x:auto;margin:12px 0 34px}.table-wrap table{min-width:1540px}.partner-badge{display:block;font-size:.72rem;color:var(--muted)}.dual-cta,.triple-cta{display:grid;gap:8px;min-width:210px}.triple-cta{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:22px}.promo-field{display:grid;gap:4px;margin-top:16px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#f8faf8}.promo-field.compact{min-width:170px;margin:0;font-size:.82rem}.promo-field span,.promo-field small{color:var(--muted)}.promo-field strong{font-size:.92rem}
    .cta{display:inline-flex;min-height:46px;align-items:center;justify-content:center;padding:10px 14px;border:1px solid var(--green);border-radius:12px;background:var(--green);color:#fff;font-weight:800;text-align:center;text-decoration:none}.cta.primary,.cta.affiliate{background:var(--green);color:#fff}.cta.lead{border-color:var(--blue);background:var(--blue)}.cta.internal{border:1px solid var(--line);background:#fff;color:var(--ink)}
    .provider-card{margin:22px 0}.provider-card-head{display:flex;justify-content:space-between;gap:24px;align-items:start}.provider-card-head h3{margin:.2rem 0;font-size:clamp(1.8rem,3vw,2.8rem)}.subscore-block{margin-top:22px}.subscore-block ul{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:0;list-style:none}.subscore-block li{display:grid;gap:6px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#f8faf8;font-size:.82rem}.subscore-block li span{min-height:2.5em}.subscore-block meter{width:100%;accent-color:var(--green)}.pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pros-cons section{padding:18px;border:1px solid var(--line);border-radius:16px}.pros-cons section:first-child{background:#eff8f3}.pros-cons section:last-child{background:#fff8ed}.pros-cons h4{margin-top:0}.bottom-line{margin-top:16px;padding:16px;border-left:4px solid var(--gold);background:#fbf8f2}.bottom-line p:last-child{margin-bottom:0}
    .winner-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.winner{margin:0;border-top:5px solid var(--blue)}.decision-matrix-row{display:flex;flex-direction:column}.decision-matrix-row .cta{margin-top:auto}.source-list{display:grid;gap:10px;padding:0;list-style:none}.source-list li{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--line)}.source-list li>span{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:var(--ink);color:#fff;font-weight:900}.source-list small{color:var(--muted)}
    .sticky{position:fixed;display:none;left:0;right:0;bottom:0;padding:10px;background:#fff;border-top:1px solid var(--line);z-index:90;grid-template-columns:1fr 1fr;gap:8px}.sticky .cta{font-size:.84rem;line-height:1.2}
    .exit-capture-trigger{position:fixed;right:16px;bottom:16px;z-index:85;min-height:46px;padding:10px 16px;border:0;border-radius:999px;background:var(--ink);color:#fff;font-weight:900;box-shadow:0 8px 30px rgba(17,33,58,.24)}.exit-capture[hidden]{display:none}.exit-capture{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:18px;background:rgba(7,17,31,.72)}.exit-capture-panel{position:relative;width:min(560px,100%);max-height:92vh;overflow:auto;padding:clamp(24px,5vw,40px);border-radius:22px;background:#fff;box-shadow:0 28px 80px rgba(0,0,0,.35)}.exit-capture-close{position:absolute;right:14px;top:12px;width:44px;height:44px;border:0;border-radius:50%;background:#eef2f5;font-size:1.8rem}.exit-capture form,.exit-capture label{display:grid;gap:8px}.exit-capture form{gap:14px}.exit-capture input[type=email]{min-height:48px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit}.capture-consent{grid-template-columns:22px 1fr!important;align-items:start;font-size:.88rem}.capture-consent input{margin-top:3px}.capture-honeypot{position:absolute!important;left:-10000px!important}.capture-status{margin:0;color:var(--muted);font-size:.85rem}.capture-open{overflow:hidden}
    @media(max-width:900px){.best-for-grid,.winner-grid{grid-template-columns:1fr}.section-heading,.trust-block,.verdict-grid{grid-template-columns:1fr}.section-heading>*{grid-column:1!important;grid-row:auto!important}.subscore-block ul{grid-template-columns:repeat(2,minmax(0,1fr))}.triple-cta{grid-template-columns:1fr}.jump-nav{top:68px}}
    @media(max-width:768px){body{padding-bottom:132px}.sticky.is-active{display:grid}.pros-cons{grid-template-columns:1fr}.provider-card-head{display:grid}.hero-ctas{grid-template-columns:1fr}.source-list li{grid-template-columns:32px 1fr}.source-list small{grid-column:2}.jump-nav{padding-inline:12px}.money-header,main{padding-inline:16px}.exit-capture-trigger{right:12px;bottom:142px;max-width:calc(100vw - 24px)}.provider-logo--card{width:180px}}
  </style>`;
  return `<!doctype html><html lang="en" data-release="live" data-link-dark="false"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet,max-image-preview:large"><title>${esc(spec.title)}</title><meta name="description" content="${esc(spec.description)}"><link rel="canonical" href="${esc(url)}">${pageCss}</head><body data-page-slug="${esc(spec.page_slug)}"><header class="money-header"><div class="money-header-meta"><span class="stage">Independent comparison · sources dated</span>${renderAtfDisclosure()}</div><h1>${esc(spec.h1)}</h1><p class="dek">${esc(spec.description)}</p></header><main>${renderVerdict(spec, topProgram)}${renderJumpNav()}<section class="money-intro">${intro}</section>${renderTrustBlock(spec, identity)}${renderBestForBox(spec)}${renderCompareCards(spec)}<div class="compare-band"><section id="compare" class="anchor-section" aria-labelledby="compare-title"><div class="section-heading"><p class="eyebrow">At-a-glance comparison</p><h2 id="compare-title">Side-by-side pricing and evidence</h2><p>Filter by provider name, sort by score or published starting price, and page through every provider. Each score stays tied to the five criteria below.</p></div>${renderComparisonTable(spec)}</section></div><aside class="panel evidence-line inline-capture" aria-label="Free provider terms checklist"><div class="inline-capture-grid"><div><p class="gcs-kicker">Free checklist</p><h3>Get the 7-point provider terms checklist</h3><p>The exact checks behind our scores — cost, commitment, eligibility, shipping, support, cancellation, and evidence dates. Emailed to you right away.</p></div><form action="/api/content-upgrade" method="post" data-content-upgrade-form-inline><input type="hidden" name="source_page" value=""><input type="hidden" name="lead_magnet_key" value=""><input type="hidden" name="consent_version" value="glp-content-upgrade-v1-20260724"><div class="inline-capture-row"><label class="visually-hidden" for="inline-capture-email">Email</label><input id="inline-capture-email" type="email" name="email" placeholder="you@email.com" autocomplete="email" required maxlength="254"><button type="submit" class="gcs-button">Send me the checklist</button></div><div class="capture-consents"><label class="capture-consent"><input type="checkbox" name="privacy_consent" value="true" required><span>I agree to the <a href="/privacy/">privacy policy</a>.</span></label><label class="capture-consent"><input type="checkbox" name="marketing_consent" value="true" required><span>Email me the checklist plus occasional provider-comparison research. Unsubscribe anytime.</span></label></div><label class="capture-honeypot" aria-hidden="true">Leave blank<input type="text" name="company" tabindex="-1" autocomplete="off"></label><p class="capture-status" role="status" aria-live="polite"></p></form></div></aside><div class="provider-reviews-band"><section id="provider-reviews" class="anchor-section" aria-labelledby="provider-reviews-title"><div class="section-heading"><p class="eyebrow">Source-backed deep cards</p><h2 id="provider-reviews-title">Provider-by-provider breakdown</h2><p>Pros, limitations, subscores, and bottom lines come from the same dated evidence that drives the table—not a second hidden ranking. Filter by provider name or page through the full set.</p></div>${renderProviderCards(spec)}</section></div><section aria-labelledby="decision-title"><div class="section-heading"><p class="eyebrow">Section winners</p><h2 id="decision-title">If you care most about one factor</h2><p>These are evidence-category leaders, not medical recommendations.</p></div><div class="winner-grid">${winnerSections(spec)}</div></section><section class="evidence"><h2>What this page does well</h2><ul>${listItems(spec.pros || [])}</ul><h2>What still needs verification</h2><ul>${listItems(spec.cons)}</ul></section><section id="faq" class="anchor-section"><h2>Frequently asked questions</h2><div class="faq-list">${faq}</div></section><section id="sources" class="provenance anchor-section"><p class="eyebrow">Source ledger</p><h2>Dated evidence behind this comparison</h2><p>Reviewed against cited first-party and primary sources · ${sourceWindow(spec)} · <a href="/editorial-guidelines/">How evidence review works</a></p><ol class="source-list">${sources}</ol></section><div class="sticky" aria-label="Current sorted provider actions">${affiliateCta(spec, topProgram, "conclusion", "start", "a", "data-sticky-affiliate")}${leadCta(topProgram, "sticky", "data-sticky-lead")}</div></main>${renderPageScript()}<script type="application/ld+json">${JSON.stringify(schema.jsonLd).replaceAll("<", "\\u003c")}</script></body></html>`;
}

export const moneyPageContract = Object.freeze({
  templateRevision: "money-page-p1-v2-wave0",
  verdictBox: true,
  comparisonRows: [4, 8],
  comparisonColumns: [7, 8],
  numericScoring: SCORE_WEIGHTS,
  scoreDisplay: "/10_plus_five_star_glyph",
  scoreRounding: "half_up_to_nearest_whole_number_for_nonnegative_scores",
  sortable: ["score", "price"],
  decisionMatrix: true,
  bestForIntentBox: true,
  providerCards: true,
  providerCardTripleCta: true,
  providerCardFields: ["logo", "best_for", "pros", "cons", "bottom_line", "criteria_scores", "social_proof", "promo"],
  quantifiedTrustBlock: true,
  clinicianRequired: false,
  clinicianReviewerRendered: false,
  stickyJumpNav: true,
  sourceLabeledSocialProof: true,
  aggregateRatingSchema: false,
  itemListSchema: true,
  providerReviewPages: true,
  inlineNumberedCitations: true,
  officialSiteCtaQualifier: false,
  ctaCopySystem: { winner: "start_with_brand", other: "visit_brand", priceVolatile: "check_current_price_at_brand", lead: "find_my_match" },
  exitIntentCapture: false,
  exitIntentTrigger: "enabled",
  exitIntentScrollInterception: false,
  dualCtaRows: true,
  outcomeCtaPositions: POSITIONS,
  inlineDisclosure: AFFILIATE_MICRO_DISCLOSURE,
  leadDisclosure: LEAD_DISCLOSURE,
  stickyMobileCta: true,
});