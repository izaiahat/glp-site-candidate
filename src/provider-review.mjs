import { pageSeoCopy } from "./page-seo-copy.mjs";
// DESIGN WAVE 2026-08-06: compact (still fully visible) affiliate-status disclosure.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildSchemaGraph } from "./schema.mjs";
import { subidAttributes } from "./affiliate-subid.mjs";
import { selectedGoOutbound } from "./go-render-selection.mjs";
import { relationshipEndedNotice } from './affiliate-relationship-sync.mjs';
import { trackingAllowedHosts } from "./tracking-allowed-hosts.mjs";
import { scoreProvider } from "./money-page.mjs";
import { renderPromoEvidence } from "./promo-code.mjs";
import { providerVisualKind, renderProviderEvidencePicture } from "./pass2-provider-visuals.mjs";
import { CITATION_REASONS, citationAttr, renderCitationAnchor } from "./citation-attribution.mjs";
import { priceStateText } from "./price-state.mjs";
import { deriveIdentityGroups } from "./provider-identity.mjs";


const RESEARCH_FACT_LABELS = [
  ["research_first_month_price", "First month price"],
  ["research_states_served", "States served"],
  ["research_consultation_fee", "Consultation fee"],
  ["research_cancellation", "Cancellation"],
  ["research_pharmacy_type", "Pharmacy type"],
  ["research_shipping_wait", "Shipping time"],
];

function researchFacts(row) {
  // Deep-research fields (2026-08-06 pass): each carries its own source URL and
  // checked date. Rendered only when present; never invents a value.
  return RESEARCH_FACT_LABELS.map(([key, label]) => {
    const item = row[key];
    // A not_publicly_stated finding records that the provider publishes NOTHING
    // here. Rendering it in the facts list would read as a published fact.
    if (!item || !item.value || item.state === "not_publicly_stated") return "";
    const date = item.verified_as_of ? ` <small>checked ${esc(item.verified_as_of)}</small>` : "";
    const src = item.source_url
      ? ` <span class="citation">${renderCitationAnchor({ url: item.source_url, label: "†", reason: CITATION_REASONS.INLINE_FACT_SOURCE, rel: "nofollow noopener", extraAttrs: ` title="${esc(label)} source"` })}</span>`
      : "";
    return `<div><dt>${esc(label)}</dt><dd>${esc(String(item.value))}${date}${src}</dd></div>`;
  }).join("");
}

const WEIGHTS = Object.freeze({ price_transparency: 30, medical_oversight: 25, insurance_support: 15, public_reviews: 15, shipping_transparency: 15 });
const LABELS = Object.freeze({ price_transparency: "Price transparency", medical_oversight: "Care-process visibility", insurance_support: "Insurance support", public_reviews: "Comparable public reviews", shipping_transparency: "Shipping transparency" });
const AFFILIATE_MICRO_DISCLOSURE = `<span>Clinic Scout is independent and reader-supported — we may earn a commission at no extra cost to you. It never changes a score.</span> The scored comparison uses the published evidence rubric, not a clinical assessment. <a href="/how-we-make-money/">How we make money</a>.`;
const HOW_IT_WORKS_FOLD_WORDS = 80;
// 2026-08-20 Blocker F (ported 2026-08-27 from the live head): the frozen
// per-network DIRECT_TRACKING_HOSTS literal was a third copy of rail knowledge
// with no Trackdesk key, so Nu Image Medical was refused in the one component
// that decides whether the monetized CTA is emitted. The allowlist is now
// derived per program through src/tracking-allowed-hosts.mjs; an uncovered
// program throws instead of rendering a link — same gate, stricter scope.

export function providerLinkDark(row) {
  return row?.live_link_allowed !== true || row?.promotion_authorized !== true || selectedGoOutbound(row, 'reviews.rv2')?.held === true;
}

function esc(value) {
  const normalized = String(value ?? "").trim() === "UNKNOWN_NO_SOURCE"
    ? "No source-backed statement is published for this field."
    : String(value ?? "");
  return normalized.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function sourceBackedText(value) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "UNKNOWN_NO_SOURCE" ? normalized : null;
}

function score(row) {
  return scoreProvider(row);
}

// 2026-08-06 cluster 1. The fast-path template used to hard-code the string
// "Score pending evidence" into its summary. It was not a description of the
// evidence: the SAME build scored those providers on the comparison table
// (Measured 7.6/10) off criteria the merit derivation had already produced. The
// score simply never reached this renderer, because a fast-path review's row is
// built from the provider contract and the derived criteria live on the content
// ledger. Both halves are fixed: the ledger's scoring evidence is merged onto the
// row in buildProviderReviewSpecs, and the score block below renders whatever
// that row scores. A provider with genuinely no scoreable evidence gets a named,
// explained state - never a bare placeholder.
function scoreBlock(row, provider) {
  const overall = score(row);
  const count = assessedCriteria(row).length;
  if (overall !== null && count > 0) {
    return `<p class="score">${esc((overall / 10).toFixed(1))}/10</p>`
      + `<p class="score-basis">Evidence-completeness score across the ${count} assessed criteria below. <a href="/how-we-rate/">How we rate</a>.</p>`;
  }
  return `<p class="score score-unscored">Not scored</p>`
    + `<p class="score-basis">No comparable editorial score is assigned to ${esc(provider)}. `
    + `This is not a claim that provider information is unpublished. <a href="/how-we-rate/">How we rate</a>.</p>`;
}

// A criterion the provider publishes nothing for scores zero in the weighted
// total - that is the rubric - but printing "0.0/10" beside it reads as a
// quality judgement the evidence does not support. It says what actually
// happened instead: nothing was published, and it carried no points.
/**
 * Three legacy-vertical review pages are carried forward as frozen bytes from an
 * earlier release and print "Score pending evidence" above their own explanation
 * of why no number is shown. The explanation is honest; the label is not - the
 * score is not pending anything, it is deliberately not given. Frozen bytes
 * cannot re-render, so the label is normalized here and the build refuses the
 * rewrite unless the explanation it depends on is actually present.
 */
export function normalizeFrozenScoreState(relative, html) {
  const PLACEHOLDER = "Score pending evidence";
  if (!html.includes(PLACEHOLDER)) return { html, rewritten: false };
  if (!/No numeric score is shown because/.test(html)) {
    throw new Error(`frozen_score_placeholder_without_reason:${relative}`);
  }
  return { html: html.replaceAll(PLACEHOLDER, "Not scored"), rewritten: true };
}

function assessedCriteria(row) {
  return Object.entries(WEIGHTS).filter(([key]) => Number.isFinite(row.criteria_scores?.[key])
    && (key !== "public_reviews" || hasComparableReviewEvidence(row)));
}

function criteriaList(row) {
  return assessedCriteria(row).map(([key, weight]) => {
    const value = row.criteria_scores[key];
    const result = value === 0 ? `Nothing published · 0 of ${weight}%`
      : `${esc((value / 10).toFixed(1))}/10`;
    return `<li><span>${esc(LABELS[key])} · ${weight}%</span><strong>${result}</strong></li>`;
  }).join("");
}

function hasComparableReviewEvidence(row) {
  return row.social_proof?.status === "VERIFIED" && Number(row.criteria_scores?.public_reviews) > 0;
}

function humanBestFor(row) {
  return String(row.best_for || "Published terms")
    .replace(/^Stronger published\s+/i, "")
    .replace(/\s+evidence in this comparison$/i, "")
    .replaceAll("-", " ")
    .trim();
}

function reviewLogo(row) {
  const logo = row.logo;
  if (!logo || !/^\/assets\/provider-logos\/.+\.(?:svg|webp)$/.test(logo.path || "") || !/^[a-f0-9]{64}$/.test(logo.sha256 || "") || logo.runtime_remote_load !== false) throw new Error(`review_logo_invalid:${row.program_id}`);
  // 2026-08-18: the review lockup used `logo.surface` - a fact about the page we
  // captured the mark FROM, not about the ink - so a white logo rendered as an
  // empty white box here even after the compare chips were fixed. Use the
  // derived treatment (scripts/analyze-provider-logo-luminance.py), and fall
  // back to `surface` only for a row the chip join has not touched.
  const chip = logo.chip_class || (logo.treatment === "dark-chip" ? "dark" : logo.surface);
  const scale = Number(logo.content_scale) > 1
    ? ` style="--logo-content-scale:${Number(logo.content_scale).toFixed(3)}"` : "";
  return `<span class="review-logo review-logo--${esc(chip)}"${scale}><img src="${esc(logo.path)}" alt="${esc(logo.alt)}" width="${esc(logo.width)}" height="${esc(logo.height)}" decoding="async"></span>`;
}

// Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #6): the review's
// Article node gets `image` (required for Article rich results) pointing at the
// editorial scene derivative the page ALREADY renders eagerly above the fold —
// the largest JPG for maximum compatibility, attached only when the asset
// exists on disk, never fabricated.
const REVIEW_SCENE_DERIVATIVES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "derivatives", "provider-review-pass2");
function reviewSceneImage(review) {
  return existsSync(path.join(REVIEW_SCENE_DERIVATIVES, `${review.program_id}-1280.jpg`))
    ? `https://glpclinicscout.com/assets/images/provider-review-pass2/${review.program_id}-1280.jpg`
    : null;
}

function providerEditorialScene(review) {
  const identity = { program_id: review.program_id, display_name: review.provider };
  const visual = providerVisualKind(identity);
  const picture = renderProviderEvidencePicture(identity, {
    className: "cs-review-scene-picture",
    ...(review.program_id === "orderlymeds" ? {
      sizes: "(max-width:760px) calc(100vw - 32px), 920px",
      alt: "Editorial evidence desk for the OrderlyMeds review with a blank research dossier and comparison materials",
    } : {}),
  });
  const caption = visual.kind === "editorial-scene"
    ? "Original editorial research scene. Provider identity and evidence appear separately in accessible page content."
    : "First-party provider logo fallback. No original editorial scene is available; provider evidence appears in accessible page content.";
  return `<figure class="cs-review-scene" data-provider-scene="${esc(review.program_id)}" data-provider-visual-kind="${esc(visual.kind)}">${picture}<figcaption>${caption}</figcaption></figure>`;
}

function citation(number = 1, label = "Provider source", className = "citation") {
  return `<sup class="${esc(className)}"><a href="#source-${number}" aria-label="${esc(label)} ${number}">${number}</a></sup>`;
}

function cited(value, label) {
  return `${esc(value)}${citation(1, label)}`;
}

function list(items, label) {
  return items.map((item) => `<li>${cited(item, label)}</li>`).join("");
}

// REPAIR C 2026-08-21 (review template compression, ≤14,000px target with zero
// copy loss): the first three evidence/article sections a reader hits on a
// review page stay fully open. Everything after that is real, unabridged
// copy — nothing is shortened or reworded — it is only moved behind a native
// <details> disclosure so the page does not force a 20,000px scroll to reach
// the sources list. The one-line "gist" shown in the closed summary is lifted
// verbatim (first sentence, or a word-boundary truncation) from the section's
// own body text, so it is never a new claim — just a shorter quote of the
// same evidence. GOAL:625-626 explicitly allows this: "long exact copy may
// move into accessible <details>/tabs/drawers provided it stays rendered,
// keyboard-reachable, discoverable."
const EVIDENCE_OPEN_COUNT = 3;

function evidenceGist(text, maxChars = 110) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentenceMatch = clean.match(/^[^.!?]*[.!?]/);
  const candidate = (sentenceMatch ? sentenceMatch[0] : clean).trim();
  if (candidate.length <= maxChars) return candidate;
  const cut = candidate.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function renderEvidenceSection(id, heading, bodyHtml, gistSource, position) {
  if (position <= EVIDENCE_OPEN_COUNT) {
    return `<section class="review-depth" id="${esc(id)}"><h2>${esc(heading)}</h2>${bodyHtml}</section>`;
  }
  const gist = evidenceGist(gistSource);
  return `<details class="review-depth cs-details" id="${esc(id)}"><summary><span class="cs-details-label"><span class="cs-details-heading">${esc(heading)}</span>${gist ? `<span class="cs-details-gist">${esc(gist)}</span>` : ""}</span></summary><div class="cs-details-body">${bodyHtml}</div></details>`;
}

// Validate the destination actually selected for rendering, separately from
// the immutable predecessor row which a receipted rail successor supersedes.
export function reviewAffiliateUrl(programId, network, href) {
  const allowedHosts = trackingAllowedHosts(programId, network);
  let url;
  try { url = new URL(href); } catch { throw new Error(`review_direct_link_host_invalid:${programId}`); }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error(`review_direct_link_host_invalid:${programId}`);
  return url;
}

function affiliateReviewCta(row) {
  const selected = selectedGoOutbound(row, 'reviews.rv2');
  const live = selected ? !selected.held : row.live_link_allowed === true && row.promotion_authorized === true;
  if (!live) return `<a class="cta secondary" href="/best/online-glp-1-providers/" data-affiliate-state="unavailable">See ${esc(row.provider)} in comparison</a>`;
  if (row.affiliate_link_mode !== "transparent_direct" || !row.affiliate_href) throw new Error(`review_direct_link_contract_invalid:${row.program_id}`);
  const url = reviewAffiliateUrl(row.program_id, selected?.network || row.affiliate_network, selected?.issuedHref || row.affiliate_href);
  const attributionMonth = String(row.activation_at_utc || row.review_date_modified || "").slice(0, 7).replace("-", "");
  if (!/^\d{6}$/.test(attributionMonth)) throw new Error(`review_affiliate_subid_month_invalid:${row.program_id}`);
  const subid = selected?.surfaceCode || `review-${row.program_id}-conclusion-${attributionMonth}`;
  const subids = subidAttributes({
    programId: row.program_id,
    network: selected?.network || row.affiliate_network,
    position: "review-closing",
    rankPosition: 1,
    pageSlug: `review-${row.program_id}`,
    pageType: "review",
    providerSlug: row.review_slug || row.program_id,
  });
  return `<a class="cta primary affiliate" href="${esc(selected?.href || url.toString())}" rel="sponsored nofollow noopener" data-analytics-event="affiliate_click" data-link-mode="${selected ? 'server-redirect' : 'transparent-direct'}" data-affiliate-state="active" data-program="${esc(row.program_id)}" data-merchant="${esc(row.provider)}" data-page-slug="review-${esc(row.program_id)}" data-link-position="conclusion" data-variant="a" data-subid="${esc(subid)}" ${subids}>Start with ${esc(row.provider)} →</a>`;
}

function promo(row) {
  if (!row.promo) throw new Error(`review_promo_invalid:${row.program_id}`);
  return renderPromoEvidence(row.promo, row.review_date_modified || new Date().toISOString());
}

function sourcePublisher(url, provider) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return host === "fda.gov" ? "U.S. Food and Drug Administration" : provider;
}

function buildFastpathReview(contract, integration, checkedAsOf) {
  const active = integration.route_state === "LIVE_EDITORIAL_AFFILIATE_ACTIVE" && integration.affiliate_cta_state === "ACTIVE_PROVIDER_ISSUED_DIRECT";
  const held = integration.route_state === "READY_EDITORIAL_LINK_DARK" && integration.affiliate_cta_state?.startsWith("HOLD_");
  if (!active && !held) throw new Error(`fastpath_publication_state_invalid:${contract.program_id}`);
  if (contract.row_contract.starting_price_sort !== null) throw new Error(`fastpath_row_gate_invalid:${contract.program_id}`);
  if (active && (contract.row_contract.live_link_allowed !== true || contract.row_contract.promotion_authorized !== true || !contract.network_contract.tracking_url)) throw new Error(`fastpath_active_gate_invalid:${contract.program_id}`);
  if (held && (contract.row_contract.live_link_allowed !== false || contract.row_contract.promotion_authorized !== false)) throw new Error(`fastpath_held_gate_invalid:${contract.program_id}`);
  const sources = [];
  const provenance = contract.research_copy_bindings;
  const sourceIdsByField = Object.fromEntries(Object.entries(contract.field_sources).map(([field, urls]) => [field, urls.map(url => {
    const evidence = (provenance?.citation_fields?.[field] || [])
      .map(id => provenance.captures[id]).find(capture => capture.url === url);
    const observed = evidence?.observed_at?.slice(0, 10) || contract.source_capture_bindings?.[url]?.captured_at_utc?.slice(0, 10) || checkedAsOf;
    // A URL reused for an older field must not inherit another field's newer clock.
    let source = sources.find(source => source.url === url && source.verified_as_of === observed);
    if (!source) {
      source = { url, publisher: sourcePublisher(url, contract.display_name), verified_as_of: observed, source_id: `source-${sources.length + 1}` };
      sources.push(source);
    }
    return source.source_id;
  })]));
  const row = {
    ...contract.row_contract,
    provider: contract.display_name,
    meds_offered: contract.row_contract.medications,
    average_wait: contract.page_copy.shipping,
    logo: { ...integration.logo, alt: `${contract.display_name} logo`, runtime_remote_load: false },
    live_link_allowed: contract.row_contract.live_link_allowed,
    promotion_authorized: contract.row_contract.promotion_authorized,
    affiliate_link_mode: contract.row_contract.affiliate_link_mode,
    affiliate_network: contract.network_contract.network,
    affiliate_href: contract.network_contract.tracking_url,
    promo: { status: "NOT_VERIFIED", code: null, source_url: null },
    social_proof: { status: "NOT_VERIFIED_COMPARABLE", explanation: "No comparable independent public-review dataset was verified for this contract.", methodology_path: "/how-we-rate/", verified_as_of: checkedAsOf },
    review_date_modified: checkedAsOf,
    activation_at_utc: integration.activation_at_utc || null,
  };
  return {
    program_id: contract.program_id,
    provider: contract.display_name,
    path: contract.review_path,
    row,
    appearances: [],
    sources,
    date_published: checkedAsOf,
    date_modified: checkedAsOf,
    fastpath_contract: contract,
    fastpath_integration: integration,
    source_ids_by_field: sourceIdsByField,
  };
}

export function buildProviderReviewSpecs(pages, providerContracts, fastpath, registry = null, profileId = "glp-clinic-scout", ledgerPrograms = []) {
  if (providerContracts?.schema !== "glp-provider-fastpath-contracts-v1" || fastpath?.schema !== "glp-provider-fastpath-integration-v1") throw new Error("provider_fastpath_contract_missing");
  const reviews = new Map();
  // READY6 providers now carry comparison rows like everyone else, but their
  // review page is rendered by src/ready6-editorial.mjs from its own evidence
  // contract. Generating a second review page from the comparison row would
  // publish two pages on one route. This is a RENDERER split, not a surface
  // exclusion: they are on compare, quiz and the ranked table with everyone else.
  const editorialLaneIds = new Set((registry?.programs || [])
    .filter((program) => program.source_kind === "approved53_ready6")
    .flatMap((program) => [program.program_id, program.review_slug].filter(Boolean)));
  for (const page of pages) {
    for (const row of page.rows) {
      if (editorialLaneIds.has(row.program_id)) continue;
      const existing = reviews.get(row.program_id) || {
        program_id: row.program_id,
        provider: row.provider,
        path: row.review_path,
        row,
        appearances: [],
        sources: new Map(),
        date_published: page.date_published,
        date_modified: page.date_modified,
      };
      if (existing.provider !== row.provider || existing.path !== row.review_path) throw new Error(`provider_review_identity_conflict:${row.program_id}`);
      existing.appearances.push({ title: page.title, path: page.path, page_slug: page.page_slug, score: score(row), best_for: row.best_for });
      const source = page.sources.find((item) => item.url === row.source_url);
      if (!source) throw new Error(`provider_review_source_missing:${row.program_id}:${page.page_id}`);
      existing.sources.set(source.url, source);
      if (page.date_modified > existing.date_modified) existing.date_modified = page.date_modified;
      reviews.set(row.program_id, existing);
    }
  }
  // 2026-08-06 surface unification: `base_provider_review_count` was a frozen 13.
  // It described the money-class tier, so the moment a fast-path provider earned a
  // comparison row the build died on a number that had nothing to verify. The
  // registry projection below is the real invariant and it stays; the count is
  // derived, reported, and no longer asserted against a literal.
  const comparisonDerivedReviewCount = reviews.size;
  const ledgerById = new Map((ledgerPrograms || []).map((entry) => [entry.program_id, entry]));
  const integrations = new Map(fastpath.providers.map((provider) => [provider.program_id, provider]));
  if (providerContracts.providers.length !== fastpath.fastpath_provider_count || integrations.size !== fastpath.fastpath_provider_count) throw new Error("provider_fastpath_count_invalid");
  for (const contract of providerContracts.providers) {
    if (!integrations.has(contract.program_id)) throw new Error(`provider_fastpath_identity_invalid:${contract.program_id}`);
    const integration = integrations.get(contract.program_id);
    const fastpathReview = buildFastpathReview(contract, integration, integration.checked_as_of || fastpath.checked_as_of);
    // A fast-path row is assembled from the provider contract, which carries no
    // scoring fields. The derived criteria live on the content ledger and already
    // drive this provider's rank on the comparison table, so bind them here
    // instead of shipping a page that says its own score does not exist.
    const ledgerEntry = ledgerById.get(contract.program_id);
    // A capture-bound authored contract can explicitly withhold a review score.
    // Generic ledger ranking must not overwrite that independently reviewed state.
    const explicitlyUnscored = contract.source_capture_bindings
      && Object.hasOwn(contract.row_contract, 'score') && contract.row_contract.score === null
      && Object.keys(contract.row_contract.criteria_scores || {}).length === 0;
    if (ledgerEntry?.criteria_scores && !explicitlyUnscored) {
      fastpathReview.row.criteria_scores = ledgerEntry.criteria_scores;
      fastpathReview.row.score_basis = ledgerEntry.score_basis;
      if (ledgerEntry.score_evidence_earned) fastpathReview.row.score_evidence_earned = ledgerEntry.score_evidence_earned;
    }
    // A fast-path provider now also carries comparison rows. Its review page stays
    // the contract's editorial page; the comparison appearances it earned come with
    // it so the cross-links between page and table still resolve.
    const fromComparison = reviews.get(contract.program_id);
    if (fromComparison) fastpathReview.appearances = fromComparison.appearances;
    reviews.set(contract.program_id, fastpathReview);
  }
  if (reviews.size !== fastpath.expected_provider_review_count) throw new Error(`provider_review_count_invalid:${reviews.size}:expected:${fastpath.expected_provider_review_count}:comparison_derived:${comparisonDerivedReviewCount}`);
  if (registry !== null) {
    if (registry.schema !== "site-program-registry-v1" || !registry.site_profiles?.[profileId]) throw new Error(`provider_review_program_registry_invalid:${profileId}`);
    const expectedGenerated = new Set(registry.programs
      .filter((program) => ["money", "fastpath"].includes(program.source_kind) && program.profiles?.[profileId]?.surfaces?.review === true)
      .map((program) => program.program_id));
    if (expectedGenerated.size !== reviews.size || [...reviews.keys()].some((programId) => !expectedGenerated.has(programId))) throw new Error(`provider_review_registry_projection_invalid:${profileId}`);
  }
  const pricingEntries = registry ? JSON.parse(readFileSync(new URL("../data/provider-pricing-matrix.json", import.meta.url), "utf8")).providers : {};
  const aliasIds = registry ? deriveIdentityGroups(registry, profileId, ledgerPrograms).aliasIds : new Set();
  return [...reviews.values()].map((review) => {
    const record = registry?.programs.find(program => program.program_id === review.program_id || program.review_path === review.path);
    const alias = record?.profiles?.[profileId]?.canonical_identity;
    const canonicalRecord = alias?.role === 'alias' ? registry.programs.find(program => program.program_id === alias.canonical_program_id) : record;
    const provider_detail_path = canonicalRecord ? `/providers/${canonicalRecord.program_id}/` : null;
    const model = review.fastpath_contract ? review : { ...review, row: { ...review.row, review_date_modified: review.date_modified }, sources: [...review.sources.values()].map((source, index) => ({ ...source, source_id: `source-${index + 1}` })) };
    const profile = record?.profiles?.[profileId];
    const entry = record ? pricingEntries[String(record.review_slug || record.program_id)] : null;
    // The registered writer appends this substantive disclosure after rendering.
    // Bind it before freshness derivation so Article, byline and the later Review
    // schema writer all receive the same evidence-backed date, not stale models.
    if (record?.commercial_state === "live" && profile?.vertical_fit === true
      && profile?.wired === true && profile?.surfaces?.review === true
      && !aliasIds.has(record.program_id) && entry && entry.medications.length === 0) {
      model.row = { ...model.row, price_state_disclosure_evidence: priceStateText(entry) };
    }
    const endedNotice = relationshipEndedNotice(record?.affiliate_relationship_snapshot);
    if (endedNotice) model.row = {...model.row, affiliate_relationship_notice:endedNotice};
    return { ...model, provider_detail_path };
  });
}

function fastpathCitations(review, displayField, label = displayField) {
  const contractFields = review.fastpath_integration.field_bindings[displayField] || [];
  const sourceIds = [...new Set(contractFields.flatMap((field) => review.source_ids_by_field[field] || []))];
  if (!sourceIds.length) throw new Error(`fastpath_field_source_missing:${review.program_id}:${displayField}`);
  return sourceIds.map((sourceId) => citation(Number(sourceId.replace("source-", "")), `${label} source`, "citation fastpath-citation")).join("");
}

function fastpathParagraph(review, key, heading, position) {
  const value = sourceBackedText(review.fastpath_contract.page_copy[key]);
  if (!value) return "";
  position.n += 1;
  const bodyHtml = `<p>${esc(value)}${fastpathCitations(review, key, heading)}</p>`;
  return renderEvidenceSection(key.replaceAll("_", "-"), heading, bodyHtml, value, position.n);
}

function renderFastpathProviderReviewPage(review, identity) {
  const { row, fastpath_contract: contract, fastpath_integration: integration } = review;
  const linkDark = providerLinkDark(row);
  if (review.path !== `/reviews/${review.program_id}/` || review.sources.length < 2) throw new Error(`fastpath_review_contract_invalid:${review.program_id}`);
  if (!linkDark && integration.affiliate_cta_state !== "ACTIVE_PROVIDER_ISSUED_DIRECT") throw new Error(`fastpath_review_active_state_invalid:${review.program_id}`);
  if (linkDark && !integration.affiliate_cta_state?.startsWith("HOLD_") && selectedGoOutbound(row, 'reviews.rv2')?.held !== true) throw new Error(`fastpath_review_held_state_invalid:${review.program_id}`);
  const url = `https://glpclinicscout.com${review.path}`;
  const seo = pageSeoCopy(review.path);
  const title = seo?.title ?? `${contract.page_copy.title} | Clinic Scout`;
  const h1 = seo?.h1 ?? contract.page_copy.title;
  const description = seo?.meta ?? contract.page_copy.description;
  const schema = buildSchemaGraph({
    url,
    title,
    description,
    datePublished: review.date_published,
    dateModified: review.date_modified,
    author: identity.author,
    image: reviewSceneImage(review),
    evidenceReview: { status: "PASS", source_urls: review.sources.map((source) => source.url) },
    breadcrumbs: [{ name: "Home", path: "/" }, { name: "Provider reviews", path: "/reviews/" }, { name: `${review.provider} review`, path: review.path }],
  });
  const sources = review.sources.map((source, index) => `<li id="source-${index + 1}"><span>${index + 1}</span>${renderCitationAnchor({ url: source.url, label: source.publisher, reason: CITATION_REASONS.REVIEW_SOURCE_LEDGER })}<small>Checked ${esc(source.verified_as_of)}</small></li>`).join("");
  const criteria = criteriaList(row);
  const warning = contract.page_copy.regulatory_warning ? `<aside class="regulatory-warning" id="regulatory-warning" role="note"><p class="eyebrow">Provider-specific FDA warning</p><h2>Read the FDA warning-letter context first</h2><p>${esc(contract.page_copy.regulatory_warning)}${fastpathCitations(review, "regulatory_warning", "FDA warning letter")}</p></aside>` : "";
  const endedNotice = relationshipEndedNotice(selectedGoOutbound(row, 'reviews.rv2')?.relationship_snapshot);
  const holdCopy = endedNotice || (linkDark
    ? "No active affiliate link is available on this page."
    : "This page contains one active affiliate link. Clinic Scout may earn a commission at no extra cost to the reader; the link does not change the page evidence or score.");
  const affiliateContext = holdCopy ? `<section class="affiliate-status" id="affiliate-status" aria-label="Affiliate status"><p class="affiliate-status-label">Affiliate status</p><p>${esc(holdCopy)}</p></section>` : "";
  const affiliateCta = endedNotice ? '' : linkDark
    ? `<p class="cta secondary affiliate-hold" aria-disabled="true" data-affiliate-state="held">Partner link unavailable</p>`
    : affiliateReviewCta(row);
  // Shared left-to-right counter: sections beyond the first three RENDERED
  // (non-empty) evidence sections collapse into disclosures. Threaded through
  // fastpathParagraph in DOM order below, not declaration order.
  const evidencePosition = { n: 0 };
  const css = `<style>:root{--ink:#11213a;--paper:#fbfaf6;--line:#d6dee8;--green:#0c6b54;--muted:#5b6676}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,system-ui,sans-serif;line-height:1.6}header,main{width:min(960px,calc(100% - 32px));margin:auto}header{padding:56px 0 20px}.summary,.facts,.review-depth,.criteria,.sources,.affiliate-status,.regulatory-warning{padding:24px;border:1px solid var(--line);border-radius:20px;background:#fff;margin:20px 0}.regulatory-warning{border:3px solid #a43b2d;background:#fff2ef}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.criteria ul,.sources ol{display:grid;gap:10px;padding:0;list-style:none}.criteria li{display:flex;justify-content:space-between;gap:16px}.score{margin:12px 0 4px;font-size:2rem;font-weight:900}.score-unscored{font-size:1.35rem;color:var(--muted)}.score-basis{margin:0;color:var(--muted);font-size:.9rem}.review-logo{display:grid;place-items:center;width:220px;height:86px;padding:12px}.review-logo img{width:100%;height:100%;object-fit:contain}.cta{display:block;padding:12px;border-radius:12px;background:#eef1f3;font-weight:800}.actions{display:grid;gap:12px;margin:20px 0}.cta.internal{background:#e6efe9;color:var(--green);text-align:center;text-decoration:none}`;
  return `<!doctype html><html lang="en" data-release="live" data-link-dark="${linkDark ? "true" : "false"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}">${css}</style></head><body><header><span class="stage">Independent provider review · sources dated</span><p class="eyebrow">Source-cited editorial review</p><h1>${esc(h1)}</h1><p>${esc(contract.page_copy.description)}</p><p class="byline">By the <a href="${esc(identity.author.bio_path)}">${esc(identity.author.display_name)}</a> · Updated ${esc(review.date_modified)}</p><p class="byline affiliate-note">${AFFILIATE_MICRO_DISCLOSURE}</p></header><main>${providerDetailReturn(review)}${providerEditorialScene(review)}<section class="summary" id="bottom-line">${reviewLogo(row)}<h2>Bottom line</h2><p>${esc(contract.page_copy.bottom_line)}${fastpathCitations(review, "bottom_line", "Bottom line")}</p>${scoreBlock(row, review.provider)}</section>${warning}<dl class="facts"><div><dt>Published price</dt><dd>${esc(row.starting_price)}${fastpathCitations(review, "pricing", "Price")}</dd></div><div><dt>Medications described</dt><dd>${esc(row.meds_offered)}${fastpathCitations(review, "pricing", "Medication")}</dd></div><div><dt>Insurance</dt><dd>${esc(row.insurance)}${fastpathCitations(review, "pricing", "Insurance")}</dd></div><div><dt>Shipping</dt><dd>${esc(contract.page_copy.shipping)}${fastpathCitations(review, "shipping", "Shipping")}</dd></div></dl>${fastpathParagraph(review, "pricing", "Pricing breakdown", evidencePosition)}${fastpathParagraph(review, "eligibility", "Eligibility and clinician review", evidencePosition)}${fastpathParagraph(review, "shipping", "Shipping", evidencePosition)}${fastpathParagraph(review, "cancellation", "Cancellation and refunds", evidencePosition)}${fastpathParagraph(review, "accreditation", "Accreditation and pharmacy", evidencePosition)}${fastpathParagraph(review, "regulatory", "Compounded-drug status", evidencePosition)}${affiliateContext}${criteria ? `<section class="criteria" id="criteria"><h2>Published scoring criteria</h2><p>Scores use the published weights, normalize across assessed criteria only, and exclude commission. Unassessed criteria are omitted, not treated as unpublished or zero.</p><ul>${criteria}</ul></section>` : ""}<section class="sources" id="sources"><h2>Sources</h2><ol>${sources}</ol></section><div class="actions">${affiliateCta}<a class="cta internal" href="/quiz/provider-fit/?source=provider-review&amp;provider=${esc(review.program_id)}">Find my match</a></div><section class="disclosure"><h2>Editorial disclosure</h2><p>${AFFILIATE_MICRO_DISCLOSURE}</p><p>This page is general consumer research, not medical advice. Eligibility, prescribing, product selection, and availability require a licensed clinician and current provider confirmation.</p></section><script type="application/ld+json">${JSON.stringify(schema.jsonLd)}</script></main></body></html>`;
}

function providerDetailReturn(review) {
  if (!review.provider_detail_path) return '';
  if (!/^\/providers\/[a-z0-9-]+\/$/.test(review.provider_detail_path)) throw new Error(`review_detail_path_invalid:${review.program_id}`);
  return `<p class="review-provider-detail-return"><a class="cs-btn cs-btn--quiet" data-review-provider-detail-link href="${esc(review.provider_detail_path)}">View ${esc(review.provider)} provider details</a></p>`;
}

export function renderProviderReviewPage(review, identity) {
  if (review?.fastpath_contract) {
    const html = renderFastpathProviderReviewPage(review, identity);
    return ['bodybuilding-com-glp-1-longevity-review','skinnyrx-1-glp-weight-loss-provider-review'].includes(review.program_id)
      ? html.replace('<dt>Published price</dt>', '<dt>Reported price wording</dt>') : html;
  }
  const { row } = review;
  if (review.path !== `/reviews/${review.program_id}/` || row.provider !== review.provider || !review.appearances.length || !review.sources.length) throw new Error(`provider_review_contract_invalid:${review.program_id}`);
  const url = `https://glpclinicscout.com${review.path}`;
  const seo = pageSeoCopy(review.path);
  const h1 = seo?.h1 ?? `${review.provider} review`;
  const title = seo?.title ?? `${review.provider} review: pricing, terms, and evidence | Clinic Scout`;
  const evidenceDescription = `A source-cited editorial review of ${review.provider}'s published pricing, service terms, tradeoffs, and Clinic Scout comparison appearances.`;
  const description = seo?.meta ?? evidenceDescription;
  const schema = buildSchemaGraph({
    url,
    title,
    description,
    datePublished: review.date_published,
    dateModified: review.date_modified,
    author: identity.author,
    image: reviewSceneImage(review),
    evidenceReview: { status: "PASS", source_urls: review.sources.map((source) => source.url) },
    breadcrumbs: [{ name: "Home", path: "/" }, { name: "Provider reviews", path: "/reviews/" }, { name: `${review.provider} review`, path: review.path }],
  });
  const scoredCriteria = Object.entries(WEIGHTS).filter(([key]) => key !== "public_reviews" || hasComparableReviewEvidence(row));
  const criteria = criteriaList(row);
  const appearances = review.appearances.map((item) => `<li><a href="${esc(item.path)}">${esc(item.title)}</a><span>${esc(humanBestFor(row))}${item.score === null ? " · score pending" : ` · ${esc((item.score / 10).toFixed(1))}/10`}</span></li>`).join("");
  const sources = review.sources.map((source, index) => `<li id="source-${index + 1}"><span>${index + 1}</span>${renderCitationAnchor({ url: source.url, label: source.publisher, reason: CITATION_REASONS.REVIEW_SOURCE_LEDGER })}<small>Checked ${esc(source.verified_as_of)}</small></li>`).join("");
  const overall = score(row);
  const strongest = scoredCriteria
    .map(([key]) => [key, Number(row.criteria_scores?.[key])])
    .filter(([, value]) => Number.isFinite(value))
    .sort((left, right) => right[1] - left[1])[0];
  const scoreContext = strongest ? `${LABELS[strongest[0]]} is ${review.provider}'s strongest documented category at ${(strongest[1] / 10).toFixed(1)}/10.` : "The evidence score remains pending.";
  const howItWorksWords = `${row.meds_offered ?? ""} ${row.average_wait ?? ""}`.trim().split(/\s+/).filter(Boolean).length;
  const foldHowItWorks = howItWorksWords < HOW_IT_WORKS_FOLD_WORDS;
  const howItWorksFold = foldHowItWorks ? `<p>${cited(row.meds_offered, "Service source")} ${cited(row.average_wait, "Timing source")}</p>` : "";
  const hasReviews = hasComparableReviewEvidence(row);
  // Same left-to-right disclosure counter as the fastpath template (see
  // renderEvidenceSection): the first three RENDERED sections stay open,
  // anything after that collapses behind a <details> with its content byte-
  // identical to before, just re-homed.
  const evidencePosition = { n: 0 };
  evidencePosition.n += 1;
  const pricingSection = renderEvidenceSection(
    "pricing", "Pricing breakdown",
    `<p>${cited(row.starting_price, "Price source")}</p><p>Verify the amount due today, recurring charge, included services, and any medication or laboratory cost before checkout.</p>`,
    `${row.starting_price} Verify the amount due today, recurring charge, included services, and any medication or laboratory cost before checkout.`,
    evidencePosition.n,
  );
  let howItWorksSection = "";
  if (!foldHowItWorks) {
    evidencePosition.n += 1;
    howItWorksSection = renderEvidenceSection(
      "how-it-works", "How the program works",
      `<p>${cited(row.meds_offered, "Service source")}</p><p>${cited(row.average_wait, "Timing source")}</p>`,
      `${row.meds_offered ?? ""} ${row.average_wait ?? ""}`,
      evidencePosition.n,
    );
  }
  evidencePosition.n += 1;
  const cancellationCopy = "The compared source does not establish a complete cancellation or refund policy. Read the current operative terms and keep written confirmation before paying.";
  const cancellationSection = renderEvidenceSection(
    "cancellation", "Cancellation and refunds",
    `<p>${cancellationCopy}</p>`,
    cancellationCopy,
    evidencePosition.n,
  );
  let customerReviewsSection = "";
  if (hasReviews) {
    evidencePosition.n += 1;
    customerReviewsSection = renderEvidenceSection(
      "customer-reviews", "Customer reviews",
      `<p>${esc(row.social_proof.rating.toFixed(1))}/5 from ${esc(row.social_proof.review_count)} reviews · <a href="${esc(row.social_proof.source_url)}" rel="noopener">source</a>.</p>`,
      `${row.social_proof.rating.toFixed(1)}/5 from ${row.social_proof.review_count} reviews`,
      evidencePosition.n,
    );
  }
  const deepReview = `${pricingSection}${howItWorksSection}${cancellationSection}${customerReviewsSection}`;
  const css = `<style>:root{--ink:#11213a;--paper:#fbfaf6;--card:#fff;--line:#d6dee8;--green:#0c6b54;--blue:#174ea6;--muted:#5b6676;--gold:#d99a22}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.6}header,main,footer{width:min(960px,calc(100% - 32px));margin:auto}header{padding:56px 0 20px}main{padding-bottom:72px}h1{max-width:18ch;font-size:clamp(2.5rem,7vw,5.4rem);line-height:.95;letter-spacing:-.05em}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:.76rem;font-weight:900;color:var(--green)}.stage{display:inline-block;padding:6px 10px;border-radius:999px;background:#fff1c8;font-weight:900}.review-logo{display:grid;place-items:center;width:220px;height:86px;padding:12px;border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden}.review-logo--dark{background:#12243a;border-color:#2c4460}.review-logo--light{background:#fff}.review-logo img{width:100%;height:100%;object-fit:contain;transform:scale(var(--logo-content-scale,1))}.summary,.facts,.pros-cons section,.criteria,.promo,.comparisons,.sources,.disclosure{padding:clamp(20px,4vw,34px);border:1px solid var(--line);border-radius:20px;background:#fff;margin:20px 0}.summary{border-left:7px solid var(--green)}.score{font-size:2rem;font-weight:900}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.facts div{padding:14px;border-radius:12px;background:#f5f8f6}.facts dt{font-size:.75rem;text-transform:uppercase;font-weight:900;color:var(--muted)}.facts dd{margin:4px 0 0;font-weight:750}.pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pros-cons section:first-child{background:#eff8f3}.pros-cons section:last-child{background:#fff8ed}.criteria ul,.comparisons ul,.sources ol{display:grid;gap:10px;padding:0;list-style:none}.criteria li,.comparisons li{display:flex;justify-content:space-between;gap:16px;padding:12px;border-bottom:1px solid var(--line)}.comparisons li{align-items:start}.comparisons li span{color:var(--muted)}.sources li{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:center}.sources li>span{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:var(--ink);color:#fff;font-weight:900}.citation{margin-left:.15em;font-size:.7em}.citation a{display:inline-grid;min-width:1.3em;height:1.3em;place-items:center;border-radius:50%;background:#e8eef8;color:var(--blue);font-weight:900;text-decoration:none}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:22px 0}.cta{display:flex;min-height:50px;align-items:center;justify-content:center;padding:12px;border-radius:12px;font-weight:900;text-align:center;text-decoration:none}.cta.primary{background:var(--green);color:#fff}.cta.secondary{border:1px solid var(--line);background:#fff;color:var(--ink)}.cta.disabled{background:#647184;color:#fff}.byline{color:var(--muted)}@media(max-width:700px){.facts,.pros-cons,.actions{grid-template-columns:1fr}.criteria li,.comparisons li{display:grid}.sources li{grid-template-columns:32px 1fr}.sources small{grid-column:2}}</style>`;
  const linkDark = providerLinkDark(row);
  return `<!doctype html><html lang="en" data-release="live" data-link-dark="${linkDark ? "true" : "false"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}">${css}</head><body><header><span class="stage">Independent provider review · sources dated</span><p class="eyebrow">Source-cited editorial review</p><h1>${esc(h1)}</h1><p>${esc(evidenceDescription)}</p><p class="byline">By the <a href="${esc(identity.author.bio_path)}">${esc(identity.author.display_name)}</a> · Updated ${esc(review.date_modified)}</p><p class="byline affiliate-note">${AFFILIATE_MICRO_DISCLOSURE}</p></header><nav class="jump-nav" aria-label="On this page"><div class="jump-nav-scroll"><a href="#bottom-line">Bottom line</a><a href="#pricing">Pricing</a>${foldHowItWorks ? "" : `<a href="#how-it-works">How it works</a>`}<a href="#cancellation">Cancellation</a>${hasReviews ? `<a href="#customer-reviews">Customer reviews</a>` : ""}${criteria ? `<a href="#criteria">Scoring</a>` : ""}<a href="#comparisons">Comparisons</a><a href="#sources">Sources</a></div></nav><main>${providerDetailReturn(review)}${providerEditorialScene(review)}<section class="summary" id="bottom-line">${reviewLogo(row)}<h2>Bottom line</h2><p>${cited(scoreContext, "Bottom-line source")}</p>${howItWorksFold}${scoreBlock(row, review.provider)}</section><dl class="facts" id="provider-details"><div><dt>Published starting price</dt><dd>${cited(row.starting_price, "Price source")}</dd></div><div><dt>Medications offered</dt><dd>${cited(row.meds_offered, "Service source")}</dd></div><div><dt>Insurance</dt><dd>${cited(row.insurance, "Payment source")}</dd></div><div><dt>Published wait</dt><dd>${cited(row.average_wait, "Timing source")}</dd></div>${researchFacts(row)}</dl>${deepReview}${promo(row)}<div class="pros-cons"><section><h2>✅ Pros</h2><ul>${list(row.pros, "Provider source")}</ul></section><section><h2>⚠️ Watch-outs</h2><ul>${list(row.cons, "Provider source")}</ul></section></div>${criteria ? `<section class="criteria" id="criteria"><h2>Published scoring criteria</h2><p>Scores use the published weights, normalize across assessed criteria only, and exclude commission. Unassessed criteria are omitted, not treated as unpublished or zero.</p><ul>${criteria}</ul></section>` : ""}<section class="comparisons" id="comparisons"><h2>See ${esc(review.provider)} in context</h2><ul>${appearances}</ul></section><div class="actions">${affiliateReviewCta(row)}<a class="cta internal" href="/quiz/provider-fit/?source=provider-review&provider=${esc(review.program_id)}">Find my match</a></div><section class="sources" id="sources"><h2>Sources</h2><ol>${sources}</ol></section></main><script type="application/ld+json">${JSON.stringify(schema.jsonLd).replaceAll("<", "\\u003c")}</script></body></html>`;
}
