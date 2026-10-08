import { effectiveAffiliateRegistry } from './affiliate-relationship-sync.mjs';
import { access, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCostCalculatorData, costCalculatorDropdownProviders } from "./cost-calculator.mjs";
import { renderGoRuntimeManifestModule } from "./go-runtime-manifest.mjs";
import { AGGREGATE_SURFACES, assertUniqueRenderIdentity, deriveIdentityGroups } from "./provider-identity.mjs";
import { redirectorTermsAllowed } from "./go-redirector-authority.mjs";
import { projectProviderDisplayLedger } from "./provider-display-evidence.mjs";

const SURFACES = Object.freeze(["compare", "quiz", "calculator", "review", "go", "sitemap"]);
const NETWORK_ID_SLUG = /^(?:awin|katalys|cj-affiliate|partnerize)-\d+$/;
const ROUTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function rootPath(root) {
  return root instanceof URL ? fileURLToPath(root) : path.resolve(root);
}

function profileFor(program, profileId) {
  return program?.profiles?.[profileId] || null;
}

function validateRegistryShape(registry, profileId) {
  if (registry?.schema !== "site-program-registry-v1" || !Array.isArray(registry.programs)) throw new Error("program_registry_invalid");
  const siteProfile = registry.site_profiles?.[profileId];
  if (!siteProfile) throw new Error(`site_profile_unknown:${profileId}`);
  if (siteProfile.auto_generate !== false || siteProfile.auto_publish !== false) throw new Error(`site_profile_automation_must_be_held:${profileId}`);
  const ids = new Set();
  const reviewSlugs = new Set();
  const goRoutes = new Set();
  for (const program of registry.programs) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(program.program_id || "") || ids.has(program.program_id)) throw new Error(`program_registry_identity_invalid:${program.program_id || "missing"}`);
    ids.add(program.program_id);
    if (!program.display_name || !["live", "held"].includes(program.commercial_state)) throw new Error(`program_registry_state_invalid:${program.program_id}`);
    const routeMatch = String(program.review_path || "").match(/^\/reviews\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/);
    const reviewSlug = routeMatch?.[1];
    const expectedSlug = program.review_slug || program.program_id;
    const identityProfile = profileFor(program, profileId);
    const identityOnlyAlias = identityProfile?.canonical_identity?.role === "alias"
      && program.commercial_state === "held" && identityProfile.wired === false
      && SURFACES.every(surface => identityProfile.surfaces?.[surface] === false)
      && registry.programs.some(target => target.program_id === identityProfile.canonical_identity.canonical_program_id
        && target.program_id !== program.program_id && target.profiles?.[profileId]?.canonical_identity?.role === "canonical");
    if ((!identityOnlyAlias || Object.hasOwn(program, "review_path"))
      && (!reviewSlug || !ROUTE_SLUG.test(expectedSlug) || reviewSlug !== expectedSlug || reviewSlugs.has(reviewSlug))) throw new Error(`program_registry_review_path_invalid:${program.program_id}`);
    if (NETWORK_ID_SLUG.test(reviewSlug)) throw new Error(`coverage_network_id_review_slug_forbidden:${profileId}:${program.program_id}:${reviewSlug}`);
    if (reviewSlug) reviewSlugs.add(reviewSlug);
    if (program.go?.route !== `/go/${expectedSlug}` || !program.go.entry_state || goRoutes.has(program.go.route)) throw new Error(`program_registry_go_entry_invalid:${program.program_id}`);
    goRoutes.add(program.go.route);
    const profile = profileFor(program, profileId);
    if (!profile) continue;
    if (typeof profile.vertical_fit !== "boolean" || typeof profile.wired !== "boolean") throw new Error(`program_registry_profile_invalid:${profileId}:${program.program_id}`);
    if (typeof profile.data_profile?.has_price !== "boolean" || typeof profile.data_profile?.has_review_facts !== "boolean") throw new Error(`program_registry_data_profile_invalid:${profileId}:${program.program_id}`);
    for (const surface of SURFACES) {
      if (typeof profile.surfaces?.[surface] !== "boolean") throw new Error(`program_registry_surface_flag_invalid:${profileId}:${program.program_id}:${surface}`);
    }
    for (const [surface, exception] of Object.entries(profile.exceptions || {})) {
      if (!SURFACES.includes(surface) || exception?.enabled !== true) throw new Error(`coverage_exception_flag_invalid:${profileId}:${program.program_id}:${surface}`);
      if (typeof exception.reason !== "string" || !exception.reason.trim()) throw new Error(`coverage_exception_reason_missing:${profileId}:${program.program_id}:${surface}`);
      // OPERATOR MODEL 2026-08-13: any surface scoping must name its documented
      // restriction basis on the row itself; prose alone does not scope.
      if (typeof exception.surface_restriction_basis !== "string" || !exception.surface_restriction_basis.trim()) throw new Error(`coverage_exception_restriction_basis_missing:${profileId}:${program.program_id}:${surface}`);
    }
  }
  return siteProfile;
}

export function deriveProfileSurfaceSets(registry, profileId, ledgerPrograms = []) {
  validateRegistryShape(registry, profileId);
  // One canonical render identity per merchant. An alias row keeps its own
  // review page and sitemap entry, but is never a second entry in a LIST -
  // that is how "Shed" and "SHED" both reached the calculator dropdown.
  const { aliasIds } = deriveIdentityGroups(registry, profileId, ledgerPrograms);
  const sets = Object.fromEntries(SURFACES.map((surface) => [surface, new Set()]));
  for (const program of registry.programs) {
    const profile = profileFor(program, profileId);
    if (!profile) continue;
    const isAlias = aliasIds.has(program.program_id);
    // A network program is keyed by its network id (awin-128761) in the registry
    // and by its render slug (coivas) everywhere a reader can see it. Carrying
    // BOTH keys is not belt-and-braces: matching on the network id alone silently
    // filtered all six READY6 providers back off the comparison page after they
    // had been added to it (2026-08-06 surface unification).
    for (const surface of SURFACES) {
      if (!profile.surfaces[surface]) continue;
      if (isAlias && AGGREGATE_SURFACES.includes(surface)) continue;
      sets[surface].add(program.program_id);
      if (program.review_slug) sets[surface].add(program.review_slug);
    }
  }
  return sets;
}

// OPERATOR MODEL 2026-08-13 ("deploy each new provider on ALL surfaces"): every
// live provider appears on every surface unless its registry row documents a
// restriction (an exception carrying surface_restriction_basis), and the
// conversion pools (quiz, calculator) equal the live-eligible set exactly in
// BOTH directions — a pool may not omit a live provider and may not offer a
// program that is not live-eligible. Identity is compared on the canonical
// render identity, so a declared alias (katalys-1516 "SHED" → shedrx "Shed")
// counts as its one canonical merchant instead of a phantom gap or a duplicate.
export function assertLiveSurfaceParity(registry, profileId, eligibility, ledgerPrograms = []) {
  validateRegistryShape(registry, profileId);
  const sets = deriveProfileSurfaceSets(registry, profileId, ledgerPrograms);
  const byAnyId = new Map();
  for (const program of registry.programs) {
    byAnyId.set(program.program_id, program);
    if (program.review_slug) byAnyId.set(program.review_slug, program);
  }
  const canonicalRenderId = (program) => {
    const declared = program.profiles?.[profileId]?.canonical_identity;
    const canonical = (declared?.canonical_program_id && byAnyId.get(declared.canonical_program_id)) || program;
    return String(canonical.review_slug || canonical.program_id);
  };
  const rows = eligibility?.programs || [];
  if (!rows.length) throw new Error(`surface_parity_eligibility_empty:${profileId}`);
  const liveEligible = new Map();
  for (const row of rows) {
    if (!(String(row.status || "").includes("live") || row.live_link_allowed === true)) continue;
    const program = byAnyId.get(String(row.program_id));
    if (!program) throw new Error(`surface_parity_unregistered_live_program:${profileId}:${row.program_id}`);
    const render = canonicalRenderId(program);
    if (!liveEligible.has(render)) liveEligible.set(render, []);
    liveEligible.get(render).push(String(row.program_id));
  }
  const documentedRestriction = (ids, surface) => ids.some((id) => {
    const exception = byAnyId.get(id)?.profiles?.[profileId]?.exceptions?.[surface];
    return exception?.enabled === true && typeof exception.surface_restriction_basis === "string" && exception.surface_restriction_basis.trim();
  });
  const problems = new Set();
  for (const [render, sourceIds] of liveEligible) {
    for (const surface of SURFACES) {
      if (sets[surface].has(render)) continue;
      if (documentedRestriction([...sourceIds, render], surface)) continue;
      problems.add(`missing:${render}:${surface}`);
    }
  }
  // Reverse direction (found live 2026-08-13: trt-nation offered by the quiz
  // and the calculator while editorial_link_dark): a conversion pool may not
  // recommend a program that is not live-eligible.
  for (const surface of ["quiz", "calculator"]) {
    for (const id of sets[surface]) {
      const program = byAnyId.get(id);
      const render = program ? canonicalRenderId(program) : id;
      if (!liveEligible.has(render)) problems.add(`not_live_eligible:${render}:${surface}`);
    }
  }
  if (problems.size) throw new Error(`surface_parity_violation:${profileId}:${[...problems].sort().join(",")}`);
  return { live_render_identities: liveEligible.size };
}

export function projectMoneyPagesFromRegistry(registry, profileId, pages, ledgerPrograms = [], options = {}) {
  const allowed = new Set(deriveProfileSurfaceSets(registry, profileId, ledgerPrograms).compare);
  const forced = new Set(options.includeProgramIds || []);
  const registryRenderIds = new Set((registry.programs || []).map((program) => String(program.review_slug || program.program_id)));
  for (const pid of forced) {
    if (!registryRenderIds.has(pid)) throw new Error(`coverage_forced_compare_program_missing:${profileId}:${pid}`);
    allowed.add(pid);
  }
  return pages.map((page) => {
    const rows = (page.rows || []).filter((row) => allowed.has(row.program_id));
    assertUniqueRenderIdentity(rows.map((row) => ({ ...row, provider: row.render_provider || row.provider })), `money:${page.page_id}`);
    return { ...page, rows };
  });
}

const STATE_CODE_BY_NAME = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

export function excludedStatesFromResearch(statesServedText) {
  // Deterministic, explicit-evidence-only: a state is excluded ONLY when the
  // researched states_served text names it as unavailable ("California has no
  // plans available", "all but Louisiana"). Vague coverage ("most U.S.
  // states") excludes nothing — we never guess a user out of a match.
  const text = String(statesServedText || "").toLowerCase();
  if (!text) return [];
  const excluded = new Set();
  for (const [name, code] of Object.entries(STATE_CODE_BY_NAME)) {
    if (new RegExp(`(?:all but|except|excluding|no plans[^.]*in|not (?:currently )?available in)[^.]*\\b${name}\\b`).test(text)
        || new RegExp(`\\b${name}\\b[^.]{0,60}(?:has no plans|not available|excluded|no availability)`).test(text)) {
      excluded.add(code);
    }
  }
  return [...excluded].sort();
}

export function projectQuizFromRegistry(registry, profileId, quiz, contentLedger = null, options = {}) {
  const allowed = new Set(deriveProfileSurfaceSets(registry, profileId, contentLedger?.programs || []).quiz);
  const forced = new Set(options.includeProgramIds || []);
  const registryRenderIds = new Set((registry.programs || []).map((program) => String(program.review_slug || program.program_id)));
  for (const pid of forced) {
    if (!registryRenderIds.has(pid)) throw new Error(`coverage_forced_quiz_program_missing:${profileId}:${pid}`);
    allowed.add(pid);
  }
  const ledgerById = new Map(((contentLedger && contentLedger.programs) || []).map((entry) => [entry.program_id, entry]));
  const research = (entry, field) => {
    const item = entry && entry[`research_${field}`];
    // Never let a "provider does not publish this" finding become a quiz
    // price line or a states-served note.
    return item && item.value && item.state !== "not_publicly_stated" ? item : null;
  };
  const candidates = (quiz.candidates || []).filter((candidate) => allowed.has(candidate.program_id)).map((candidate) => {
    const rawEntry = ledgerById.get(candidate.program_id);
    const entry = rawEntry ? projectProviderDisplayLedger(rawEntry) : rawEntry;
    if (!entry) return candidate;
    const firstMonth = research(entry, "first_month_price");
    const priceValue = (firstMonth && firstMonth.value) || entry.starting_price || "";
    const priceDate = (firstMonth && firstMonth.verified_as_of) || null;
    const statesItem = research(entry, "states_served");
    return {
      ...candidate,
      priority_score: typeof entry.score === "number" ? entry.score : candidate.priority_score,
      best_for: entry.best_for || candidate.best_for || "",
      price_line: priceValue ? `${String(priceValue).split(";")[0].trim()}${priceDate ? ` · checked ${priceDate}` : ""}` : "",
      excluded_states: statesItem ? excludedStatesFromResearch(statesItem.value) : [],
      states_note: statesItem ? String(statesItem.value).split(";")[0].trim() : "",
    };
  });
  assertUniqueRenderIdentity(candidates.map((candidate) => ({
    ...candidate,
    display_name: candidate.render_display_name || candidate.display_name,
  })), "quiz");
  return { ...quiz, candidates };
}


// Selection is not permission: legacy VERIFIED labels without complete receipts
// stay held. Never invent dates, QA results or express network consent at build.
import { goPromotionReceiptComplete } from './go-promotion-contract.mjs';

// GO_RUNTIME_PROMOTION_AUTHORITY_V2: project complete, exact-bound receipts.
export function deriveGoEntriesFromRegistry(registry, profileId, ledgerPrograms = [], affiliateMap = {}, goPromotionAuthority = {}, commercialLabels = {}) {
  const allowed = deriveProfileSurfaceSets(registry, profileId, ledgerPrograms).go;
  const ledgerById = new Map(ledgerPrograms.map((program) => [program.program_id, program]));
  // PASS 7 ALLOWLIST 2026-09-03. Pass 7 emits landing-page, self-pay and review
  // surface codes. The worker's runtime manifest allowlist has to accept them or
  // handleGoRequest refuses the click with assignment-not-allowlisted and mints
  // NO cs_click_id - a silently dark anchor behind a green build. Accepting a
  // surface code NEVER activates a route: liveAllowed still requires the governed
  // promotion authority, so held-by-default is untouched.
  const allowedPageRoles = ["providers", "reviews", "calculator", "self-pay", "lp", "lp-quiz", "lp-compare", "semaglutide", "tirzepatide", "compounded", "compounded-tirzepatide", "lp-best-providers-compounded-semaglutide", "lp-best-providers-compounded-tirzepatide", "3-month", "6-month", "wegovy-pill", "wegovy", "ozempic", "mounjaro", "zepbound"];
  const allowedPositions = [
    "rv1", "rv2",
    ...Array.from({ length: 60 }, (_, index) => `lp${index + 1}`),
    ...Array.from({ length: 60 }, (_, index) => `sp${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `fv2s${index + 1}`),
    ...Array.from({ length: 5 }, (_, index) => `fv2m${index + 1}`),
    ...Array.from({ length: 60 }, (_, index) => `pc${index + 1}`),
    ...Array.from({ length: 50 }, (_, index) => `pcu${index + 1}`),
  ];
  return registry.programs.filter((program) => allowed.has(program.program_id)).map((program) => {
    const renderId = program.review_slug || program.program_id;
    const base = {
      program_id: program.program_id,
      display_name: commercialLabels[program.program_id] ?? program.display_name,
      route: program.go.route,
      ...(program.review_slug ? { route_slug: program.review_slug } : {}),
      entry_state: program.go.entry_state,
      commercial_state: program.commercial_state,
      live_link_allowed: false,
      promotion_authorized: false,
      candidate_gate: 'No complete live attribution and promotion receipt; entry remains held.',
    };
    const promotion = goPromotionAuthority?.programs?.[program.program_id] || goPromotionAuthority?.programs?.[renderId] || null;
    const link = affiliateMap[renderId];
    const promotionActive = goPromotionReceiptComplete(promotion, program, link);
    if (!link?.live || !link.affiliate_href || !link.network) return base;
    const ledger = ledgerById.get(renderId) || ledgerById.get(program.program_id) || {};
    const officialFallback = ledger.research_price?.source_url || ledger.source_url || "";
    let trackingHost = "";
    let fallbackHost = "";
    try { trackingHost = new URL(link.affiliate_href).hostname.toLowerCase(); } catch { return base; }
    try { fallbackHost = new URL(officialFallback).hostname.toLowerCase(); } catch { fallbackHost = ""; }
    return {
      ...base,
      status: promotionActive ? "live_operator_approved" : "candidate_preview_only",
      link_mode: promotionActive ? "server_redirect" : "instrumented_redirect_candidate",
      ...(promotionActive ? {
        operator_selection_receipt_sha256: promotion.operator_selection_receipt_sha256,
        ...(promotion.redirector_tos_verified === true ? {
          redirector_tos_source_url: promotion.redirector_tos_source_url,
          redirector_tos_verified_as_of: promotion.redirector_tos_verified_as_of,
        } : { redirector_risk_acceptance: structuredClone(promotion.redirector_risk_acceptance) }),
      } : {}),
      network: String(link.network).toLowerCase(),
      ...(link.network_offer_id ? { network_offer_id: String(link.network_offer_id) } : {}),
      tracking: { base_url: link.affiliate_href, allowed_tracking_hosts: [trackingHost], generated_link_readback_verified: true,
        ...(["everflow", "xentraffic"].includes(String(link.network).toLowerCase()) && promotionActive ? { everflow_redirect_link_verified: true } : {}),
        ...(program.program_id === "gobymeds" && promotionActive && String(link.network).toLowerCase() === "direct" ? { issued_link_passthrough_verified: true } : {}),
      },
      official_fallback: fallbackHost ? officialFallback : "https://glpclinicscout.com/providers/",
      allowed_fallback_hosts: fallbackHost ? [fallbackHost] : ["glpclinicscout.com"],
      allowed_page_roles: allowedPageRoles,
      allowed_positions: allowedPositions,
      allowed_variants: ["a"],
      go_route_wired: true,
      live_link_allowed: promotionActive,
      promotion_authorized: promotionActive,
      constructor_verified: promotionActive,
      advertiser_permission_verified: promotionActive && promotion.advertiser_permission_verified === true,
      encoding_verified: promotionActive && promotion.encoding_verified === true,
      privacy_qa_passed: promotionActive && promotion.privacy_qa_passed === true,
      redirector_tos_verified: promotionActive && promotion.redirector_tos_verified === true,
      candidate_gate: promotionActive ? null : (promotion?.reason || "go_runtime_promotion_authority_missing"),
    };
  });
}

export function goSurfaceFromManifest(manifest, profileId) {
  if (
    manifest?.schema !== "affiliate-worker-staging-v3-registry"
    || manifest.program_registry_schema !== "site-program-registry-v1"
    || manifest.site_profile !== profileId
    || !Array.isArray(manifest.programs)
  ) throw new Error(`coverage_go_manifest_invalid:${profileId}`);
  const ids = new Set();
  for (const program of manifest.programs) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(program?.program_id || "")
      || ids.has(program.program_id)
      || program.route !== `/go/${program.route_slug || program.program_id}`
      || (program.route_slug && (!ROUTE_SLUG.test(program.route_slug) || NETWORK_ID_SLUG.test(program.route_slug)))
    ) throw new Error(`coverage_go_manifest_entry_invalid:${profileId}:${program?.program_id || "missing"}`);
    ids.add(program.program_id);
  }
  return ids;
}

export function deriveReviewRoutesFromRegistry(registry, profileId, ledgerPrograms = []) {
  const allowed = deriveProfileSurfaceSets(registry, profileId, ledgerPrograms).review;
  return registry.programs.filter((program) => allowed.has(program.program_id)).map((program) => program.review_path);
}

function parseSitemapRoutes(xml, origin) {
  return new Set([...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => {
    const url = new URL(match[1]);
    if (url.origin !== origin) throw new Error(`sitemap_origin_invalid:${url.origin}`);
    return url.pathname;
  }));
}

export async function reviewPageIds(root, registry, profileId) {
  const reviewsRoot = path.join(root, "public", "reviews");
  const entries = await readdir(reviewsRoot, { withFileTypes: true });
  const ids = [];
  const reservedReviewRoutes = new Set(["submit"]);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (reservedReviewRoutes.has(entry.name)) continue;
    const indexFile = path.join(reviewsRoot, entry.name, "index.html");
    if (!await access(indexFile).then(() => true, () => false)) continue;
    ids.push(entry.name);
  }
  // Identity-only aliases may redirect to their canonical held review, but
  // that redirect is not a second public review. Real alias HTML remains in
  // ids above, so unauthorized rendered surfaces still fail exact coverage.
  const registeredSlugs = new Set(registry.programs.map((program) => program.review_path?.match(/^\/reviews\/([^/]+)\/$/)?.[1]).filter(Boolean));
  const redirects = await readFile(path.join(root, "public", "_redirects"), "utf8");
  for (const line of redirects.split("\n")) {
    const match = line.trim().match(/^\/reviews\/([^/]+)\/\s+(\S+)\s+(301|308)$/);
    if (!match || !registeredSlugs.has(match[1])) continue;
    const program = registry.programs.find((row) => row.review_path === `/reviews/${match[1]}/`);
    const profile = program?.profiles?.[profileId];
    if (profile?.canonical_identity?.role === "alias"
      && profile.surfaces?.review === false && profile.surfaces?.sitemap === false) {
      const canonical = registry.programs.find((row) => row.program_id === profile.canonical_identity.canonical_program_id);
      if (canonical?.profiles?.[profileId]?.surfaces?.review === true && match[2] === canonical.review_path) continue;
    }
    ids.push(match[1]);
  }
  return new Set(ids);
}

export async function collectCoverageInputs({ root, registry, profileId, money, quiz, calculatorConfig, providerContracts, providerFastpath }) {
  registry = effectiveAffiliateRegistry(registry);
  const resolvedRoot = rootPath(root);
  // 2026-08-06 cluster 1: coverage has to audit the surfaces the BUILD assembles,
  // not the raw data files. Reading money-page-specs.json directly counted the
  // Shed alias row as a compare surface that the build had already (correctly)
  // suppressed, and reported the build's own dedup as coverage drift.
  const ledgerPrograms = JSON.parse(await readFile(path.join(resolvedRoot, "data", "program-content-ledger.json"), "utf8")).programs || [];
  const { aliasKeys } = deriveIdentityGroups(registry, profileId, ledgerPrograms);
  const projectedMoney = { ...money, pages: projectMoneyPagesFromRegistry(registry, profileId, money.pages, ledgerPrograms) };
  const projectedQuiz = projectQuizFromRegistry(registry, profileId, quiz, { programs: ledgerPrograms });
  const calculatorData = buildCostCalculatorData(calculatorConfig, projectedMoney.pages, providerContracts, providerFastpath, registry, profileId, aliasKeys);
  const { eligible: calculatorProviders } = costCalculatorDropdownProviders(calculatorData);
  const sitemapXml = await readFile(path.join(resolvedRoot, "public", "sitemap.xml"), "utf8");
  let goManifest;
  let goRuntimeManifestText;
  try {
    goManifest = JSON.parse(await readFile(path.join(resolvedRoot, "artifacts", "ops", "worker-manifest.staging.json"), "utf8"));
    goRuntimeManifestText = await readFile(path.join(resolvedRoot, "functions", "go", "program-manifest.js"), "utf8");
  } catch {
    throw new Error(`coverage_go_manifest_invalid:${profileId}`);
  }
  return {
    root: resolvedRoot,
    registry,
    profileId,
    money: projectedMoney,
    quiz: projectedQuiz,
    ledgerPrograms,
    calculatorData,
    providerContracts,
    providerFastpath,
    actual: {
      compare: new Set(projectedMoney.pages.flatMap((page) => (page.rows || []).map((row) => row.program_id))),
      quiz: new Set((projectedQuiz.candidates || []).map((candidate) => candidate.program_id)),
      calculator: new Set(calculatorProviders.map((provider) => provider.program_id)),
      review: await reviewPageIds(resolvedRoot, registry, profileId),
      sitemapRoutes: parseSitemapRoutes(sitemapXml, registry.site_profiles?.[profileId]?.canonical_origin || "https://glpclinicscout.com"),
      goHandlerPresent: await access(path.join(resolvedRoot, "functions", "go", "[program].js")).then(() => true, () => false),
      go: goSurfaceFromManifest(goManifest, profileId),
      goManifest,
      goRuntimeManifestText,
    },
  };
}

function exceptionAllows(profile, surface) {
  return profile.exceptions?.[surface]?.enabled === true;
}

function requireSurface({ program, profile, profileId, surface, actual }) {
  // Surfaces are keyed by render identity where a reader sees them and by
  // registry id where the registry does; accept either for the same program.
  if (actual.has(program.program_id) || (program.review_slug && actual.has(program.review_slug))) return;
  if (exceptionAllows(profile, surface)) return;
  throw new Error(`coverage_missing:${profileId}:${program.program_id}:${surface}`);
}

function assertExactSurface(actual, expected, profileId, surface, canonical = (id) => id) {
  // Compare on ONE identity. A program that appears as `coivas` on the page and
  // `awin-128761` in the registry is one program, and the exactness check has to
  // say so or it reports a phantom gap for every network-registered provider.
  const actualCanonical = new Set([...actual].map(canonical));
  const expectedCanonical = new Set([...expected].map(canonical));
  for (const id of actualCanonical) if (!expectedCanonical.has(id)) throw new Error(`coverage_unregistered:${profileId}:${id}:${surface}`);
  for (const id of expectedCanonical) if (!actualCanonical.has(id)) throw new Error(`coverage_projection_missing:${profileId}:${id}:${surface}`);
}

export function validateProgramCoverage(inputs) {
  const { profileId, actual, root, providerContracts, providerFastpath } = inputs;
  const registry = effectiveAffiliateRegistry(inputs.registry);
  const siteProfile = validateRegistryShape(registry, profileId);
  const expected = deriveProfileSurfaceSets(registry, profileId, inputs.ledgerPrograms || []);
  const reviewRouteToProgramId = new Map(registry.programs.map((program) => [program.review_path, program.program_id]));
  const mapReviewSlug = (slug) => reviewRouteToProgramId.get(`/reviews/${slug}/`) || `unregistered-review-slug:${slug}`;
  const actualSurfaces = {
    compare: new Set(inputs.money.pages.flatMap((page) => (page.rows || []).map((row) => row.program_id))),
    quiz: new Set((inputs.quiz.candidates || []).map((candidate) => candidate.program_id)),
    calculator: actual.calculator,
    review: new Set([...actual.review].map(mapReviewSlug)),
    sitemap: new Set([...actual.sitemapRoutes]
      .filter((route) => /^\/reviews\/[a-z0-9-]+\/$/.test(route))
      .map((route) => reviewRouteToProgramId.get(route) || `unregistered-review-route:${route}`)),
  };
  if (actual.goHandlerPresent !== true) throw new Error(`coverage_go_handler_missing:${profileId}`);
  if (actual.goRuntimeManifestText !== renderGoRuntimeManifestModule(actual.goManifest)) throw new Error(`coverage_go_runtime_manifest_mismatch:${profileId}`);
  actualSurfaces.go = actual.go;

  for (const program of registry.programs) {
    const profile = profileFor(program, profileId);
    if (!profile) continue;
    const coverageLive = program.commercial_state === "live" && profile.vertical_fit === true && profile.wired === true;
    if (!coverageLive) continue;
    for (const surface of ["review", "go", "sitemap"]) requireSurface({ program, profile, profileId, surface, actual: actualSurfaces[surface] });
    if (profile.data_profile.has_review_facts) {
      for (const surface of ["compare", "quiz"]) requireSurface({ program, profile, profileId, surface, actual: actualSurfaces[surface] });
    }
    if (profile.data_profile.has_price) requireSurface({ program, profile, profileId, surface: "calculator", actual: actualSurfaces.calculator });
  }
  const canonicalById = new Map(registry.programs.flatMap((program) => [
    [program.program_id, program.review_slug || program.program_id],
    [program.review_slug || program.program_id, program.review_slug || program.program_id],
  ]));
  const canonical = (id) => canonicalById.get(id) || id;
  for (const surface of SURFACES) assertExactSurface(actualSurfaces[surface], expected[surface], profileId, surface, canonical);

  if (actual.sitemapRoutes.size !== siteProfile.expected_sitemap_routes) throw new Error(`coverage_sitemap_count_invalid:${actual.sitemapRoutes.size}`);
  const moneyPrograms = [...actual.compare];
  const contracts = new Set(providerContracts.providers.map((program) => program.program_id));
  const activeFastpathIds = new Set((providerFastpath.providers || [])
    .filter((program) => program.route_state === "LIVE_EDITORIAL_AFFILIATE_ACTIVE"
      && program.affiliate_cta_state === "ACTIVE_PROVIDER_ISSUED_DIRECT")
    .map((program) => program.program_id));
  const contractRowsById = new Map(providerContracts.providers.map((program) => [program.program_id, program]));
  const liveFastpath = registry.programs.filter((program) => {
    const row = contractRowsById.get(program.program_id)?.row_contract;
    return contracts.has(program.program_id) && program.commercial_state === "live"
      && activeFastpathIds.has(program.program_id)
      && row?.live_link_allowed === true && row?.promotion_authorized === true;
  }).map((program) => program.program_id);
  const heldContracts = [...contracts].filter((programId) => !liveFastpath.includes(programId));
  return {
    status: "PASS",
    profile_id: profileId,
    registry_programs: registry.programs.length,
    sitemap_routes: actual.sitemapRoutes.size,
    money_programs: moneyPrograms.length,
    quiz_candidates: actual.quiz.size,
    calculator_providers: actual.calculator.size,
    review_pages: actual.review.size,
    live_money_programs: moneyPrograms.filter((id) => registry.programs.find((program) => program.program_id === id || program.review_slug === id)?.commercial_state === "live").length,
    live_fastpath_programs: liveFastpath.length,
    held_contract_programs: heldContracts,
    auto_generate: siteProfile.auto_generate,
    auto_publish: siteProfile.auto_publish,
    network_calls: 0,
  };
}
