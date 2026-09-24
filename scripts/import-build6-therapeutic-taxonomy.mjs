#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import {
  commercialLinkState,
  deriveFacetCounts,
  normalizedTaxonomySha256,
  stableSha256,
  validateTherapeuticTaxonomy,
} from "../src/therapeutic-taxonomy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUSINESS = path.resolve(ROOT, "../../../..");
const REPORTS = path.join(BUSINESS, "reports/glp-clinic-scout/growth/build-6");
const PROFILE = "glp-clinic-scout";
const SEALED_DATE = "2026-08-08";
const REQUIRED_PATHS = Object.freeze([
  "/best/online-glp-1-providers/",
  "/cost/online-glp-1-programs/",
  "/best/expanded-curated-glp-1-programs/",
]);
const INPUTS = Object.freeze({
  sequence_reseal: {
    path: path.join(REPORTS, "build-6-sequence-reseal-20260808.json"),
    expected: "07c6beeb4da355e39695383a600eb1b0d5b5bd0ba70516ab8ac0ae922a1a64a3",
  },
  implementation_contract: {
    path: path.join(REPORTS, "build-6-6b-implementation-contract-20260808.json"),
    expected: "2c3461ada23b475c0a4b2b355a114ec7f0a2036389f2625e175b3176aa957283",
  },
  base_map: {
    path: path.join(REPORTS, "build-6-classification-and-seams-20260808.json"),
    expected: "92c771f5bb9ac0b4b97c7e01919b944cf0580144f1d4a57401cf4784f0a33edc",
  },
  corrected_refresh: {
    path: path.join(REPORTS, "build-6-firecrawl-classification-refresh-20260808.json"),
    expected: "7ec5ffa7e0043804198d9cbb8c3d7ceed912476e8e14421bdf98e826f780d7f7",
  },
  brand_form_addendum: {
    path: path.join(REPORTS, "build-6-brand-form-firecrawl-addendum-20260808.json"),
    expected: "25b285411412c85b2552e35de31f4cbc0d3ac9895a30bf5dc7cf287458db4b48",
  },
});
const EXPECTED_COUNTS = Object.freeze({
  provider_rows: 29,
  semaglutide: 28,
  tirzepatide: 28,
  retatrutide: 0,
  wegovy: 9,
  zepbound: 6,
  mounjaro: 4,
  oral: 17,
  injectable: 16,
  compounded: 28,
  brand_name: 10,
  treatment_type_unknown: 1,
});
const PRICE_INDEX_REGISTRY_SEMANTIC_BASIS_SHA256 = "1f2f83a7b6c956a1e2750350a8ee60dfc8626f0a68bf9542e6a2ad035cb48fd0";
const PRICE_INDEX_REGISTRY_FROZEN_SOURCE_SHA256 = "7940a48ddb453a1ebe274a48ed1c1fb7b5afdedfbbb4bed364153da6b5293499";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sealedInput(name, descriptor) {
  const bytes = await readFile(descriptor.path);
  const actual = sha256(bytes);
  if (actual !== descriptor.expected) throw new Error(`build6_authority_hash_mismatch:${name}:${actual}`);
  return { bytes, json: JSON.parse(bytes), relative: path.relative(BUSINESS, descriptor.path).replaceAll(path.sep, "/") };
}

function union(...values) {
  return [...new Set(values.flat().filter(Boolean))].sort();
}

function binding(authority, authorityInput, { source_url, evidence_sha256 = null, capture_id = null }) {
  if (!source_url?.startsWith("https://")) throw new Error(`build6_evidence_source_invalid:${authority}`);
  return {
    authority,
    authority_sha256: authorityInput.expected,
    source_url,
    verified_as_of: SEALED_DATE,
    ...(evidence_sha256 ? { evidence_sha256 } : {}),
    ...(capture_id ? { capture_id } : {}),
  };
}

function rowMap(rows, label) {
  const result = new Map();
  for (const row of rows || []) {
    if (!row?.program_id || result.has(row.program_id)) throw new Error(`build6_${label}_program_ids_invalid`);
    result.set(row.program_id, row);
  }
  return result;
}

function sameSet(actual, expected, label) {
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  if (missing.length || extra.length) throw new Error(`build6_${label}_set_mismatch:missing=${missing}:extra=${extra}`);
}

async function main() {
  const loaded = Object.fromEntries(await Promise.all(Object.entries(INPUTS).map(async ([name, descriptor]) => [name, await sealedInput(name, descriptor)])));
  const [registry, money, quiz] = await Promise.all([
    readFile(path.join(ROOT, "data/program-registry.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "data/money-page-specs.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, "data/quiz-config.json"), "utf8").then(JSON.parse),
  ]);
  const baseRows = rowMap(loaded.base_map.json.providers, "base");
  const refreshRows = rowMap(loaded.corrected_refresh.json.rows, "refresh");
  const addendumRows = rowMap(loaded.brand_form_addendum.json.rows, "addendum");
  if (baseRows.size !== EXPECTED_COUNTS.provider_rows) throw new Error(`build6_base_provider_count_invalid:${baseRows.size}`);
  sameSet(new Set(addendumRows.keys()), new Set(baseRows.keys()), "addendum");
  const registryById = new Map(registry.programs.map((program) => [program.program_id, program]));
  const requiredPages = REQUIRED_PATHS.map((route) => {
    const page = money.pages.find((item) => item.path === route);
    if (!page) throw new Error(`build6_money_surface_missing:${route}`);
    sameSet(new Set(page.rows.map((row) => row.program_id)), new Set(baseRows.keys()), `money_${route}`);
    return page;
  });
  sameSet(new Set(quiz.candidates.map((candidate) => candidate.program_id)), new Set(baseRows.keys()), "quiz");
  const firstRows = new Map(requiredPages[0].rows.map((row) => [row.program_id, row]));
  const quizRows = new Map(quiz.candidates.map((candidate) => [candidate.program_id, candidate]));
  const quizLinks = loadAffiliateLinkMap("quiz", PROFILE);
  const projectionPrograms = {};
  for (const pid of [...baseRows.keys()].sort()) {
    const base = baseRows.get(pid);
    const refresh = refreshRows.get(pid);
    const addendum = addendumRows.get(pid);
    const registryProgram = registryById.get(base.registry_program_id);
    if (!registryProgram || String(registryProgram.review_slug || registryProgram.program_id) !== pid) {
      throw new Error(`build6_registry_program_binding_invalid:${pid}`);
    }
    const profile = registryProgram.profiles?.[PROFILE];
    if (profile?.vertical_fit !== true) throw new Error(`build6_registry_profile_invalid:${pid}`);
    const moneyStates = new Set(requiredPages.map((page) => commercialLinkState(page.rows.find((row) => row.program_id === pid), "compare")));
    if (moneyStates.size !== 1) throw new Error(`build6_money_link_state_drift:${pid}`);
    const compareLinkState = [...moneyStates][0];
    const rawQuizState = commercialLinkState(quizRows.get(pid), "quiz");
    const quizLink = quizLinks[pid];
    const quizLinkState = quizLink?.live === true && /^https:\/\//.test(String(quizLink.affiliate_href || "")) ? "live" : "editorial_link_dark";
    if (rawQuizState === "live" && quizLinkState !== "live") throw new Error(`build6_quiz_link_state_escalation:${pid}`);
    const evidenceBindings = [binding("base_map", INPUTS.base_map, {
      source_url: base.source_url,
      evidence_sha256: base.classification_sha256,
    })];
    if (refresh) evidenceBindings.push(binding("corrected_refresh", INPUTS.corrected_refresh, {
      source_url: refresh.source_url,
      evidence_sha256: refresh.evidence_sha256,
      capture_id: refresh.firecrawl_id,
    }));
    const acceptedText = String(addendum.accepted_evidence || "");
    evidenceBindings.push(binding("brand_form_addendum", INPUTS.brand_form_addendum, {
      source_url: addendum.source_url,
      evidence_sha256: sha256(Buffer.from(acceptedText)),
      capture_id: addendum.firecrawl_id,
    }));
    const canonicalDeclaration = profile.canonical_identity;
    const canonical = canonicalDeclaration?.role === "alias" ? registryById.get(canonicalDeclaration.canonical_program_id) : null;
    const row = {
      program_id: pid,
      registry_program_id: registryProgram.program_id,
      provider: base.provider,
      render_label: canonical ? `${base.provider} program (same provider as ${canonical.display_name})` : null,
      classification_state: refresh ? refresh.state : base.classification_state,
      verified_as_of: SEALED_DATE,
      source_urls: union(evidenceBindings.map((item) => item.source_url)),
      molecule_tags: union(refresh ? refresh.molecule_tags || [] : base.molecule_tags || []),
      brand_name_tags: union(base.brand_name_tags || [], addendum.accepted_brand_tags || []),
      delivery_form_tags: union(refresh ? refresh.delivery_form_tags || [] : base.delivery_form_tags || [], addendum.accepted_form_tags || []),
      treatment_type_tags: union(refresh ? refresh.treatment_type_tags || [] : base.treatment_type_tags || []),
      treatment_type_state: "verified",
      commercial_link_state: { compare: compareLinkState, quiz: quizLinkState },
      evidence_bindings: evidenceBindings,
    };
    row.treatment_type_state = row.treatment_type_tags.length ? "verified" : "not_verified";
    row.normalized_sha256 = normalizedTaxonomySha256(row);
    projectionPrograms[pid] = row;
  }
  const actualCounts = deriveFacetCounts(projectionPrograms);
  if (JSON.stringify(actualCounts) !== JSON.stringify(EXPECTED_COUNTS)) {
    throw new Error(`build6_derived_counts_invalid:${JSON.stringify(actualCounts)}`);
  }
  const priceIndexRegistryBasis = structuredClone(registry);
  delete priceIndexRegistryBasis.therapeutic_taxonomy;
  if (stableSha256(priceIndexRegistryBasis) !== PRICE_INDEX_REGISTRY_SEMANTIC_BASIS_SHA256) {
    throw new Error("build6_price_index_registry_semantic_basis_drift");
  }
  registry.therapeutic_taxonomy = {
    schema: "glp-therapeutic-taxonomy-v1",
    sealed_as_of: SEALED_DATE,
    freshness_max_days: 31,
    projection_key: "program_id",
    derivation: "Set-union projection from the sealed base map, corrected Firecrawl refresh, and brand/form addendum. Tags are accepted only when an authority row explicitly records them; missing tags remain unknown and are never inferred from prose.",
    provider_wire_in_contract: "A new registry program must provide a research_therapeutic_taxonomy object with verified normalized arrays, source_url, verified_as_of, and an evidence sha256 or capture id. glp_surface_unification.py validates and appends that row before compare or quiz projection.",
    price_index_registry_semantic_basis_sha256: PRICE_INDEX_REGISTRY_SEMANTIC_BASIS_SHA256,
    price_index_registry_frozen_source_sha256: PRICE_INDEX_REGISTRY_FROZEN_SOURCE_SHA256,
    required_surface_paths: REQUIRED_PATHS,
    authorities: Object.fromEntries(Object.entries(INPUTS).map(([name, descriptor]) => [name, {
      path: loaded[name].relative,
      sha256: descriptor.expected,
    }])),
    expected_counts: EXPECTED_COUNTS,
    programs: projectionPrograms,
  };
  validateTherapeuticTaxonomy(registry, PROFILE, { asOf: `${SEALED_DATE}T00:00:00Z` });
  if (!process.argv.includes("--check")) {
    await writeFile(path.join(ROOT, "data/program-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    status: process.argv.includes("--check") ? "PASS_CHECKED" : "PASS_IMPORTED",
    provider_rows: Object.keys(projectionPrograms).length,
    counts: actualCounts,
    authority_hashes: Object.fromEntries(Object.entries(INPUTS).map(([name, descriptor]) => [name, descriptor.expected])),
    output: path.join(ROOT, "data/program-registry.json"),
    external_effects: 0,
  }));
}

await main();
