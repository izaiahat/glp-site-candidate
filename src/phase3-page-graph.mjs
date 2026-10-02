import { renderCompoundedCategoryBody, getCompoundedCategoryMetadata } from "./compounded-category.mjs";
import { isTypedPrice, renderTypedPrice } from "./typed-price-labels.mjs";
import { PROVIDER_REVEAL_BATCH_SIZE } from './surface-tallies.mjs';
import { finalsCss, renderPricePair, renderDirectoryFinal, renderProgramCardCount } from "./directory-detail-finals.mjs";
import { selectedFamilyStyles } from "./selected-family-styles.mjs";
import { deriveMoneyPageFreshness } from "./freshness.mjs";
import { publicProviderName } from "./public-provider-names.mjs";
import { pageSeoCopy } from "./page-seo-copy.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CITATION_REASONS, renderCitationAnchor } from "./citation-attribution.mjs";
import { renderCouponChip } from "./coupon-offers.mjs";
import { loadAffiliateLinkMap } from "./affiliate-link-map.mjs";
import { loadGoPromotionAuthority } from './go-runtime-selection.mjs';
import { selectedGoOutbound } from './go-render-selection.mjs';
import { affiliateOutboundMode } from "./affiliate-outbound-mode.mjs";
import { resolveCardOutbound } from "./card-outbound.mjs";
import { selectUnpublishedProviders } from "./unpublished-provider-cards.mjs";
import { subidAttributes } from "./affiliate-subid.mjs";
import { renderProductComparisonPicture } from "./pass2-product-visuals.mjs";
import { deriveIdentityGroups } from "./provider-identity.mjs";
import { projectProviderDisplayLedger, projectProviderDisplayFacts } from "./provider-display-evidence.mjs";
import { comparisonTerm, comparisonCardBody, comparisonControls, comparisonRuntime, comparisonStyles } from "./comparison-presets.mjs";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const usd = (value) => `$${Number(value).toLocaleString("en-US")}`;
const routeFile = (route) => `${String(route).replace(/^\//, "").replace(/\/$/, "")}/index.html`;
const canonical = (route) => `https://glpclinicscout.com${route}`;
const STATES = Object.freeze([
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
]);
const DOSES = Object.freeze(["2.5", "5", "7.5", "10", "12.5", "15"]);
const SEMAGLUTIDE_DOSES = Object.freeze(["0.25", "0.5", "1", "1.7", "2.4"]);
const PRODUCT_MANUFACTURER_URLS = Object.freeze({
  "wegovy-pill": "https://www.wegovy.com/obesity/is-wegovy-right-for-me/wegovy-pill-results.html",
  wegovy: "https://www.wegovy.com/",
  ozempic: "https://www.ozempic.com/",
  mounjaro: "https://mounjaro.lilly.com/",
  zepbound: "https://zepbound.lilly.com/",
});
const DOSE_CAPTURE_URL = new URL("../data/predecessors/provider-dose-pricing-20260824.json", import.meta.url);
const PROVIDER_LOGO_MANIFEST_URL = new URL("../assets/provider-logos/manifest.json", import.meta.url);
const PROVIDER_LOGO_ATLAS_URL = new URL("../assets/provider-logos/pass2-lp-atlas.json", import.meta.url);
const PROGRAM_LEDGER_URL = new URL("../data/program-content-ledger.json", import.meta.url);
const PROVIDER_FACTS_URL = new URL("../data/provider-facts-backfill-20260830.json", import.meta.url);
const COMPARE_AFFILIATE_MAP = loadAffiliateLinkMap("compare");
const GO_AUTHORITY = loadGoPromotionAuthority();
const UNPUBLISHED_OFFER_EVIDENCE = JSON.parse(readFileSync(new URL("../data/unpublished-offer-evidence.json", import.meta.url), "utf8"));
const LEGACY_MEDICATION_REDIRECTS = Object.freeze([

  // Packs-cost spec fix 12 (route hygiene): bare /cost/ was a dead URL shape we
  // mint ourselves; the durable cost surface is the provider comparison.
  ["/cost/", "/providers/"],
]);

function readJson(url, errorCode) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    throw new Error(`${errorCode}:${error.code || error.message}`);
  }
}

export function loadPass2DoseCapture() {
  const capture = readJson(DOSE_CAPTURE_URL, "phase3_dose_capture_missing");
  if (capture?.schema !== "glp-provider-pricing-matrix-v1" || capture.version !== 2 || !capture.providers || !capture.dose_pricing_model_values) {
    throw new Error("phase3_dose_capture_invalid");
  }
  return capture;
}

function loadProviderLogoManifest() {
  const manifest = readJson(PROVIDER_LOGO_MANIFEST_URL, "phase3_provider_logo_manifest_missing");
  if (manifest?.schema !== "glp-provider-logo-manifest-v1" || !Array.isArray(manifest.logos)) throw new Error("phase3_provider_logo_manifest_invalid");
  const atlas = readJson(PROVIDER_LOGO_ATLAS_URL, "phase3_provider_logo_atlas_missing");
  const sourceSha256 = createHash("sha256").update(readFileSync(PROVIDER_LOGO_MANIFEST_URL)).digest("hex");
  if (atlas?.schema !== "glp-provider-logo-lp-atlas-v1" || atlas.status !== "PASS" || atlas.source_manifest_sha256 !== sourceSha256 || !Array.isArray(atlas.entries) || atlas.entries.length !== manifest.logos.length) {
    throw new Error("phase3_provider_logo_atlas_invalid");
  }
  const atlasIds = new Set(atlas.entries.map((entry) => entry.program_id));
  if (manifest.logos.some((entry) => !atlasIds.has(entry.program_id))) throw new Error("phase3_provider_logo_atlas_incomplete");
  return { ...manifest, atlas };
}

function loadProgramLedger() {
  const ledger = readJson(PROGRAM_LEDGER_URL, "phase3_program_ledger_missing");
  if (!Array.isArray(ledger?.programs)) throw new Error("phase3_program_ledger_invalid");
  return new Map(ledger.programs.map((entry) => [entry.program_id, projectProviderDisplayLedger(entry)]));
}

function loadProviderFacts() {
  const input = readJson(PROVIDER_FACTS_URL, "phase3_provider_facts_missing");
  // 2026-09-02: was `!== 38`, the roster size on the day this file was frozen.
  // Onboarding GROWS the provider set, so an exact pin made every new provider
  // unrenderable on the compare surface and the deploy sensor reported each one
  // as "live but absent from compare". Floored, not removed: a document that
  // SHRANK below the frozen roster still fails closed.
  if (input?.schema !== "glp.provider-facts-backfill.v2" || !Array.isArray(input.programs) || input.programs.length < 38) {
    throw new Error("phase3_provider_facts_invalid");
  }
  return new Map(input.programs.map((entry) => [entry.program_id, {
    ...projectProviderDisplayFacts(entry), display_name: publicProviderName(entry.display_name),
  }]));
}

function providerStateCoverage(ledgerEntry) {
  const statement = ledgerEntry?.research_states_served;
  const text = String(statement?.value || "");
  const excluded = new Set();
  for (const [code, name] of STATES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:no plans[^.]*in|not (?:currently )?available in|except|excluding)[^.]*\\b${escaped}\\b`, "i").test(text)) excluded.add(code);
  }
  const list = text.match(/(?:include|includes|currently|states:?)\s*:?\s*((?:[A-Z]{2}(?:,|\s|and|$)){3,})/);
  const included = new Set(list ? (list[1].match(/\b[A-Z]{2}\b/g) || []).filter((code) => STATES.some(([candidate]) => candidate === code)) : []);
  const allStates = /(?:all|every)\s+(?:50\s+)?(?:u\.?s\.?\s+)?states/i.test(text) && !/var(?:y|ies)|select states|most states/i.test(text);
  const mode = included.size ? "included" : allStates ? "all" : excluded.size ? "excluded" : "unknown";
  return {
    mode,
    included: [...included],
    excluded: [...excluded],
    checked: statement?.verified_as_of || "",
    source: statement?.source_url || "",
    summary: text || "State availability was not published in the bound program research.",
  };
}

function medicationToken(medicationId) {
  const value = String(medicationId || "").toLowerCase();
  if (value.includes("wegovy-pill")) return "WEGOVY_PILL";
  if (value.includes("wegovy")) return "WEGOVY";
  if (value.includes("ozempic")) return "OZEMPIC";
  if (value.includes("mounjaro")) return "MOUNJARO";
  if (value.includes("zepbound")) return "ZEPBOUND";
  if (value.includes("tirzepatide")) return "TIRZEPATIDE";
  if (value.includes("semaglutide")) return "SEMAGLUTIDE";
  return value.toUpperCase();
}

function medicationForm(medicationId) {
  const id = String(medicationId || "");
  return id.startsWith("brand-") ? "BRAND_NAME" : "COMPOUNDED";
}

const PROGRAM_LEDGER_BY_ID = loadProgramLedger();
const PROVIDER_FACTS_BY_ID = loadProviderFacts();

function sourceReportedFact(row) {
  return row?.status === "SOURCE_REPORTED" && Boolean(String(row.value || "").trim()) && Boolean(row.source_url) && Boolean(row.capture_date);
}

function providerCardContract(programId) {
  const research = PROVIDER_FACTS_BY_ID.get(programId);
  const ledger = PROGRAM_LEDGER_BY_ID.get(programId);
  if (!research?.display_name || !ledger?.meds_offered || !ledger?.source_url) return null;
  const cost = research.facts?.total_monthly_cost;
  const cancellation = research.facts?.cancellation;
  if (!sourceReportedFact(cost) || !sourceReportedFact(cancellation)) return null;
  return { research, ledger, cost, cancellation };
}

function providerCardEligible(programId) {
  return Boolean(providerCardContract(programId));
}
// This recovered guide remains governed by its independent exact-byte pin. Keep
// it out of the rebuilt Insights graph rather than pretending an unmodified page
// satisfies the Phase 3 article contract.
export const PHASE3_INSIGHTS_EXCLUSIONS = new Set([
  "/guides/mounjaro-coupon/",
  "/guides/healthrx-vs-agelessrx/",
  "/guides/wellorithm-vs-enhance-md/",
  "/guides/cheapest-glp1/",
  "/guides/compare-online-glp-1-provider-fees/",
  "/guides/glp-1-program-total-cost-comparison/",
]);

function pageDocument({ route, title, description, body, robots = "index,follow,max-image-preview:large", schema = null, mainClass = "p3-page", listingArchetype = null }) {
  body = body.replaceAll('Source-checked provider', 'Provider information')
    .replaceAll('Compare only the plan numbers and self-pay evidence you hold.', 'Compare your insurance and self-pay costs.')
    .replaceAll('Each card opens a live listing or product page and preserves source-governed filtering.', 'Choose a medication to compare providers and plan options.');
  // Include lazy-card payloads as well as immediate cards in the visible range.
  const cardDates = [...body.replaceAll('\\"', '"').matchAll(/data-source-checked="(\d{4}-\d{2}-\d{2})"/g)].map(match => match[1]);
  if (cardDates.length) {
    const freshness = deriveMoneyPageFreshness({ sources: cardDates.map(verified_as_of => ({ verified_as_of })) });
    body = body.replace('</h1>', `</h1><p>Prices checked <span data-prices-checked-date>${esc(freshness.source_checked_from)} – ${esc(freshness.source_checked_through)}</span></p>`);
  }
  const jsonLd = schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : "";
  const familyStyles = listingArchetype === "D" ? "" : selectedFamilyStyles(route);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${esc(robots)}"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${canonical(route)}">${jsonLd}${familyStyles}</head><body><main class="${esc(mainClass)}" data-phase3-route="${esc(route)}"${listingArchetype ? ` data-listing-archetype="${esc(listingArchetype)}"` : ""}>${body}</main></body></html>`;
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items.map((item, index) => item.href ? `<a href="${esc(item.href)}">${esc(item.label)}</a>${index < items.length - 1 ? '<span aria-hidden="true">/</span>' : ""}` : `<span aria-current="page">${esc(item.label)}</span>`).join("")}</nav>`;
}

// Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4): the p3 revenue
// templates shipped publisher-Organization-only JSON-LD. Every renderer below
// now passes an honest page-level graph built from the SAME data the page
// visibly renders: BreadcrumbList mirrors the breadcrumbs() trail, Product
// offers exist only where a live source-dated price row exists, FAQPage
// mirrors visible accordion copy, ItemList lists exactly the providers on the
// page. NO aggregateRating anywhere, ever; nothing is fabricated. The sitewide
// Organization node is appended separately by the AEO codemod.
function breadcrumbSchema(route, items) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${canonical(route)}#breadcrumbs`,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: canonical(item.href || route),
    })),
  };
}

function pageSchemaGraph(...nodes) {
  return { "@context": "https://schema.org", "@graph": nodes.filter(Boolean) };
}

function providerItemListSchema(route, name, providers, registry) {
  return {
    "@type": "ItemList",
    "@id": `${canonical(route)}#providers`,
    name,
    numberOfItems: providers.length,
    itemListElement: providers.map((entry, index) => {
      const record = registryRecord(entry, registry);
      const destination = record && (canonicalReviewPath(record, registry) || `/providers/${record.program_id}/`);
      const url = destination ? canonical(destination) : null;
      return {
        "@type": "ListItem",
        position: index + 1,
        ...(url ? { item: { "@type": "Thing", name: entry.provider, url } } : { name: entry.provider }),
      };
    }),
  };
}

function sourceDisclosure() {
  return '<aside class="p3-source-disclosure affiliate-note table-disclosure"><strong>How these links work.</strong> Price-source links go directly to the provider page Clinic Scout checked, not through an affiliate redirect. Separately marked sponsored links may earn Clinic Scout a commission. Check the ordering method stated for each comparison; payment is not evidence of quality, safety or medical suitability.</aside>';
}

function pricingProviders(pricingMatrix, medicationIds) {
  const wanted = new Set(medicationIds);
  return Object.values(pricingMatrix.providers || {}).map((entry) => {
    if (!providerCardEligible(entry.program_id)) return null;
    const medications = (entry.medications || []).filter((row) => wanted.has(row.medication_id) && Number.isFinite(row.ongoing_usd));
    return medications.length ? { ...entry, medications } : null;
  }).filter(Boolean).sort((left, right) => Math.min(...left.medications.map((row) => row.ongoing_usd)) - Math.min(...right.medications.map((row) => row.ongoing_usd)) || left.provider.localeCompare(right.provider));
}

function registryRecord(entry, registry) {
  const id = String(entry.program_id || "");
  return (registry.programs || []).find((row) => row.program_id === id)
    || (registry.programs || []).find((row) => String(row.review_path || "").includes(`/${id}/`))
    || null;
}

function canonicalReviewPath(record, registry) {
  if (!record?.review_path) return null;
  const identity = record.profiles?.["glp-clinic-scout"]?.canonical_identity;
  if (identity?.role !== "alias") return record.review_path;
  const canonicalRecord = (registry.programs || []).find((row) => row.program_id === identity.canonical_program_id);
  if (!canonicalRecord?.review_path) throw new Error(`phase3_alias_canonical_review_missing:${record.program_id}`);
  return canonicalRecord.review_path;
}

export function renderPhase3TypedOffers({ pricingMatrix, registry, medicationIds = null, programId = null, bulk = false, renderedRowIds = new Set() }) {
  const wanted = medicationIds ? new Set(medicationIds) : null;
  const entries = Object.values(pricingMatrix.providers || {}).filter(entry => {
    if (programId && entry.program_id !== programId) return false;
    if (!providerCardEligible(entry.program_id) || /fella/i.test(entry.program_id)) return false;
    const record = registryRecord(entry, registry);
    if (!record) return false;
    const mode = affiliateOutboundMode(record, COMPARE_AFFILIATE_MAP[entry.program_id], GO_AUTHORITY.programs?.[record.program_id]);
    return mode === 'go' || mode === 'transparent_direct';
  }).map(entry => ({...entry, medications: (entry.medications || []).filter(row => isTypedPrice(row) && !renderedRowIds.has(esc(row.row_id)) && (!wanted || wanted.has(row.medication_id)) && (!bulk || ['prepaid_bundle', 'monthly_equivalent_of_billing_period'].includes(row.price_kind)))})).filter(entry => entry.medications.length);
  if (!entries.length) return '';
  return `<section data-phase3-typed-offers><h2>Reported plan information</h2><p>These are separately labeled offers, not comparable monthly cash charges. They do not enter price sorting, dose filters, savings or calculator autofill.${bulk ? ' Billing and supply periods are quoted below; inclusion here does not establish the duration selected in a bulk filter.' : ''}</p>${entries.map(entry => `<article data-typed-provider="${esc(entry.program_id)}"><h3>${esc(entry.provider)}</h3>${entry.medications.map(row => renderTypedPrice(row)).join('')}</article>`).join('')}</section>`;
}

function sourcePrice(row, prefix, { showDate = false } = {}) {
  if (isTypedPrice(row)) return renderTypedPrice(row, { showDate });
  return `<div class="p3-source-price" data-medication="${esc(row.medication_id)}" data-source-checked="${esc(row.captured_on)}"><span class="p3-price-medication">${esc(row.display_label || row.label)}</span> <strong>${usd(row.ongoing_usd)}</strong><span>/${esc(row.cadence || "month")}</span><details><summary>Price source</summary><blockquote>${esc(row.quote)}</blockquote>${showDate ? `<time datetime="${esc(row.captured_on)}">${esc(row.captured_on)}</time> · ` : ''}${renderCitationAnchor({ url: row.source_url, label: "Open the provider page", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE, rel: "noopener noreferrer" })}</details></div>`;
}

function providerLogoMark(entry, logoManifest) {
  const logo = (logoManifest.logos || []).find((item) => item.program_id === entry.program_id);
  const atlasEntry = (logoManifest.atlas?.entries || []).find((item) => item.program_id === entry.program_id);
  return logo && atlasEntry
    ? `<span class="provider-logo provider-logo--${logo.logo_treatment === "dark-chip" ? "dark" : "light"} provider-logo--sprite" role="img" aria-label="${esc(`${entry.provider} logo`)}" style="--p3-logo-x:-${esc(atlasEntry.display_x)}px;--p3-logo-y:-${esc(atlasEntry.display_y)}px;--p3-logo-atlas-width:${esc(logoManifest.atlas.display_atlas_width)}px;--p3-logo-atlas-height:${esc(logoManifest.atlas.display_atlas_height)}px"></span>`
    : `<span class="provider-logo provider-logo--wordmark" role="img" aria-label="${esc(entry.provider)}"><span class="provider-wordmark" aria-hidden="true">${esc(entry.provider)}</span></span>`;
}

function providerIdentity(entry, logoManifest, headingLevel = 3) {
  const heading = `h${headingLevel}`;
  const mark = providerLogoMark(entry, logoManifest);
  return `<div class="p3-provider-identity p3-wrap-cluster" data-wrap-identity>${mark}<${heading} class="p3-wrap-title" data-wrap-text>${esc(entry.provider)}</${heading}></div>`;
}

function doseMedicationFor(entry, doseCapture, medicationIndex = 0) {
  const provider = doseCapture.providers?.[entry.program_id];
  if (!provider) throw new Error(`phase3_dose_provider_missing:${entry.program_id}`);
  const sourceMedication = entry.medications[medicationIndex];
  const medicationId = sourceMedication?.medication_id;
  const candidates = (provider.medications || []).filter((row) => row.medication_id === medicationId);
  if (candidates.length === 0) throw new Error(`phase3_dose_medication_missing:${entry.program_id}:${medicationId}`);
  if (candidates.length === 1) return candidates[0];
  const medication = candidates.find((row) =>
    row.ongoing_usd === sourceMedication.ongoing_usd &&
    row.month_1_usd === sourceMedication.month_1_usd &&
    row.quote === sourceMedication.quote
  );
  if (!medication) throw new Error(`phase3_dose_medication_ambiguous:${entry.program_id}:${medicationId}`);
  return medication;
}

export function renderDosePricing(entry, doseCapture, medicationIndex = 0, { open = false, ladderHeader = false } = {}) {
  // Option C: dose ladders are detail-only and render only when the governed
  // pricing row explicitly binds every displayed tier to a first-party source.
  // UNKNOWN_NO_SOURCE rows emit no copy, cells, or reserved space.
  const medication = entry.medications?.[medicationIndex];
  const dosePricing = medication?.dose_pricing;
  if (dosePricing?.status !== "SOURCE_REPORTED_PER_DOSE" || dosePricing.render_action !== "RENDER") return "";
  const tiers = dosePricing.tiers || [];
  if (!tiers.length || tiers.some((row) => !Number.isFinite(row.dose_mg) || !Number.isFinite(row.monthly_usd) || row.numeric_provenance !== "SOURCE-REPORTED")) {
    throw new Error(`phase3_source_reported_dose_tiers_invalid:${entry.program_id}:${medication?.medication_id || "unknown"}`);
  }
  const checked = dosePricing.capture_date;
  const sourceAnchor = renderCitationAnchor({ url: dosePricing.source_url, label: "dose-pricing source", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE });
  const evidence = `<p class="p3-dose-definition"><strong>Reported dose pricing.</strong> Every amount below is quoted by the provider; no tier is extrapolated.</p><small><span class="p3-provenance">Reported information</span> · checked <time datetime="${esc(checked)}">${esc(checked)}</time> · ${sourceAnchor}</small>`;
  const openAttr = open ? " open" : "";
  const head = ladderHeader ? '<li class="p3-dose-head"><span>mg/week</span><strong>$ / month</strong></li>' : "";
  const rows = tiers.map((row) => `<li data-dose-row="${esc(row.dose_mg)}" data-selected="false"><span>${esc(row.dose_mg)} mg/week</span><strong>${usd(row.monthly_usd)}/month</strong></li>`).join("");
  return `<details class="p3-dose-grid" data-dose-model="source-reported-per-dose"${openAttr}><summary>Published dose-price rows</summary>${evidence}<ul>${head}${rows}</ul></details>`;
}

// W9 G03: provenance tags are data values; the visitor-facing label is plain language.
// W9 r2: the tag is generic evidence metadata, not a verified source-owner classification, so the default
// label stays source-neutral. Provider-specific wording is used only where the surrounding copy already establishes it.
const provenanceLabel = (tag) => String(tag) === "SOURCE-REPORTED" ? "Reported information" : String(tag || "").replace(/[-_]+/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

// D2j: only explicit monthly cash enters this legacy numeric interface.
// S11 floors, bundles, equivalents and partial components remain display-only.
// Different forms/plans under one medication token are not silently min-priced.
export function directoryPriceMap(medications = []) {
  const prices = new Map();
  for (const row of medications) {
    const value = isTypedPrice(row)
      ? (row.price_kind === 'monthly_cash' ? row.facts?.amount_usd?.value : undefined)
      : row.ongoing_usd;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    const token = medicationToken(row.medication_id);
    if (!token || !/^[A-Z][A-Z0-9_-]*$/.test(token)) continue;
    if (!prices.has(token)) prices.set(token, new Set());
    prices.get(token).add(value);
  }
  return [...prices].filter(([, values]) => values.size === 1)
    .map(([token, values]) => `${token}:${[...values][0]}`).join('|');
}

import {priceStateText,renderPriceStateComparison} from './price-state.mjs';
function compactProviderCard(entry, registry, doseCapture, logoManifest, { coupon = null, mode = "provider", duration = null, promoted = null, goSurface = null, rankPosition = 0, initialHidden = false, stateUnverified = false } = {}) {
  const contract = providerCardContract(entry.program_id);
  if (!contract) throw new Error(`phase3_provider_card_ineligible:${entry.program_id}`);
  const record = registryRecord(entry, registry);
  const medications = entry.medications || [];
  const medIds = medications.map((row) => row.medication_id).join(" ");
  const ledgerDrugTokens = ["semaglutide", "tirzepatide", "ozempic", "mounjaro", "wegovy", "zepbound"].filter((token) => contract.ledger.meds_offered.toLowerCase().includes(token)).map((token) => token.toUpperCase());
  const drugTokens = [...new Set([...medications.map((row) => medicationToken(row.medication_id)), ...ledgerDrugTokens])];
  const formTokens = [...new Set(medications.map((row) => medicationForm(row.medication_id)))];
  if (!formTokens.length && /compounded/i.test(contract.ledger.meds_offered)) formTokens.push("COMPOUNDED");
  const priceMap = directoryPriceMap(medications);
  const coverage = providerStateCoverage(contract.ledger);
  const durationText = medications.map((row) => `${row.quote || ""} ${row.notes || ""}`).join(" ").toLowerCase();
  const durationTags = [1, 3, 6, 12].filter((months) => new RegExp(`(?:^|\\D)${months}(?:\\s*[- ]?month|\\s*mo(?:nth)?s?)(?:\\D|$)`, "i").test(durationText));
  const doseValues = [...new Set(medications.flatMap((medication) => medication.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE" ? (medication.dose_pricing.tiers || []).map((row) => String(row.dose_mg)) : []))];
  const sourceMeta = (row, { numeric = false } = {}) => `<small data-source-checked="${esc(row.capture_date)}">${numeric ? `<span class="p3-provenance">${esc(provenanceLabel(row.numeric_provenance || row.provenance_tag || "SOURCE-REPORTED"))}</span> · ` : ""}${renderCitationAnchor({ url: row.source_url, label: "Provider terms", reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "noopener noreferrer" })}</small>`;
  const hubFactSources = goSurface?.route === "/providers/";
  const factSourceMeta = (row, options = {}) => hubFactSources
    ? `<small data-source-checked="${esc(row.capture_date)}">${options.numeric ? `<span class="p3-provenance">${esc(provenanceLabel(row.numeric_provenance || row.provenance_tag || "SOURCE-REPORTED"))}</span> · ` : ""}<time datetime="${esc(row.capture_date)}">${esc(row.capture_date)}</time> · ${renderCitationAnchor({ url: row.source_url, label: "Provider terms", reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "noopener noreferrer" })}</small>`
    : sourceMeta(row, options);
  const factSources = (rows, options = {}) => {
    const markup = rows.map((row) => factSourceMeta(row, options)).join("");
    return hubFactSources && !options.visible ? `<details><summary>Sources and checked dates</summary>${markup}</details>` : markup;
  };
  const identitySource = { capture_date: contract.research.capture_date, source_url: contract.ledger.source_url };
  const medicationEvidence = contract.ledger.meds_offered_evidence;
  const medicationSourceMeta = medicationEvidence?.schema === "s10-field-evidence-v1"
    ? factSources(medicationEvidence.sources.map((source) => ({ capture_date: source.checked_date, source_url: source.source_url })))
    : factSources([identitySource]);
  const factRow = (label, value, source, options = {}) => `<div><dt>${esc(label)}</dt><dd><span>${esc(value)}</span>${factSources([source], { ...options, visible: hubFactSources && label === "Total monthly cost" })}</dd></div>`;
  // Current matrix evidence owns price copy as well as sorting. The legacy
  // research summary can describe a different plan or a superseded price.
  const costFact = medications.length
    ? `<div><dt>Total monthly cost</dt><dd><span class="p3-provenance">Reported information</span>${medications.map(row => sourcePrice(row, 'card', { showDate: mode !== 'compounded' })).join('')}</dd></div>`
    : factRow("Total monthly cost", priceStateText(entry) || contract.cost.value, contract.cost);
  const cardFacts = `<dl class="p3-card-ledger p3-card-contract" data-provider-card-contract="option-c"><div><dt>Medications offered</dt><dd><span>${esc(contract.ledger.meds_offered)}</span>${medicationSourceMeta}</dd></div>${costFact}${factRow("Cancellation", contract.cancellation.value, contract.cancellation)}</dl>`;
  const affiliate = COMPARE_AFFILIATE_MAP[entry.program_id];
  const goPageSlug = goSurface ? String(goSurface.route || "/providers/").replace(/^\/+|\/+$/g, "").replaceAll("/", "-") || "providers" : "provider-listing";
  const goPosition = goSurface?.position || "pricing";
  const affiliateAttrs = affiliate?.live ? subidAttributes({ programId: entry.program_id, network: affiliate.network, href: affiliate.affiliate_href, renderedHref: affiliate.affiliate_href, position: goPosition, rankPosition, pageSlug: goPageSlug, pageType: goSurface ? "funnel-v2-comparison" : "provider-listing", providerSlug: entry.program_id }) : "";
  const outbound = goSurface ? resolveCardOutbound({program:record,affiliate,promotionAuthority:goSurface.authority ?? GO_AUTHORITY,pageSlug:goPageSlug,position:goPosition,rankPosition}) : null;
  const cardHref = goSurface ? outbound.href : affiliate?.affiliate_href;
  const getStarted = stateUnverified ? '<p class="p3-unavailable-action">State availability not established. Check directly with the provider before considering enrollment.</p>' : affiliate?.live && cardHref
    ? `<a class="cs-btn cs-palette-action" href="${esc(cardHref)}" rel="sponsored noopener nofollow" data-analytics-event="affiliate_click" data-program="${esc(entry.program_id)}" data-link-position="${esc(goPosition)}" ${goSurface ? outbound.attributes : affiliateAttrs}>Get started</a>`
    : '<p class="p3-unavailable-action" data-affiliate-unavailable><strong>Enrollment link pending verification</strong><span>No destination appears until Clinic Scout verifies it.</span></p>';
  const detailPath = record ? `/providers/${record.program_id}/` : null;
  const detail = detailPath ? `<a class="cs-btn cs-btn--quiet" href="${esc(detailPath)}">Open provider details</a>` : "";
  // F2 (Pass 7 original note, 2026-09-01): every listing card links to its
  // canonical editorial review. Alias records resolve to the canonical review.
  const cardReviewPath = record ? canonicalReviewPath(record, registry) : null;
  const review = cardReviewPath ? `<a class="cs-btn cs-btn--quiet" href="${esc(cardReviewPath)}" data-card-review data-provider-review-link>Read our ${esc(entry.provider)} review</a>` : "";
  const finitePrices = medications.map((row) => row.ongoing_usd).filter(Number.isFinite);
  const ongoingPriceMap = medications.filter((row) => Number.isFinite(row.ongoing_usd) && row.ongoing_usd >= 0)
    .map((row) => `${medicationToken(row.medication_id)}:${row.ongoing_usd}`).join('|');
  const factPrice = Number.parseFloat(String(contract.cost.value).match(/\$\s*([\d,]+(?:\.\d+)?)/)?.[1]?.replaceAll(",", "") || "");
  const sortPrice = finitePrices.length ? Math.min(...finitePrices) : "";
  return `<article class="p3-provider-card cs-card" data-phase3-provider data-wrap-card data-program="${esc(entry.program_id)}" data-medications="${esc(medIds)}" data-drugs="${esc(drugTokens.join(" "))}" data-forms="${esc(formTokens.join(" "))}" data-price-map="${esc(priceMap)}" data-ongoing-price-map="${esc(ongoingPriceMap)}" data-state-mode="${esc(coverage.mode)}" data-state-includes="${esc(coverage.included.join(" "))}" data-state-excludes="${esc(coverage.excluded.join(" "))}" data-duration="${esc(durationTags.join(" ") || "unknown")}" data-dose="${esc(doseValues[0] || "unknown")}" data-dose-values="${esc(doseValues.join(" ") || "unknown")}" data-dose-model="${doseValues.length ? "source-reported-per-dose" : "none"}" data-price="${esc(sortPrice)}" data-mode="${esc(mode)}"${duration ? ` data-bulk-duration="${esc(duration)}"` : ""}${initialHidden ? " hidden" : ""}><div class="p3-card-aurora" aria-hidden="true"></div><header class="p3-card-header p3-wrap-cluster" data-wrap-header><p class="gcs-kicker">Source-checked provider</p>${providerIdentity({ ...entry, provider: contract.research.display_name }, logoManifest)}${sourceMeta(identitySource)}</header>${cardFacts}${renderCouponChip(coupon)}<div class="p3-card-actions p3-wrap-actions" data-wrap-actions>${getStarted}${review || detail}</div></article>`;
}

function unpublishedProviderCards(page, pricedProviders, registry, logoManifest, { mode, coupons = {}, goAuthority = GO_AUTHORITY }) {
  const entries = selectUnpublishedProviders({ registry, affiliateMap: COMPARE_AFFILIATE_MAP, goAuthority, pricedProviders, medicationIds: page.medication_ids || [page.medication_id], durationMonths: page.duration_months || null, offerEvidence: UNPUBLISHED_OFFER_EVIDENCE });
  const pageSlug = page.route.replace(/^\/+|\/+$/g, "").replaceAll("/", "-");
  const position = "provider-card-unverified";
  const cards = entries.map((entry, index) => {
    const rank = pricedProviders.length + index + 1;
    const outbound = resolveCardOutbound({program:entry.record,affiliate:entry.affiliate,promotionAuthority:goAuthority,pageSlug,position,rankPosition:rank});
    const href = outbound.href;
    const attrs = outbound.attributes;
    const reviewPath = canonicalReviewPath(entry.record, registry);
    const bindings = [...new Map(entry.offers.flatMap(o => o.evidence).map(e => [e.capture_sha256, e])).values()];
    const chip = bindings.map(e => `<small data-source-meta data-source-checked="${esc(e.checked_date)}">${renderCitationAnchor({ url: e.source_url, label: "Provider terms", reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "noopener noreferrer" })}</small>`).join("");
    const medications = entry.offers.map(o => o.label + (page.route === "/wegovy-pill/" && o.medication_id === "compounded-semaglutide-oral" ? " (not Wegovy Pill)" : "")).join("; ");
    const medIds = [...new Set(entry.offers.map(o => o.medication_id))];
    const drugs = [...new Set(medIds.map(medicationToken))];
    const forms = [...new Set(medIds.map(medicationForm))];
    const durations = [...new Set(entry.offers.flatMap(o => o.duration_months))];
    return `<article class="p3-provider-card cs-card" data-phase3-provider data-unpublished-price-card data-program="${esc(entry.program_id)}" data-medications="${esc(medIds.join(" "))}" data-drugs="${esc(drugs.join(" "))}" data-forms="${esc(forms.join(" "))}" data-duration="${esc(durations.join(" ") || "unknown")}" data-price-state="unpublished" data-price="" data-price-map="" data-mode="${esc(mode)}">
      <div class="p3-card-aurora" aria-hidden="true"></div>
      <header class="p3-card-header"><p class="gcs-kicker">Reported information</p>${providerIdentity(entry, logoManifest)}</header>
      <dl class="p3-card-ledger p3-card-contract" data-provider-card-contract="option-c">
        <div><dt>Medications offered</dt><dd><span>${esc(medications)}</span>${chip}</dd></div>
        <div><dt>Total monthly cost</dt><dd><span>Price not yet substantiated for this product/plan — check the provider's current terms</span><small>No comparable published price.</small></dd></div>
        <div><dt>Cancellation</dt><dd><span>Check the provider's cancellation terms.</span></dd></div>
      </dl>${renderCouponChip(coupons[entry.program_id])}
      <div class="p3-card-actions p3-wrap-actions"><a class="cs-btn cs-palette-action" href="${esc(href)}" rel="sponsored noopener nofollow" data-analytics-event="affiliate_click" data-program="${esc(entry.program_id)}" data-link-position="${position}" ${attrs}>Get started</a>${reviewPath ? `<a class="cs-btn cs-btn--quiet" href="${esc(reviewPath)}" data-card-review data-provider-review-link>Read our ${esc(entry.provider)} review</a>` : `<a class="cs-btn cs-btn--quiet" href="/providers/${esc(entry.record.program_id)}/">Open provider details</a>`}</div>
    </article>`;
  }).join("");
  return { cards, entries };
}

function withUnpublishedProviderCards(body, page, pricedProviders, registry, pricingMatrix, logoManifest, { mode, afterMarkup = "", goAuthority = GO_AUTHORITY }) {
  const { cards, entries } = unpublishedProviderCards(page, pricedProviders, registry, logoManifest, { mode, goAuthority });
  if (!entries.length) return body;
  const section = `<section class="p3-provider-section" data-unpublished-provider-section><div class="section-heading"><p class="gcs-kicker">Pricing unpublished</p><h2>More provider paths</h2><p>These provider records have no supported price for this product and term in our capture. They are outside the price rankings, calculators and filters above. Check product and state availability with the provider.</p></div><div class="p3-provider-grid">${cards}</div></section>`;
  // Static section follows every priced card, including state-unknown rows.
  if (afterMarkup) {
    if (!body.includes(afterMarkup)) throw new Error("unpublished_card_anchor_missing");
    return body.replace(afterMarkup, afterMarkup + section);
  }
  const start = body.indexOf("data-three-column-results");
  const end = body.indexOf("</section>", start);
  if (start < 0 || end < 0) throw new Error("unpublished_card_grid_missing");
  return body.slice(0, end + 10) + section + body.slice(end + 10);
}

function deferProviderCard(fullCard, entry, payloadIndex) {
  const match = fullCard.match(/^<article\b([^>]*)>([\s\S]*)<\/article>$/);
  if (!match) throw new Error(`phase3_provider_card_defer_invalid:${entry.program_id}`);
  return {
    // Every deferred body needs a complete no-JS twin, even when its shell is visible.
    // W9 G02: the un-hidden copy is placed BEFORE the placeholder, because
    // author !important rules cannot reliably un-hide a [hidden] element across the site's cascade layers.
    // With JavaScript enabled, <noscript> is inert and the deferred payload path is unchanged.
    placeholder: `<noscript><article${match[1].replace(/\s+hidden(?=\s|$)/, "")} data-provider-noscript-card>${match[2]}</article></noscript><article${match[1]} data-provider-lazy-index="${payloadIndex}"><p class="gcs-kicker" data-provider-lazy-placeholder>Source-checked provider</p><p data-provider-lazy-placeholder>${esc(entry.provider)}</p></article>`,
    body: match[2],
  };
}

// Category spec fix 5: their template inserts one quiz cross-sell card after
// the second provider card — a second conversion path at the scroll-fatigue
// point. Ours is a dark aurora card carrying the existing quiz route; it never
// counts as a provider row (no data-phase3-provider) and adds zero requests.
function quizInterstitialCard(page) {
  const source = encodeURIComponent(`listing-interstitial-${page?.slug || "listing"}`);
  return `<aside class="p3-quiz-interstitial" data-quiz-interstitial aria-label="Provider fit quiz shortcut"><p class="gcs-kicker">Skip the research</p><h3>Find your fit in about 3 minutes.</h3><div class="p3-quiz-chips"><span>Free</span><span>No email needed</span></div><p>Answer a few commercial-priority questions and the quiz narrows these source-checked rows to your match.</p><a class="cs-btn cs-palette-action" href="/quiz/provider-fit/?source=${source}">Find my match</a></aside>`;
}

// The winner treatment is earned from the capture itself: the first entry of a
// cheapest-first sorted set with a finite price. Never a hardcoded provider.
function promotedForCheapest(providers) {
  const cheapest = providers[0];
  if (!cheapest || !cheapest.medications?.some((row) => Number.isFinite(row.ongoing_usd))) return null;
  return { key: "lowest-captured", label: "Lowest captured price" };
}

function medicationTabs(graph, activeRoute) {
  const activePage = graph.brand_pages.find((item) => item.route === activeRoute);
  const molecule = activePage ? productMolecule(activePage) : "";
  const brands = molecule ? graph.brand_pages.filter((item) => productMolecule(item) === molecule) : graph.brand_pages;
  const compounded = molecule ? graph.compounded_pages.find((item) => productMolecule(item) === molecule) : null;
  const brandLinks = brands.map((item) => {
    const drug = medicationToken(item.medication_ids?.[0] || item.medication_id);
    const href = routeWithQuery(item.route, { drug, form: drug === "WEGOVY_PILL" ? "COMPOUNDED" : "BRAND_NAME", sort: "cheapest" });
    return `<a data-filter-route data-route-family="brand-product" href="${esc(href)}"${item.route === activeRoute ? ' aria-current="page"' : ""}>${esc(item.name)}</a>`;
  }).join("");
  const compoundedLink = compounded ? `<a data-filter-route data-route-family="compounded-category" href="${esc(compounded.route)}?drug=${esc(medicationToken(compounded.medication_id))}&amp;form=COMPOUNDED&amp;sort=cheapest">Compounded ${esc(molecule)}</a>` : "";
  return `<nav class="p3-med-tabs p3-wrap-cluster" data-product-family-switcher data-active-molecule="${esc(molecule || "all")}" aria-label="Medication pages">${brandLinks}${compoundedLink}</nav>`;
}

function productMolecule(page) {
  const medicationId = page?.medication_id || page?.medication_ids?.[0] || page?.ingredient || "";
  return String(medicationId).toLowerCase().includes("tirzepatide") || /mounjaro|zepbound/i.test(String(medicationId)) ? "tirzepatide" : "semaglutide";
}

function routeWithQuery(route, values = {}) {
  const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== "" && value != null).map(([key, value]) => [key, String(value)]));
  return `${route}${query.size ? `?${query.toString()}` : ""}`;
}

function compoundPageFor(page, graph) {
  const molecule = productMolecule(page);
  const match = graph.compounded_pages.find((item) => productMolecule(item) === molecule);
  if (!match) throw new Error(`phase3_compounded_cross_route_missing:${molecule}`);
  return match;
}

function brandPagesFor(page, graph) {
  const molecule = productMolecule(page);
  const matches = graph.brand_pages.filter((item) => productMolecule(item) === molecule);
  if (!matches.length) throw new Error(`phase3_brand_cross_route_missing:${molecule}`);
  return matches;
}

function productSelector(graph, activeRoute = "") {
  const products = [
    ...graph.compounded_pages.map((page) => ({ ...page, drug: page.medication_id.includes("tirzepatide") ? "TIRZEPATIDE" : "SEMAGLUTIDE", form: "COMPOUNDED", label: page.name })),
    ...graph.brand_pages.map((page) => {
      const drug = medicationToken(page.medication_ids[0]);
      return { ...page, drug, form: drug === "WEGOVY_PILL" ? "COMPOUNDED" : "BRAND_NAME", label: page.name };
    }),
  ];
  return `<section class="p3-product-picker" data-product-picker aria-labelledby="product-picker-title"><div class="section-heading"><p class="gcs-kicker">Start with a product</p><h2 id="product-picker-title">Choose the medication path you want to compare.</h2><p>Each card opens a live listing or product page and preserves source-governed filtering.</p></div><div class="p3-intent-grid">${products.map((product) => {
    const href = routeWithQuery(product.route, { drug: product.drug, form: product.form, sort: "cheapest" });
    return `<a class="cs-card p3-intent-card" data-product-card data-filter-route data-route-family="${esc(product.form === "BRAND_NAME" ? "brand-product" : "compounded-category")}" data-drug="${esc(product.drug)}" data-form="${esc(product.form)}" href="${esc(href)}"${product.route === activeRoute ? ' aria-current="page"' : ""}><p class="gcs-kicker">${esc(product.form === "BRAND_NAME" ? "Brand name" : "Compounded")}</p><h3 class="p3-wrap-title" data-wrap-text>${esc(product.label)}</h3><span>Compare providers and evidence →</span></a>`;
  }).join("")}</div></section>`;
}

function productForFilter(page) {
  const primaryMedicationId = page.medication_id || page.medication_ids?.[0] || "";
  return {
    id: primaryMedicationId,
    name: page.name || "GLP-1",
    drug: medicationToken(primaryMedicationId),
    form: medicationForm(primaryMedicationId),
  };
}

export function renderPhase3ProductPicture(page, { className = "p3-product-float", loading = "lazy", sizes = "(max-width:700px) 86vw, 380px" } = {}) {
  return `<figure class="p3-product-visual" data-representative-editorial-visual><picture class="${esc(className)}"><source srcset="/assets/images/phase3-product-${esc(page.slug)}-640.avif 640w, /assets/images/phase3-product-${esc(page.slug)}-1024.avif 1024w" sizes="${esc(sizes)}" type="image/avif"><source srcset="/assets/images/phase3-product-${esc(page.slug)}-640.webp 640w, /assets/images/phase3-product-${esc(page.slug)}-1024.webp 1024w" sizes="${esc(sizes)}" type="image/webp"><img src="/assets/images/phase3-product-${esc(page.slug)}-1024.jpg" srcset="/assets/images/phase3-product-${esc(page.slug)}-640.jpg 640w, /assets/images/phase3-product-${esc(page.slug)}-1024.jpg 1024w" sizes="${esc(sizes)}" width="1024" height="1024" loading="${esc(loading)}" decoding="async" alt="Original branded representative editorial visualization for ${esc(page.name)}; not retail-package photography"></picture><figcaption>Representative editorial visualization generated for Clinic Scout; not retail-package photography and not supplied by the manufacturer.</figcaption></figure>`;
}

const productPicture = renderPhase3ProductPicture;

export function insuranceWizard(page, cheapest) {
  const likelihoods = ["Not covered / unsure", "Probably not", "Probably", "Covered"];
  let sourceUrl = "";
  try {
    const source = new URL(cheapest?.source_url);
    if (["https:", "http:"].includes(source.protocol)) sourceUrl = source.href;
  } catch { /* Missing or invalid evidence stays unknown. */ }
  const hasSelfPay = Boolean(cheapest && page.medication_ids.includes(cheapest.medication_id)
    && Number.isFinite(cheapest.ongoing_usd) && cheapest.ongoing_usd >= 0
    && cheapest.cadence === "month" && sourceUrl
    && /^\d{4}-\d{2}-\d{2}$/.test(cheapest.captured_on));
  const selfPay = hasSelfPay
    ? `Published self-pay starts at ${usd(cheapest.ongoing_usd)}/month. ${renderCitationAnchor({ url: sourceUrl, label: "Price source", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE, extraAttrs: " data-insurance-source" })}, checked ${esc(cheapest.captured_on)}. The source's dose, eligibility, billing period and fees still apply; this is not a personal quote.`
    : "A source-linked monthly self-pay amount is not available for this estimate. Ask the provider for a price; unknown does not mean free.";
  return `<section class="p3-insurance" data-with-without-insurance aria-labelledby="insurance-${esc(page.slug)}"><div><p class="gcs-kicker">With or without insurance</p><h2 id="insurance-${esc(page.slug)}">Estimate your monthly cost.</h2><div class="p3-insurance-paths"><article data-insurance-path="without"><h3>Without insurance</h3><p>${selfPay}</p></article><article data-insurance-path="with"><h3>With insurance</h3><p>Enter your own estimated monthly out-of-pocket amount or choose a copay. We do not supply an insurer's price.</p></article></div><p data-coverage-formula>Not covered / unsure or Probably not: use the published monthly self-pay amount above, not your copay. Probably: use your monthly amount if coverage applies. Covered: use your monthly amount based on your self-reported coverage. A missing amount stays unknown; no coverage probabilities or billing-period conversions are used.</p></div><form data-insurance-wizard data-self-pay-amount="${hasSelfPay ? cheapest.ongoing_usd : ""}" data-self-pay-cadence="${hasSelfPay ? cheapest.cadence : ""}" data-self-pay-source="${hasSelfPay ? esc(sourceUrl) : ""}" data-self-pay-checked="${hasSelfPay ? esc(cheapest.captured_on) : ""}" novalidate><p class="p3-boundary-note"><strong>Boundary:</strong> This estimate does not verify coverage, prior authorization, eligibility, or the price a pharmacy will charge.</p><label>Your coverage expectation (self-reported)<output data-coverage-label>${likelihoods[0]}</output><input name="coverage" type="range" min="0" max="3" step="1" value="0" aria-label="Your coverage expectation (self-reported)" aria-valuetext="${likelihoods[0]}" style="--p3-progress:0%"></label><div class="p3-progress-labels" aria-hidden="true">${likelihoods.map((label, index) => `<span${index === 0 ? ' class="is-active"' : ""}>${label}</span>`).join("")}</div><label>Estimated monthly out-of-pocket<input name="monthly_oop" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Enter your estimate"></label><fieldset><legend>Common copays — choose only your own amount</legend><div class="p3-copay-picks">${[0,25,50,75].map((amount) => `<button type="button" data-copay="${amount}" aria-pressed="false">${usd(amount)}</button>`).join("")}</div></fieldset><button class="cs-btn cs-palette-action" type="submit" data-insurance-complete aria-controls="insurance-result-${esc(page.slug)}" disabled>Finish estimate</button><output id="insurance-result-${esc(page.slug)}" class="p3-insurance-result" data-insurance-result aria-live="polite" aria-atomic="true">Choose your coverage expectation, then finish your estimate.</output><p data-insurance-finish-status role="status"></p><noscript>JavaScript is needed to calculate the estimate. The formula and published self-pay information above remain available.</noscript></form></section>`;
}

function relatedProductShelf(page, graph) {
  const related = graph.brand_pages.filter((item) => item.route !== page.route).slice(0, 3);
  return `<section class="p3-related p3-product-related" data-related-provider-shelf aria-labelledby="related-${esc(page.slug)}"><div class="section-heading"><p class="gcs-kicker">Related product guides</p><h2 id="related-${esc(page.slug)}">Compare other medication options.</h2></div><div>${related.map((item) => `<a class="cs-card p3-product-related-card" data-wrap-card href="${esc(routeWithQuery(item.route, { drug: medicationToken(item.medication_ids[0]), form: medicationForm(item.medication_ids[0]), sort: "cheapest" }))}">${productPicture(item, { className: "p3-product-card-picture", sizes: "(max-width:700px) 82vw, 260px" })}<span>Product guide</span><strong class="p3-wrap-title" data-wrap-text>${esc(item.name)}</strong></a>`).join("")}</div></section>`;
}

export function renderPhase3RelatedInsightsShelf(page, articles) {
  const eligible = (articles || []).filter((article) => article?.canonical_path && !PHASE3_INSIGHTS_EXCLUSIONS.has(article.canonical_path));
  const preferred = page?.research_route ? eligible.find((article) => article.canonical_path === page.research_route) : null;
  const ordered = preferred ? [preferred, ...eligible] : eligible;
  const related = ordered.filter((article, index, rows) => rows.findIndex((candidate) => candidate.canonical_path === article.canonical_path) === index).slice(0, 3);
  if (!related.length) return '<section class="p3-related p3-insights-related" data-related-insights-shelf><div class="p3-empty"><h2>No related Insights guide is bound.</h2><p>Clinic Scout does not invent an article destination.</p></div><a href="/insights/">Browse all Insights</a></section>';
  const cards = related.map((article) => `<a class="cs-card p3-story" data-wrap-card href="${esc(article.canonical_path)}">${articlePicture(article, { className: "p3-story-picture" })}<p class="gcs-kicker">Clinic Scout Insights</p><h3 class="p3-wrap-title" data-wrap-text>${esc(article.h1 || article.title)}</h3><p>${esc(article.meta_description || article.direct_answer || "Open the source-checked guide.")}</p><span>Read the guide →</span></a>`).join("");
  const id = `related-insights-${esc(page?.slug || "listing")}`;
  return `<section class="p3-related p3-insights-related" data-related-insights-shelf aria-labelledby="${id}"><div class="section-heading"><p class="gcs-kicker">Related Insights</p><h2 id="${id}">Understand your options before choosing.</h2></div><div class="p3-story-grid">${cards}</div><a class="p3-card-link" href="/insights/">Read more Insights</a></section>`;
}

function renderBrandPage(page, graph, pricingMatrix, registry, coupons, doseCapture, logoManifest, articles, goAuthority = GO_AUTHORITY) {
  const providers = pricingProviders(pricingMatrix, page.medication_ids);
  const deferredBodies = [];
  const cards = providers.slice(0, 12).map((entry, index) => {
    const fullCard = compactProviderCard(entry, registry, doseCapture, logoManifest, { coupon: coupons[entry.program_id], mode: "brand", goSurface: { route: page.route, position: "provider-card", authority:goAuthority }, rankPosition: index + 1 });
    if (page.slug !== "wegovy") return fullCard;
    const deferred = deferProviderCard(fullCard, entry, deferredBodies.length);
    deferredBodies.push(deferred.body);
    return deferred.placeholder;
  }).join("");
  const deferredPayload = deferredBodies.length ? JSON.stringify(deferredBodies).replaceAll("<", "\\u003c") : "";
  const cheapest = providers[0]?.medications.slice().sort((a, b) => a.ongoing_usd - b.ongoing_usd)[0] || null;
  const manufacturerUrl = PRODUCT_MANUFACTURER_URLS[page.slug];
  if (!manufacturerUrl) throw new Error(`phase3_manufacturer_url_missing:${page.slug}`);
  const heroPicture = productPicture(page, { loading: "eager" });
  const controls = renderPhase3FilterControls(page, providers, doseCapture, graph);
  const title = `${page.name}: published prices and provider paths · Clinic Scout`;
  // Design pass 2026-08-26 (brand specs fixes 1-2, F2/F4): their template is a
  // stateful comparator — hero with the price and sibling cross-link, controls,
  // then the provider grid within one scroll. The insurance organizer and the
  // 7-card product picker are demoted BELOW the grid; the compact affiliate
  // disclosure leads the page so it still precedes the first dollar figure.
  const siblings = brandPagesFor(page, graph).filter((item) => item.route !== page.route);
  const heroPrice = cheapest
    ? `<p class="p3-hero-price"><strong>${usd(cheapest.ongoing_usd)}</strong><span>/${esc(cheapest.cadence)} self-pay in our capture · checked ${esc(cheapest.captured_on)}</span></p>`
    : "";
  const heroCrosslink = siblings.length
    ? `<p class="p3-hero-crosslink">Comparing ${siblings.map((item) => `<a href="${esc(routeWithQuery(item.route, { drug: medicationToken(item.medication_ids[0]), form: medicationForm(item.medication_ids[0]), sort: "cheapest" }))}">${esc(item.name)}</a>`).join(" or ")} instead?</p>`
    : "";
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4): brand pages
  // get BreadcrumbList + FAQPage. The FAQ text below mirrors the visible
  // "About" accordion copy rendered further down BYTE-FOR-WORD (link anchor
  // flattened to plain text); no Article node — these are comparators, not
  // editorial. No aggregateRating, nothing invented.
  const aboutFaq = [
    [`What is ${page.name}?`, `${page.name} is the product represented by the medication identifiers on this page. Open the official manufacturer resource for current labeling and product information.`],
    ["How does it work?", "The official prescribing information explains how the medication works. Clinic Scout focuses on comparing published provider pathways and does not turn a mechanism into a treatment recommendation."],
    ["Benefits", "This comparison helps you inspect total monthly cost, renewal cadence, included services, and source links before choosing a provider path. It cannot determine medical suitability, coverage, availability, or checkout price."],
  ];
  const schema = pageSchemaGraph(
    breadcrumbSchema(page.route, [{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: page.name }]),
    {
      "@type": "FAQPage",
      "@id": `${canonical(page.route)}#faq`,
      mainEntity: aboutFaq.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
    },
  );
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: page.name }])}${sourceDisclosure()}<section class="p3-product-hero p3-product-hero--${esc(page.accent)}"><div><p class="gcs-kicker">Brand product guide</p><h1 class="p3-wrap-title" data-wrap-text>${esc(page.name)}</h1><p class="lede">Compare ${esc(page.name)} prices and provider options.</p>${heroPrice}<a class="p3-card-link" data-manufacturer-resource href="${esc(manufacturerUrl)}" rel="noopener noreferrer">Official manufacturer labeling and product information</a><div class="p3-hero-actions p3-wrap-actions" data-wrap-actions><a class="cs-btn cs-palette-action" href="#published-options">See published options</a><a class="cs-btn cs-btn--quiet" href="${esc(page.research_route)}">Read the evidence guide</a></div>${heroCrosslink}</div>${heroPicture}</section>${insuranceWizard(page, cheapest)}${medicationTabs(graph, page.route)}${controls}<section id="published-options" class="p3-provider-section" data-three-column-results><div class="section-heading"><p class="gcs-kicker">Published provider paths</p><h2>Compare ${esc(page.name)} providers</h2><p>${providers.length} provider${providers.length === 1 ? "" : "s"} with published pricing. Unavailable prices are not shown.</p></div><p class="p3-filter-result" data-filter-result aria-live="polite"></p><div class="p3-provider-grid" data-phase3-provider-grid>${cards || '<p class="p3-empty">No matching provider has published pricing.</p>'}</div>${deferredPayload ? `<script type="application/json" data-provider-card-payloads>${deferredPayload}</script>` : ""}<div class="p3-filter-empty" data-filter-empty hidden><p>No published option matches those filters.</p><p>Reset a filter or choose another product. We do not estimate missing prices.</p><button type="button" data-filter-reset>Reset filters</button></div></section>${productSelector(graph, page.route)}<section class="p3-selfpay-cta"><div><p class="gcs-kicker">Paying without insurance</p><h2>Compare the whole bill, not one headline.</h2><p>Compare medication, membership, renewal cadence, required term, and what the cited price actually includes.</p></div><a class="cs-btn cs-palette-action" href="/self-pay/">Compare self-pay paths</a></section><section class="p3-accordions" aria-labelledby="about-${esc(page.slug)}"><h2 id="about-${esc(page.slug)}">About ${esc(page.name)}</h2><details><summary>What is ${esc(page.name)}?</summary><p>${esc(page.name)} is the product represented by the medication identifiers on this page. <a href="${esc(manufacturerUrl)}" rel="noopener noreferrer">Open the official manufacturer resource</a> for current labeling and product information.</p></details><details><summary>How does it work?</summary><p>The official prescribing information explains how the medication works. Clinic Scout focuses on comparing published provider pathways and does not turn a mechanism into a treatment recommendation.</p></details><details><summary>Benefits</summary><p>This comparison helps you inspect total monthly cost, renewal cadence, included services, and source links before choosing a provider path. It cannot determine medical suitability, coverage, availability, or checkout price.</p></details></section>${relatedProductShelf(page, graph)}${renderPhase3RelatedInsightsShelf(page, articles)}`;
  return pageDocument({ route: page.route, title, description: `Source-dated ${page.name} provider prices, self-pay paths, insurance-plan inputs, and evidence limits.`, body: withUnpublishedProviderCards(body, page, providers, registry, pricingMatrix, logoManifest, { mode: "brand", goAuthority }), schema });
}

function stateFilterControl() {
  const stateOptions = STATES.map(([code, name]) => `<button type="button" role="option" data-state="${esc(code)}" aria-selected="false" tabindex="-1">${esc(name)}</button>`).join("");
  const nativeStateOptions = STATES.map(([code, name]) => `<option value="${esc(code)}">${esc(name)}</option>`).join("");
  return `<div class="p3-state-control" data-wrap-control><button type="button" data-state-open aria-expanded="false" aria-haspopup="listbox" aria-controls="p3-state-options">State: <span data-state-label>Choose state</span></button><div class="p3-state-popover" role="group" aria-label="State search and choices" hidden><input type="search" aria-label="Search states" placeholder="Search states" data-state-search aria-controls="p3-state-options"><div class="p3-state-options" id="p3-state-options" role="listbox" aria-label="Choose state">${stateOptions}</div><p data-state-empty role="status" hidden>No states match your search.</p></div><label class="p3-state-native"><span class="p3-state-native-label">Native state selector</span><select data-state-native aria-label="Choose state (native selector)"><option value="">Choose state</option>${nativeStateOptions}</select></label></div>`;
}

function filterChipGroup(label, key, options) {
  const firstEnabled = options.findIndex((option) => !option.disabled);
  const selected = options.findIndex((option) => option.current === true && !option.disabled);
  const active = selected >= 0 ? selected : firstEnabled;
  const buttons = options.map((option, index) => {
    const route = option.route ? ` data-route="${esc(option.route)}" data-filter-route` : "";
    const disabled = option.disabled ? ' disabled aria-disabled="true" title="No source-backed row is available for this control"' : "";
    return `<button type="button" role="tab" tabindex="${index === active ? "0" : "-1"}" aria-selected="${index === active ? "true" : "false"}" data-filter="${esc(key)}" data-value="${esc(option.value)}"${route}${disabled}>${esc(option.label)}</button>`;
  }).join("");
  return `<fieldset role="tablist" aria-label="${esc(label)}" data-filter-group="${esc(key)}" data-wrap-control><legend>${esc(label)}</legend><div class="p3-filter-chips p3-wrap-cluster" data-wrap-actions>${buttons}</div></fieldset>`;
}

function crossRouteLinks(page, graph) {
  const compounded = compoundPageFor(page, graph);
  const brands = brandPagesFor(page, graph);
  const links = [
    `<a data-filter-route data-route-family="compounded-category" href="${esc(routeWithQuery(compounded.route, { drug: medicationToken(compounded.medication_id), form: "COMPOUNDED", sort: "cheapest" }))}">${esc(compounded.name)}</a>`,
    ...brands.map((brand) => `<a data-filter-route data-route-family="brand-product" href="${esc(routeWithQuery(brand.route, { drug: medicationToken(brand.medication_ids[0]), form: medicationForm(brand.medication_ids[0]), sort: "cheapest" }))}">${esc(brand.name)}</a>`),
  ];
  return `<nav class="p3-cross-route-options p3-wrap-cluster" data-cross-route-options aria-label="Switch product template">${links.join("")}</nav>`;
}

export function renderPhase3FilterControls(page, providers, doseCapture, graph, { fixedDuration = null } = {}) {
  const product = productForFilter(page);
  const brandTemplate = graph.brand_pages.some((item) => item.route === page.route);
  const molecule = productMolecule(page);
  const compounded = compoundPageFor(page, graph);
  const brands = brandPagesFor(page, graph);
  const doseValues = molecule === "tirzepatide" ? DOSES : SEMAGLUTIDE_DOSES;
  const filterTemplate = brandTemplate ? "brand-product" : "compounded-listing";
  let controls = "";

  if (brandTemplate) {
    controls += filterChipGroup("Medication", "treatment", brands.map((brand) => ({
      value: medicationToken(brand.medication_ids[0]),
      label: brand.name,
      route: routeWithQuery(brand.route, { drug: medicationToken(brand.medication_ids[0]), form: medicationForm(brand.medication_ids[0]), sort: "cheapest" }),
      current: brand.route === page.route,
    })));
    const currentForm = page.slug === "wegovy-pill" ? "COMPOUNDED" : medicationForm(page.medication_ids[0]);
    controls += filterChipGroup("Form", "type", [
      {
        value: "brand",
        label: "Brand name",
        current: currentForm === "BRAND_NAME",
      },
      {
        value: "compounded",
        label: "Compounded",
        current: currentForm !== "BRAND_NAME",
      },
      { value: "microdose", label: "Microdose", disabled: true },
    ]);
    if (page.slug === "wegovy-pill") {
      controls += filterChipGroup("Duration", "duration", [
        { value: "1", label: "Monthly", route: routeWithQuery(page.route, { drug: product.drug, form: currentForm, duration: 1, sort: "cheapest" }), current: true },
        { value: "3", label: "3 months", route: routeWithQuery(page.route, { drug: product.drug, form: currentForm, duration: 3, sort: "cheapest" }) },
        { value: "6", label: "6 months", route: routeWithQuery(page.route, { drug: product.drug, form: currentForm, duration: 6, sort: "cheapest" }) },
        { value: "12", label: "12 months", route: routeWithQuery(page.route, { drug: product.drug, form: currentForm, duration: 12, sort: "cheapest" }) },
      ]);
    }
  } else {
    const activeMedicationId = page.medication_id || page.medication_ids?.[0] || compounded.medication_id;
    controls += filterChipGroup("Medication", "treatment", graph.compounded_pages.map((item) => ({
      value: medicationToken(item.medication_id),
      label: productMolecule(item) === "tirzepatide" ? "Tirzepatide" : "Semaglutide",
      route: fixedDuration
        ? routeWithQuery(page.route, { drug: medicationToken(item.medication_id), form: "COMPOUNDED", ...(fixedDuration === 3 ? { plan: 3 } : { duration: fixedDuration }), sort: "cheapest" })
        : routeWithQuery(item.route, { drug: medicationToken(item.medication_id), form: "COMPOUNDED", sort: "cheapest" }),
      current: item.medication_id === activeMedicationId,
    })));
    controls += filterChipGroup("Form", "type", [
      { value: "compounded", label: "Compounded", route: routeWithQuery(page.route, { drug: medicationToken(activeMedicationId), form: "COMPOUNDED", ...(fixedDuration === 3 ? { plan: 3 } : fixedDuration ? { duration: fixedDuration } : {}), sort: "cheapest" }), current: true },
      { value: "brand", label: "Brand name", route: routeWithQuery(brands[0].route, { drug: medicationToken(brands[0].medication_ids[0]), form: medicationForm(brands[0].medication_ids[0]), sort: "cheapest" }) },
      { value: "microdose", label: "Microdose", disabled: true },
    ]);
    controls += filterChipGroup("Plan", "plan", [
      { value: "both", label: "Both", route: routeWithQuery(compounded.route, { drug: medicationToken(activeMedicationId), form: "COMPOUNDED", sort: "cheapest" }), current: fixedDuration == null },
      { value: "1", label: "1 month", route: routeWithQuery(compounded.route, { drug: medicationToken(activeMedicationId), form: "COMPOUNDED", duration: 1, sort: "cheapest" }) },
      { value: "3", label: "3 months", route: routeWithQuery("/3-month/", { drug: medicationToken(activeMedicationId), form: "COMPOUNDED", plan: 3, sort: "cheapest" }), current: fixedDuration === 3 },
      { value: "more", label: "More plans ▾" },
    ]);
    controls += `<details class="p3-more-filters"${Number(fixedDuration) >= 6 ? " open" : ""}><summary>More plans</summary>${filterChipGroup("Longer plan", "duration", [
      { value: "all", label: "All", current: Number(fixedDuration) < 6 },
      { value: "6", label: "6+ months", route: routeWithQuery("/6-month/", { drug: medicationToken(activeMedicationId), form: "COMPOUNDED", duration: 6, sort: "cheapest" }), current: Number(fixedDuration) >= 6 },
      { value: "starter", label: "Starter", disabled: true },
      { value: "step-up", label: "Step-up", disabled: true },
    ])}</details>${filterChipGroup("Dose", "dose", [{ value: "all", label: "All doses", current: true }, ...doseValues.map((dose) => ({ value: dose, label: `${dose} mg/week` }))])}`;
  }

  controls += filterChipGroup("Sort", "sort", [
    { value: "cheapest", label: "Cheapest", current: true },
    { value: "best", label: "Best match (quiz only)", disabled: true },
  ]);
  controls += stateFilterControl();
  const durationPolicy = page.slug === "wegovy-pill" ? "monthly-3-6-12" : brandTemplate ? "none" : fixedDuration ? `fixed-${fixedDuration}` : "listing";
  return `<div class="p3-filterbar" data-provider-filters data-filter-template="${esc(filterTemplate)}" data-product-route="${esc(page.route)}" data-active-molecule="${esc(molecule)}" data-duration-policy="${esc(durationPolicy)}">${controls}${crossRouteLinks(page, graph)}</div>`;
}

function doseSelectionRuntime() {
  return `<script data-phase3-dose-selection>(()=>{const root=document.currentScript.closest("main");if(!root)return;const paint=(value)=>{root.querySelectorAll("[data-dose-row]").forEach((row)=>{const selected=value!=="all"&&row.dataset.doseRow===value;row.dataset.selected=String(selected);row.classList.toggle("is-selected-dose",selected);if(selected)row.setAttribute("aria-current","true");else row.removeAttribute("aria-current");});};root.addEventListener("click",(event)=>{const button=event.target.closest('[data-filter="dose"][data-value]');if(button&&!button.disabled)paint(button.dataset.value);});})();</script>`;
}

function renderCompoundedPage(page, graph, pricingMatrix, registry, coupons, doseCapture, logoManifest, articles, goAuthority = GO_AUTHORITY) {
  const providers = pricingProviders(pricingMatrix, [page.medication_id]);
  const stateBoundProviders = providers.filter((entry) => providerStateCoverage(PROGRAM_LEDGER_BY_ID.get(entry.program_id)).mode !== "unknown");
  const stateUnknownProviders = providers.filter((entry) => providerStateCoverage(PROGRAM_LEDGER_BY_ID.get(entry.program_id)).mode === "unknown");
  const promoted = promotedForCheapest(stateBoundProviders);
  // Design pass 2026-08-26 (category spec fixes 2/3/5, work order A8): the
  // listing leads — hero, compact disclosure, filter rail, then the card grid
  // with the quiz interstitial in slot 3. The product picker moves BELOW the
  // results as the cross-product band; it no longer pushes the money grid down.
  const cardList = stateBoundProviders.map((entry, index) => compactProviderCard(entry, registry, doseCapture, logoManifest, { coupon: coupons[entry.program_id], mode: "compounded", promoted: index === 0 ? promoted : null, goSurface: { route: page.route, position: "provider-card", authority:goAuthority }, rankPosition: index + 1 }));
  if (cardList.length >= 2) cardList.splice(2, 0, quizInterstitialCard(page));
  const cards = cardList.join("");
  const stateUnknownCards = stateUnknownProviders.map((entry, index) => compactProviderCard(entry, registry, doseCapture, logoManifest, { coupon: coupons[entry.program_id], mode: "compounded", goSurface: { route: page.route, position: "provider-card-unverified", authority:goAuthority }, rankPosition: stateBoundProviders.length + index + 1 })).join("");
  const stateUnknownRemainder = stateUnknownCards
    ? `<details class="p3-unverified-remainder" data-state-unverified-remainder><summary>${stateUnknownProviders.length} price row${stateUnknownProviders.length === 1 ? "" : "s"} with availability unverified</summary><p>These source-priced records do not carry positive state evidence. They remain available for direct verification, but never appear as a selected-state match.</p><div class="p3-provider-grid p3-unverified-grid">${stateUnknownCards}</div></details>`
    : "";
  const controls = renderPhase3FilterControls(page, providers, doseCapture, graph);
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: page.name }])}<section class="p3-category-hero p3-category-hero--${esc(page.tone)}"><div><p class="gcs-kicker">Compounded category</p><h1 class="p3-wrap-title" data-wrap-text data-state-heading data-state-title-template="{product} providers in {state}" data-state-product="${esc(page.name)}">${esc(page.name)} providers</h1><p class="lede">Filter the source-dated rows Clinic Scout actually captured. A provider card is commercial evidence, not a treatment recommendation.</p></div><div class="p3-category-orb" aria-hidden="true"></div></section>${sourceDisclosure()}<div class="d3-category-workbench">${controls}<div class="d3-category-stack"><section class="p3-provider-section" data-three-column-results aria-labelledby="providers-${esc(page.slug)}"><div class="section-heading"><h2 id="providers-${esc(page.slug)}">${stateBoundProviders.length} providers with explicit state evidence</h2><p>${providers.length} total price rows are preserved. State selection applies only explicit included, excluded, or all-state evidence; unknown coverage stays in the separate verification remainder.</p></div><p class="p3-filter-result" data-filter-result aria-live="polite"></p><div class="p3-provider-grid" data-phase3-provider-grid>${cards || '<div class="p3-empty"><h3>No matching price row is published.</h3><p>That is an evidence gap, not proof that no provider exists.</p></div>'}</div><div class="p3-filter-empty" data-filter-empty hidden><p>No source-backed row matches those controls.</p><p>An empty result is not evidence that no provider exists. Reset a filter to continue.</p><button type="button" data-filter-reset>Reset filters</button></div></section>${stateUnknownRemainder}</div></div><aside class="p3-evidence-boundary"><strong>Evidence boundary.</strong> Compounded drugs are not FDA-approved. Clinic Scout does not determine eligibility, formulation quality, dose, treatment fit, or current state availability.</aside>${productSelector(graph, page.route)}${renderPhase3RelatedInsightsShelf(page, articles)}${doseSelectionRuntime()}`;
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4): LP templates
  // get BreadcrumbList + an ItemList of exactly the providers listed on the
  // page (source-dated capture order). No ratings, nothing invented.
  const schema = pageSchemaGraph(
    breadcrumbSchema(page.route, [{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: page.name }]),
    providerItemListSchema(page.route, `${page.name} providers with source-dated prices`, providers, registry),
  );
  return pageDocument({
    route: page.route,
    title: `${page.name} providers with source-dated prices · Clinic Scout`,
    description: `Filter source-dated ${page.name.toLowerCase()} provider prices, plan evidence, and visible source gaps.`,
    robots: "noindex,nofollow,noarchive,nosnippet,max-image-preview:large",
    body: withUnpublishedProviderCards(body, page, providers, registry, pricingMatrix, logoManifest, { mode: "compounded", afterMarkup: stateUnknownRemainder, goAuthority }),
    schema,
  });
}

function durationSupported(row, months) {
  const text = `${row.quote || ""} ${row.notes || ""}`.toLowerCase().replace(/[–—]/g, "-");
  const explicitlyNames = (duration) => new RegExp(`\\b${duration}\\s*[- ]?\\s*(?:months?|mos?)\\b`, "i").test(text);
  const appearsInSharedUnitList = (duration) => new RegExp(`\\b(?:\\d+\\s*\\/\\s*)*${duration}\\s*(?:\\/\\s*\\d+\\s*)*(?:months?|mos?)\\b`, "i").test(text);
  if (months === 3) return explicitlyNames(3) || appearsInSharedUnitList(3);
  return [6, 12].some((duration) => explicitlyNames(duration) || appearsInSharedUnitList(duration));
}

function bulkFeedbackRuntime(duration) {
  return `<script data-phase3-bulk-feedback>(()=>{const root=document.currentScript.closest("main");if(!root)return;const paint=()=>{const output=root.querySelector("[data-bulk-result]");const active=root.querySelector('[data-bulk-drug-value][aria-pressed="true"]');if(!output||!active)return;const count=[...root.querySelectorAll("[data-bulk-grid] [data-phase3-provider]")].filter((card)=>!card.hidden).length;const name=active.textContent.trim().toLowerCase();output.textContent="Showing "+count+" source-backed "+name+" row"+(count===1?"":"s")+" for ${esc(duration)}.";};root.addEventListener("click",(event)=>{if(event.target.closest("[data-bulk-drug-value]"))setTimeout(paint,0);});window.addEventListener("load",paint,{once:true});setTimeout(paint,0);})();</script>`;
}

function renderBulkPage(page, graph, pricingMatrix, registry, coupons, doseCapture, logoManifest, articles, goAuthority = GO_AUTHORITY) {
  const all = pricingProviders(pricingMatrix, page.medication_ids);
  const providers = all.map((entry) => ({ ...entry, medications: entry.medications.filter((row) => durationSupported(row, page.duration_months)) })).filter((entry) => entry.medications.length);
  // Design pass 2026-08-26 (packs spec fixes 2/4, operator: our 3-month page
  // "looks totally different"): comparison-first — the hero is a benefit
  // headline, one utility line, and the drug segment; the winner treatment is
  // earned by the lowest captured row; the bundle-math boundary line moves to
  // the evidence aside under the grid where their legal band sits.
  const promoted = promotedForCheapest(providers);
  const cards = providers.map((entry, index) => compactProviderCard(entry, registry, doseCapture, logoManifest, { coupon: coupons[entry.program_id], mode: "bulk", duration: page.duration, promoted: index === 0 ? promoted : null, goSurface: { route: page.route, position: "provider-card", authority:goAuthority }, rankPosition: index + 1 })).join("");
  const initialCount = providers.filter((entry) => entry.medications.some((row) => row.medication_id.includes("semaglutide"))).length;
  const controls = renderPhase3FilterControls(page, providers, doseCapture, graph, { fixedDuration: page.duration_months });
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/bulk/", label: "Bulk plans" }, { label: page.name }])}<section class="p3-bulk-hero"><div><p class="gcs-kicker">Multi-month price evidence</p><h1 class="p3-wrap-title" data-wrap-text>${esc(page.name)} plans that lower the monthly bill</h1><p class="lede">Choose semaglutide or tirzepatide. Only provider captures whose own wording mentions the matching term appear below.</p><div class="p3-filter-chips p3-wrap-cluster" data-bulk-drug data-wrap-actions><button type="button" data-bulk-drug-value="SEMAGLUTIDE" aria-pressed="true">Semaglutide</button><button type="button" data-bulk-drug-value="TIRZEPATIDE" aria-pressed="false">Tirzepatide</button></div></div>${renderProductComparisonPicture(page, "bulk")}</section>${sourceDisclosure()}${controls}<section class="p3-provider-section" data-three-column-results><div class="section-heading"><h2>${providers.length} source-backed option${providers.length === 1 ? "" : "s"}</h2><p>Compare total obligation, renewal, cancellation, shipping, and what the published amount includes before paying.</p></div><p class="p3-filter-result" data-bulk-result data-filter-result aria-live="polite">Showing ${initialCount} source-backed semaglutide row${initialCount === 1 ? "" : "s"} for ${esc(page.duration)}.</p><div class="p3-provider-grid" data-bulk-grid data-phase3-provider-grid>${cards || '<div class="p3-empty"><h3>No matching term is published in the bound capture.</h3><p>That is an evidence gap, not proof that no program offers one.</p></div>'}</div><div class="p3-filter-empty" data-bulk-empty data-filter-empty hidden><h3>No source-backed row matches this medication and term.</h3><p>That is an evidence gap, not proof that no program offers one.</p><button type="button" data-filter-reset>Reset filters</button></div></section><aside class="p3-evidence-boundary">A lower per-month figure can require a larger upfront payment or longer commitment. The cited provider wording controls. We do not multiply a monthly price and call it a bundle.</aside>${renderPhase3RelatedInsightsShelf({ ...page, slug: page.duration }, articles)}${bulkFeedbackRuntime(page.duration)}`;
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4).
  const schema = pageSchemaGraph(breadcrumbSchema(page.route, [{ href: "/", label: "Home" }, { href: "/bulk/", label: "Bulk plans" }, { label: page.name }]));
  return pageDocument({ route: page.route, title: `${page.name} plans with cited price evidence · Clinic Scout`, description: `Source-backed ${page.name} program rows without invented bundle math.`, body: withUnpublishedProviderCards(body, page, providers, registry, pricingMatrix, logoManifest, { mode: "bulk", goAuthority }), schema });
}

function renderBulkHub(graph, pricingMatrix) {
  const preview = (intent) => {
    const destination = new URL(intent.href, "https://glpclinicscout.com");
    const page = graph.bulk_pages.find((candidate) => candidate.route === destination.pathname);
    if (!page) return { count: 0, lowest: null };
    const drug = String(destination.searchParams.get("drug") || "").toLowerCase();
    const providers = pricingProviders(pricingMatrix, page.medication_ids)
      .map((entry) => ({ ...entry, medications: entry.medications.filter((row) => durationSupported(row, page.duration_months) && (!drug || row.medication_id.includes(drug))) }))
      .filter((entry) => entry.medications.length);
    const prices = providers.flatMap((entry) => entry.medications.map((row) => row.ongoing_usd)).filter(Number.isFinite);
    return { count: providers.length, lowest: prices.length ? Math.min(...prices) : null };
  };
  const cards = graph.bulk_intents.map((page) => {
    const result = preview(page);
    const amount = Number.isFinite(result.lowest) ? `Lowest captured ${usd(result.lowest)}/month` : "No source-backed price preview";
    return `<a class="cs-card p3-intent-card" href="${esc(page.href)}"><p class="gcs-kicker">${esc(page.duration)}</p><h2>${esc(page.name)}</h2><p>${result.count} source-backed provider row${result.count === 1 ? "" : "s"}</p><strong class="p3-intent-preview">${amount}</strong></a>`;
  }).join("");
  return pageDocument({ route: "/bulk/", title: "Multi-month GLP-1 plan evidence · Clinic Scout", description: "Compare cited three-month and longer semaglutide and tirzepatide program terms.", schema: pageSchemaGraph(breadcrumbSchema("/bulk/", [{ href: "/", label: "Home" }, { label: "Bulk plans" }])), body: `${breadcrumbs([{ href: "/", label: "Home" }, { label: "Bulk plans" }])}<section class="p3-index-hero"><p class="gcs-kicker">Bulk plan finder</p><h1>Compare the commitment before the discount.</h1><p class="lede">Choose a term and medication path. Every result must carry provider wording that supports the duration; Clinic Scout never manufactures bundle math.</p></section><section aria-labelledby="bulk-intents-title"><div class="section-heading"><p class="gcs-kicker">Choose a plan window</p><h2 id="bulk-intents-title">Start with the commitment you can verify.</h2><p>Each card opens the same source-governed comparison with the medication choice preserved.</p></div><div class="p3-intent-grid">${cards}</div></section>` });
}

export function phase3Registry(graph, registry) {
  const additions = graph.provider_work_order_additions || [];
  const identityOnlyAliases = new Set((registry.programs || []).filter((program) => {
    const profile = program.profiles?.["glp-clinic-scout"];
    return profile?.canonical_identity?.role === "alias"
      && profile?.surfaces?.review === false && profile?.surfaces?.sitemap === false;
  }).map((program) => program.program_id));
  const programs = (registry.programs || []).filter((program) => !identityOnlyAliases.has(program.program_id));
  for (const addition of additions) {
    if (!addition?.program_id || !addition?.display_name || !addition?.governance_source || addition?.commercial_facts_status !== "unbound") {
      throw new Error("phase3_provider_work_order_addition_invalid");
    }
    if (!identityOnlyAliases.has(addition.program_id)
      && !programs.some((program) => program.program_id === addition.program_id)) programs.push(addition);
  }
  if (new Set(programs.map((program) => program.program_id)).size !== programs.length) throw new Error("phase3_provider_work_order_duplicate");
  return { ...registry, programs };
}

function liveCanonicalProviderPrograms(registry) {
  const profileId = "glp-clinic-scout";
  const ledgerPrograms = [...PROGRAM_LEDGER_BY_ID.values()];
  const { aliasIds } = deriveIdentityGroups(registry, profileId, ledgerPrograms);
  return (registry.programs || [])
    .filter((program) => {
      const profile = program.profiles?.[profileId];
      return program.commercial_state === "live"
        && profile?.vertical_fit === true
        && profile?.wired === true
        && profile?.surfaces?.review === true
        && !aliasIds.has(program.program_id);
    })
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

export function providerComparisonCardCount(registry) {
  return liveCanonicalProviderPrograms(registry).filter((program) =>
    providerCardEligible(program.review_slug || program.program_id)
      || providerCardEligible(program.program_id)).length;
}

function providerHubControls(entries, doseCapture) {
  // Search owns this listing's eligible canonical cards, not the whole registry.
  const ids = entries.map((entry) => entry.program_id);
  if (ids.some((id) => !/^[a-z0-9-]+$/.test(id)) || new Set(ids).size !== ids.length
    || entries.some((entry) => !String(entry.provider || "").trim())) throw new Error("phase3_provider_search_identity_invalid");
  const options = entries.map((entry, index) => `<button type="button" role="option" id="p3-provider-option-${index}" data-program="${esc(entry.program_id)}" aria-selected="false" tabindex="-1">${esc(entry.provider)}</button>`).join("");
  const search = `<form data-provider-search data-canonical-provider-ids="${esc(ids.join(","))}"><label for="p3-provider-search">Provider<input id="p3-provider-search" name="provider" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="p3-provider-options" autocomplete="off"></label><button type="submit">Search providers</button><button type="button" data-provider-search-reset>Reset</button><div id="p3-provider-options" role="listbox" aria-label="Providers" hidden>${options}</div><p data-provider-search-empty role="status" hidden>No providers match your search.</p></form>`;
  const styles = '<style>[data-provider-search]{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:end;gap:8px;min-width:0}[data-provider-search] label{grid-column:1/-1;min-width:0}[data-provider-search] input{box-sizing:border-box;width:100%;min-width:0;min-height:44px}[data-provider-search] button{min-width:44px;min-height:44px}[data-provider-search] [role="listbox"],[data-provider-search-empty]{grid-column:1/-1;max-height:320px;overflow:auto}[data-provider-search] [role="option"]{display:block;width:100%;text-align:left}[data-provider-search] [hidden]{display:none!important}</style>';
  const prefix = '<div class="p3-filterbar" data-provider-filters>';
  const controls = providerHubControlsBase(entries, doseCapture);
  if (!controls.startsWith(prefix)) throw new Error("phase3_provider_search_filter_root_missing");
  return `${prefix}${styles}<noscript><style>[data-provider-search]{display:none!important}</style></noscript>${search}${controls.slice(prefix.length)}`;
}

function providerHubStateControl() {
  const stateOptions = STATES.map(([code, name]) => `<button type="button" role="option" data-state="${code}" aria-selected="false" tabindex="-1">${esc(name)}</button>`).join("");
  const nativeStateOptions = STATES.map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join("");
  return `<div class="p3-state-control"><button type="button" data-state-open aria-expanded="false" aria-haspopup="listbox" aria-controls="p3-state-options">State: <span data-state-label>Choose state</span></button><div class="p3-state-popover" role="group" aria-label="State search and choices" hidden><input type="search" aria-label="Search states" placeholder="Search states" data-state-search aria-controls="p3-state-options"><div class="p3-state-options" id="p3-state-options" role="listbox" aria-label="Choose state">${stateOptions}</div><p data-state-empty role="status" hidden>No states match your search.</p></div><label class="p3-state-native"><span class="p3-state-native-label">Native state selector</span><select data-state-native aria-label="Choose state (native selector)"><option value="">Choose state</option>${nativeStateOptions}</select></label></div>`;
}

function providerHubControlsBase(entries, doseCapture) {
  const doses = [...new Set(entries.flatMap((entry) => (entry.medications || []).flatMap((medication) => medication.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE" ? (medication.dose_pricing.tiers || []).map((row) => String(row.dose_mg)) : [])))].sort((left, right) => Number(left) - Number(right));
  const chips = (label, key, values) => filterChipGroup(label, key, values.map(([value, text], index) => ({ value, label: text, current: index === 0 })));
  return `<div class="p3-filterbar" data-provider-filters>${chips("Medication", "treatment", [["all", "All medications"], ["SEMAGLUTIDE", "Semaglutide"], ["TIRZEPATIDE", "Tirzepatide"], ["OZEMPIC", "Ozempic"], ["MOUNJARO", "Mounjaro"], ["WEGOVY", "Wegovy"], ["WEGOVY_PILL", "Wegovy Pill"], ["ZEPBOUND", "Zepbound"]])}${chips("Form", "type", [["all", "Both"], ["compounded", "Compounded"], ["brand", "Brand name"]])}${chips("Plan", "plan", [["both", "Any term"], ["1", "1 month"], ["3", "3 months"]])}<div class="p3-more-filters">${chips("Longer plan", "duration", [["all", "Any duration"], ["6", "6+ months"]])}${chips("Dose", "dose", [["all", "All doses"], ...doses.map((dose) => [dose, `${dose} mg/week`])])}</div>${chips("Sort", "sort", [["cheapest", "Cheapest first"]])}${providerHubStateControl()}</div>`;
}

function renderProviderListingHub(graph, pricingMatrix, registry, coupons, doseCapture, logoManifest, articles = []) {
  const seo = pageSeoCopy("/providers/");
  const priceEntries = new Map(Object.values(pricingMatrix.providers || {}).map((entry) => [entry.program_id, entry]));
  const entries = [...PROVIDER_FACTS_BY_ID.values()]
    .filter((research) => providerCardEligible(research.program_id))
    .map((research) => {
      const priced = priceEntries.get(research.program_id);
      return {
        ...(priced || {}),
        program_id: research.program_id,
        provider: research.display_name,
        medications: (priced?.medications || []).filter((row) => isTypedPrice(row) || Number.isFinite(row.ongoing_usd)),
      };
    })
    .sort((left, right) => {
      const price = (entry) => Math.min(...entry.medications
        .filter((row) => !isTypedPrice(row) && Number.isFinite(row.ongoing_usd) && row.ongoing_usd >= 0)
        .map((row) => row.ongoing_usd));
      const leftPrice = price(left);
      const rightPrice = price(right);
      return leftPrice === rightPrice ? left.program_id.localeCompare(right.program_id) : leftPrice - rightPrice;
    });
  const livePrograms = liveCanonicalProviderPrograms(registry);
  const initialVisible = 12;
  const revealBatchSize = PROVIDER_REVEAL_BATCH_SIZE;
  const deferredBodies = [];
  const cards = entries.map((entry, index) => {
    const fullCard = compactProviderCard(entry, registry, doseCapture, logoManifest, { coupon: coupons[entry.program_id], goSurface: { route: "/providers/", position: "provider-card" }, rankPosition: index + 1, initialHidden: index >= initialVisible });
    if (index < initialVisible) return fullCard;
    // W9 G02: every deferred card also ships inside <noscript>, so visitors without JavaScript
    // can browse all cards and their review links; with JavaScript the payload path is unchanged.
    const deferred = deferProviderCard(fullCard, entry, deferredBodies.length);
    deferredBodies.push(deferred.body);
    return deferred.placeholder;
  }).join("");
  const deferredPayload = JSON.stringify(deferredBodies).replaceAll("<", "\\u003c");

  const initialRemaining = Math.max(0, entries.length - initialVisible);
  const initialResult = initialRemaining ? `Showing ${initialVisible} of ${entries.length}` : `Showing ${entries.length}`;
  const initialLoadMoreCount = Math.min(revealBatchSize, initialRemaining);
  const initialLoadMoreLabel = `Show ${initialLoadMoreCount} more provider${initialLoadMoreCount === 1 ? "" : "s"}`;
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { label: "Providers" }])}<section class="p3-index-hero"><p class="gcs-kicker">Provider comparison</p><h1 data-state-heading data-state-title-template="Compare weight loss providers in {state}" data-state-product="weight loss">${esc(seo?.h1 ?? "Compare weight loss providers")}</h1><p class="lede">Each card below shows a program's published medications, monthly cost and cancellation terms, with the date we checked them against the provider's own pages.</p><p class="p3-registry-count" data-live-provider-count="${livePrograms.length}">${livePrograms.length} program profiles are listed in total. A profile appears as a card only when all three facts are verified; the other profiles keep their detail pages.</p><div class="p3-hero-actions p3-wrap-actions" data-wrap-actions><a class="cs-btn cs-palette-action" href="#provider-results">Compare providers</a><a class="cs-btn cs-btn--quiet" href="/quiz/provider-fit/">View your top picks</a></div></section>${sourceDisclosure()}${providerHubControls(entries, doseCapture)}<section id="provider-results" class="p3-provider-section" data-initial-visible="${initialVisible}"><div class="section-heading"><p class="gcs-kicker">Side-by-side comparison</p><h2>Compare providers on the same facts</h2><p>Every card shows the same three facts with a source link and a check date. A card appears only when all three are verified against the provider's published pages.</p></div><noscript><style>[data-provider-filters],[data-provider-load-more],[data-filter-result],[data-provider-lazy-placeholder],[data-filter-empty]{display:none!important}</style><p class="p3-filter-result">All ${entries.length} program cards are shown. Filters and sorting need JavaScript.</p></noscript><p class="p3-filter-result" data-filter-result aria-live="polite">${initialResult} program cards</p><div class="p3-provider-grid" data-phase3-provider-grid>${cards}</div><script type="application/json" data-provider-card-payloads>${deferredPayload}</script><button class="cs-btn cs-btn--quiet p3-load-more" type="button" data-provider-load-more${initialRemaining ? "" : " hidden"}>${initialLoadMoreLabel}</button><div class="p3-filter-empty" data-filter-empty hidden><h3>No evidence-qualified card matches those filters.</h3><p>Clear a filter. Filter absence is not a medical or availability conclusion.</p><button type="button" data-filter-reset>Reset filters</button></div></section>${renderPhase3RelatedInsightsShelf({ slug: "providers" }, articles)}${doseSelectionRuntime()}`;
  // The pricing ledger supplements, never replaces, the eligibility-bound program cards.
  // Its row/card IDs are independent of the provider filter/lazy-loading namespace.
  const finalRows = entries.flatMap((entry) => {
    const record = registryRecord(entry, registry);
    if (!record) throw new Error(`directory_pricing_registry_identity_missing:${entry.program_id}`);
    return entry.medications.map((price, index) => ({ program_id: entry.program_id, id: isTypedPrice(price) ? price.row_id : `${entry.program_id}:${index}`, provider: entry.provider, review: canonicalReviewPath(record, registry), price }));
  });
  const pricedProviderCount = new Set(finalRows.map((row) => row.program_id)).size;
  const priceLedger = `<section class="d3-directory-prices" data-directory-pricing data-directory-pricing-rows="${finalRows.length}" data-directory-pricing-provider-count="${pricedProviderCount}" aria-labelledby="directory-pricing-title"><h2 id="directory-pricing-title">Reported plan prices and billing terms</h2>${renderProgramCardCount(entries.length)}<p>${finalRows.length} reported medication and plan rows from ${pricedProviderCount} card-eligible providers. This is a pricing subset, not the total live-provider count. Filters below apply to program cards; this price ledger remains complete.</p>${renderDirectoryFinal(finalRows, (url) => renderCitationAnchor({ url, label: "Source", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE, rel: "noopener noreferrer" }).replace("<a ", "<a data-source-link "))}</section>`;
  const disclosureBoundary = `</div></section>${sourceDisclosure()}`;
  if (!body.includes(disclosureBoundary)) throw new Error("directory_hero_disclosure_boundary_changed");
  const finalsBody = finalsCss() + body.replace('<section class="p3-index-hero">', '<section class="p3-index-hero d3-directory-hero">').replace(disclosureBoundary, `${sourceDisclosure()}</div></section><section class="section-heading" aria-labelledby="g08-category-links-title"><h2 id="g08-category-links-title">Explore compounded medication categories</h2><div class="p3-hero-actions p3-wrap-actions"><a class="cs-btn cs-btn--quiet" href="/semaglutide/">Compounded semaglutide programs</a><a class="cs-btn cs-btn--quiet" href="/tirzepatide/">Compounded tirzepatide programs</a></div></section>${priceLedger}`);
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4): honest hub
  // markup — BreadcrumbList mirroring the visible trail. No ratings.
  const schema = pageSchemaGraph(
    breadcrumbSchema("/providers/", [{ href: "/", label: "Home" }, { label: "Providers" }]),
    providerItemListSchema(
      "/providers/",
      "GLP-1 provider comparison",
      entries,
      registry,
    ),
  );
  return pageDocument({ route: "/providers/", title: seo?.title ?? "Compare GLP-1 providers · Clinic Scout", description: seo?.meta ?? "Compare GLP-1 providers on the medications they offer, monthly cost and cancellation terms, each with its source and check date.", body: finalsBody, schema });
}

function renderProvidersHub(graph, pricingMatrix, registry, logoManifest, coupons, doseCapture, articles = []) {
  const seo = pageSeoCopy("/providers/");
  const html=renderProviderListingHub(graph, pricingMatrix, registry, coupons, doseCapture, logoManifest, articles);
  const limited=liveCanonicalProviderPrograms(registry).filter(p=>!providerCardEligible(p.review_slug||p.program_id)).map(p=>{const id=p.review_slug||p.program_id;return {id,label:p.display_name,review_path:p.review_path||`/reviews/${id}/`,entry:pricingMatrix.providers[id]};});
  return limited.length?html.replace('</main>',renderPriceStateComparison(limited)+'</main>'):html;
  const sourceRows = Object.values(pricingMatrix.providers || {}).filter((entry) => (entry.medications || []).some((row) => Number.isFinite(row.ongoing_usd))).length;
  const brand = graph.brand_pages.map((page) => `<a class="cs-card p3-intent-card" href="${esc(page.route)}"><p class="gcs-kicker">Brand route</p><h2>${esc(page.name)}</h2><p>${esc(page.ingredient)} provider pathways and dated price rows.</p></a>`).join("");
  const compounded = graph.compounded_pages.map((page) => `<a class="cs-card p3-intent-card" href="${esc(page.route)}"><p class="gcs-kicker">Compounded route</p><h2>${esc(page.name)}</h2><p>Full filters, source dates, and explicit gaps.</p></a>`).join("");
  const details = (registry.programs || []).slice().sort((left, right) => left.display_name.localeCompare(right.display_name)).map((program) => `<a class="cs-card p3-intent-card" data-provider-record="${esc(program.program_id)}" href="/providers/${esc(program.program_id)}/"><p class="gcs-kicker">Provider record</p>${providerIdentity({ program_id: program.program_id, provider: program.display_name }, logoManifest, 2)}<p>${program.commercial_facts_status === "unbound" ? "Identity is governed; price, product, state, and service facts remain unbound in this candidate." : "Open source-dated price rows and the evidence boundary for this program."}</p></a>`).join("");
  return pageDocument({ route: "/providers/", title: seo?.title ?? "GLP-1 provider paths · Clinic Scout", description: seo?.meta ?? "Choose a brand, compounded medication, multi-month intent, or provider record before comparing source-dated rows.", body: `${breadcrumbs([{ href: "/", label: "Home" }, { label: "Providers" }])}<section class="p3-index-hero"><p class="gcs-kicker">Provider directory</p><h1>${esc(seo?.h1 ?? "Start with the path you are actually comparing.")}</h1><p class="lede">${sourceRows} provider records currently contain at least one source-dated price. Pick a medication or plan intent; missing evidence stays visible.</p></section><section><div class="section-heading"><h2>Brand product paths</h2></div><div class="p3-intent-grid">${brand}</div></section><section><div class="section-heading"><h2>Compounded category paths</h2></div><div class="p3-intent-grid">${compounded}</div></section><section><div class="section-heading"><h2>Providers</h2></div><div class="p3-intent-grid">${details}</div></section><section class="p3-selfpay-cta"><div><h2>Comparing plan length?</h2><p>Open the dedicated three-month and longer-term routes.</p></div><a class="cs-btn cs-palette-action" href="/bulk/">Browse multi-month plans</a></section>` });
}

function pricingEntryForProgram(programId, pricingMatrix) {
  return Object.values(pricingMatrix.providers || {}).find((entry) => entry.program_id === programId) || null;
}

// ---------------------------------------------------------------------------
// GLPWinner-emulation provider detail (PAGE-SPECS-20260826/provider-pharmacy
// spec §1/§5 F1+F2+F6, DESIGN-PASS-WORK-ORDER A7/A8): two-track desktop layout
// with a sticky conversion rail, a plan-card grid ("Treatments") instead of the
// single collapsed pricing card, and empty states compressed into modules.
// Honesty contracts unchanged: unpublished dose prices stay "Not published",
// no ratings are fabricated, and every displayed amount keeps its capture
// date, quote, and source link. The affiliate CTA string is built once and
// reused byte-identically in hero, rail, and mobile action bar.
// ---------------------------------------------------------------------------
function medicationMolecule(medicationId) {
  const id = String(medicationId || "").toLowerCase();
  return /tirzepatide|mounjaro|zepbound/.test(id) ? "tirzepatide" : "semaglutide";
}

function planAccent(medicationId) {
  if (medicationToken(medicationId) === "WEGOVY_PILL") return "oral";
  if (medicationForm(medicationId) === "BRAND_NAME") return "brand";
  return medicationMolecule(medicationId);
}

function providerPlanSection(priced, doseCapture, coupon, { heroFirst = false } = {}) {
  const anchorFor = (index) => `plan-${priced.program_id}-${index}`;
  const groups = new Map();
  priced.medications.forEach((row, index) => {
    const molecule = medicationMolecule(row.medication_id);
    if (!groups.has(molecule)) groups.set(molecule, { count: 0, anchor: anchorFor(index) });
    groups.get(molecule).count += 1;
  });
  const jumps = [...groups.entries()].map(([molecule, info]) => `<a class="cs-btn cs-btn--quiet p3-plan-jump p3-plan-jump--${molecule}" href="#${info.anchor}">${molecule.charAt(0).toUpperCase()}${molecule.slice(1)} (${info.count})</a>`).join("");
  const cards = priced.medications.map((row, index) => {
    const accent = planAccent(row.medication_id);
    const cadence = esc(row.cadence || "Cadence not stated");
    const cadencePill = isTypedPrice(row) ? "Reported billing terms" : row.cadence === "month" ? "Monthly" : cadence;

    const prices = heroFirst && index === 0 ? '<a class="p3-card-link" href="#provider-reported-prices">Reported plan prices and billing terms are shown above</a>' : renderPricePair(row, (url) => renderCitationAnchor({ url, label: "Source", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE, rel: "noopener noreferrer" }));
    return `<article class="p3-plan-card p3-plan-card--${accent}" id="${anchorFor(index)}" data-plan-card data-plan-row-id="${esc(row.row_id || anchorFor(index))}" data-medication="${esc(row.medication_id)}">${index === 0 ? finalsCss() : ""}<div class="d3-detail-hero"><header class="p3-plan-title"><span class="p3-plan-pill">${cadencePill}</span><h3>${esc(priced.provider)} · ${esc(row.label)}</h3></header>${prices}</div>${isTypedPrice(row) ? "" : renderDosePricing(priced, doseCapture, index, { open: true, ladderHeader: true, absentNote: true })}</article>`;
  }).join("");
  return `<section class="p3-provider-section p3-plans" aria-labelledby="plans-${esc(priced.program_id)}" data-provider-plans><div class="p3-plan-head"><div><p class="gcs-kicker">Medication and plan pricing</p><h2 id="plans-${esc(priced.program_id)}">Treatments</h2></div>${jumps ? `<nav class="p3-plan-jumps" aria-label="Jump to a medication plan">${jumps}</nav>` : ""}</div><p class="p3-plan-note">Dates, quotes, and source links stay attached to every displayed amount. Exact dose tiers appear only when the provider publishes source-reported per-dose pricing; otherwise the dose grid is omitted.</p>${renderCouponChip(coupon)}<div class="p3-plan-grid" data-plan-grid>${cards}</div></section>`;
}

function renderProviderDetailComplete(program, pricingMatrix, registry, coupons, doseCapture, logoManifest, pharmacyEntries) {
  const entry = pricingEntryForProgram(program.program_id, pricingMatrix);
  const priced = entry ? { ...entry, medications: (entry.medications || []).filter((row) => isTypedPrice(row) || Number.isFinite(row.ongoing_usd)) } : null;
  const ledger = PROGRAM_LEDGER_BY_ID.get(program.program_id) || null;
  const route = `/providers/${program.program_id}/`;
  const reviewPath = canonicalReviewPath(program, registry);
  const affiliate = COMPARE_AFFILIATE_MAP[program.program_id];
  const selected = selectedGoOutbound(program, 'providers.rv1');
  const affiliateAttrs = affiliate?.live ? subidAttributes({ programId: program.program_id, network: affiliate.network, href: affiliate.affiliate_href, position: "intro", rankPosition: 0, pageSlug: `provider-${program.program_id}`, pageType: "provider-detail", providerSlug: program.program_id }) : "";
  const getStarted = affiliate?.live && affiliate.affiliate_href
    ? `<a class="cs-btn cs-palette-action" href="${esc(selected?.href || affiliate.affiliate_href)}" rel="sponsored noopener nofollow" data-analytics-event="affiliate_click" data-program="${esc(program.program_id)}" ${selected?.href ? 'data-link-mode="server-redirect" data-funnel-v2-go data-subid="providers.rv1" data-variant="a"' : 'data-link-mode="transparent-direct"'} ${affiliateAttrs}>Get started</a>`
    : '<p class="p3-unavailable-action" data-affiliate-unavailable><strong>Enrollment link pending verification</strong><span>No destination appears until Clinic Scout verifies it.</span></p>';
  const fact = (label, value, source = null) => {
    const published = String(value ?? "").trim();
    if (!published || published === "UNKNOWN_NO_SOURCE") return "";
    return `<article class="cs-card"><p class="gcs-kicker">${esc(label)}</p><p>${esc(published)}</p>${source?.source_url ? `<small>${renderCitationAnchor({ url: source.source_url, label: `View ${label.toLowerCase()} source`, reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "noopener noreferrer" })}${source.verified_as_of ? ` · checked ${esc(source.verified_as_of)}` : ""}</small>` : ""}</article>`;
  };
  const relationships = (pharmacyEntries || []).flatMap((pharmacy) => verifiedPharmacyRelationships(pharmacy).filter((relationship) => relationship.program_id === program.program_id).map((relationship) => ({ pharmacy, relationship })));
  const relationshipRows = relationships.length
    ? relationships.map(({ pharmacy, relationship }) => `<article class="p3-rail-row"><h3><a href="${esc(pharmacy.route)}">${esc(pharmacy.display_name)}</a></h3><p>${esc(relationship.summary)}</p><small>${renderCitationAnchor({ url: relationship.source_url, label: "Relationship source", reason: CITATION_REASONS.COMPARISON_SOURCE_LEDGER, rel: "noopener noreferrer" })} · checked ${esc(relationship.verified_as_of || "date not stated")}</small></article>`).join("")
    : '<p class="p3-rail-empty">No provider-to-pharmacy relationship is verified in the bound source set.</p>';
  const medicationIds = new Set(priced?.medications?.map((row) => row.medication_id) || []);
  const related = Object.values(pricingMatrix.providers || {}).filter((candidate) => candidate.program_id !== program.program_id && (candidate.medications || []).some((row) => medicationIds.has(row.medication_id) && Number.isFinite(row.ongoing_usd))).sort((left, right) => left.provider.localeCompare(right.provider)).slice(0, 3);
  const relatedRows = related.length
    ? related.map((candidate) => `<a class="p3-rail-row p3-rail-row--link" href="/providers/${esc(candidate.program_id)}/"><strong>${esc(candidate.provider)}</strong><span>Shares at least one source-priced medication row with ${esc(program.display_name)}.</span></a>`).join("")
    : '<p class="p3-rail-empty">No dedicated source-fact comparison is available for this record.</p>';
  const coverage = providerStateCoverage(ledger);
  const limitations = (ledger?.limitations || []).map((item) => `<li>${esc(item)}</li>`).join("");
  const reviewAction = `/reviews/submit/?entity=${encodeURIComponent(program.display_name)}&amp;type=provider`;
  const latestChecked = priced?.medications?.length ? priced.medications.flatMap((row) => isTypedPrice(row) ? [...(row.evidence || []), ...(row.identity_evidence || []), ...Object.values(row.facts || {}).flatMap((fact) => fact.evidence || [])].map((w) => String(w.captured_at_utc || "").slice(0, 10)) : [String(row.captured_on || "")]).sort().at(-1) : "";
  const sticky = `<aside class="p3-provider-sticky p3-wrap-actions" data-provider-sticky data-program="${esc(program.program_id)}" data-wrap-actions aria-label="${esc(program.display_name)} actions"><span data-wrap-text><small>${latestChecked ? `Price checked ${esc(latestChecked)}` : "Provider record"}</small><strong>${esc(program.display_name)}</strong></span>${getStarted}<a class="cs-btn cs-btn--quiet" href="/quiz/provider-fit/?source=provider-sticky&amp;provider=${esc(program.program_id)}" data-provider-sticky-primary>Check fit</a></aside>`;
  const plans = priced?.medications?.length
    ? providerPlanSection(priced, doseCapture, coupons[program.program_id] || null, { heroFirst: true })
    : '<section class="p3-provider-section p3-plans"><div class="p3-plan-head"><div><p class="gcs-kicker">Medication and plan pricing</p><h2>Treatments</h2></div></div><div class="p3-empty"><h3>No current source-dated price row is bound.</h3><p>Clinic Scout does not estimate the missing amount.</p></div></section>';
  let railPills = "";
  if (priced?.medications?.length) {
    const medicationLabels = [...new Set(priced.medications.map((row) => row.label))];
    const hasExactDoseTiers = priced.medications.some((row) => row.dose_pricing?.status === "SOURCE_REPORTED_PER_DOSE" && row.dose_pricing.render_action === "RENDER");
    const detailLabels = hasExactDoseTiers ? [...medicationLabels, "Exact source-reported dose tiers"] : medicationLabels;
    railPills = `<div class="p3-rail-card"><h2>Provider details</h2><div class="p3-feature-chips p3-wrap-cluster" data-wrap-chips aria-label="Published provider facts">${detailLabels.map((label) => `<span>${esc(label)}</span>`).join("")}</div></div>`;
  } else {
    railPills = `<div class="p3-rail-card"><h2>Provider details</h2><p class="p3-rail-empty">${esc(program.commercial_facts_status === "unbound" ? "Identity is governed; product, price, and availability facts remain unbound in this candidate." : "Published card facts are not bound for this record.")}</p></div>`;
  }
  const evidenceState = latestChecked
    ? `Price rows checked <time datetime="${esc(latestChecked)}">${esc(latestChecked)}</time> · ${priced.medications.length} source-dated row${priced.medications.length === 1 ? "" : "s"}`
    : "No source-dated price row is bound.";
  const rail = `<aside class="p3-detail-rail" data-provider-rail aria-label="${esc(program.display_name)} evidence and actions"><div class="p3-rail-card p3-rail-card--cta"><div class="p3-rail-identity p3-provider-identity">${providerLogoMark({ program_id: program.program_id, provider: program.display_name }, logoManifest)}<p><strong>${esc(program.display_name)}</strong><small>Source-bound provider record</small></p></div><p class="p3-rail-evidence">${evidenceState}</p>${getStarted}<a class="cs-btn cs-btn--quiet" href="/quiz/provider-fit/?provider=${esc(program.program_id)}">Check my fit</a></div>${railPills}<div class="p3-rail-card"><h2>Verified pharmacy relationships</h2><p class="p3-rail-note">Only explicit provider-to-pharmacy source facts create a relationship card.</p>${relationshipRows}<a class="cs-arrowlink" href="/pharmacies/">Browse compounding pharmacies <span class="cs-arrow" aria-hidden="true">→</span></a></div><div class="p3-rail-card"><h2>Related providers</h2><p class="p3-rail-note">Shown only when a shared source-priced medication row exists.</p>${relatedRows}<a class="cs-arrowlink" href="/providers/?sort=cheapest">Browse all providers <span class="cs-arrow" aria-hidden="true">→</span></a></div></aside>`;
  const glance = `<section aria-labelledby="glance-${esc(program.program_id)}"><div class="section-heading"><h2 id="glance-${esc(program.program_id)}">At a glance</h2><p>Unknown is kept separate from a verified negative.</p></div><div class="p3-intent-grid p3-glance-grid">${fact("Medication paths", ledger?.meds_offered)}${fact("Insurance", ledger?.insurance)}${fact("Consultation or membership", ledger?.research_consultation_fee?.value, ledger?.research_consultation_fee)}${fact("Shipping or timing", ledger?.research_shipping_wait?.value || ledger?.average_wait, ledger?.research_shipping_wait)}${fact("Cancellation", ledger?.research_cancellation?.value, ledger?.research_cancellation)}${fact("State evidence", coverage.summary, ledger?.research_states_served)}</div></section>`;
  const tradeoffs = `<section class="p3-detail-grid"><article><h2>Editorial tradeoffs</h2><p><strong>Useful for comparing:</strong> ${esc(ledger?.best_for || "Not published.")}</p><h3>Limitations in the record</h3>${limitations ? `<ul>${limitations}</ul>` : "<p>No editorial limitations are bound to this profile.</p>"}</article><article><h2>Feature evidence and unknowns</h2><p>${esc(ledger?.average_wait || "Care timing is not stated.")}</p><p>${esc(ledger?.research_pharmacy_type?.value || "Dispensing-pharmacy type is not established in the bound research.")}</p></article></section>`;
  const reviews = `<section class="p3-reviews-module" aria-labelledby="reviews-${esc(program.program_id)}"><div class="p3-reviews-head"><h2 id="reviews-${esc(program.program_id)}">Clinic Scout patient reviews</h2><a class="cs-btn cs-btn--quiet" href="${reviewAction}">Share your experience</a></div><p class="p3-review-empty-line">No Clinic Scout patient reviews are published for this provider. Submissions are checked before publication.</p></section>`;
  const methodology = `<section class="p3-related-provider-records" aria-label="Related provider records"><h2>Related provider records</h2><p>Shown only when a shared source-priced medication row exists; this is not a medical recommendation.</p>${relatedRows}</section>` + '<section class="p3-evidence-boundary"><h2>Methodology and evidence boundary</h2><p>Provider names and links come from our reviewed provider list. Prices come from our dated price records; each price links to the source it was taken from, with the date we checked it. Program facts come from our reviewed notes on those dated sources. Clinic Scout does not infer availability, medical fit, ratings, or review counts.</p><a href="/how-we-make-money/">Affiliate and ranking methodology</a></section>';
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: program.display_name }])}<a class="p3-card-link" data-provider-context-back href="/providers/?sort=cheapest">← Back to provider comparison</a>${sourceDisclosure()}<section class="p3-index-hero"><p class="gcs-kicker">Provider profile · source-bound facts</p>${providerIdentity({ program_id: program.program_id, provider: program.display_name }, logoManifest, 1)}<p class="lede">${esc(ledger?.best_for || "Clinic Scout has not published a best-for summary for this provider.")}</p><div class="p3-hero-actions p3-wrap-actions" data-wrap-actions>${getStarted}${reviewPath ? `<a class="cs-btn cs-btn--quiet" href="${esc(reviewPath)}">Read editorial evidence</a>` : ""}</div></section><div class="p3-detail-layout" data-detail-layout><div class="p3-detail-main">${plans}${glance}${tradeoffs}${reviews}${methodology}</div>${rail}</div>${sticky}`;
  let finalsBody = body;
  if (priced?.medications?.length) {
    const firstPlan = priced.medications[0];
    const heroPrices = `<div class="d3-hero-prices" id="provider-reported-prices" data-primary-plan="${esc(firstPlan.row_id || firstPlan.medication_id)}"><p>First source-listed plan: ${esc(firstPlan.label)}. Other published plans appear below; this is not a lowest-price ranking.</p>${renderPricePair(firstPlan, (url) => renderCitationAnchor({ url, label: "Source", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE, rel: "noopener noreferrer" }))}</div>`;
    const heroBoundary = '</section><div class="p3-detail-layout"';
    if (!body.includes(heroBoundary)) throw new Error("provider_detail_hero_boundary_changed");
    finalsBody = finalsCss() + body.replace('<section class="p3-index-hero">', '<section class="p3-index-hero d3-profile-hero">').replace('</h1>', ` · ${esc(firstPlan.label)}</h1>`).replace(heroBoundary, `${heroPrices}${heroBoundary}`);
  }
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4): provider
  // records get BreadcrumbList always, and a Product node with Offers ONLY when
  // a live source-dated price row is bound (the same rows the Treatments
  // section renders, each carrying capture date + source on-page). Records
  // without a bound price get no Product — a missing price is never estimated.
  // No aggregateRating, no availability claims, nothing invented.
  const description = `Source-bound pricing, program facts, tradeoffs, pharmacy relationships, and explicit unknowns for ${program.display_name}.`;
  const schema = pageSchemaGraph(
    breadcrumbSchema(route, [{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: program.display_name }]),
    priced?.medications?.length ? {
      "@type": "Product",
      "@id": `${canonical(route)}#product`,
      name: program.display_name,
      description,
      url: canonical(route),
      offers: priced.medications.filter((row) => !isTypedPrice(row)).map((row) => ({
        "@type": "Offer",
        name: row.label,
        price: row.ongoing_usd,
        priceCurrency: "USD",
        url: canonical(route),
      })),
    } : null,
  );
  return pageDocument({ route, title: `${program.display_name}: source-dated program details · Clinic Scout`, description, body: finalsBody, schema, mainClass: "p3-page p3-detail-page" });
}

function renderProviderDetail(program, pricingMatrix, registry, coupons, doseCapture, logoManifest, pharmacyEntries = []) {
  // WS-A-004 F02. Test: tests/ws-a-004-provider-detail.test.mjs. Blast radius:
  // provider-detail source only; rendered output should remain unchanged.
  return renderProviderDetailComplete(program, pricingMatrix, registry, coupons, doseCapture, logoManifest, pharmacyEntries);
}

function renderSelfPay(graph, pricingMatrix, registry, coupons, doseCapture, logoManifest, articles) {
  const entries = Object.values(pricingMatrix.providers || {}).filter((entry) => (entry.medications || []).some((row) => Number.isFinite(row.ongoing_usd))).sort((a, b) => Math.min(...a.medications.filter((row) => Number.isFinite(row.ongoing_usd)).map((row) => row.ongoing_usd)) - Math.min(...b.medications.filter((row) => Number.isFinite(row.ongoing_usd)).map((row) => row.ongoing_usd)) || a.provider.localeCompare(b.provider));
  const cards = entries.map((entry) => compactProviderCard({ ...entry, medications: entry.medications.filter((row) => Number.isFinite(row.ongoing_usd)).slice(0, 3) }, registry, doseCapture, logoManifest, { coupon: coupons[entry.program_id] })).join("");
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { label: "Self-pay" }])}<section class="p3-index-hero"><p class="gcs-kicker">Self-pay comparison</p><h1 class="p3-wrap-title" data-wrap-text>Normalize the bill before you compare the number.</h1><p class="lede">Every displayed price comes from the provider's bound page capture. It may not include the same medication, service scope, term, or renewal.</p></section>${productSelector(graph)}${sourceDisclosure()}${medicationTabs(graph, "")}<section class="p3-provider-section" data-self-pay-options data-three-column-results><div class="section-heading"><h2>Three lowest captured starting rows</h2><p>Ordered only by the comparable ongoing amount in the bound capture. This is not a quality ranking, recommendation, availability claim, or universal cash price.</p></div><div class="p3-provider-grid">${cards || '<div class="p3-empty"><h3>No self-pay amount is published.</h3><p>Clinic Scout does not estimate a missing price.</p></div>'}</div></section>${renderPhase3RelatedInsightsShelf({ slug: "self-pay" }, articles)}`;
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4).
  const schema = pageSchemaGraph(breadcrumbSchema("/self-pay/", [{ href: "/", label: "Home" }, { label: "Self-pay" }]));
  return pageDocument({ route: "/self-pay/", title: "Self-pay GLP-1 price paths · Clinic Scout", description: "Compare source-dated self-pay provider prices and what each captured row does and does not establish.", body: body.replace("Three lowest captured starting rows", `${entries.length} captured starting rows`), schema });
}

function articleImageStem(article) {
  const slug = String(article.canonical_path || "").split("/").filter(Boolean).at(-1);
  return `/assets/images/guide-${slug}`;
}

function articlePicture(article, { loading = "lazy", fetchPriority = "auto", className = "" } = {}) {
  const stem = articleImageStem(article);
  const title = article.h1 || article.title || "Clinic Scout source-checked guide";
  return `<picture${className ? ` class="${esc(className)}"` : ""}><source srcset="${esc(stem)}-800.avif 800w, ${esc(stem)}-1600.avif 1600w" sizes="(max-width:768px) calc(100vw - 24px), 620px" type="image/avif"><source srcset="${esc(stem)}-800.webp 800w, ${esc(stem)}-1600.webp 1600w" sizes="(max-width:768px) calc(100vw - 24px), 620px" type="image/webp"><img src="${esc(stem)}-1600.jpg" srcset="${esc(stem)}-800.jpg 800w, ${esc(stem)}-1600.jpg 1600w" sizes="(max-width:768px) calc(100vw - 24px), 620px" width="1600" height="900" alt="Editorial art for ${esc(title)}" loading="${esc(loading)}" decoding="async" fetchpriority="${esc(fetchPriority)}"></picture>`;
}

function insightPageRoute(pageNumber) {
  return pageNumber === 1 ? "/insights/" : `/insights/page/${pageNumber}/`;
}

function renderInsightsPagination(pageNumber, totalPages) {
  const visible = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : [...new Set([1, totalPages, pageNumber - 1, pageNumber, pageNumber + 1].filter((value) => value >= 1 && value <= totalPages))].sort((left, right) => left - right);
  const numbered = [];
  for (let index = 0; index < visible.length; index += 1) {
    const value = visible[index];
    if (index > 0 && value - visible[index - 1] > 1) numbered.push('<span class="p3-pagination-gap" aria-hidden="true">…</span>');
    numbered.push(value === pageNumber
      ? `<span class="p3-pagination-page" aria-current="page">${value}</span>`
      : `<a class="p3-pagination-page" href="${esc(insightPageRoute(value))}" aria-label="Insights page ${value}">${value}</a>`);
  }
  const previous = pageNumber > 1
    ? `<a rel="prev" href="${esc(insightPageRoute(pageNumber - 1))}">Previous</a>`
    : '<span aria-disabled="true">Previous</span>';
  const next = pageNumber < totalPages
    ? `<a rel="next" href="${esc(insightPageRoute(pageNumber + 1))}">Next</a>`
    : '<span aria-disabled="true">Next</span>';
  return `<nav class="p3-pagination" data-stable-pagination aria-label="Insights pages">${previous}<span class="p3-pagination-pages">${numbered.join("")}</span>${next}<span class="p3-pagination-status">Page ${pageNumber} of ${totalPages}</span></nav>`;
}

// GLPWinner-emulation index (PAGE-SPECS-20260826/insights spec.md §1 + §4):
// compact title row (small gradient glyph + "Insights" + Subscribe pill + one
// dek line), then featured card (text LEFT ~35%, photo RIGHT edge-to-edge),
// then 3-up photo-top rows. No breadcrumbs, no per-card eyebrows, deks come
// from the short meta description first and get line-clamped in CSS
// (40-editorial.css, .cs-ins-index scope). Structural markers pinned by
// tests are preserved verbatim: class="p3-insights-hero", data-subscribe-open,
// data-insight-cycle, data-insights-feature, data-insights-supporting-row,
// class="cs-card p3-story", class="p3-pagination".
export function renderPhase3InsightsPage(articles, pageNumber = 1, pageSize = 12) {
  const totalPages = Math.max(1, Math.ceil(articles.length / pageSize));
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) throw new Error(`phase3_insights_page_invalid:${pageNumber}:${totalPages}`);
  const start = (pageNumber - 1) * pageSize;
  const current = articles.slice(start, start + pageSize);
  const cycles = [];
  for (let index = 0; index < current.length; index += 4) {
    const group = current.slice(index, index + 4);
    const featured = group[0];
    if (!featured) continue;
    const supporting = group.slice(1).map((article) => `<a class="cs-card p3-story" data-wrap-card href="${esc(article.canonical_path)}">${articlePicture(article, { className: "p3-story-picture" })}<h3 class="p3-wrap-title" data-wrap-text>${esc(article.h1 || article.title)}</h3><p>${esc(article.meta_description || article.direct_answer || "Source-checked Clinic Scout research.")}</p></a>`).join("");
    cycles.push(`<section class="p3-insight-cycle" data-insight-cycle><a class="p3-feature-story" data-insights-feature data-wrap-card href="${esc(featured.canonical_path)}"><div><h2 class="p3-wrap-title" data-wrap-text>${esc(featured.h1 || featured.title)}</h2><p>${esc(featured.meta_description || featured.direct_answer || "Open the source-checked guide.")}</p></div>${articlePicture(featured, { loading: index ? "lazy" : "eager", fetchPriority: index ? "auto" : "high", className: "p3-story-picture" })}</a><div class="p3-story-grid" data-insights-supporting-row>${supporting}</div></section>`);
  }
  const route = insightPageRoute(pageNumber);
  const empty = cycles.length ? "" : '<div class="p3-empty"><h2>No Insights article is published for this page.</h2><p>Clinic Scout does not invent an article destination.</p></div>';
  const pagination = renderInsightsPagination(pageNumber, totalPages);
  const pageTitle = `${pageNumber === 1 ? "GLP-1 insights" : `GLP-1 insights, page ${pageNumber}`} · Clinic Scout`;
  const pageDescription = "Source-checked GLP-1 guides on pricing, product status, insurance, safety verification, and provider terms.";
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4): the Insights
  // hub is the live editorial index — mark it CollectionPage + BreadcrumbList.
  const schema = pageSchemaGraph(
    breadcrumbSchema(route, pageNumber === 1
      ? [{ href: "/", label: "Home" }, { label: "Insights" }]
      : [{ href: "/", label: "Home" }, { href: "/insights/", label: "Insights" }, { label: `Page ${pageNumber}` }]),
    { "@type": "CollectionPage", "@id": canonical(route), name: pageTitle, description: pageDescription, url: canonical(route) },
  );
  return pageDocument({ route, title: pageTitle, description: pageDescription, schema, mainClass: "p3-page cs-ins-index", body: `<section class="p3-insights-hero"><div class="cs-ins-head"><div class="cs-ins-head-row"><h1 class="p3-wrap-title" data-wrap-text><span class="cs-ins-glyph" aria-hidden="true"></span>Insights</h1><button class="cs-btn cs-palette-action" type="button" data-subscribe-open><svg class="cs-subscribe-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg>Subscribe</button></div><p class="lede">Understand your options, compare costs, and get more from your next appointment.</p></div></section>${cycles.join("")}${empty}${pagination}` });
}

const renderInsightsPage = renderPhase3InsightsPage;

function pharmacyClass(entry, key) {
  const value = entry.classification?.[key]?.value;
  return value === true ? key.replace("section_", "") : "";
}
function pharmacyStates(entry) {
  return (entry.states_served?.regulator_verified || []).map((row) => String(row.state || "").trim()).filter(Boolean);
}
const PHARMACY_ADDITIVES = Object.freeze([
  ["vitamin-b12", "Vitamin B12", /(?:vitamin\s*)?B12\b/i],
  ["cyanocobalamin", "Cyanocobalamin", /cyanocobalamin/i],
  ["niacinamide", "Niacinamide", /niacinamide/i],
  ["glycine", "Glycine", /glycine/i],
  ["pyridoxine", "Pyridoxine (B6)", /pyridoxine|vit(?:amin)?\s*B6\b/i],
  ["vitamin-b3", "Vitamin B3", /vit(?:amin)?\s*B3\b/i],
]);

function pharmacyAdditives(entry) {
  const evidence = [entry.glp1_relevance?.semaglutide?.evidence, entry.glp1_relevance?.tirzepatide?.evidence].filter(Boolean).join(" ");
  return PHARMACY_ADDITIVES.filter(([, , pattern]) => pattern.test(evidence)).map(([value, label]) => ({ value, label }));
}

// GLPWinner-emulation pharmacy hub card (PAGE-SPECS-20260826/provider-pharmacy
// §2/§5 F5): chip grammar instead of empty-state prose. Honesty distinctions
// stay visible — a captured additive chip, a muted "evidence not captured"
// chip, and an unverified state footprint are three different renders. All
// data-* filter attributes are unchanged (site.js hub runtime contract).
function pharmacyStatusLabel(status) {
  const value = String(status || "");
  if (value === "partial_identity_blocked" || value === "partial_identity_unresolved") return "Identity under review";
  if (!value || value.startsWith("partial")) return "";
  return value.replaceAll("_", " ");
}

function pharmacyLocationText(item) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  return String(item.address || [item.city, item.state].filter(Boolean).join(", ") || "").trim();
}

function pharmacyCardEligible(entry) {
  const location = (entry.locations?.items || []).map(pharmacyLocationText).find(Boolean);
  const service = (entry.services?.items || []).map((item) => String(item || "").trim()).find(Boolean);
  const evidence = entry.evidence_summary || {};
  return entry.locations?.status === "source_backed"
    && entry.services?.status === "source_backed"
    && Boolean(location && service && evidence.citation_count && evidence.source_classes?.length && evidence.last_researched_date);
}

function pharmacyFactSource(entry, text) {
  const terms = String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  return (entry.citation_ledger || []).find((source) => terms.some((term) => String(source.quote || "").toLowerCase().includes(term)))
    || (entry.citation_ledger || [])[0]
    || null;
}

function pharmacySourceMeta(entry, source) {
  const checked = source?.accessed_date || entry.evidence_summary.last_researched_date;
  return `<small><span class="p3-provenance">Reported information</span> · checked <time datetime="${esc(checked)}">${esc(checked)}</time>${source?.url ? ` · ${renderCitationAnchor({ url: source.url, label: "Source", reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "noopener noreferrer" })}` : ""}</small>`;
}

function pharmacyCard(entry) {
  const tags = [pharmacyClass(entry, "section_503a"), pharmacyClass(entry, "section_503b")].filter(Boolean);
  const meds = [entry.glp1_relevance?.semaglutide?.relevant === true ? "Semaglutide" : "", entry.glp1_relevance?.tirzepatide?.relevant === true ? "Tirzepatide" : ""].filter(Boolean);
  const states = pharmacyStates(entry);
  const additives = pharmacyAdditives(entry);
  const location = (entry.locations.items || []).map(pharmacyLocationText).find(Boolean);
  const services = (entry.services.items || []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 2).join(" · ");
  return `<a href="${esc(entry.route)}" class="cs-card p3-pharmacy-card" data-pharmacy-card data-wrap-card data-classification="${esc(tags.join(" ") || "unverified")}" data-medications="${esc(meds.join(" ").toLowerCase() || "unverified")}" data-additives="${esc(additives.map((item) => item.value).join(" ") || "unverified")}" data-states="${esc(states.join("|").toLowerCase())}" data-name="${esc(entry.display_name.toLowerCase())}"><div class="p3-pharmacy-mark" aria-hidden="true">${esc(entry.display_name.slice(0, 1))}</div><div><h2 class="p3-wrap-title" data-wrap-text>${esc(entry.display_name)}</h2><dl class="p3-pharmacy-facts" data-pharmacy-card-contract="option-c"><div><dt>Location</dt><dd>${esc(location)}</dd></div><div><dt>Services</dt><dd>${esc(services)}</dd></div></dl><p class="p3-card-evidence-line">View profile and sources →</p></div></a>`;
}

function pharmacyAdditiveRuntime() {
  return `<script data-phase3-pharmacy-additive-runtime>(()=>{const root=document.currentScript.closest("main");if(!root)return;const cardSelector="[data-"+"pharmacy-card]";const apply=()=>{const select=root.querySelector("[data-pharmacy-additive]");if(!select)return;const value=select.value;if(value!=="all")root.querySelectorAll(cardSelector).forEach((card)=>{if(!String(card.dataset.additives||"").split(/\\s+/).includes(value))card.hidden=true;});const count=[...root.querySelectorAll(cardSelector)].filter((card)=>!card.hidden).length;const output=root.querySelector("[data-pharmacy-result]");if(output)output.textContent="Showing "+count+" evidence record"+(count===1?"":"s");};root.addEventListener("input",()=>setTimeout(apply,0));root.addEventListener("change",()=>setTimeout(apply,0));window.addEventListener("load",apply,{once:true});})();</script>`;
}

function renderPharmacyHub(input, articles = []) {
  const allEntries = input.entries || [];
  const entries = allEntries.filter(pharmacyCardEligible);
  const retainedDetailOnly = allEntries.length - entries.length;
  const cards = entries.map(pharmacyCard).join("");
  const stateOptions = STATES.map(([code, name]) => `<option value="${name.toLowerCase()}">${esc(name)}</option>`).join("");
  const additiveOptions = [...new Map(entries.flatMap(pharmacyAdditives).map((item) => [item.value, item])).values()].sort((left, right) => left.label.localeCompare(right.label));
  // Visitor task first: directory controls and records. The 503A/503B
  // explanation remains available after the records instead of delaying them.
  const controls = `<div class="p3-pharmacy-filters p3-pharmacy-filters--toolbar" data-pharmacy-filters><label class="p3-toolbar-search">Search pharmacies<input type="search" data-pharmacy-search placeholder="Search pharmacies…"></label><label>Pathway<select data-pharmacy-class><option value="all">All</option><option value="503b">503B</option><option value="503a">503A</option></select></label><label>Medication<select data-pharmacy-med><option value="all">Both</option><option value="semaglutide">Semaglutide</option><option value="tirzepatide">Tirzepatide</option></select></label><label>Compounded with<select data-pharmacy-additive><option value="all">Any sourced additive</option>${additiveOptions.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("")}</select></label><label class="p3-toolbar-state">Verified state record<select data-pharmacy-state><option value="all">Any state</option>${stateOptions}</select></label></div>`;
  const method = `<section class="p3-pharmacy-method" aria-labelledby="pharmacy-method-title"><p class="gcs-kicker">How to read the directory</p><h2 id="pharmacy-method-title">503 pathway labels describe oversight, not quality.</h2><p>A 503A pharmacy compounds individual prescriptions under state-board oversight; a 503B outsourcing facility produces larger batches under direct FDA registration. Filters use only source-backed fields. Cards never reserve rows for facts outside the evidence-qualified card contract.</p></section>`;
  return pageDocument({ route: "/pharmacies/", title: "Compounding pharmacy evidence directory · Clinic Scout", description: `${entries.length} evidence-qualified pharmacy cards with source-backed facility locations, services, and dated evidence provenance.`, mainClass: "p3-page p3-pharm-hub", schema: pageSchemaGraph(breadcrumbSchema("/pharmacies/", [{ href: "/", label: "Home" }, { label: "Pharmacies" }])), body: `${breadcrumbs([{ href: "/", label: "Home" }, { label: "Pharmacies" }])}<header class="p3-pharmacy-index-head"><p class="gcs-kicker">Pharmacy evidence directory</p><h1>Compare ${entries.length} evidence-qualified pharmacy records.</h1><p>Each card carries a source-backed facility location, published services, and dated evidence provenance. ${retainedDetailOnly} records missing a core card field remain available at their detail URLs but do not appear in this default grid.</p></header>${controls}<p class="p3-filter-result" data-pharmacy-result aria-live="polite">Showing ${entries.length} evidence-qualified records</p><div class="p3-pharmacy-grid" data-pharmacy-grid>${cards}</div><button class="cs-btn cs-btn--quiet p3-load-more" type="button" data-pharmacy-load-more hidden>Show more pharmacy records</button><div class="p3-filter-empty" data-pharmacy-empty hidden><h2>No evidence record matches those filters.</h2><p>Clear a filter. An empty directory view is not proof that no pharmacy exists.</p></div>${method}${renderPhase3RelatedInsightsShelf({ slug: "pharmacies" }, articles)}` });
}

function classificationPanel(entry) {
  // Status tokens are inward snake_case identifiers; when no prose note is
  // bound, render the token as readable words instead of leaking raw grammar.
  const render = (label, row) => `<article class="cs-card"><p class="gcs-kicker">${label}</p><h3>${row?.value === true ? "Source-backed pathway evidence" : row?.value === false ? "Source-backed negative" : "Not conclusively established"}</h3><p>${esc(row?.note || String(row?.status || "").replaceAll("_", " ") || "No bound statement available.")}</p></article>`;
  return `<div class="p3-classification-grid">${render("Section 503A", entry.classification?.section_503a)}${render("Section 503B", entry.classification?.section_503b)}</div>`;
}

function renderRelatedPharmacies(entry, entries) {
  const entryMeds = new Set(["semaglutide", "tirzepatide"].filter((medication) => entry.glp1_relevance?.[medication]?.relevant === true));
  const entryClasses = new Set([pharmacyClass(entry, "section_503a"), pharmacyClass(entry, "section_503b")].filter(Boolean));
  const related = entries.filter((item) => item.slug !== entry.slug).map((item) => {
    const sharedMeds = [...entryMeds].filter((medication) => item.glp1_relevance?.[medication]?.relevant === true).length;
    const sharedClasses = [...entryClasses].filter((key) => pharmacyClass(item, `section_${key}`) === key).length;
    return { item, score: (sharedMeds * 2) + sharedClasses };
  }).sort((left, right) => right.score - left.score || left.item.priority - right.item.priority).slice(0, 3);
  return `<section class="p3-related p3-pharmacy-related" data-related-pharmacies><div class="section-heading"><p class="gcs-kicker">Related pharmacies</p><h2>Continue with pharmacies that share the same source-backed directory tags.</h2><p>These links are based only on shared GLP-1 relevance or 503-pathway tags; they do not assert affiliation or a dispensing relationship.</p></div><div>${related.map(({ item }) => `<a class="cs-card" href="${esc(item.route)}"><strong>${esc(item.display_name)}</strong><span>${esc([pharmacyClass(item, "section_503a"), pharmacyClass(item, "section_503b")].filter(Boolean).map((key) => key.toUpperCase()).join(" · ") || "Pathway unresolved")}</span></a>`).join("")}</div></section>`;
}

// GLPWinner-emulation pharmacy detail (PAGE-SPECS-20260826/provider-pharmacy
// §3/§5 F4+F7+F10+F12): reader-job modules first (compounded-with, regulatory
// compliance, telehealth providers), deep evidence second (history, unknowns,
// sources). Adds the reverse-comparison conversion path, an honest patient-
// review empty state with a moderated submit CTA, a dual cross-link shelf, and
// a mobile bottom bar. The self-referential "beats the captured comparison
// profile" panel is rewritten to reader-benefit framing. All pinned selectors
// stay: .p3-pharmacy-hero, .p3-classification-grid > .cs-card,
// .p3-detail-grid > article, .p3-action-grid, .p3-unknowns, .p3-source-rail,
// [data-related-pharmacies] with exactly three /pharmacies/ links.
function pharmacyBarRuntime() {
  return '<script data-pharmacy-bar-runtime>(()=>{var bar=document.querySelector("[data-pharmacy-bar]");if(!bar)return;var mq=window.matchMedia("(max-width: 760px)");var frame=0;var sync=function(){frame=0;var footer=document.querySelector(".cs-prefooter, .gcs-footer");if(!mq.matches||!footer){bar.classList.remove("is-released");return;}bar.classList.toggle("is-released",footer.getBoundingClientRect().top<=window.innerHeight);};var queue=function(){if(frame)return;frame=window.requestAnimationFrame(sync);};window.addEventListener("scroll",queue,{passive:true});window.addEventListener("resize",queue,{passive:true});if(mq.addEventListener)mq.addEventListener("change",queue);sync();})();</script>';
}

function renderPharmacyDetail(entry, entries, registry) {
  const seo = pageSeoCopy(entry.route);
  const citations = (entry.citation_ledger || []).map((source, index) => `<li id="pharmacy-source-${index + 1}">${renderCitationAnchor({ url: source.url, label: `${source.source_class} · accessed ${source.accessed_date}`, reason: CITATION_REASONS.COMPARISON_SOURCE_LEDGER, rel: "noopener noreferrer" })}<blockquote>${esc(source.quote)}</blockquote></li>`).join("");
  const actions = (entry.regulatory_actions || []).map((action) => `<article class="p3-action"><p class="gcs-kicker">${esc(action.agency)} · ${esc(action.date || "date not stated")}</p><h3>${esc(action.type)}</h3><p>${esc(action.summary)}</p><small>${esc(action.status || "Status not stated")}</small></article>`).join("");
  const unknowns = (entry.unverified_fields || []).map((item) => `<li>${esc(item)}</li>`).join("");
  const advantages = (entry.competitive_advantage?.dimensions || []).filter((row) => row.beats_competitor === true).map((row) => `<li><strong>${esc(row.dimension.replaceAll("_", " "))}:</strong> ${esc(row.our_evidence)}</li>`).join("");
  // Location items are structured records ({address|city/state, name|entity,
  // status, note}) — the old `item.address || item` printed "[object Object]"
  // for city-only records. Compose an honest line; claims the record marks
  // unverified stay visibly unverified.
  const locationLine = (item) => {
    if (typeof item === "string") return item;
    const place = item.address || [item.city, item.state].filter(Boolean).join(", ");
    if (!place) return "";
    const prefix = item.name || item.entity ? `${item.name || item.entity} — ` : "";
    const flag = /unverified|not_recovered/.test(String(item.status || "")) ? " (not independently verified)" : "";
    const note = item.note ? ` ${item.note}` : "";
    return `${prefix}${place}${flag}${note}`;
  };
  const locations = (entry.locations?.items || []).map(locationLine).filter(Boolean).map((line) => `<li>${esc(line)}</li>`).join("");
  const services = (entry.services?.items || []).map((item) => `<li>${esc(item)}</li>`).join("");
  const faq = (entry.faq || []).map((item) => `<details><summary>${esc(item.question)}</summary><p>${esc(item.answer)}</p></details>`).join("");
  const relatedShelf = renderRelatedPharmacies(entry, entries);
  const relationships = verifiedPharmacyRelationships(entry);
  const providerName = (programId) => (registry?.programs || []).find((row) => row.program_id === programId)?.display_name || programId;
  const molSide = (label, mol) => {
    const row = entry.glp1_relevance?.[mol];
    return `<div class="p3-molside p3-molside--${mol}"><h3>${label}</h3><p>${row?.relevant === true ? esc(row.evidence) : "Not verified in the sources we checked."}</p></div>`;
  };
  const compoundedGrid = `<section class="p3-detail-grid p3-pharm-reader"><article class="p3-compounded-card"><h2>Compounded with</h2><div class="p3-molsplit">${molSide("Semaglutide", "semaglutide")}${molSide("Tirzepatide", "tirzepatide")}</div><p class="p3-availability-note">${esc(entry.glp1_relevance?.availability_note || "Product evidence does not establish current availability.")}</p></article><article><h2>Locations in the source record</h2>${locations ? `<ul>${locations}</ul>` : `<p>${esc(entry.locations?.render_empty_state || "No source-backed location was captured.")}</p>`}<h2>Services named by sources</h2>${services ? `<ul>${services}</ul>` : `<p>${esc(entry.services?.render_empty_state || "No source-backed service list was captured.")}</p>`}</article></section>`;
  const compliance = `<section class="p3-pharm-reg" aria-labelledby="pharm-reg-${esc(entry.slug)}"><div class="section-heading"><p class="gcs-kicker">Regulatory compliance</p><h2 id="pharm-reg-${esc(entry.slug)}">503 pathway evidence</h2><p>A pathway label describes which federal rules apply — it is not a quality claim.</p></div>${classificationPanel(entry)}</section>`;
  const providersModule = relationships.length
    ? `<section class="p3-pharm-providers" aria-labelledby="pharm-providers-${esc(entry.slug)}"><div class="section-heading"><p class="gcs-kicker">Telehealth providers</p><h2 id="pharm-providers-${esc(entry.slug)}">Programs with a verified source relationship</h2><p>Only relationships named by an explicit bound source appear. A listing is not an availability, quality, or dispensing claim.</p></div><div class="p3-provider-chiprow" data-pharm-provider-chips>${relationships.map((relationship) => `<a class="p3-provider-chip-link" href="/providers/${esc(relationship.program_id)}/">${esc(providerName(relationship.program_id))}<span aria-hidden="true"> ↗</span></a>`).join("")}</div><a class="cs-btn cs-palette-action" href="${esc(entry.route)}compare-providers/">Compare providers using this pharmacy</a></section>`
    : '<section class="p3-pharm-providers"><div class="section-heading"><p class="gcs-kicker">Telehealth providers</p><h2>No telehealth-provider relationship is verified in the sources we checked.</h2><p>Clinic Scout links a provider only when an explicit source names the relationship.</p></div><a class="cs-arrowlink" href="/providers/?sort=cheapest">Browse providers <span class="cs-arrow" aria-hidden="true">→</span></a></section>';
  const reviewAction = `/reviews/submit/?entity=${encodeURIComponent(entry.display_name)}&amp;type=pharmacy`;
  const reviewsModule = `<section class="p3-reviews-module" aria-labelledby="pharm-reviews-${esc(entry.slug)}"><div class="p3-reviews-head"><h2 id="pharm-reviews-${esc(entry.slug)}">Patient reviews</h2><a class="cs-btn cs-btn--quiet" href="${reviewAction}">Share your experience</a></div><p class="p3-review-empty-line">No Clinic Scout patient reviews are published for this pharmacy. Submissions are checked before publication.</p></section>`;
  const advantage = `<section class="p3-advantage"><p class="gcs-kicker">What this page verifies for you</p><h2>${entry.competitive_advantage.verified_advantage_count} evidence checks carry a date and a source.</h2><p class="p3-advantage-lede">Each line traces to a citation in the source list below — read the exact captured wording before relying on it.</p><ul>${advantages}</ul><p>${esc(entry.competitive_advantage.boundary)}</p></section>`;
  const dualShelf = `<div class="p3-dual-shelf">${relatedShelf}<section class="p3-related p3-provider-search-shelf"><div class="section-heading"><p class="gcs-kicker">Providers</p><h2>Compare source-checked telehealth programs.</h2><p>Published prices, source dates, and explicit unknowns for every governed program.</p></div><a class="cs-btn cs-palette-action" href="/providers/?sort=cheapest">Start a provider search</a></section></div>`;
  const bar = `<aside class="p3-pharmacy-bar" data-pharmacy-bar aria-label="${esc(entry.display_name)} evidence summary"><span><small>${entry.evidence_summary.citation_count} citations · ${entry.unverified_fields.length} unknowns</small><strong>${esc(entry.display_name)}</strong></span><a class="cs-btn cs-palette-action" href="${relationships.length ? esc(`${entry.route}compare-providers/`) : "/providers/?sort=cheapest"}">See providers</a></aside>`;
  const schema = { "@context": "https://schema.org", "@graph": [{ "@type": "Pharmacy", "@id": `${canonical(entry.route)}#pharmacy`, name: entry.display_name, url: entry.official_site_url || undefined }, { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: canonical("/") }, { "@type": "ListItem", position: 2, name: "Pharmacies", item: canonical("/pharmacies/") }, { "@type": "ListItem", position: 3, name: entry.display_name, item: canonical(entry.route) }] }] };
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/pharmacies/", label: "Pharmacies" }, { label: entry.display_name }])}<section class="p3-pharmacy-hero"><div><p class="gcs-kicker">Pharmacy evidence record · researched ${esc(entry.evidence_summary.last_researched_date)}</p><h1 class="p3-wrap-title" data-wrap-text>${esc(seo?.h1 ?? entry.display_name)}</h1><p class="lede">${esc(entry.legal_identity.value || "Legal identity not verified in the bound record")}</p><div class="p3-tagrow p3-wrap-cluster" data-wrap-chips><span>${entry.evidence_summary.citation_count} citations</span><span>${entry.evidence_summary.regulatory_action_count} action records</span><span>${entry.unverified_fields.length} explicit unknowns</span></div></div><div class="p3-pharmacy-mark p3-pharmacy-mark--large" aria-hidden="true">${esc(entry.display_name.slice(0, 1))}</div></section>${compoundedGrid}<div class="d3-pharmacy-evidence">${compliance}<section class="p3-unknowns"><h2>What remains unverified</h2><ul>${unknowns || "<li>No unresolved fields listed.</li>"}</ul></section></div>${providersModule}<section><div class="section-heading"><p class="gcs-kicker">Regulatory history</p><h2>Actions stay dated and bounded.</h2><p>${esc(entry.action_search_disposition)}</p></div><div class="p3-action-grid">${actions || '<p>No regulatory action was found in the bounded search. That is not a categorical absence claim.</p>'}</div></section>${reviewsModule}${advantage}<section id="sources" class="p3-source-rail"><h2>Sources and exact captured wording</h2><ol>${citations}</ol></section>${dualShelf}<section class="p3-accordions"><h2>Questions readers ask</h2>${faq}</section>${bar}${pharmacyBarRuntime()}`;
  return pageDocument({ route: entry.route, title: seo?.title ?? `${entry.display_name}: licenses, sources, and evidence gaps · Clinic Scout`, description: seo?.meta ?? `Source-bound ${entry.display_name} record with legal identity, 503 pathway evidence, regulatory history, citations, and explicit unknowns.`, body, schema, mainClass: "p3-page p3-pharm-detail" });
}

function verifiedPharmacyRelationships(entry) {
  return (entry.provider_relationships || []).filter((row) => row?.status === "verified" && row.program_id && row.source_url);
}

function renderPharmacyReverseInteractive(entry, relationships, registry, pricingMatrix, logoManifest, coupons = {}) {
  const cards = relationships.map((relationship) => {
    const program = (registry.programs || []).find((row) => row.program_id === relationship.program_id);
    if (!program) throw new Error(`phase3_pharmacy_relationship_program_missing:${entry.slug}:${relationship.program_id}`);
    const priced = pricingEntryForProgram(program.program_id, pricingMatrix);
    const cheapest = priced?.medications?.filter((row) => Number.isFinite(row.ongoing_usd)).sort((left, right) => left.ongoing_usd - right.ongoing_usd)[0] || null;
    const identityEntry = priced || { program_id: program.program_id, provider: program.display_name };
    const price = cheapest
      ? `<div class="p3-reverse-price"><span>Lowest captured published price</span><strong>${usd(cheapest.ongoing_usd)}<small>/${esc(cheapest.cadence || "month")}</small></strong><small>${esc(cheapest.label)} · checked ${esc(cheapest.captured_on)}</small></div>`
      : '<div class="p3-reverse-price p3-reverse-price--unknown"><span>Published price</span><strong>Not established</strong></div>';
    const sourceAnchor = renderCitationAnchor({ url: relationship.source_url, label: "Open relationship source →", reason: CITATION_REASONS.COMPARISON_SOURCE_LEDGER, rel: "noopener noreferrer" })
      .replace("<a ", '<a class="cs-arrowlink" ');
    return `<article class="cs-card p3-reverse-card" data-pharmacy-reverse-card data-wrap-card data-state="unknown" data-drug="unknown" data-dose="unknown" data-duration="unknown"><p class="gcs-kicker">Verified source relationship</p>${providerIdentity(identityEntry, logoManifest, 2)}${price}${renderCouponChip(coupons[program.program_id])}<p>${esc(relationship.summary || "The bound source explicitly names this provider relationship.")}</p><p><small>Relationship checked ${esc(relationship.verified_as_of || "date not stated")}. State, medication, dose, duration, price, and patient assignment are not established by this source.</small></p><div class="p3-wrap-actions" data-wrap-actions>${sourceAnchor}<a class="cs-btn cs-btn--quiet" href="/providers/${esc(program.program_id)}/">Open provider details</a><a class="cs-btn cs-palette-action" href="/quiz/provider-fit/?provider=${esc(program.program_id)}">Check my fit</a></div></article>`;
  }).join("");
  const stateOptions = STATES.map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join("");
  const route = `${entry.route}compare-providers/`;
  const controls = `<form class="p3-filterbar" data-pharmacy-reverse-filters><label>State<select name="state"><option value="all">Any sourced state</option>${stateOptions}</select></label><label>Medication<select name="drug"><option value="all">Any sourced medication</option><option value="SEMAGLUTIDE">Semaglutide</option><option value="TIRZEPATIDE">Tirzepatide</option></select></label><label>Dose<select name="dose"><option value="all">Any sourced dose</option>${[...SEMAGLUTIDE_DOSES, ...DOSES].map((dose) => `<option value="${dose}">${dose} mg/week</option>`).join("")}</select></label><label>Duration<select name="duration"><option value="all">Any sourced duration</option><option value="1">1 month</option><option value="3">3 months</option><option value="6">6+ months</option></select></label><button type="button" data-pharmacy-reverse-reset>Clear controls</button></form>`;
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #4).
  const schema = pageSchemaGraph(breadcrumbSchema(route, [{ href: "/", label: "Home" }, { href: "/pharmacies/", label: "Pharmacies" }, { href: entry.route, label: entry.display_name }, { label: "Compare providers" }]));
  const body = `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/pharmacies/", label: "Pharmacies" }, { href: entry.route, label: entry.display_name }, { label: "Compare providers" }])}<a class="p3-card-link" href="${esc(entry.route)}">← Back to ${esc(entry.display_name)}</a><section class="p3-index-hero"><p class="gcs-kicker">Reverse pharmacy comparison</p><h1>Verified programs associated with ${esc(entry.display_name)}</h1><p class="lede">Only relationships with an explicit bound source appear. Clinic Scout does not infer medication, dose, duration, price, state availability, or patient-specific dispensing.</p></section>${controls}<p class="p3-filter-result" data-pharmacy-reverse-result aria-live="polite">Showing ${relationships.length} verified source relationship${relationships.length === 1 ? "" : "s"}</p><div class="p3-intent-grid" data-pharmacy-reverse-grid>${cards}</div><div class="p3-filter-empty" data-pharmacy-reverse-empty hidden><h2>No relationship source establishes every selected control.</h2><p>The provider-to-pharmacy relationship remains verified, but the selected state, medication, dose, or duration is not documented by that source. Clear controls rather than treating unknown as available.</p><button type="button" data-pharmacy-reverse-reset>Clear controls</button></div><aside class="p3-evidence-boundary">A pharmacy page, a provider page, and a shipping label can refer to different legal entities. Verify the dispensing pharmacy on the current prescription and package.</aside>`;
  return pageDocument({ route, title: `Verified programs associated with ${entry.display_name} · Clinic Scout`, description: `Source-bounded provider-to-pharmacy relationships for ${entry.display_name}, with fail-closed comparison controls.`, body, schema });
}

function renderPharmacyReverse(entry, relationships, registry, pricingMatrix, logoManifest, coupons = {}) {
  return renderPharmacyReverseInteractive(entry, relationships, registry, pricingMatrix, logoManifest, coupons);
  const cards = relationships.map((relationship) => {
    const program = (registry.programs || []).find((row) => row.program_id === relationship.program_id);
    if (!program) throw new Error(`phase3_pharmacy_relationship_program_missing:${entry.slug}:${relationship.program_id}`);
    const sourceAnchor = renderCitationAnchor({ url: relationship.source_url, label: "Open relationship source", reason: CITATION_REASONS.COMPARISON_SOURCE_LEDGER, rel: "noopener noreferrer" });
    return `<article class="cs-card"><p class="gcs-kicker">Verified source relationship</p><h2>${esc(program.display_name)}</h2><p>${esc(relationship.summary || "The bound source explicitly names this provider relationship.")}</p>${sourceAnchor}<a href="/providers/${esc(program.program_id)}/">Open provider details</a></article>`;
  }).join("");
  const route = `${entry.route}compare-providers/`;
  return pageDocument({ route, title: `Verified programs associated with ${entry.display_name} · Clinic Scout`, description: `Only explicitly sourced provider-to-pharmacy relationships for ${entry.display_name}.`, body: `${breadcrumbs([{ href: "/", label: "Home" }, { href: "/pharmacies/", label: "Pharmacies" }, { href: entry.route, label: entry.display_name }, { label: "Compare providers" }])}<section class="p3-index-hero"><p class="gcs-kicker">Reverse pharmacy comparison</p><h1>Verified programs associated with ${esc(entry.display_name)}</h1><p class="lede">Only relationships with an explicit bound source appear. Clinic Scout does not infer the rest.</p></section><div class="p3-intent-grid">${cards}</div><aside class="p3-evidence-boundary">A pharmacy page, a provider page, and a shipping label can refer to different legal entities. Verify the dispensing pharmacy on the current prescription and package.</aside>` });
}

export function validatePhase3Graph(graph, pharmacyInput) {
  if (!Array.isArray(graph.organic_compounded_pages) || graph.organic_compounded_pages.length !== 2 || !["semaglutide", "tirzepatide"].every(med => graph.organic_compounded_pages.some(page => page.medication === med && page.route === `/${med}/`))) throw new Error("phase3_organic_compounded_category_invalid");
  if (graph?.schema !== "glp-phase3-page-graph-v1" || graph.status !== "STAGED_NOT_DEPLOYED") throw new Error("phase3_graph_identity_invalid");
  if (graph.brand_pages?.length !== 5 || graph.compounded_pages?.length !== 2 || graph.bulk_pages?.length !== 2 || graph.bulk_intents?.length !== 4) throw new Error("phase3_graph_route_family_invalid");
  if (!Array.isArray(graph.comparison_pages)) throw new Error("phase3_comparison_pages_invalid");
  for (const page of graph.comparison_pages) {
    if (!["both", "starter", "step-up"].includes(page.slug) || page.route !== `/${page.slug}/` || !page.name) throw new Error("phase3_comparison_page_invalid");
    const expectedKind = page.slug === "both" ? "cross-duration" : "plan-preset";
    if (page.kind !== expectedKind || (page.slug === "both" ? JSON.stringify(page.duration_months) !== "[1,3]" : Object.hasOwn(page, "duration_months"))) throw new Error("phase3_comparison_kind_invalid");
    if (!Array.isArray(page.medication_ids) || page.medication_ids.length !== 2 || new Set(page.medication_ids).size !== 2 || page.medication_ids.some(id => !["compounded-tirzepatide-injection", "compounded-semaglutide-injection"].includes(id))) throw new Error("phase3_comparison_medications_invalid");
  }
  const brandSlugs = graph.brand_pages.map((page) => page.slug).sort();
  if (brandSlugs.join("|") !== ["mounjaro", "ozempic", "wegovy", "wegovy-pill", "zepbound"].sort().join("|")) throw new Error("phase3_brand_render_family_invalid");
  const wegovyPill = graph.brand_pages.find((page) => page.slug === "wegovy-pill");
  const wegovy = graph.brand_pages.find((page) => page.slug === "wegovy");
  if (wegovyPill?.route !== "/wegovy-pill/" || wegovy?.route !== "/wegovy/" || productMolecule(wegovyPill) !== "semaglutide" || productMolecule(wegovy) !== "semaglutide") throw new Error("phase3_wegovy_dynamic_family_invalid");
  if (!["semaglutide", "tirzepatide"].every((molecule) => graph.compounded_pages.some((page) => productMolecule(page) === molecule) && graph.brand_pages.some((page) => productMolecule(page) === molecule))) throw new Error("phase3_cross_route_family_invalid");
  if (graph.retired_evidence_wall_redirects?.length !== 12) throw new Error("phase3_d54_inventory_invalid");
  if (!Number.isInteger(graph.expected_indexable_routes) || graph.expected_indexable_routes < 1) throw new Error("phase3_expected_indexable_routes_invalid");
  const o35 = graph.canonical_served_equivalents?.o35_mounjaro_coupon;
  if (o35?.requested_route !== "/guides/mounjaro-coupon/" || o35?.served_route !== o35.requested_route || !String(o35?.disposition || "").includes("exact_byte")) throw new Error("phase3_o35_served_contract_invalid");
  if (pharmacyInput?.schema !== "glp.pharmacy-render-input.v1" || pharmacyInput.entry_count !== 90 || pharmacyInput.entries?.length !== 90) throw new Error("phase3_pharmacy_input_invalid");
  const routes = ["/providers/", "/self-pay/", "/bulk/", "/insights/", "/pharmacies/", ...graph.organic_compounded_pages.map((row) => row.route), ...graph.brand_pages.map((row) => row.route), ...graph.compounded_pages.map((row) => row.route), ...graph.bulk_pages.map((row) => row.route), ...graph.comparison_pages.map((row) => row.route), ...pharmacyInput.entries.map((row) => row.route)];
  if (new Set(routes).size !== routes.length) throw new Error("phase3_route_collision");
  const redirectSources = [...graph.retired_evidence_wall_redirects, ...graph.legacy_redirects].map(([from]) => from);
  if (redirectSources.some((route) => routes.includes(route)) || new Set(redirectSources).size !== redirectSources.length) throw new Error("phase3_redirect_collision");
  return true;
}

// Article topic chip label — same heuristics as blog-system's humanTopic, kept
// local so the article upgrade stays dependency-light.
function articleTopicLabel(article) {
  const keyword = String(article.primary_keyword || article.target_query || article.h1 || "").toLowerCase();
  if (/cost|price|savings|assistance/.test(keyword)) return "Cost and access";
  if (/counterfeit|safety|verify|pharmacy|warning/.test(keyword)) return "Safety and verification";
  if (/coverage|insurance|appeal|medicare/.test(keyword)) return "Coverage and appeals";
  if (/\bvs\b|compare|comparison/.test(keyword)) return "Comparison guide";
  return "Source-checked research";
}

// GLPWinner-emulation article shell (PAGE-SPECS-20260826/insights spec.md §2):
// share row rides directly under the cinematic hero; the curation block moves
// to the END of the article (their "Curated by" pattern: gradient divider rule,
// circular gradient mark, brand link + short role copy) instead of a redundant
// card at the top; topic chips close the article; Keep Reading becomes
// photo-top cards with real per-article deks. Pinned markers preserved:
// data-phase3-article, data-insights-article-anatomy, p3-article-share,
// data-author-block (exactly one, with an /authors/ link), data-faq-disclosure
// (two details), p3-keep-reading.
export function upgradeInsightsArticle(html, article, related = []) {
  if (!html.includes("<main")) throw new Error(`phase3_article_main_missing:${article.canonical_path}`);
  const share = `<nav class="p3-article-share p3-wrap-actions" data-wrap-actions aria-label="Share this guide"><span>Share</span><a href="mailto:?subject=${encodeURIComponent(article.h1 || article.title)}&body=${encodeURIComponent(canonical(article.canonical_path))}">Email</a><a href="https://x.com/intent/post?url=${encodeURIComponent(canonical(article.canonical_path))}" rel="noopener noreferrer">X</a></nav>`;
  const author = article.author || {};
  const authorBlock = author.bio_path && author.display_name
    ? `<aside class="p3-article-author cs-curator" data-author-block><hr class="cs-grad-rule" aria-hidden="true"><div class="cs-curator-row"><span class="cs-curator-mark" aria-hidden="true"></span><div><p class="gcs-kicker">Curated by</p><p>Curated and evidence-reviewed by <a href="${esc(author.bio_path)}">${esc(author.display_name)}</a>. Every claim in this guide stays bound to a dated, named source before it publishes. ${author.clinical_credentials_claimed === false ? "No clinical credentials are claimed." : ""}</p></div></div></aside>`
    : "";
  const tags = `<nav class="cs-article-tags" aria-label="Article topics"><span>Categories</span><a href="/insights/">${esc(articleTopicLabel(article))}</a><a href="/insights/">GLP-1</a></nav>`;
  const faqItems = [
    article.direct_answer ? ["What does this guide establish?", article.direct_answer] : null,
    article.medical_advice_disclaimer ? ["What does this guide not determine?", article.medical_advice_disclaimer] : null,
  ].filter(Boolean);
  const faq = faqItems.length
    ? `<section class="p3-article-faq guide-faq" data-faq data-faq-disclosure><p class="gcs-kicker">Guide disclosures</p><h2>Questions about this evidence record</h2>${faqItems.map(([question, answer]) => `<details><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join("")}</section>`
    : "";
  const keepReading = `<section class="p3-keep-reading"><p class="gcs-kicker">Keep reading</p><h2>Continue the source trail.</h2><div>${related.slice(0, 3).map((item) => `<a class="cs-card" data-wrap-card href="${esc(item.canonical_path)}">${articlePicture(item, { className: "p3-story-picture" })}<h3 class="p3-wrap-title" data-wrap-text>${esc(item.h1 || item.title)}</h3><p>${esc(item.meta_description || item.direct_answer || "Source-checked Clinic Scout research.")}</p></a>`).join("")}</div></section>`;
  return html
    .replace(/<main([^>]*)>/i, '<main$1 data-phase3-article="true" data-insights-article-anatomy="hero-body-sources-related-author">')
    .replace(/<nav class="guide-toc"[\s\S]*?<\/nav>/i, "")
    .replace(/<nav class="breadcrumbs"([\s\S]*?)<a href="\/guides\/">Guides<\/a>/i, '<nav class="breadcrumbs"$1<a href="/insights/">Insights</a>')
    .replace(/(<section class="guide-hero[^"]*">[\s\S]*?<\/section>)/i, `$1${share}`)
    .replace("</main>", `${faq}${keepReading}${tags}${authorBlock}</main>`);
}

// GLP-34: one active listing composition. Route adapters supply data and slots,
// never a completed page to be rearranged by regular expressions. Older page
// functions above are retained as migration reference, not called by the graph.
const LISTING_CONFIG = Object.freeze({
  A: Object.freeze({ mode: "bulk", support: "Compare monthly costs and upfront payments before choosing a longer plan." }),
  B: Object.freeze({ mode: "brand", support: "Explore provider options, self-pay costs and questions for your insurer." }),
  C: Object.freeze({ mode: "compounded", support: "Compare published prices. Confirm availability in your state with the provider." }),
  D: Object.freeze({ mode: "pharmacy", support: "Find pharmacy locations and services. Open a profile for details and sources." }),
  E: Object.freeze({ mode: "provider", support: "Compare published medications, monthly cost and cancellation terms." }),
});

function listingDocument({ archetype, route, title, description, heading, support, count, controls, cards, panel = "", atfPreview = "", resultTail = "", afterGrid = "", runtime = "", schema, initialVisible = null, profileCount = null, hasNonpriced = false }) {
  const pharmacy = archetype === "D";
  if (!LISTING_CONFIG[archetype] || (archetype !== "B" && panel)) throw new Error("listing_configuration_invalid");
  const statusHook = pharmacy ? "data-pharmacy-result" : "data-filter-result";
  const gridHook = pharmacy ? "data-pharmacy-grid" : "data-phase3-provider-grid";
  const emptyHook = pharmacy ? "data-pharmacy-empty" : "data-filter-empty";
  const registryScope = route === "/providers/" ? `<p data-provider-registry-scope>We track <span data-live-provider-count>{{LIVE_PROVIDER_COUNT}}</span> providers in total. ${count} meet the comparison-card evidence rules; ${profileCount - count} additional provider profiles have their own first-party pages outside this comparison. The count covers our live registry, not a claim of availability in your state.</p>` : "";
  const stateMarkup = archetype === "C" ? stateFilterControl() : archetype === "E" ? providerHubStateControl() : "";
  if (stateMarkup && controls.split(stateMarkup).length !== 2) throw new Error("listing_state_control_source_missing_or_duplicate");
  const inlineControls = stateMarkup ? controls.replace(stateMarkup, "") : controls;
  // Native details remains usable if enhancement fails, while the parser-time
  // close reserves the same mobile footprint as the enhanced filter trigger.
  // GLP-75: source-coverage eligibility is not regulatory or stock evidence.
  // Dated support: data/blog/content-batch.json, verify-online-glp-1-pharmacy
  // (2026-07-23); grid inclusion: pharmacyCardEligible above.
  const pharmacyScope = '<aside class="p3-evidence-boundary" data-pharmacy-evidence-scope role="note" aria-label="How to read this directory"><p><strong>Reported information — how to read this directory.</strong> This grid is a source-coverage subset, not a current licensure or availability list. Directory inclusion alone does not establish current licensure, stock or product approval. Open each profile’s dated sources and keep state licensure, NPI identity, facility registration and product regulatory status as separate checks.</p></aside>';
  const filterControls = pharmacy
    ? `${pharmacyScope}<details open data-native-pharmacy-filters><summary class="cs-mobile-filter-trigger"><span>Pharmacy filters</span><span aria-hidden="true">Tune filters&nbsp;↗</span></summary>${inlineControls}</details><script>(()=>{const shell=document.currentScript.previousElementSibling;if(matchMedia('(max-width:760px)').matches)shell.open=false;})();</script>`
    : inlineControls;
  const leadDisclosure = pharmacy ? "" : `<div class="table-disclosure p3-source-disclosure affiliate-note"><p class="listing__disclosure-lead affiliate-note">We may earn a commission from sponsored links.</p>${route === "/providers/" ? "<p>That never changes a score.</p>" : ""}<p>Price-source links go directly to the provider page Clinic Scout checked, not through an affiliate redirect.</p></div>`;
  const numericListing = ["A", "B", "C"].includes(archetype);
  const emptyCopy = numericListing
    ? hasNonpriced
      ? "No comparable price matches those filters. Records without a comparable price are listed separately below. This is not a medical or availability conclusion."
      : "No source-backed record matches those filters. An empty result is not a medical or availability conclusion."
    : "No source-backed record matches those filters. An empty result is not a medical or availability conclusion.";
  const body = `<header class="listing__intro${stateMarkup ? " listing__intro--state" : ""}">${stateMarkup}<h1${archetype === "E" || archetype === "C" ? ' data-state-heading data-state-title-template="Compare weight loss providers in {state}"' : ""}>${esc(heading)}</h1><p class="listing__support">${esc(support)} <span class="listing__count" ${statusHook} aria-live="polite" aria-atomic="true">${count} ${numericListing ? "comparable price results" : pharmacy ? "pharmacy records" : "provider records"}</span></p>${registryScope}${leadDisclosure}${atfPreview}</header>${filterControls}${panel}<section id="provider-results" class="listing-results p3-provider-section" data-three-column-results${initialVisible ? ` data-initial-visible="${initialVisible}"` : ""} aria-labelledby="listing-results-heading"><h2 id="listing-results-heading" class="sr-only">Results</h2><div class="listing-grid ${pharmacy ? "p3-pharmacy-grid" : "p3-provider-grid"}" ${gridHook}>${cards || (pharmacy ? '<p class="p3-empty">No source-backed row is published for this selection. An evidence gap is not proof that no provider exists.</p>' : "")}</div>${resultTail}<div class="p3-filter-empty" ${emptyHook}${count || pharmacy ? " hidden" : ""}><p>${esc(emptyCopy)}</p>${pharmacy ? "" : '<p data-active-filter-label>Active filters: none.</p><button type="button" data-filter-reset>Reset filters</button>'}</div></section>${pharmacy ? "" : sourceDisclosure()}${afterGrid}${runtime}`;
  return pageDocument({ route, title, description, body: '<noscript><style data-preserve>main.listing [data-provider-lazy-index]{display:none!important}</style></noscript>' + body, schema, listingArchetype: archetype,
    mainClass: `p3-page listing${pharmacy ? " p3-pharm-hub" : ""}`,
    ...(archetype === "C" ? { robots: "noindex,nofollow,noarchive,nosnippet,max-image-preview:large" } : {}),
  });
}

function listingDrugPanel(page, providers) {
  const manufacturerUrl = PRODUCT_MANUFACTURER_URLS[page.slug];
  if (!manufacturerUrl) throw new Error(`phase3_manufacturer_url_missing:${page.slug}`);
  const cheapest = providers.flatMap(entry => entry.medications).filter(row => Number.isFinite(row.ongoing_usd)).sort((a, b) => a.ongoing_usd - b.ongoing_usd)[0];
  const faq = [
    [`What is ${page.name}?`, `Compare ${page.name} providers and costs. For approved uses and prescribing information, visit the manufacturer.`],
    ["How does it work?", "The official prescribing information explains how the medication works. Clinic Scout focuses on comparing published provider pathways and does not turn a mechanism into a treatment recommendation."],
    ["Benefits", "This comparison helps you inspect total monthly cost, renewal cadence, included services, and source links before choosing a provider path. It cannot determine medical suitability, coverage, availability, or checkout price."],
  ];
  // The existing local picture hook is required by the bound-art upgrader.
  // Do not call an oral compounded row a Wegovy Pill price.
  const price = cheapest ? `<div class="listing__drug-price"><h3>${esc(cheapest.label)}: published self-pay price</h3>${sourcePrice(cheapest)}</div>` : '<p>A matching self-pay price is not listed here. Ask the provider for a current quote.</p>';
  return {
    html: `<section class="listing__drug-panel" data-listing-drug-panel aria-labelledby="listing-drug-heading"><div class="listing__drug-summary"><div><h2 id="listing-drug-heading">${esc(page.name)} information</h2><p>${esc(faq[0][1])}</p><a class="p3-card-link" data-manufacturer-resource href="${esc(manufacturerUrl)}" rel="noopener noreferrer">Open the official manufacturer resource for labeling and product information</a>${price}<p>No covered price is estimated. This comparison does not verify coverage, prior authorization, eligibility, or the price a pharmacy will charge.</p><a href="${esc(page.research_route)}">Read the evidence guide</a></div>${productPicture(page, { loading: "eager" })}</div><div class="listing__drug-faq">${faq.map(([question, answer]) => `<details><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join("")}</div></section>`,
    schema: { "@type": "FAQPage", "@id": `${canonical(page.route)}#faq`, mainEntity: faq.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
  };
}

function listingUnknownCard(program, entry, registry, logoManifest) {
  const id = program.review_slug || program.program_id;
  const review = canonicalReviewPath(program, registry);
  return `<article class="p3-provider-card cs-card" data-phase3-provider data-price-state-provider="${esc(id)}" data-program="${esc(id)}" data-price="" data-price-map="" data-state-mode="unknown" data-drugs="" data-forms="" data-duration="unknown" data-dose="unknown"><header class="p3-card-header">${providerIdentity({ program_id: id, provider: program.display_name }, logoManifest)}</header><p>${esc(priceStateText(entry) || 'Reported pricing is available in the provider review. Floors, bundles and starting prices are not exact monthly cash schedules.')}</p><p>Review medication options, coverage and program terms independently of price.</p><div class="p3-card-actions"><a class="cs-btn cs-btn--quiet" href="${esc(review || `/providers/${program.program_id}/`)}"${review ? " data-card-review" : ""}>${review ? `Read ${esc(program.display_name)} review` : `Open ${esc(program.display_name)} details`}</a></div></article>`;
}

export function renderConfiguredListing(archetype, page, { graph, pharmacyInput, pricingMatrix, registry, coupons, doseCapture, logoManifest, articles, goAuthority }) {
  const config = LISTING_CONFIG[archetype];
  const route = page.route;
  const pharmacy = archetype === "D";
  const reverseEntries = pharmacy ? (pharmacyInput.entries || []).filter(entry => verifiedPharmacyRelationships(entry).length > 0) : [];
  const reverseIndex = reverseEntries.length ? `<section data-pharmacy-reverse-index><h2>Verified provider relationships</h2><ul>${reverseEntries.map(entry => `<li><a href="${esc(`${entry.route}compare-providers/`)}">Verified programs associated with ${esc(entry.display_name)}</a></li>`).join("")}</ul></section>` : "";
  const selfPay = route === "/self-pay/";
  const livePrograms = liveCanonicalProviderPrograms(registry);
  const liveIds = new Set(livePrograms.flatMap(program => [program.program_id, program.review_slug].filter(Boolean)));
  let providers = [];
  let unknownPrograms = [];
  let stateUnknownProviders = [];
  let controls;
  let cards;
  let payload = [];
  let resultTail = "";
  let below = "";
  let atfPreview = "";
  let hasNonpriced = false;
  let count;
  let panel = { html: "", schema: null };
  let heading = page.name;
  let support = config.support;
  if (pharmacy) {
    const entries = (pharmacyInput.entries || []).filter(pharmacyCardEligible);
    count = entries.length;
    cards = entries.map(pharmacyCard).join("");
    resultTail = '<button type="button" class="cs-btn cs-btn--quiet" data-pharmacy-load-more hidden>Show more pharmacy records</button>';
    const additives = [...new Map(entries.flatMap(pharmacyAdditives).map(item => [item.value, item])).values()].sort((a, b) => a.label.localeCompare(b.label));
    const scopeControls = filterChipGroup("Pathway", "data-pharmacy-class", [{ value: "all", label: "All" }, { value: "503b", label: "503B" }, { value: "503a", label: "503A" }]);
    const medicationControls = filterChipGroup("Medication", "data-pharmacy-med", [{ value: "all", label: "Both" }, { value: "semaglutide", label: "Semaglutide" }, { value: "tirzepatide", label: "Tirzepatide" }]);
    const regionControl = stateFilterControl().replace(/<label class="p3-state-native">[\s\S]*?<\/label>/, '<input type="hidden" data-pharmacy-state value="all">');
    controls = `<div class="listing-filter p3-pharmacy-filters p3-pharmacy-filters--toolbar" data-pharmacy-filters><input type="hidden" data-pharmacy-class value="all"><input type="hidden" data-pharmacy-med value="all">${scopeControls}${medicationControls}<label>Compounded with<select data-pharmacy-additive><option value="all">Any sourced additive</option>${additives.map(item => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("")}</select></label><label>Search pharmacies<input type="search" data-pharmacy-search placeholder="Search pharmacies…"></label>${regionControl}</div>`;
    below = '<section class="p3-pharmacy-method"><h2>503 pathway labels describe oversight, not quality.</h2><p>A 503A pharmacy compounds individual prescriptions under state-board oversight; a 503B outsourcing facility produces larger batches under direct FDA registration. Filters use only source-backed fields.</p></section>';
  } else {
    if (archetype === "E") {
      const priceEntries = new Map(Object.values(pricingMatrix.providers || {}).map(entry => [entry.program_id, entry]));
      providers = livePrograms.flatMap(program => {
        const id = program.review_slug || program.program_id;
        const priced = priceEntries.get(id) || priceEntries.get(program.program_id);
        const cardId = providerCardEligible(id) ? id : program.program_id;
        const medications = (priced?.medications || []).filter(row => selfPay ? !isTypedPrice(row) && Number.isFinite(row.ongoing_usd) : isTypedPrice(row) || Number.isFinite(row.ongoing_usd));
        if (selfPay && !medications.length) return [];
        if (!providerCardEligible(cardId)) { unknownPrograms.push({ program, entry: priced }); return []; }
        return [{ ...(priced || {}), program_id: cardId, provider: program.display_name, medications }];
      });
      const price = entry => { const amounts = entry.medications.filter(row => !isTypedPrice(row)).map(row => row.ongoing_usd).filter(Number.isFinite); return amounts.length ? Math.min(...amounts) : Infinity; };
      providers.sort((a, b) => price(a) - price(b) || a.program_id.localeCompare(b.program_id) || a.provider.localeCompare(b.provider));
      // The self-pay destination is a bounded price-led shortlist, not the directory.
      if (selfPay) {
        providers = providers.slice(0, 3);
        unknownPrograms = [];
        heading = `Compare ${providers.length} self-pay provider options`;
      }
      controls = providerHubControls(providers, doseCapture);
      if (route === "/providers/") {
        below += '<section class="section-heading" aria-labelledby="g08-category-links-title"><h2 id="g08-category-links-title">Explore compounded medication categories</h2><div class="p3-hero-actions p3-wrap-actions"><a class="cs-btn cs-btn--quiet" href="/semaglutide/">Compounded semaglutide programs</a><a class="cs-btn cs-btn--quiet" href="/tirzepatide/">Compounded tirzepatide programs</a></div></section>';
        const retatrutideFda = renderCitationAnchor({ url: "https://www.fda.gov/drugs/drug-alerts-and-statements/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss", label: "FDA notice", reason: CITATION_REASONS.INLINE_FACT_SOURCE });
        const retatrutideLilly = renderCitationAnchor({ url: "https://www.lilly.com/news/stories/what-to-know-about-retatrutide", label: "Lilly statement", reason: CITATION_REASONS.INLINE_FACT_SOURCE });
        below += `<p class="cmp-retatrutide-note">Retatrutide is not available as a consumer provider filter. It remains investigational and is not FDA-approved; Lilly says it is lawfully available only in its clinical trials. ${retatrutideFda} · ${retatrutideLilly}.</p>`;
      }
      support = selfPay ? "Selected by lowest reported cash starting amount, then provider name. Medication and service scope may differ; this is not a treatment recommendation, quality ranking or confirmation of availability." : support;
    } else {
      providers = pricingProviders(pricingMatrix, page.medication_ids || [page.medication_id]).filter(entry => liveIds.has(entry.program_id));
      if (archetype === "A") providers = providers.map(entry => ({ ...entry, medications: entry.medications.filter(row => durationSupported(row, page.duration_months)) })).filter(entry => entry.medications.length);
      if (archetype === "C") {
        stateUnknownProviders = providers.filter(entry => providerStateCoverage(providerCardContract(entry.program_id).ledger).mode === "unknown");
        const unknownIds = new Set(stateUnknownProviders.map(entry => entry.program_id));
        providers = providers.filter(entry => !unknownIds.has(entry.program_id));
      }
      controls = renderPhase3FilterControls(page, providers, doseCapture, graph, { fixedDuration: page.duration_months || null });
      if (archetype === "B") panel = listingDrugPanel(page, providers);
    }
    // P19: dormant until a family-specific RESTORE call is applied. The
    // current result grid and its filter/count/CTA ownership remain unchanged.
    function p19RestoredFunnel(family, dualPresentation) {
      // Fable 2026-09-18: the persistent receipt root lives under reports/ (operator decision 2026-09-18, paid-page payout order).
      const approvalRoot = process.env.P19_APPROVAL_ROOT || "/home/ubuntu/business/reports/ops/glp38-20260915/p19-rulings";
      if (!approvalRoot || !approvalRoot.startsWith("/home/ubuntu/business/reports/")) throw new Error("p19_restore_persistent_receipt_required");
      const approval = JSON.parse(readFileSync(`${approvalRoot}/${family}-RESTORE.json`, "utf8"));
      if (approval.schema !== "glp-p19-ruling-v1" || approval.family !== family || approval.branch !== "RESTORE"
        || approval.status !== "APPROVED" || !approval.approved_by || !approval.approval_reference
        || typeof approval.economics_currentness_reference !== "string" || !approval.economics_currentness_reference.trim()
        || approval.allow_commercial_order !== true
        || approval.economics_git_blob !== "2610829e31db6dfb83f58ebad3d133c6623aa6e5"
        || !approval.supersedes?.includes("ULTRACODE-DESIGN-GOAL-20260821.md#ranking-truth")) {
        throw new Error(`p19_${family}_restore_ruling_missing`);
      }
      const economics = JSON.parse(readFileSync(new URL("../data/funnel-v2-economics.json", import.meta.url), "utf8"));
      if (economics.schema !== "glp-funnel-v2-economics-v1" || !economics.public_disclosure) throw new Error("p19_economics_invalid");
      const economicRows = [...economics.paid_search_provider_order];
      if (!economicRows.length || new Set(economicRows.map(row => row.program_id)).size !== economicRows.length
        || economicRows.some(row => !Number.isFinite(row.network_epc_usd) || row.network_epc_usd < 0
          || row.paid_search_allowed !== true || row.tracking_ready !== true || row.wired_live !== true)) {
        throw new Error("p19_economics_rows_invalid");
      }
      economicRows.sort((a, b) => b.network_epc_usd - a.network_epc_usd || a.program_id.localeCompare(b.program_id));
      // R11 orders evidenced offers by EPC, not comparable monthly cash price.
      // Keep the result grid's numeric-only selector and its ownership unchanged.
      const funnelMedicationIds = new Set(page.medication_ids || [page.medication_id]);
      const funnelProviders = family === "R11"
        ? Object.values(pricingMatrix.providers || {})
          .filter(entry => liveIds.has(entry.program_id) && providerCardEligible(entry.program_id))
          .map(entry => ({ ...entry, medications: (entry.medications || []).filter(row =>
            funnelMedicationIds.has(row.medication_id) && (isTypedPrice(row) || Number.isFinite(row.ongoing_usd))) }))
          .filter(entry => entry.medications.length)
        : providers;
      const byId = new Map(funnelProviders.map(entry => [entry.program_id, entry]));
      const ranked = economicRows.map((row, index) => ({ row, rank: index + 1, entry: byId.get(row.program_id) }));
      const picked = ranked.filter(item => item.entry && item.entry.medications.length);
      if (!picked.length || (dualPresentation && picked.length !== 5)) throw new Error(`p19_${family}_eligible_cohort_changed`);
      const renderCard = (item, index) => {
        const full = compactProviderCard(item.entry, registry, doseCapture, logoManifest, {
          coupon: coupons[item.entry.program_id], mode: config.mode, duration: page.duration || null,
          goSurface: { route, position: "provider-card", authority: goAuthority }, rankPosition: index + 1,
        });
        if (!full.includes('data-analytics-event="affiliate_click"')) throw new Error(`p19_${family}_approved_commerce_missing:${item.entry.program_id}`);
        // These are separate commercial comparisons, not extra directory
        // results. Do not let the directory runtime double-count the copies.
        return full.replace(/\sdata-phase3-provider(?=\s|>)/, "")
          .replace('<dl class="p3-card-ledger p3-card-contract"', '<dl data-funnel-v2-price class="p3-card-ledger p3-card-contract"');
      };
      const attrs = item => `data-funnel-v2-provider data-program="${esc(item.row.program_id)}" data-economic-rank="${item.rank}" data-economic-epc="${item.row.network_epc_usd}"`;
      const desktop = `<div class="fv2-table-shell"><table class="fv2-table"><thead><tr><th scope="col">Commercial order</th><th scope="col">Source-backed provider evidence</th></tr></thead><tbody>${picked.map((item, index) => `<tr ${attrs(item)}><td><span class="fv2-rank">${item.rank}</span><strong>${esc(item.entry.provider)}</strong></td><td>${renderCard(item, index)}</td></tr>`).join("")}</tbody></table></div>`;
      const mobile = dualPresentation ? `<div class="fv2-mobile-list">${picked.map((item, index) => `<details ${attrs(item)}><summary>${esc(item.entry.provider)} — open provider evidence</summary>${renderCard(item, index)}</details>`).join("")}</div>` : "";
      const disclosure = `<aside class="fv2-disclosure" id="p19-${family}-disclosure" data-funnel-v2-disclosure>${esc(economics.public_disclosure)}</aside>`;
      const presentations = desktop + mobile;

      const runtime = `<script data-p19-funnel-runtime>(()=>{
const root=document.currentScript.previousElementSibling;
const sync=()=>{
 const p=new URL(location.href).searchParams;
 const drug=p.get("drug"), form=p.get("form"), plan=p.get("plan");
 for(const row of root.querySelectorAll("[data-funnel-v2-provider]")) {
  const card=row.querySelector("[data-drugs]");
  const has=(key,value)=>!value||value==="all"||String(card?.getAttribute(key)||"").split(/\\s+/).includes(value);
  row.hidden=!(has("data-drugs",drug)&&has("data-forms",form)&&(!plan||plan==="all"||root.dataset.p19FixedPlan===plan||has("data-duration",plan)));
 }
 const ids=new Set([...root.querySelectorAll("[data-funnel-v2-provider]")].filter(row=>!row.hidden).map(row=>row.dataset.program));
 root.querySelector("[data-funnel-v2-count]").textContent=ids.size+" commercially ordered provider"+(ids.size===1?" match":"s match")+" this treatment evidence.";
};
sync();window.addEventListener("popstate",sync);
const main=root.closest("main");for(const event of ["click","input","change"])main.addEventListener(event,()=>setTimeout(sync,0));
})();</script>`;
      return `<section class="fv2 p19-frozen-funnel" data-funnel-v2 data-p19-dual="${dualPresentation}" data-p19-fixed-plan="${esc(page.duration_months || "")}"><header class="fv2-head"><div><p class="gcs-kicker">Commercial shortlist</p><h2>Compare the source-backed provider evidence</h2></div><a href="#p19-${family}-disclosure">How this order works</a></header><p class="fv2-count" data-funnel-v2-count>${picked.length} commercially ordered providers match this treatment evidence.</p>${presentations}${disclosure}</section>${runtime}`;
    }
    const initialVisible = 12;
    const cardBodies = providers.map((entry, index) => compactProviderCard(entry, registry, doseCapture, logoManifest, {
      coupon: coupons[entry.program_id], mode: config.mode, duration: page.duration || null,
      goSurface: { route, position: "provider-card", authority: goAuthority }, rankPosition: index + 1,
      initialHidden: archetype === "E" && index >= initialVisible,
    }));
    if ((route === "/providers/" || /^\/lp\/best-providers\/compounded-(?:semaglutide|tirzepatide)\/$/.test(route)) && providers.length) {
      const first = providers[0];
      const action = cardBodies[0].match(/<a class="cs-btn cs-palette-action"[^>]*>Get started<\/a>/)?.[0];
      if (first.medications.length && action) {
        atfPreview = `<section class="p3-atf-price" data-atf-result data-atf-program="${esc(first.program_id)}" aria-label="First source-backed comparison result"><p>First comparison card, not a treatment recommendation or a claim of state availability.</p><strong>${esc(first.provider)}</strong><div data-atf-price>${first.medications.map(row => sourcePrice(row, 'preview', { showDate: archetype !== 'C' })).join('')}</div>${action}</section>`;
      }
    }
    if (stateUnknownProviders.length) below += `<section class="p3-provider-section" data-state-unverified-remainder aria-labelledby="state-unverified-title"><h2 id="state-unverified-title">State availability not established</h2><p>These source-backed records have not established state availability. A published price is not confirmation of access or treatment eligibility; check directly with the provider.</p><div class="p3-provider-grid">${stateUnknownProviders.map((entry) => compactProviderCard(entry, registry, doseCapture, logoManifest, { mode: config.mode, stateUnverified: true })).join("")}</div></section>`;
    // Operator 2026-09-18: payout order on the PAID landing pages only (OPERATOR-DECISION-20260918-paid-page-payout-order).
    if (["/lp/best-providers/compounded-semaglutide/", "/lp/best-providers/compounded-tirzepatide/"].includes(route)) below += p19RestoredFunnel("R11", false);
    if (unknownPrograms.length) below += `<section data-provider-evidence-pending><h2>Additional provider profiles</h2><p>These registry profiles do not yet have the source-backed facts required for a comparison card. They remain available as profiles, not confirmed cards or a claim of availability.</p><ul>${unknownPrograms.map(({ program, entry }) => `<li data-price-state-provider="${esc(program.review_slug || program.program_id)}"><a href="${esc(canonicalReviewPath(program, registry) || `/providers/${program.program_id}/`)}">${esc(program.display_name)}</a>${entry && !entry.medications.length ? `<p>${esc(priceStateText(entry))}</p>` : ""}</li>`).join("")}</ul></section>`;
    cards = cardBodies.map((card, index) => {
      // Preserve the build's lazy payload contract, with complete initial E cards.
      if (!((archetype === "E" && index >= initialVisible) || (page.slug === "wegovy"))) return card;
      const entry = providers[index];
      const deferred = deferProviderCard(card, entry, payload.length);
      payload.push(deferred.body);
      return deferred.placeholder;
    }).join("");
    count = cardBodies.length;
    if (archetype !== "E") {
      const unpublished = unpublishedProviderCards(page, [...providers, ...stateUnknownProviders], registry, logoManifest, { mode: config.mode, coupons, goAuthority });
      hasNonpriced = unpublished.entries.length > 0;
      if (unpublished.entries.length) below += `<section class="p3-provider-section" data-unpublished-provider-section aria-labelledby="unpriced-records-title"><h2 id="unpriced-records-title">Records without a comparable price</h2><p>These source-backed records have no comparable published price for this selection. They are outside numeric results and do not establish availability.</p><div class="p3-provider-grid">${unpublished.cards}</div></section>`;
    }
    if (archetype === "E") {
      const finalRows = providers.flatMap(entry => {
        const record = registryRecord(entry, registry);
        if (!record) throw new Error(`directory_pricing_registry_identity_missing:${entry.program_id}`);
        return entry.medications.map((price, index) => ({ program_id: entry.program_id, id: isTypedPrice(price) ? price.row_id : `${entry.program_id}:${index}`, provider: entry.provider, review: canonicalReviewPath(record, registry), price }));
      });
      const pricedProviderCount = new Set(finalRows.map(row => row.program_id)).size;
      below += `${finalsCss()}<section class="d3-directory-prices" data-directory-pricing data-directory-pricing-rows="${finalRows.length}" data-directory-pricing-provider-count="${pricedProviderCount}" aria-labelledby="directory-pricing-title"><h2 id="directory-pricing-title">Reported plan prices and billing terms</h2><p>These reported medication and plan rows are a pricing subset, not the total live-provider count. Provider filters do not change this source ledger.</p>${renderDirectoryFinal(finalRows, url => renderCitationAnchor({ url, label: "Source", reason: CITATION_REASONS.FIRST_PARTY_PRICE_EVIDENCE, rel: "noopener noreferrer" }))}</section>`;
      const remaining = Math.max(0, count - initialVisible);
      resultTail += `<button class="cs-btn cs-btn--quiet p3-load-more" type="button" data-provider-load-more${remaining ? "" : " hidden"}>Show ${Math.min(PROVIDER_REVEAL_BATCH_SIZE, remaining)} more providers</button>`;
      // P19 R11 RESTORE is limited to the explicitly approved route cohort.
      // p19RestoredFunnel fails closed without a superseding commercial-order receipt.
      below += `<p data-provider-source-attribution><strong>Where this comes from.</strong> Provider names, prices and program details are taken from each provider's own published pages, with the date we checked shown next to every fact. We don't estimate availability, guess whether a program suits you, or invent ratings or review counts. This describes the confirmed cards above; the additional registry profiles still need evidence checks.</p>`;
    }
    if (archetype === "C") below += '<div class="listing__category-art"><div class="p3-category-orb" aria-hidden="true"></div></div><aside class="p3-evidence-boundary"><strong>Evidence boundary.</strong> Compounded drugs are not FDA-approved. Clinic Scout does not determine eligibility, formulation quality, dose, treatment suitability, or state availability.</aside>';
    if (archetype === "A") below += '<aside class="p3-evidence-boundary">A lower per-month figure can require a larger upfront payment or longer commitment. The cited provider wording controls; Clinic Scout does not invent bundle math.</aside>';
    if (archetype === "B") {
      const cheapest = providers[0]?.medications.slice().sort((a, b) => a.ongoing_usd - b.ongoing_usd)[0] || null;
      const siblingSlug = { "wegovy-pill": "wegovy", wegovy: "ozempic", ozempic: "wegovy", mounjaro: "zepbound", zepbound: "mounjaro" }[page.slug];
      const sibling = graph.brand_pages.find(item => item.slug === siblingSlug);
      if (!sibling) throw new Error(`phase3_brand_sibling_missing:${page.slug}`);
      below += `${insuranceWizard(page, cheapest)}<nav class="p3-brand-journey" aria-label="Other comparison paths"><p><a class="p3-card-link" data-brand-sibling href="${esc(sibling.route)}">Looking for ${esc(sibling.name)} instead?</a></p><p><a class="cs-btn cs-palette-action" data-curated-self-pay href="/self-pay/">Prefer to self-pay? See self-pay options</a></p></nav>${medicationTabs(graph, route)}${productSelector(graph, route)}${relatedProductShelf(page, graph)}`;
    }
  }
  below += renderPhase3RelatedInsightsShelf(page, articles);
  const schema = pageSchemaGraph(
    breadcrumbSchema(route, [{ href: "/", label: "Home" }, { ...(archetype === "A" ? { href: "/bulk/", label: "Bulk plans" } : route === "/providers/" || pharmacy || selfPay ? { label: heading } : { href: "/providers/", label: "Providers" }) }, ...(!pharmacy && !selfPay && route !== "/providers/" ? [{ label: heading }] : [])]),
    panel.schema,
    !pharmacy ? providerItemListSchema(route, route === "/providers/" ? "GLP-1 provider comparison" : heading, providers, registry) : null,
  );
  const seo = route === "/providers/" ? pageSeoCopy(route) : null;
  return listingDocument({ archetype, route, title: seo?.title ?? `${heading} · Clinic Scout`, description: seo?.meta ?? support, heading, support, count, controls, cards, atfPreview,
    panel: panel.html, afterGrid: below + reverseIndex + (route === '/providers/' ? approvedDirectoryLinks() : ''), schema, initialVisible: archetype === "E" ? 12 : null,
    profileCount: route === "/providers/" ? livePrograms.length : null,
    hasNonpriced,
    resultTail: `${resultTail}${payload.length ? `<script type="application/json" data-provider-card-payloads>${JSON.stringify(payload).replaceAll("<", "\\u003c")}</script>` : ""}`,
    runtime: pharmacy ? "" : doseSelectionRuntime(),
  });
}

import { loadApprovedDirectoryRegistry } from './private-approved-directory.mjs';

export function approvedDirectoryLinks() {
  const approved = loadApprovedDirectoryRegistry();
  const authority = loadGoPromotionAuthority().programs || {};
  const emed = approved.programs.find((item) => item.registry_id === 'partnerize-1011l6645');
  return [emed, ...(approved.approved_directory_programs || [])].filter((row) => {
    if (row?.canonical_vertical !== 'glp1-weightloss' || row.enumeration_class !== 'provider_joined_or_approved_exact_id'
        || authority[row.registry_id]?.status !== 'VERIFIED' || authority[row.registry_id]?.promotion_authorized !== true) return false;
    const href = row.tracking?.provider_issued_url;
    if (!href) return false;
    const host = new URL(href).hostname;
    return row.directory_only
      ? row.network === 'ClickDealer' && row.tracking.tracking_host === host && authority[row.registry_id].issued_link_sha256 === row.tracking.issued_link_sha256
      : (approved.allowed_provider_tracking_hosts?.[row.network] || []).includes(host);
  }).map((row) => {
    const href = row.tracking.provider_issued_url;
    const attrs = subidAttributes({ programId: row.registry_id, network: row.network, position: 'provider-card', pageSlug: 'providers', pageType: 'provider-directory', providerSlug: row.registry_id, href, renderedHref: href });
    return `<section class="p3-provider-section" data-approved-directory-provider="${esc(row.registry_id)}"><h2>More GLP-1 providers</h2><h3>${esc(row.display_name)}</h3><p>Confirm current program details and eligibility with the provider. No price or comparative rating is published here.</p><p class="affiliate-note">We may earn a commission if you use this link, at no extra cost to you.</p><a class="cta secondary" href="${esc(href)}" target="_blank" rel="sponsored nofollow noopener noreferrer" data-program="${esc(row.registry_id)}" data-affiliate-state="active" ${attrs} data-analytics-event="affiliate_click">Visit ${esc(row.display_name)}</a></section>`;
  }).join('');
}

function renderComparisonPreset(page, { pricingMatrix, registry, logoManifest, coupons, goAuthority }) {
  const medicationIds = page.medication_ids;
  const liveIds = new Set(liveCanonicalProviderPrograms(registry).flatMap(program => [program.program_id, program.review_slug].filter(Boolean)));
  const entries = new Map();
  for (const entry of Object.values(pricingMatrix.providers || {})) {
    const record = registryRecord(entry, registry);
    if (!record || !liveIds.has(entry.program_id) || !providerCardEligible(entry.program_id) || /fella/i.test(entry.program_id)) continue;
    const mode = affiliateOutboundMode(record, COMPARE_AFFILIATE_MAP[entry.program_id], goAuthority.programs?.[entry.program_id]);
    if (!["go", "transparent_direct"].includes(mode)) continue;
    const medications = (entry.medications || []).filter(row => medicationIds.includes(row.medication_id) && (isTypedPrice(row) || Number.isFinite(row.ongoing_usd)));
    if (medications.length) entries.set(entry.program_id, { ...entry, record, medications, offers: [] });
  }
  const unpublished = selectUnpublishedProviders({ registry, affiliateMap: COMPARE_AFFILIATE_MAP, goAuthority, pricedProviders: [], medicationIds, offerEvidence: UNPUBLISHED_OFFER_EVIDENCE });
  for (const entry of unpublished) {
    if (!liveIds.has(entry.program_id)) continue;
    const existing = entries.get(entry.program_id);
    if (existing) existing.offers = entry.offers;
    else entries.set(entry.program_id, { ...entry, medications: [] });
  }
  // Emit the union before filtering. Keep each medication's quotes and plan
  // terms together; never borrow a term or price from the other medication.
  const candidates = [...entries.values()].flatMap(entry => medicationIds.flatMap(medicationId => {
    const medications = entry.medications.filter(row => row.medication_id === medicationId);
    const offers = entry.offers.filter(offer => offer.medication_id === medicationId);
    if (!medications.length && !offers.length) return [];
    const terms = [...new Set([...medications.map(comparisonTerm), ...offers.flatMap(offer => offer.duration_months)].filter(term => term === 1 || term === 3))];
    if (page.slug === "both" && !terms.length) return [];
    return [{ ...entry, medications, offers, medicationId, terms }];
  })).sort((a, b) => a.provider.localeCompare(b.provider));
  const cards = candidates.map(entry => {
    const coverage = providerStateCoverage(PROGRAM_LEDGER_BY_ID.get(entry.program_id));
    const bindings = [...new Map(entry.offers.flatMap(offer => offer.evidence).map(binding => [binding.capture_sha256, binding])).values()];
    const sources = bindings.map(binding => `<small data-source-checked="${esc(binding.checked_date)}">${renderCitationAnchor({ url: binding.source_url, label: "Treatment source", reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "noopener noreferrer" })}</small>`).join("");
    const stateSource = coverage.source ? renderCitationAnchor({ url: coverage.source, label: "State coverage source", reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "noopener noreferrer" }) : "";
    const cash = entry.medications.filter(row => !isTypedPrice(row) && comparisonTerm(row) === 1);
    const review = canonicalReviewPath(entry.record, registry) || `/providers/${entry.record.program_id}/`;
    return `<article class="p3-provider-card cs-card" data-phase3-provider data-comparison-card data-program="${esc(entry.program_id)}" data-provider-name="${esc(entry.provider)}" data-drugs="${esc(medicationToken(entry.medicationId))}" data-medications="${esc(entry.medicationId)}" data-forms="COMPOUNDED" data-duration="${esc(entry.terms.join(" ") || "unknown")}" data-monthly-price="${cash.length === 1 ? esc(cash[0].ongoing_usd) : ""}" data-state-mode="${esc(coverage.mode)}" data-state-includes="${esc(coverage.included.join(" "))}" data-state-excludes="${esc(coverage.excluded.join(" "))}"><header class="p3-card-header"><p class="gcs-kicker">Reported provider information</p>${providerIdentity(entry, logoManifest)}<p>${esc(entry.medicationId.includes("tirzepatide") ? "Compounded tirzepatide injection" : "Compounded semaglutide injection")}</p>${sources}</header>${comparisonCardBody(page, entry, sourcePrice)}${renderCouponChip(coupons[entry.program_id])}<p data-comparison-state>State availability: confirm with the provider.</p>${stateSource}<div class="p3-card-actions"><a class="cs-btn cs-btn--quiet" data-card-review href="${esc(review)}">Open ${esc(entry.provider)} details</a></div></article>`;
  }).join("");
  const support = page.slug === "both" ? "Compare separately reported monthly and three-month terms for one medication. Missing terms and dose-specific prices remain unestablished." : "Inspect provider information alongside the preset details our sources do not yet establish. Listed providers are not confirmed matches for this preset.";
  const schema = pageSchemaGraph(breadcrumbSchema(page.route, [{ href: "/", label: "Home" }, { label: page.name }]));
  return listingDocument({ archetype: "A", route: page.route, title: `${page.name} · Clinic Scout`, description: support, heading: page.name, support,
    count: candidates.length, controls: comparisonControls(page, STATES, DOSES, SEMAGLUTIDE_DOSES), cards, schema,
    afterGrid: `<aside class="p3-evidence-boundary">Compounded drugs are not FDA-approved. These comparisons do not recommend a dose, schedule, treatment or provider. Eligibility, current supply and prescribing decisions remain with the clinician and provider.</aside>${comparisonStyles()}`,
    runtime: comparisonRuntime(),
  });
}

export function buildPhase3PageGraph({ graph, pharmacyInput, pricingMatrix, programRegistry, homeSpec, articles, couponOffersByProgram = {}, goPromotionAuthority = loadGoPromotionAuthority() }) {
  validatePhase3Graph(graph, pharmacyInput);
  const doseCapture = loadPass2DoseCapture();
  const logoManifest = loadProviderLogoManifest();
  const providerRegistry = phase3Registry(graph, programRegistry);
  const glpArticles = (articles || []).filter((article) => !PHASE3_INSIGHTS_EXCLUSIONS.has(article.canonical_path) && (String(article.vertical || article.focused_vertical || "GLP-1").toUpperCase().includes("GLP") || String(article.canonical_path || "").startsWith("/guides/")));
  const articleRoutes = glpArticles.map((article) => article.canonical_path);
  if (new Set(articleRoutes).size !== articleRoutes.length) throw new Error("phase3_insights_article_route_duplicate");
  if (glpArticles.some((article) => !String(article.canonical_path || "").startsWith("/guides/") || !(article.h1 || article.title))) throw new Error("phase3_insights_article_destination_invalid");
  const listingContext = { graph, pharmacyInput, pricingMatrix, registry: providerRegistry, coupons: couponOffersByProgram, doseCapture, logoManifest, articles: glpArticles, goAuthority: goPromotionAuthority };
  const listing = (archetype, page) => renderConfiguredListing(archetype, page, listingContext);
  const pages = [];
  const add = (route, html, family) => {
    if (['providers-hub', 'provider-detail'].includes(family)) {
      const page = [...graph.brand_pages, ...graph.compounded_pages, ...graph.bulk_pages].find(item => item.route === route);
      const medicationIds = page ? (page.medication_ids || [page.medication_id]) : null;
      const programId = family === 'provider-detail' ? route.split('/')[2] : null;
      // Suppress only exact typed plan rows already rendered by D3b; keep every
      // other source-supported row and S11's eligibility/direct-hold predicates.
      const renderedRowIds = new Set([...html.matchAll(/data-price-row-id="([^"]+)"/g)].map(match => match[1]));
      const information = renderPhase3TypedOffers({ pricingMatrix, registry: providerRegistry, medicationIds, programId, bulk: family === 'bulk-hub' || family === 'bulk-intent', renderedRowIds });
      if (information && /^\/lp\/best-providers\/compounded-(?:semaglutide|tirzepatide)\/$/.test(route)) {
        const panel = `<details class="p3-typed-offer-panel"><summary>Reported plan information and dated price sources</summary>${information}</details>`;
        html = html.replace('<aside class="p3-evidence-boundary">', `${panel}<aside class="p3-evidence-boundary">`);
      } else if (information) html = html.replace('</main>', `${information}</main>`);
    }
    pages.push({ route, file: routeFile(route), html, family });
  };
  add("/providers/", listing("E", { route: "/providers/", slug: "providers", name: pageSeoCopy("/providers/")?.h1 || "Compare weight loss providers" }), "providers-hub");
  for (const page of graph.organic_compounded_pages) {
    const meta = getCompoundedCategoryMetadata(page.medication);
    const crumbs = [{ href: "/", label: "Home" }, { href: "/providers/", label: "Providers" }, { label: `Compounded ${page.medication}` }];
    const body = `${breadcrumbs(crumbs)}${renderCompoundedCategoryBody({medication:page.medication, programs:liveCanonicalProviderPrograms(providerRegistry), pricingMatrix, registry:providerRegistry, coupons:couponOffersByProgram, linksNotice:sourceDisclosure()})}`;
    add(page.route, pageDocument({route:page.route, title:meta.title, description:meta.description, body, schema:pageSchemaGraph(breadcrumbSchema(page.route, crumbs))}), "organic-compounded-category");
  }
  for (const program of providerRegistry.programs || []) add(`/providers/${program.program_id}/`, renderProviderDetail(program, pricingMatrix, providerRegistry, couponOffersByProgram, doseCapture, logoManifest, pharmacyInput.entries), "provider-detail");
  add("/self-pay/", listing("E", { route: "/self-pay/", slug: "self-pay", name: "Compare self-pay provider prices" }), "self-pay");
  add("/bulk/", renderBulkHub(graph, pricingMatrix), "bulk-hub");
  for (const page of graph.brand_pages) add(page.route, listing("B", page), "brand-product");
  for (const page of graph.compounded_pages) add(page.route, listing("C", page), "compounded-category");
  for (const page of graph.bulk_pages) add(page.route, listing("A", page), "bulk-intent");
  const totalInsightPages = Math.max(1, Math.ceil(glpArticles.length / 12));
  for (let page = 1; page <= totalInsightPages; page += 1) {
    const route = page === 1 ? "/insights/" : `/insights/page/${page}/`;
    add(route, renderInsightsPage(glpArticles, page), "insights-index");
  }
  add("/pharmacies/", listing("D", { route: "/pharmacies/", slug: "pharmacies", name: "Compare compounding pharmacies" }), "pharmacy-hub");
  let pharmacyReversePages = 0;
  for (const entry of pharmacyInput.entries) {
    const relationships = verifiedPharmacyRelationships(entry);
    add(entry.route, renderPharmacyDetail(entry, pharmacyInput.entries, providerRegistry), "pharmacy-detail");
    if (relationships.length) {
      add(`${entry.route}compare-providers/`, renderPharmacyReverse(entry, relationships, providerRegistry, pricingMatrix, logoManifest, couponOffersByProgram), "pharmacy-reverse");
      pharmacyReversePages += 1;
    }
  }
  for (const page of graph.comparison_pages) add(page.route, renderComparisonPreset(page, listingContext), page.kind);
  if (pages.length !== graph.expected_indexable_routes) {
    throw new Error(`phase3_generated_route_count_mismatch:${pages.length}:${graph.expected_indexable_routes}`);
  }
  // Every /lp/ route inherits the paid-landing contract: noindex, no email
  // capture, and exclusion from the sitemap. The pages still exist for direct
  // intent traffic, but calling them indexable would contradict the shipped
  // robots policy and the LP performance gate.
  const indexableRoutes = pages.filter((page) => !page.route.startsWith("/lp/")).map((page) => page.route);
  const redirects = [...graph.retired_evidence_wall_redirects, ...graph.legacy_redirects, ...LEGACY_MEDICATION_REDIRECTS];
  const familyCounts = pages.reduce((counts, page) => ({ ...counts, [page.family]: (counts[page.family] || 0) + 1 }), {});
  return Object.freeze({
    pages,
    indexableRoutes,
    redirects,
    retiredRoutes: graph.retired_evidence_wall_redirects.map(([from]) => from),
    report: {
      schema: "glp-phase3-page-graph-report-v1",
      status: "STAGED_NOT_DEPLOYED",
      generated_routes: pages.length,
      indexable_routes: indexableRoutes.length,
      redirects: redirects.length,
      family_counts: familyCounts,
      brand_pages: graph.brand_pages.length,
      compounded_pages: graph.compounded_pages.length,
      bulk_pages: graph.bulk_pages.length,
      comparison_pages: graph.comparison_pages.length,
      bulk_intents: graph.bulk_intents.length,
      insight_pages: totalInsightPages,
      pharmacy_entries: pharmacyInput.entries.length,
      pharmacy_reverse_pages: pharmacyReversePages,
      live_provider_registry_count: liveCanonicalProviderPrograms(providerRegistry).length,
      source_price_rows: Object.values(pricingMatrix.providers || {}).reduce((sum, entry) => sum + (entry.medications || []).filter((row) => Number.isFinite(row.ongoing_usd)).length, 0),
      homepage_source_rows: homeSpec?.rows?.length || 0,
      public_review_pages: 0,
      deploys: 0,
    },
  });
}

export const phase3PageGraphContract = Object.freeze({
  pageFamilies: ["providers-hub", "provider-detail", "self-pay", "bulk-hub", "brand-product", "compounded-category", "bulk-intent", "cross-duration", "plan-preset", "insights-index", "pharmacy-hub", "pharmacy-detail", "pharmacy-reverse"],
  brandedRenderDisclosure: "representative editorial visualization; not retail-package photography",
  durationPolicyByBrand: Object.freeze({ "wegovy-pill": Object.freeze([1, 3, 6, 12]), wegovy: Object.freeze([]) }),
  crossRouting: Object.freeze(["brand-product", "compounded-category"]),
  wrapHooks: Object.freeze(["data-wrap-card", "data-wrap-text", "data-wrap-actions", "data-wrap-chips"]),
  insightsAnatomy: Object.freeze(["hero", "featured", "three-card-supporting-row", "stable-pagination", "complete-article-destination"]),
  copiedCompetitorClaims: false,
  inventedPrices: false,
  inventedDosePrices: false,
  publicReviewPages: false,
  deployment: "forbidden",
});
