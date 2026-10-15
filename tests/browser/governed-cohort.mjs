import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveIdentityGroups } from "../../src/provider-identity.mjs";
import { projectProviderDisplayFacts } from "../../src/provider-display-evidence.mjs";
import { priceStateText } from "../../src/price-state.mjs";
import { isTypedPrice } from "../../src/typed-price-labels.mjs";
import { currentComparisonPrograms } from '../helpers/current-comparison-cohort.mjs';

const readData = (file) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${file}`, import.meta.url)), "utf8"));
import { loadGoPromotionAuthority } from '../../src/go-runtime-selection.mjs';
const networkPaused = (id) => {
  const authority=loadGoPromotionAuthority().programs?.[id];
  return authority?.relationship_snapshot?.lifecycle==='paused'
    || /(?:network_paused|xentraffic_offer_\d+_paused)/.test(authority?.reason || '');
};

export function governedProviderIds() {
  const sourceRegistry = readData("program-registry.json");
  const additions = readData("phase3-page-graph.json").provider_work_order_additions;
  const identityOnly = new Set(sourceRegistry.programs.filter((row) => {
    const profile = row.profiles?.["glp-clinic-scout"];
    return profile?.canonical_identity?.role === "alias"
      && profile?.surfaces?.review === false && profile?.surfaces?.sitemap === false;
  }).map((row) => row.program_id));
  const programs = sourceRegistry.programs.filter((row) => !identityOnly.has(row.program_id));
  for (const row of additions) {
    if (!identityOnly.has(row.program_id) && !programs.some((program) => program.program_id === row.program_id)) programs.push(row);
  }
  const registry = { ...sourceRegistry, programs };
  const ledger = readData("program-content-ledger.json").programs;
  const facts = readData("provider-facts-backfill-20260830.json").programs;
  const aliases = deriveIdentityGroups(registry, "glp-clinic-scout", ledger).aliasIds;
  const ledgerById = new Map(ledger.map((row) => [row.program_id, row]));
  const factsById = new Map(facts.map((row) => [row.program_id, row]));
  const reported = (fact) => fact?.status === "SOURCE_REPORTED" && fact.value && fact.source_url && fact.capture_date;
  const eligible = (id) => {
    const row = factsById.get(id);
    const evidence = ledgerById.get(id);
    return Boolean(row?.display_name && evidence?.meds_offered && evidence?.source_url
      && reported(row.facts?.total_monthly_cost) && reported(row.facts?.cancellation));
  };
  return currentComparisonPrograms(registry).filter((row) => {
    const profile = row.profiles?.["glp-clinic-scout"];
    return row.commercial_state === "live" && profile?.vertical_fit === true
      && profile?.wired === true && profile?.surfaces?.review === true
      && !aliases.has(row.program_id)
      && (eligible(row.review_slug || row.program_id) || eligible(row.program_id));
  }).map((row) => row.review_slug || row.program_id);
}

export async function hydrateAllProviderCards(page) {
  const more = page.locator("[data-provider-load-more]");
  while (await more.isVisible()) await more.click();
  return page.locator("#provider-results [data-phase3-provider]");
}

export function governedBulkCohorts(drug, months) {
  const medicationId = `compounded-${drug.toLowerCase()}-injection`;
  const allowed = new Set(governedProviderIds());
  const registry = readData("program-registry.json");
  const offers = readData("unpublished-offer-evidence.json").offers;
  const matrix = readData("provider-pricing-matrix.json").providers;
  const duration = (row) => {
    const text = `${row.quote || ""} ${row.notes || ""}`.replace(/[–—]/g, "-");
    return (months === 3 ? [3] : [6, 12]).some((value) => new RegExp(`\\b${value}\\s*[- ]?\\s*(?:months?|mos?)\\b`, "i").test(text));
  };
  const numeric = Object.values(matrix).filter((row) => allowed.has(row.program_id)
    && row.medications?.some((medication) => medication.medication_id === medicationId
      && Number.isFinite(medication.ongoing_usd) && duration(medication))).map((row) => row.program_id);
  const unpriced = registry.programs.filter((row) => row.commercial_state === "live"
    && !networkPaused(row.program_id)
    && !/(?:^|-)fella(?:-|$)/.test(row.program_id) && !numeric.includes(row.program_id)
    && offers.some((offer) => offer.program_id === row.program_id && offer.medication_id === medicationId
      && offer.duration_months.some((durationMonths) => months === 3 ? durationMonths === 3 : durationMonths >= 6)))
    .map((row) => row.program_id);
  return { numeric, unpriced };
}

export function governedUnpricedIds(drug) {
  const medicationId = `compounded-${drug.toLowerCase()}-injection`;
  const registry = readData("program-registry.json");
  const offers = readData("unpublished-offer-evidence.json").offers;
  const matrix = readData("provider-pricing-matrix.json").providers;
  const priced = new Set(Object.values(matrix).filter((row) => row.medications?.some((medication) =>
    medication.medication_id === medicationId && Number.isFinite(medication.ongoing_usd))).map((row) => row.program_id));
  return registry.programs.filter((row) => row.commercial_state === "live" && !priced.has(row.program_id)
    && !networkPaused(row.program_id)
    && !/(?:^|-)fella(?:-|$)/.test(row.program_id)
    && offers.some((offer) => offer.program_id === row.program_id && offer.medication_id === medicationId))
    .map((row) => row.program_id);
}

export function governedPaidPrimaryIds(drug) {
  const medicationId = `compounded-${drug.toLowerCase()}-injection`;
  const allowed = new Set(governedProviderIds());
  const ledger = new Map(readData("program-content-ledger.json").programs.map((row) => [row.program_id, row]));
  const matrix = readData("provider-pricing-matrix.json").providers;
  return Object.values(matrix).filter((row) => {
    const stateText = String(ledger.get(row.program_id)?.research_states_served?.value || "");
    const evidencedState = /\b(?:all|every)\b[^.]*\bstates?\b|\bexcept\b|\bexcluding\b|\b(?:include|includes)\b[^.]*\b[A-Z]{2}\b/i.test(stateText);
    return allowed.has(row.program_id) && evidencedState
      && row.medications?.some((medication) => medication.medication_id === medicationId && Number.isFinite(medication.ongoing_usd));
  }).sort((left, right) => {
    const price = (row) => Math.min(...row.medications.filter((medication) => medication.medication_id === medicationId).map((medication) => medication.ongoing_usd));
    return price(left) - price(right) || left.provider.localeCompare(right.provider);
  }).map((row) => row.program_id);
}

export function governedWegovyIds() {
  const matrix = readData("provider-pricing-matrix.json").providers;
  const allowed = new Set(governedProviderIds());
  return Object.values(matrix).filter((row) => allowed.has(row.program_id)
    && row.medications?.some((medication) => medication.medication_id === "brand-wegovy"
      && Number.isFinite(medication.ongoing_usd)))
    .sort((left, right) => Math.min(...left.medications.filter((row) => row.medication_id === "brand-wegovy").map((row) => row.ongoing_usd))
      - Math.min(...right.medications.filter((row) => row.medication_id === "brand-wegovy").map((row) => row.ongoing_usd)))
    .map((row) => row.program_id);
}

export function governedWegovyUnpricedIds() {
  const priced = new Set(governedWegovyIds());
  const live = new Set(readData("program-registry.json").programs.filter((row) =>
    row.commercial_state === "live").map((row) => row.program_id));
  return [...new Set(readData("unpublished-offer-evidence.json").offers
    .filter((offer) => offer.medication_id === "brand-wegovy" && live.has(offer.program_id)
      && !priced.has(offer.program_id) && offer.program_id !== "fella-health")
    .map((offer) => offer.program_id))].sort();
}

export function governedReviewDirectoryCount() {
  const registry = readData("program-registry.json");
  const ledger = readData("program-content-ledger.json").programs;
  const aliases = deriveIdentityGroups(registry, "glp-clinic-scout", ledger).aliasIds;
  const reviews = registry.programs.filter((row) => !aliases.has(row.program_id)
    && /^\/reviews\/[a-z0-9-]+\/$/.test(row.review_path || ""));
  const pharmacies = readData("phase3-pharmacy-render-input.json").entries.filter((row) =>
    row.slug && row.display_name && /^\/pharmacies\/[a-z0-9-]+\/$/.test(row.route || ""));
  return reviews.length + pharmacies.length;
}

// Source-derived cohorts: never infer expected membership from emitted card IDs.
export function governedExcludedIds() {
  const registry = readData("program-registry.json");
  const aliases = deriveIdentityGroups(registry, "glp-clinic-scout", readData("program-content-ledger.json").programs).aliasIds;
  return registry.programs.filter((row) => aliases.has(row.program_id)
    || /(?:^|-)fella(?:-|$)/.test(row.program_id)
    || row.commercial_state === "held"
    || row.profiles?.["glp-clinic-scout"]?.surfaces?.compare === false).map((row) => row.program_id).sort();
}

export function governedCardFacts(programId) {
  const ledger = readData("program-content-ledger.json").programs.find((row) => row.program_id === programId);
  const raw = readData("provider-facts-backfill-20260830.json").programs.find((row) => row.program_id === programId);
  if (!ledger?.meds_offered || !raw) throw new Error(`governed_fact_source_missing:${programId}`);
  const facts = projectProviderDisplayFacts(raw).facts;
  const matrix = readData("provider-pricing-matrix.json").providers[programId];
  const comparable = { ...matrix, medications: matrix?.medications?.filter((row) => isTypedPrice(row) || Number.isFinite(row.ongoing_usd)) || [] };
  return { medication: ledger.meds_offered, cost: priceStateText(comparable) || facts.total_monthly_cost.value,
    cancellation: facts.cancellation.value };
}

export function governedCompoundedUnknownIds(drug) {
  const allowed = new Set(governedProviderIds());
  const primary = new Set(governedPaidPrimaryIds(drug));
  const id = `compounded-${drug.toLowerCase()}-injection`;
  return Object.values(readData("provider-pricing-matrix.json").providers)
    .filter((row) => allowed.has(row.program_id) && !primary.has(row.program_id)
      && row.medications?.some((medication) => medication.medication_id === id && Number.isFinite(medication.ongoing_usd)))
    .map((row) => row.program_id).sort();
}

export function governedBrandCohorts(medicationId) {
  const allowed = new Set(governedProviderIds());
  const excluded = new Set(governedExcludedIds());
  const numeric = Object.values(readData("provider-pricing-matrix.json").providers)
    .filter((row) => allowed.has(row.program_id) && row.medications?.some((medication) =>
      medication.medication_id === medicationId && Number.isFinite(medication.ongoing_usd)))
    .map((row) => row.program_id).sort();
  const priced = new Set(numeric);
  const live = new Set(readData("program-registry.json").programs.filter((row) => row.commercial_state === "live"
    && row.profiles?.["glp-clinic-scout"]?.wired === true
    && row.profiles?.["glp-clinic-scout"]?.surfaces?.compare === true
    && !excluded.has(row.program_id)).map((row) => row.program_id));
  const unpriced = [...new Set(readData("unpublished-offer-evidence.json").offers
    .filter((offer) => offer.medication_id === medicationId && live.has(offer.program_id)
      && !priced.has(offer.program_id)).map((offer) => offer.program_id))].sort();
  return { numeric, unpriced };
}
