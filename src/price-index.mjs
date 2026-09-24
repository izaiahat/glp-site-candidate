import { createHash } from "node:crypto";
import { canonicalOrganizationNode, ORGANIZATION_ID } from "./aeo-entity.mjs";
import { projectGoOnlyPriceBasis } from './go-price-basis.mjs';
import { historicalPriceIndexRegistry } from './price-index-historical-registry.mjs';

export const PRICE_INDEX_ROUTE = "/glp-1-price-index/";
export const DISTRIBUTION_FILES = Object.freeze([
  { name: "latest.csv", encodingFormat: "text/csv", label: "GLP-1 Price Index — latest observation (CSV)" },
  { name: "latest.json", encodingFormat: "application/json", label: "GLP-1 Price Index — latest observation (JSON)" },
]);
const CANONICAL_URL = `https://glpclinicscout.com${PRICE_INDEX_ROUTE}`;
const SITE_PROFILE = "glp-clinic-scout";
const MEDICATIONS = ["semaglutide", "tirzepatide"];
const PRICE_INDEX_KEYS = ["methodology", "observations", "publication_state", "records", "route", "schema"];
const METHODOLOGY_KEYS = ["comparison_limitations", "exclusion_rule", "history_policy", "inclusion_rule", "statistic"];
const RECORD_KEYS = ["amount_usd", "billing_basis", "formulation", "id", "medication", "price_phase", "provider_id", "selection_basis"];
const OBSERVATION_KEYS = ["data_as_of", "observed_on", "record_set_sha256", "records", "source_files"];
const OBSERVATION_RECORD_KEYS = [
  "amount_usd", "billing_basis", "formulation", "id", "medication",
  "price_phase", "provider_id", "selection_basis",
];
const SOURCE_FILE_KEYS = ["original_data_study_sha256", "program_content_ledger_sha256", "program_registry_sha256"];
const BILLING_BASES = new Set(["monthly", "monthly_equivalent"]);
const PRICE_PHASES = new Set(["introductory", "starting", "only_published", "bundle_starting"]);
const SELECTION_BASES = new Set([
  "lowest_explicit_monthly",
  "lowest_explicit_monthly_including_microdose",
  "lowest_explicit_monthly_including_oral",
  "lowest_explicit_monthly_equivalent_bundle",
]);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,127}$/;
const FORBIDDEN_SOURCE_HOST = /(?:awin1|dpbolvw|jdoqocy|tkqlhce|katalys|impact|shareasale|clickbank)/i;

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

function assertSafeText(value, code, { min = 1, max = 4000 } = {}) {
  if (typeof value !== "string" || value.trim() !== value || value.length < min || value.length > max || /[<>]/.test(value)) throw new Error(code);
}

function parseNow(value) {
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("price_index_now_invalid");
  return new Date(milliseconds);
}

function sourceFileHashes(value) {
  assertExactKeys(value, SOURCE_FILE_KEYS, "price_index_source_hashes_schema_invalid");
  for (const hash of Object.values(value)) if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("price_index_source_hash_invalid");
  return value;
}

export function normalizePriceIndexSourceHashes(programRegistry, value) {
  programRegistry = historicalPriceIndexRegistry(programRegistry);
  const hashes = { ...sourceFileHashes(value) };
  const taxonomy = programRegistry?.therapeutic_taxonomy;
  if (!taxonomy) return hashes;
  const frozenSource = taxonomy.price_index_registry_frozen_source_sha256;
  const semanticBasis = taxonomy.price_index_registry_programs_semantic_basis_sha256;
  if (!/^[a-f0-9]{64}$/.test(frozenSource || "") || !/^[a-f0-9]{64}$/.test(semanticBasis || "")) {
    throw new Error("price_index_therapeutic_basis_invalid");
  }
  const registryBasis = structuredClone(programRegistry);
  delete registryBasis.therapeutic_taxonomy;
  // Dynamic compare/facet profiles and consumer availability authority are
  // orthogonal evidence attachments. Price-index closure remains bound to the
  // frozen price-bearing program records, while each attachment is validated
  // independently by its own fail-closed surface validator.
  delete registryBasis.provider_dynamic_profiles;
  delete registryBasis.consumer_therapeutic_authorities;
  if (sha256(canonical(projectGoOnlyPriceBasis(registryBasis))) !== semanticBasis) {
    throw new Error("price_index_registry_semantic_basis_drift");
  }
  // Therapeutic evidence is an orthogonal Build 6 attachment. Keep Build 4's
  // source tuple byte-stable only after proving the price-bearing registry body
  // is unchanged; any provider/price registry mutation still fails closed.
  hashes.program_registry_sha256 = frozenSource;
  return hashes;
}

function liveProviderUniverse(programRegistry, contentLedger) {
  if (!Array.isArray(programRegistry?.programs) || !Array.isArray(contentLedger?.programs)) throw new Error("price_index_provider_sources_invalid");
  // Price-index membership is editorial, not affiliate authority. Keep explicit
  // content-fit holds in the dated price record while their commercial carriers
  // stay dark everywhere else.
  const ledgerLiveIds = new Set(contentLedger.programs
    .filter((program) => program.live_link_allowed || program.promotion_authorized
      || program.status === "editorial_link_dark_content_fit_hold")
    .map((program) => String(program.program_id)));
  const rows = programRegistry.programs.filter((program) => {
    const profile = program.profiles?.[SITE_PROFILE];
    return program.commercial_state === "live" && profile?.vertical_fit === true
      && profile?.wired === true && profile?.surfaces?.review === true
      && ledgerLiveIds.has(String(program.review_slug || program.program_id));
  });
  const aliases = rows.filter((program) => program.profiles?.[SITE_PROFILE]?.canonical_identity?.role === "alias");
  const aliasIds = new Set(aliases.map((program) => program.program_id));
  const providers = rows.filter((program) => !aliasIds.has(program.program_id)).map((program) => ({
    ...program,
    index_provider_id: String(program.review_slug || program.program_id),
  }));
  const ids = providers.map((program) => program.index_provider_id);
  if (ids.length < 1 || new Set(ids).size !== ids.length) throw new Error("price_index_provider_universe_invalid");
  return providers.sort((left, right) => left.index_provider_id.localeCompare(right.index_provider_id));
}

function evidenceFor(program, medication, amount) {
  const evidence = program?.research_first_month_price;
  if (!isObject(evidence)) throw new Error(`price_index_first_party_evidence_missing:${program?.program_id}`);
  for (const key of ["quote", "source_url", "value", "verified_as_of"]) assertSafeText(evidence[key], `price_index_first_party_evidence_invalid:${program.program_id}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.verified_as_of)) throw new Error(`price_index_source_date_invalid:${program.program_id}`);
  let source;
  try { source = new URL(evidence.source_url); } catch { throw new Error(`price_index_source_url_invalid:${program.program_id}`); }
  if (source.protocol !== "https:" || source.username || source.password || source.port || FORBIDDEN_SOURCE_HOST.test(source.hostname)) throw new Error(`price_index_source_url_invalid:${program.program_id}`);
  const text = [evidence.quote, evidence.value, program.starting_price].join(" ");
  const amountPattern = new RegExp(`\\$${String(amount).replace(".", "\\.")}(?![0-9])`);
  if (!amountPattern.test(text)) throw new Error(`price_index_amount_not_in_evidence:${program.program_id}:${medication}:${amount}`);
  if (!text.toLowerCase().includes(medication)) throw new Error(`price_index_medication_not_in_evidence:${program.program_id}:${medication}`);
  const compoundingEvidence = [program.meds_offered, program.research_pharmacy_type?.value].filter(Boolean).join(" ");
  if (!/compound/i.test(compoundingEvidence)) throw new Error(`price_index_compounding_evidence_missing:${program.program_id}`);
  return evidence;
}

export function snapshotPriceIndexRows(records) {
  return records.map((record) => ({
    id: record.id,
    provider_id: record.provider_id,
    medication: record.medication,
    formulation: record.formulation,
    billing_basis: record.billing_basis,
    price_phase: record.price_phase,
    selection_basis: record.selection_basis,
    amount_usd: record.amount_usd,
  }));
}

function comparisonIdentity(record) {
  // The record id is the stable form identity. Provider and medication remain
  // explicit so similarly named forms from different providers can never
  // collide during latest-vs-prior comparisons.
  return `${record.provider_id}|${record.medication}|${record.id}`;
}

export function migratePriceIndexHistoryV1ToV2(tracker) {
  const output = structuredClone(tracker);
  const config = output?.price_index;
  if (!isObject(config)) throw new Error("price_index_migration_config_missing");
  if (config.schema === "glp-clinic-scout-price-index-v2") return { tracker: output, migrated: false };
  if (config.schema !== "glp-clinic-scout-price-index-v1") throw new Error("price_index_migration_source_schema_invalid");
  if (!Array.isArray(config.records) || !Array.isArray(config.observations) || !config.observations.length) throw new Error("price_index_migration_source_invalid");
  const currentById = new Map(config.records.map((record) => [record.id, record]));
  for (const observation of config.observations) {
    if (!Array.isArray(observation.records) || !observation.records.length) throw new Error("price_index_migration_observation_invalid");
    observation.records = observation.records.map((legacy) => {
      assertExactKeys(legacy, ["amount_usd", "id"], "price_index_migration_legacy_row_invalid");
      const current = currentById.get(legacy.id);
      if (!current) throw new Error(`price_index_migration_identity_unavailable:${legacy.id}`);
      return {
        id: current.id,
        provider_id: current.provider_id,
        medication: current.medication,
        formulation: current.formulation,
        billing_basis: current.billing_basis,
        price_phase: current.price_phase,
        selection_basis: current.selection_basis,
        amount_usd: legacy.amount_usd,
      };
    });
    observation.record_set_sha256 = sha256(canonical(observation.records));
  }
  config.schema = "glp-clinic-scout-price-index-v2";
  return { tracker: output, migrated: true };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

function deriveMetrics(records) {
  return MEDICATIONS.map((medication) => {
    const amounts = records.filter((record) => record.medication === medication).map((record) => record.amount_usd);
    if (!amounts.length) throw new Error(`price_index_medication_empty:${medication}`);
    const minimum = Math.min(...amounts);
    const maximum = Math.max(...amounts);
    return {
      medication,
      provider_count: amounts.length,
      median_usd: median(amounts),
      min_usd: minimum,
      max_usd: maximum,
      spread_usd: Number((maximum - minimum).toFixed(2)),
    };
  });
}

function deriveMovers(observations, records, providersById) {
  if (observations.length < 2) return { status: "NO_PRIOR_OBSERVED_WEEK", previous_observed_on: null, movers: [] };
  const previous = observations.at(-2);
  const priorByIdentity = new Map(previous.records.map((record) => [comparisonIdentity(record), record.amount_usd]));
  const movers = records.flatMap((record) => {
    const prior = priorByIdentity.get(comparisonIdentity(record));
    if (!Number.isFinite(prior) || prior === record.amount_usd) return [];
    const delta = Number((record.amount_usd - prior).toFixed(2));
    return [{
      id: record.id,
      provider: providersById.get(record.provider_id)?.display_name || record.provider_id,
      medication: record.medication,
      prior_amount_usd: prior,
      current_amount_usd: record.amount_usd,
      delta_usd: delta,
    }];
  }).sort((left, right) => Math.abs(right.delta_usd) - Math.abs(left.delta_usd) || left.id.localeCompare(right.id));
  return { status: movers.length ? "OBSERVED_MOVERS" : "NO_OBSERVED_PRICE_CHANGES", previous_observed_on: previous.observed_on, movers: movers.slice(0, 5) };
}

export function validatePriceIndexInputs({ tracker, study, programRegistry, contentLedger, sourceHashes }, { now = Date.now() } = {}) {
  const nowDate = parseNow(now);
  let hashes = sourceFileHashes(sourceHashes);
  const config = tracker?.price_index;
  assertExactKeys(config, PRICE_INDEX_KEYS, "price_index_schema_invalid");
  if (config.schema !== "glp-clinic-scout-price-index-v2" || config.route !== PRICE_INDEX_ROUTE || config.publication_state !== "PUBLIC_INDEXABLE") throw new Error("price_index_authority_invalid");
  assertExactKeys(config.methodology, METHODOLOGY_KEYS, "price_index_methodology_schema_invalid");
  for (const value of Object.values(config.methodology)) assertSafeText(value, "price_index_methodology_invalid", { min: 30, max: 4000 });
  if (study?.schema !== "glp-clinic-scout-original-data-study-v2" || typeof study.study_id !== "string" || study.source_ledger?.ledger_payload_sha256 !== tracker?.source_ledger?.ledger_payload_sha256) throw new Error("price_index_original_study_lineage_invalid");

  // Historical editorial membership is isolated from today's commercial HOLD.
  // The owner projection authenticates the exact whole price basis first; the
  // live selector itself remains unchanged and accepts no arbitrary held row.
  const priceRegistry = historicalPriceIndexRegistry(programRegistry, contentLedger);
  const providers = liveProviderUniverse(priceRegistry, contentLedger);
  const providersById = new Map(providers.map((program) => [program.index_provider_id, program]));
  const ledgerById = new Map(contentLedger.programs.map((program) => [program.program_id, program]));
  if (!Array.isArray(config.records) || config.records.length < 2) throw new Error("price_index_records_invalid");
  const recordIds = new Set();
  const providerMedicationIds = new Set();
  const evidenceByRecord = new Map();
  for (const record of config.records) {
    assertExactKeys(record, RECORD_KEYS, "price_index_record_schema_invalid");
    if (!SAFE_ID.test(record.id) || !SAFE_ID.test(record.provider_id) || !MEDICATIONS.includes(record.medication)
      || !BILLING_BASES.has(record.billing_basis) || !PRICE_PHASES.has(record.price_phase)
      || !SELECTION_BASES.has(record.selection_basis) || !Number.isFinite(record.amount_usd)
      || record.amount_usd <= 0 || record.amount_usd > 10_000) throw new Error("price_index_record_invalid");
    assertSafeText(record.formulation, "price_index_formulation_invalid", { max: 120 });
    if (recordIds.has(record.id)) throw new Error("price_index_record_id_duplicate");
    recordIds.add(record.id);
    const identity = `${record.provider_id}:${record.medication}`;
    if (providerMedicationIds.has(identity)) throw new Error("price_index_provider_medication_duplicate");
    providerMedicationIds.add(identity);
    if (!providersById.has(record.provider_id) || !ledgerById.has(record.provider_id)) throw new Error(`price_index_nonlive_provider:${record.provider_id}`);
    evidenceByRecord.set(record.id, evidenceFor(ledgerById.get(record.provider_id), record.medication, record.amount_usd));
  }

  if (!Array.isArray(config.observations) || !config.observations.length) throw new Error("price_index_observation_history_missing");
  let priorDate = "";
  for (const observation of config.observations) {
    assertExactKeys(observation, OBSERVATION_KEYS, "price_index_observation_schema_invalid");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observation.observed_on) || !/^\d{4}-\d{2}-\d{2}$/.test(observation.data_as_of)
      || observation.observed_on <= priorDate || observation.observed_on > nowDate.toISOString().slice(0, 10)) throw new Error("price_index_observation_date_invalid");
    priorDate = observation.observed_on;
    sourceFileHashes(observation.source_files);
    if (!/^[a-f0-9]{64}$/.test(observation.record_set_sha256) || !Array.isArray(observation.records) || !observation.records.length) throw new Error("price_index_observation_invalid");
    const seenIds = new Set();
    const seenIdentities = new Set();
    for (const row of observation.records) {
      assertExactKeys(row, OBSERVATION_RECORD_KEYS, "price_index_observation_record_schema_invalid");
      if (!SAFE_ID.test(row.id) || !SAFE_ID.test(row.provider_id) || !MEDICATIONS.includes(row.medication)
        || !BILLING_BASES.has(row.billing_basis) || !PRICE_PHASES.has(row.price_phase)
        || !SELECTION_BASES.has(row.selection_basis) || !Number.isFinite(row.amount_usd)
        || row.amount_usd <= 0 || row.amount_usd > 10_000) throw new Error("price_index_observation_record_invalid");
      assertSafeText(row.formulation, "price_index_observation_formulation_invalid", { max: 120 });
      const identity = comparisonIdentity(row);
      if (seenIds.has(row.id) || seenIdentities.has(identity)) throw new Error("price_index_observation_record_duplicate");
      seenIds.add(row.id);
      seenIdentities.add(identity);
    }
    if (sha256(canonical(observation.records)) !== observation.record_set_sha256) throw new Error("price_index_observation_record_hash_invalid");
  }
  const latest = config.observations.at(-1);
  if (canonical(latest.records) !== canonical(snapshotPriceIndexRows(config.records))) throw new Error("price_index_latest_observation_not_current");
  if (canonical(latest.source_files) !== canonical(hashes)) {
    hashes = normalizePriceIndexSourceHashes(programRegistry, hashes);
  }
  if (canonical(latest.source_files) !== canonical(hashes)) throw new Error("price_index_latest_source_hashes_not_current");
  const dataAsOf = [...evidenceByRecord.values()].map((evidence) => evidence.verified_as_of).sort().at(-1);
  if (latest.data_as_of !== dataAsOf) throw new Error("price_index_data_as_of_invalid");

  const metrics = deriveMetrics(config.records);
  const movers = deriveMovers(config.observations, config.records, providersById);
  return {
    status: "PASS",
    route: PRICE_INDEX_ROUTE,
    live_provider_count: providers.length,
    live_provider_ids: providers.map((provider) => provider.index_provider_id),
    indexed_provider_count: new Set(config.records.map((record) => record.provider_id)).size,
    record_count: config.records.length,
    metrics,
    movers,
    latest_observation: latest,
    observation_count: config.observations.length,
    history_started_on: config.observations[0].observed_on,
    source_hashes: hashes,
    study_id: study.study_id,
    source_ledger_payload_sha256: study.source_ledger.ledger_payload_sha256,
    providers_by_id: providersById,
    evidence_by_record: evidenceByRecord,
  };
}

const money = (amount) => `$${Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const medicationLabel = (value) => value[0].toUpperCase() + value.slice(1);
const basisLabel = (record) => {
  const phase = record.price_phase === "introductory" ? "introductory" : record.price_phase === "bundle_starting" ? "starter bundle" : record.price_phase === "only_published" ? "only published monthly amount" : "published starting";
  return `${phase}; ${record.billing_basis === "monthly_equivalent" ? "monthly equivalent" : "monthly"}; ${record.formulation}`;
};

import {PRICE_STATE_DISCLOSURE} from './price-state.mjs';
export function renderPriceIndex(input, options = {}) {
  const validation = validatePriceIndexInputs(input, options);
  const config = input.tracker.price_index;
  const { latest_observation: latest } = validation;
  // Historical observations and numeric metrics remain frozen. The current
  // catalog count is a separate renderer-owned token, not a historical divisor.
  const metricCards = validation.metrics.map((metric) => `<article class="panel evidence-line" data-index-metric="${esc(metric.medication)}"><p class="gcs-kicker">Compounded ${esc(metric.medication)}</p><h2>${money(metric.median_usd)} median</h2><p><strong>${money(metric.min_usd)}–${money(metric.max_usd)}</strong> observed range · ${money(metric.spread_usd)} spread</p><p>Historical provider sample: ${esc(metric.provider_count)} with an eligible product-specific monthly observation as of ${esc(latest.observed_on)}. The current catalog covers {{LIVE_PROVIDER_COUNT}} live providers.</p></article>`).join("");
  const moverBody = validation.movers.status === "NO_PRIOR_OBSERVED_WEEK"
    ? `<p data-mover-status="NO_PRIOR_OBSERVED_WEEK">No prior observed week exists yet. This index does not backfill or invent earlier prices, so there is no week-over-week mover to report.</p>`
    : validation.movers.status === "NO_OBSERVED_PRICE_CHANGES"
      ? `<p data-mover-status="NO_OBSERVED_PRICE_CHANGES">No price changes were observed between ${esc(validation.movers.previous_observed_on)} and ${esc(latest.observed_on)} in the tracked comparison set.</p>`
      : `<ol data-mover-status="OBSERVED_MOVERS">${validation.movers.movers.map((mover) => `<li><strong>${esc(mover.provider)} ${esc(medicationLabel(mover.medication))}</strong>: ${money(mover.prior_amount_usd)} → ${money(mover.current_amount_usd)} (${mover.delta_usd > 0 ? "+" : ""}${money(mover.delta_usd)})</li>`).join("")}</ol>`;
  const rows = [...config.records].sort((left, right) => left.medication.localeCompare(right.medication) || left.amount_usd - right.amount_usd || left.provider_id.localeCompare(right.provider_id)).map((record) => {
    const provider = validation.providers_by_id.get(record.provider_id);
    const evidence = validation.evidence_by_record.get(record.id);
    // AEO P0-B: a citation anchor names its issuer and its capture date. The
    // anchor still points straight at the provider's own page - never a
    // redirector - which is the promise this page prints below.
    const sourceLabel = `${provider.display_name} — advertised pricing page (captured ${evidence.verified_as_of})`;
    // ED §3.8.1: an internal, unmonetized path from an observation row to the
    // review page that carries the commercial CTA. No affiliate href ever enters
    // this table.
    const reviewLink = provider.review_path
      ? `<br><a class="index-review-link" href="${esc(provider.review_path)}">Clinic Scout review →</a>`
      : "";
    return `<tr data-index-record-id="${esc(record.id)}"><th scope="row">${esc(provider.display_name)}</th><td>${esc(medicationLabel(record.medication))}</td><td><strong>${money(record.amount_usd)}</strong></td><td>${esc(basisLabel(record))}</td><td><a data-first-party-source href="${esc(evidence.source_url)}" rel="noopener">${esc(sourceLabel)}</a><br><small>Current as of ${esc(evidence.verified_as_of)}</small>${reviewLink}<details><summary>Captured price wording</summary><blockquote>${esc(evidence.value)}</blockquote><p><small>Exact captured quote: ${esc(evidence.quote)}</small></p></details></td></tr>`;
  }).join("");
  const dataset = {
    "@type": "Dataset",
    name: "Clinic Scout GLP-1 Price Index",
    description: "A weekly observation of eligible first-party advertised monthly prices for compounded semaglutide and tirzepatide across the current Clinic Scout live-provider universe.",
    url: CANONICAL_URL,
    dateModified: latest.observed_on,
    temporalCoverage: `${validation.history_started_on}/${latest.observed_on}`,
    creator: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    measurementTechnique: config.methodology.statistic,
    // AEO P1-G: the index becomes machine-downloadable and attribution-licensed.
    // CC BY 4.0 is the point - a citer who reuses the numbers has to name us.
    license: "https://creativecommons.org/licenses/by/4.0/",
    isAccessibleForFree: true,
    variableMeasured: [
      { "@type": "PropertyValue", name: "advertised_monthly_price_usd", description: "Lowest eligible advertised monthly (or explicit monthly-equivalent) price in USD for one provider and one medication, captured from the provider's own page.", unitText: "USD" },
      { "@type": "PropertyValue", name: "medication", description: "Compounded semaglutide or compounded tirzepatide." },
      { "@type": "PropertyValue", name: "billing_basis", description: "monthly or monthly_equivalent - how the advertised amount is billed." },
      { "@type": "PropertyValue", name: "price_phase", description: "introductory, starting, only_published or bundle_starting." },
      { "@type": "PropertyValue", name: "first_party_source_url", description: "The provider page the amount was captured from." },
      { "@type": "PropertyValue", name: "captured_on", description: "ISO date the wording behind the amount was verified." },
      { "@type": "PropertyValue", name: "provider_count", value: validation.indexed_provider_count, description: "Providers with at least one eligible observation in this release." },
    ],
    distribution: DISTRIBUTION_FILES.map((file) => ({
      "@type": "DataDownload",
      encodingFormat: file.encodingFormat,
      contentUrl: `${CANONICAL_URL}data/${file.name}`,
      name: file.label,
    })),
  };
  // One graph, one publisher entity — the Dataset's creator/publisher @id
  // resolves on this page instead of dangling (AEO P0-C).
  const schema = { "@context": "https://schema.org", "@graph": [dataset, canonicalOrganizationNode()] };
  return `<!doctype html><html lang="en" data-release="release-ready"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GLP-1 Price Index: Semaglutide & Tirzepatide Costs</title><meta name="description" content="Weekly median, range, and observed price movement for compounded semaglutide and tirzepatide across live online providers."><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${CANONICAL_URL}"><script type="application/ld+json">${JSON.stringify(schema)}</script></head><body><main><section class="gcs-home-hero home-hero-band"><div><p class="gcs-kicker">Weekly source-bound market read</p><h1>The GLP‑1 Price Index</h1><p class="lede">A clean read on the lowest eligible monthly prices providers actually publish for compounded semaglutide and tirzepatide—without turning intro offers, bundles, or missing terms into fake certainty.</p><div class="gcs-home-actions"><a class="gcs-button" href="/cost/online-glp-1-programs/">Compare full program costs</a><a class="gcs-button secondary" href="/tools/glp-1-cost-calculator/">Estimate your cost</a></div></div><aside class="panel evidence-line"><p class="gcs-kicker">Latest observation</p><h2>${esc(latest.observed_on)}</h2><p>Source data checked through <strong>${esc(latest.data_as_of)}</strong>.</p><p><strong>{{LIVE_PROVIDER_COUNT}}</strong> live providers · <strong>${esc(validation.indexed_provider_count)}</strong> with at least one eligible price in the ${esc(latest.observed_on)} observation · <strong>${esc(validation.observation_count)}</strong> honestly observed week${validation.observation_count === 1 ? "" : "s"}.</p></aside></section>${PRICE_STATE_DISCLOSURE}<section aria-labelledby="index-numbers"><div class="gcs-section-head"><h2 id="index-numbers">This week’s index</h2><p>Each drug uses one eligible lowest monthly or explicit monthly-equivalent amount per provider. The median is calculated from the current tracker rows below.</p></div><div class="grid">${metricCards}</div></section><section class="panel evidence-line" aria-labelledby="movers"><p class="gcs-kicker">Observed change only</p><h2 id="movers">Biggest movers since last week</h2>${moverBody}</section><section aria-labelledby="source-table"><div class="gcs-section-head"><h2 id="source-table">Reproduce the numbers</h2><p>Sort the listed amounts by medication and take the middle value. Every included amount is bound to the dated first-party wording in the site’s tracker lineage.</p></div><div class="table-wrap"><table><caption>Current compounded GLP-1 monthly price observations</caption><thead><tr><th>Provider</th><th>Medication</th><th>Index amount</th><th>Basis</th><th>First-party evidence</th></tr></thead><tbody>${rows}</tbody></table></div></section><section class="panel evidence-line" aria-labelledby="methodology"><p class="gcs-kicker">Methodology</p><h2 id="methodology">What this index counts—and what it refuses to guess</h2><dl class="facts"><div><dt>Observation date</dt><dd>${esc(latest.observed_on)}</dd></div><div><dt>Provider universe</dt><dd>{{LIVE_PROVIDER_COUNT}} live, wired, unique providers after declared merchant aliases are removed.</dd></div><div><dt>First-party sources</dt><dd>${esc(config.records.length)} product observations, each linked to the provider page captured in Clinic Scout’s price lineage.</dd></div><div><dt>Honest history</dt><dd>History begins ${esc(validation.history_started_on)} and contains ${esc(validation.observation_count)} observed weekly snapshot${validation.observation_count === 1 ? "" : "s"}. No earlier weeks were backfilled.</dd></div></dl><h3>Statistic</h3><p>${esc(config.methodology.statistic)}</p><h3>Inclusion rule</h3><p>${esc(config.methodology.inclusion_rule)}</p><h3>Exclusion rule</h3><p>${esc(config.methodology.exclusion_rule)}</p><h3>Limits</h3><p>${esc(config.methodology.comparison_limitations)}</p><p>${esc(config.methodology.history_policy)}</p><p>The lineage also binds the original-data study <code>${esc(validation.study_id)}</code> and its first-party capture-ledger hash <code>${esc(validation.source_ledger_payload_sha256)}</code>. That four-page disclosure study documents the source-handling method; it is not substituted for the current index dataset.</p></section><aside class="panel evidence-line" aria-label="Commercial and health-information boundaries"><h2>Read the price, then read the terms</h2><p>Some provider pages elsewhere on Clinic Scout contain affiliate links. Commission does not select an index row or change its amount. The source links on this page go directly to provider websites, not affiliate redirectors.</p><p>Compounded drugs are not FDA-approved. This page is commercial research, not medical advice, prescribing guidance, or a claim about eligibility, quality, safety, or outcomes. Confirm the exact product, dose, supply, recurring charge, and clinical questions directly before paying.</p></aside><nav class="panel evidence-line price-index-next" aria-label="Where to go next"><p class="gcs-kicker">Next step</p><h2>The index is an evidence read, not a quote</h2><ul><li><a href="/cost/online-glp-1-programs/">Compare full program costs</a></li><li><a href="/providers/">See ranked programs</a></li><li><a href="/tools/glp-1-cost-calculator/">Estimate your cost</a></li></ul></nav><p class="price-index-dataset-note">Download this observation: <a href="${CANONICAL_URL}data/latest.csv">latest.csv</a> · <a href="${CANONICAL_URL}data/latest.json">latest.json</a> — reusable under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener license">CC BY 4.0</a> with attribution to GLP Clinic Scout.</p></main></body></html>`;
}

// AEO P1-G: the downloadable distribution is minted from the SAME validated
// observation rows the table renders, in the same function call, so the page and
// the files cannot drift apart. Row counts are asserted equal by the build gate.
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildPriceIndexDistribution(input, options = {}) {
  const validation = validatePriceIndexInputs(input, options);
  const config = input.tracker.price_index;
  const rows = [...config.records]
    .sort((left, right) => left.medication.localeCompare(right.medication) || left.amount_usd - right.amount_usd || left.provider_id.localeCompare(right.provider_id))
    .map((record) => {
      const provider = validation.providers_by_id.get(record.provider_id);
      const evidence = validation.evidence_by_record.get(record.id);
      return {
        record_id: record.id,
        provider_id: record.provider_id,
        provider: provider.display_name,
        medication: record.medication,
        formulation: record.formulation,
        advertised_monthly_price_usd: record.amount_usd,
        billing_basis: record.billing_basis,
        price_phase: record.price_phase,
        selection_basis: record.selection_basis,
        first_party_source_url: evidence.source_url,
        captured_on: evidence.verified_as_of,
      };
    });
  const columns = Object.keys(rows[0]);
  const csv = `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`;
  const json = `${JSON.stringify({
    schema: "glp-clinic-scout-price-index-distribution-v1",
    name: "Clinic Scout GLP-1 Price Index",
    url: CANONICAL_URL,
    license: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "GLP Clinic Scout (Tilton Group LLC)",
    observed_on: validation.latest_observation.observed_on,
    data_as_of: validation.latest_observation.data_as_of,
    temporal_coverage: `${validation.history_started_on}/${validation.latest_observation.observed_on}`,
    metrics: validation.metrics,
    row_count: rows.length,
    rows,
  }, null, 2)}\n`;
  return { csv, json, row_count: rows.length };
}

function deriveArtifactFacts(html) {
  const canonicalUrl = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1] || null;
  const robots = html.match(/<meta name="robots" content="([^"]+)">/)?.[1] || null;
  return {
    canonical_url: canonicalUrl,
    route: canonicalUrl ? new URL(canonicalUrl).pathname : null,
    robots,
    rendered_record_count: countMatches(html, /data-index-record-id=/g),
    first_party_source_count: countMatches(html, /data-first-party-source/g),
    affiliate_redirect_anchor_count: countMatches(html, /<a\b[^>]*href="\/go\//gi),
    medical_reviewer_claim_count: countMatches(html, /medical(?:ly)? reviewed|reviewedBy|MedicalReview/gi),
  };
}

/**
 * The page carries the derived {{LIVE_PROVIDER_COUNT}} token, so the bytes that
 * ship are the substituted ones. Rebind the manifest's transport hashes to what
 * actually shipped, so the preserved predecessor pair stays self-consistent.
 * Every price, date, metric and lineage field is untouched.
 */
export function rebindPriceIndexShippedHtml(manifest, html) {
  const { payload_sha256, ...payload } = manifest;
  if (payload.schema !== "glp-clinic-scout-price-index-build-v1") throw new Error("price_index_rebind_manifest_invalid");
  if (sha256(canonical({ ...payload, html_sha256: payload.html_sha256 })) !== payload_sha256) throw new Error("price_index_rebind_manifest_hash_mismatch");
  const next = { ...payload, html_sha256: sha256(html) };
  return { ...next, payload_sha256: sha256(canonical(next)) };
}

export function buildPriceIndexArtifacts(input, options = {}) {
  const validation = validatePriceIndexInputs(input, options);
  const rawHtml = renderPriceIndex(input, options);
  const html = typeof options.decorate === "function" ? options.decorate(rawHtml) : rawHtml;
  const facts = deriveArtifactFacts(html);
  if (facts.route !== PRICE_INDEX_ROUTE || facts.canonical_url !== CANONICAL_URL || !String(facts.robots).startsWith("index,follow")
    || facts.rendered_record_count !== validation.record_count || facts.first_party_source_count !== validation.record_count
    || facts.affiliate_redirect_anchor_count !== 0 || facts.medical_reviewer_claim_count !== 0) throw new Error("price_index_render_contract_invalid");
  const payload = {
    schema: "glp-clinic-scout-price-index-build-v1",
    status: validation.status,
    route: validation.route,
    latest_observed_on: validation.latest_observation.observed_on,
    data_as_of: validation.latest_observation.data_as_of,
    history_started_on: validation.history_started_on,
    observation_count: validation.observation_count,
    live_provider_count: validation.live_provider_count,
    indexed_provider_count: validation.indexed_provider_count,
    record_count: validation.record_count,
    metrics: validation.metrics,
    movers: validation.movers,
    source_hashes: validation.source_hashes,
    tracker_payload_sha256: sha256(canonical(input.tracker)),
    record_set_sha256: validation.latest_observation.record_set_sha256,
    original_data_study_id: validation.study_id,
    source_ledger_payload_sha256: validation.source_ledger_payload_sha256,
    html_sha256: sha256(html),
    artifact_facts: facts,
  };
  const distribution = buildPriceIndexDistribution(input, options);
  if (distribution.row_count !== validation.record_count) throw new Error("price_index_distribution_row_count_mismatch");
  return { html, distribution, manifest: { ...payload, payload_sha256: sha256(canonical(payload)) } };
}
