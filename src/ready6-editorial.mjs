import { pageSeoCopy } from "./page-seo-copy.mjs";
import { createHash } from "node:crypto";
import { canonicalOrganizationNode, EDITORIAL_TEAM_ID, ORGANIZATION_ID } from "./aeo-entity.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureReviewDepth } from "./review-depth.mjs";
import { CITATION_REASONS, renderCitationAnchor } from "./citation-attribution.mjs";
import { subidAttributes } from "./affiliate-subid.mjs";
import { selectedGoOutbound } from "./go-render-selection.mjs";
import { renderProviderEvidencePicture } from "./pass2-provider-visuals.mjs";

export const READY6_CANDIDATE_ID = "glp-approved53-ready6-brand-slug-successor-20260802-r3";
export const READY6_KEYS = Object.freeze(["Awin:128761", "Katalys:1286", "Katalys:647", "Katalys:1304", "Katalys:1516", "Katalys:1518"]);
export const READY6_ROUTE_BY_KEY = Object.freeze({
  "Awin:128761": "/reviews/coivas/",
  "Katalys:1286": "/reviews/sprout-health/",
  "Katalys:647": "/reviews/mangorx/",
  "Katalys:1304": "/reviews/direct-meds/",
  "Katalys:1516": "/reviews/shed/",
  "Katalys:1518": "/reviews/breezemeds/",
});
// The adjudication date these pages publish (unchanged evidence) and the date the
// PAGE last changed. 2026-08-19 is the P0 release that rewrote their schema graph
// to the canonical publisher entity — a real content change, so the modified date
// moves with it while datePublished keeps naming the adjudication.
export const READY6_DATE_PUBLISHED = "2026-08-02";
export const READY6_DATE_MODIFIED = "2026-08-19";
export const READY6_ROUTES = Object.freeze(READY6_KEYS.map((key) => READY6_ROUTE_BY_KEY[key]));
export const READY6_REL = Object.freeze(["sponsored", "nofollow", "noopener", "noreferrer"]);
export const READY6_RESEARCH_COUNTS = Object.freeze({ ready_editorial_direct_total: 6, adjacent_sister_pool_total: 25, drop_genuine_legal_route_block_total: 1, held_total: 0, total: 32 });

const SHA256 = /^[a-f0-9]{64}$/;
const FDA_SENTENCE = "Compounded drugs are not FDA approved, and FDA does not premarket-review them for safety, effectiveness, or quality.";
const FORBIDDEN_VISITOR_PHRASES = ["offline candidate", "bridge review pending", "not deployed", "noindex", "review-only", "candidate-only"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function fail(code, detail = "") { throw new Error(detail ? `${code}:${detail}` : code); }
function cleanOfficialUrl(url, key) {
  let parsed;
  try { parsed = new URL(url); } catch { fail("ready6_official_source_invalid", key); }
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username || parsed.password) fail("ready6_official_source_not_clean", key);
  return parsed.toString();
}
function exactFinalRecord(readjudication, programKey) {
  const rows = readjudication.final_records.filter((row) => row.program_key === programKey);
  if (rows.length !== 1) fail("ready6_final_record_bijection_invalid", programKey);
  return rows[0];
}
function isReadyState(state) { return state === "READY_EDITORIAL" || state === "READY_EDITORIAL_HONEST_COPY"; }

function validateProgram(program, finalRecord, approvedProgram, approvedRegistry, fdaSource) {
  if (
    program.program_key !== finalRecord.program_key
    || program.registry_id !== finalRecord.registry_id
    || program.display_name !== finalRecord.display_name
    || program.review_path !== READY6_ROUTE_BY_KEY[program.program_key]
    || !isReadyState(finalRecord.final_state)
    || finalRecord.build_lane !== "GLP_DIRECT_REVIEW"
    || approvedProgram?.program_key !== program.program_key
    || approvedProgram.registry_id !== program.registry_id
    || approvedProgram.display_name !== program.display_name
    || approvedProgram.network !== program.network
    || String(approvedProgram.provider_program_id) !== String(program.provider_program_id)
  ) fail("ready6_program_identity_or_final_state_invalid", program.program_key);

  if (!Array.isArray(program.official_sources) || program.official_sources.length !== 2) fail("ready6_source_count_invalid", program.program_key);
  const [merchant, regulator] = program.official_sources;
  const sourceEvidenceUrls = new Set([finalRecord.official_url, ...(finalRecord.evidence || []).map((row) => row.url)]);
  if (!sourceEvidenceUrls.has(merchant.url) || merchant.source_type !== "official_merchant" || merchant.checked_as_of !== "2026-08-02") fail("ready6_merchant_source_not_bound", program.program_key);
  if (regulator.url !== fdaSource.primary_source.url || regulator.source_type !== "official_regulator" || regulator.publisher !== "U.S. Food and Drug Administration") fail("ready6_fda_source_not_bound", program.program_key);
  program.official_sources.forEach((source) => cleanOfficialUrl(source.url, program.program_key));

  const tracking = approvedProgram.tracking;
  if (tracking?.candidate_registry_wired !== true || tracking.state !== "candidate_registry_wired_provider_issued" || tracking.click_qa_performed !== false || tracking.public_go_surface !== false) fail("ready6_approved_registry_tracking_invalid", program.program_key);
  let trackingUrl;
  try { trackingUrl = new URL(tracking.provider_issued_url); } catch { fail("ready6_provider_url_invalid", program.program_key); }
  const allowedHosts = approvedRegistry.allowed_provider_tracking_hosts?.[program.network] || [];
  if (trackingUrl.protocol !== "https:" || trackingUrl.username || trackingUrl.password || trackingUrl.hostname !== tracking.tracking_host || !allowedHosts.includes(trackingUrl.hostname)) fail("ready6_provider_url_host_invalid", program.program_key);

  const page = program.page;
  if (!page?.brand_name || !page.title || !page.description || !page.bottom_line || !page.pricing || !page.price_volatility_warning || !page.clinician_boundary || !page.regulatory || !page.cta_label || page.first_party_findings?.length < 2 || page.evidence_gaps?.length < 4 || !Array.isArray(page.review_sections) || page.review_sections.length < 4 || page.review_sections.some((section) => !section?.heading || !section?.body || section.body.trim().split(/\s+/).length < 90) || !page.regulatory.includes(FDA_SENTENCE) || !page.clinician_boundary.toLowerCase().includes("licensed clinician")) fail("ready6_editorial_page_contract_invalid", program.program_key);
  return trackingUrl.toString();
}

export async function loadReady6EditorialInputs(root) {
  const resolved = root instanceof URL ? fileURLToPath(root) : path.resolve(root);
  const contractBytes = await readFile(path.join(resolved, "data", "ready6-editorial-contract.json"));
  const approvedRegistryBytes = await readFile(path.join(resolved, "data", "approved-program-registry.json"));
  const contract = JSON.parse(contractBytes);
  const sourceBytes = {};
  for (const [sourceId, source] of Object.entries(contract.source_contracts || {})) sourceBytes[sourceId] = await readFile(source.path);
  return { root: resolved, contract, contract_sha256: sha256(contractBytes), approvedRegistry: JSON.parse(approvedRegistryBytes), approved_registry_sha256: sha256(approvedRegistryBytes), sourceBytes };
}

// 2026-08-06 cluster 1. `contract.score_rubric` freezes overall_score: null and
// every criterion at "Pending evidence". That was true when it was written and
// stopped being true the moment the merit derivation started scoring these same
// providers off the content ledger - so /best/ ranked Sprout Health 8.0/10 while
// /reviews/sprout-health/ told the reader it was "not scored". The frozen rubric
// stays in the contract as the record of what was approved; what a reader sees is
// derived from the same ledger criteria that rank the provider on the table.
// A row that IS an alias of another merchant stays unscored on purpose: showing
// two different scores for one merchant is the failure, not the fix.
function meritFor(model, ledgerById, aliasOf) {
  if (aliasOf) return null;
  const entry = ledgerById.get(model.registry_id) || ledgerById.get(model.route.replace(/^\/reviews\/|\/$/g, ""));
  const scores = entry?.criteria_scores;
  if (!scores || !READY6_CRITERION_KEYS.every((key) => Number.isFinite(scores[key]))) return null;
  const comparable = entry.social_proof?.status === "VERIFIED" && Number(scores.public_reviews) > 0;
  const used = READY6_CRITERION_KEYS.filter((key) => key !== "public_reviews" || comparable);
  const weight = used.reduce((total, key) => total + READY6_WEIGHTS[key], 0);
  const overall = Math.round(used.reduce((total, key) => total + scores[key] * READY6_WEIGHTS[key], 0) / weight);
  return Object.freeze({
    overall,
    basis: entry.score_basis || null,
    criteria: Object.freeze(used.map((key) => Object.freeze({
      name: READY6_CRITERION_LABELS[key], weight_percent: READY6_WEIGHTS[key],
      result: `${(scores[key] / 10).toFixed(1)}/10`,
    }))),
  });
}

export const READY6_WEIGHTS = Object.freeze({ price_transparency: 30, medical_oversight: 25, insurance_support: 15, public_reviews: 15, shipping_transparency: 15 });
export const READY6_CRITERION_KEYS = Object.freeze(Object.keys(READY6_WEIGHTS));
export const READY6_CRITERION_LABELS = Object.freeze({ price_transparency: "Price transparency", medical_oversight: "Care-process visibility", insurance_support: "Insurance support", public_reviews: "Comparable public reviews", shipping_transparency: "Shipping transparency" });

export function buildReady6ReviewModels(inputs, { ledgerPrograms = [], aliases = {} } = {}) {
  const { contract, approvedRegistry, sourceBytes } = inputs;
  const ledgerById = new Map((ledgerPrograms || []).flatMap((entry) => [
    [String(entry.program_id), entry], ...(entry.registry_id ? [[String(entry.registry_id), entry]] : []),
  ]));
  if (contract?.schema !== "glp-approved53-ready6-editorial-contract-v1" || contract.candidate_id !== READY6_CANDIDATE_ID || contract.candidate_state !== "READY6_PRODUCTION_REVIEW_INDEXABLE" || approvedRegistry?.candidate_id !== READY6_CANDIDATE_ID) fail("ready6_candidate_contract_invalid");
  const policy = contract.publication_policy || {};
  if (policy.bridge_review_state !== "PENDING" || policy.deployment_authority !== false || policy.deployed !== false || policy.indexable !== true || policy.sitemap_included !== true || policy.link_mode !== "transparent_direct" || policy.local_candidate_active_ctas !== 6 || policy.provider_issued_urls_only !== true || policy.tracking_link_click_qa_performed !== false) fail("ready6_publication_policy_invalid");
  if (!contract.effects || Object.values(contract.effects).some((value) => value !== 0)) fail("ready6_effects_not_zero");
  for (const [sourceId, source] of Object.entries(contract.source_contracts || {})) if (!SHA256.test(source.sha256 || "") || !sourceBytes[sourceId] || sha256(sourceBytes[sourceId]) !== source.sha256) fail("ready6_source_hash_mismatch", sourceId);

  const readjudication = JSON.parse(sourceBytes.final_readjudication);
  const fdaSource = JSON.parse(sourceBytes.fda_compounding);
  if (readjudication.schema !== "net_new32_legality_only_readjudication_v1" || readjudication.final_records?.length !== 32 || new Set(readjudication.final_records.map((row) => row.program_key)).size !== 32 || JSON.stringify(readjudication.final_portfolio_counts) !== JSON.stringify(READY6_RESEARCH_COUNTS) || JSON.stringify(contract.final_research_partition) !== JSON.stringify(READY6_RESEARCH_COUNTS)) fail("ready6_research_partition_invalid");
  const readyKeys = readjudication.final_records.filter((row) => isReadyState(row.final_state)).map((row) => row.program_key).sort();
  const adjacent = readjudication.final_records.filter((row) => row.final_state.startsWith("ADJACENT_SISTER_POOL")).length;
  const dropped = readjudication.final_records.filter((row) => row.final_state === "DROP_GENUINE_LEGAL_ROUTE_BLOCK").length;
  const held = readjudication.final_records.filter((row) => row.final_state.startsWith("HOLD_")).length;
  if (JSON.stringify(readyKeys) !== JSON.stringify([...READY6_KEYS].sort()) || adjacent !== 25 || dropped !== 1 || held !== 0 || fdaSource.primary_source?.url !== "https://www.fda.gov/drugs/human-drug-compounding/compounding-and-fda-questions-and-answers") fail("ready6_final_target_partition_invalid");
  if (!Array.isArray(contract.programs) || contract.programs.length !== 6 || JSON.stringify(contract.programs.map((p) => p.program_key)) !== JSON.stringify(READY6_KEYS) || JSON.stringify(contract.programs.map((p) => p.review_path)) !== JSON.stringify(READY6_ROUTES)) fail("ready6_exact_target_set_invalid");
  const criteria = contract.score_rubric?.criteria;
  if (contract.score_rubric?.overall_score !== null || contract.score_rubric?.status !== "NOT_SCORED_EVIDENCE_GAPS" || !contract.score_rubric.explanation || !Array.isArray(criteria) || criteria.length !== 5 || criteria.reduce((total, row) => total + row.weight_percent, 0) !== 100 || criteria.some((row) => row.result !== "Pending evidence")) fail("ready6_score_rubric_invalid");

  const approvedByKey = new Map(approvedRegistry.programs.map((program) => [program.program_key, program]));
  return contract.programs.map((program) => {
    const trackingUrl = validateProgram(program, exactFinalRecord(readjudication, program.program_key), approvedByKey.get(program.program_key), approvedRegistry, fdaSource);
    const aliasOf = aliases[program.registry_id] || null;
    const base = { registry_id: program.registry_id, route: program.review_path };
    return Object.freeze({ alias_of: aliasOf, merit: meritFor(base, ledgerById, aliasOf), candidate_id: contract.candidate_id, candidate_state: contract.candidate_state, bridge_review_state: policy.bridge_review_state, deployed: false, indexable: true, sitemap_included: true, tracking_clicked: false, route: program.review_path, registry_id: program.registry_id, program_key: program.program_key, network: program.network, display_name: program.page.brand_name, sources: program.official_sources, page: program.page, score_rubric: contract.score_rubric, cta: Object.freeze({ active: true, href: trackingUrl, href_sha256: sha256(Buffer.from(trackingUrl)), label: program.page.cta_label, mode: "transparent_direct", rel: READY6_REL }), ordered_blocks: Object.freeze(["affiliate_disclosure", "bottom_line", "published_findings", "pricing", "clinician_boundary", "regulatory", "score_rubric", "evidence_gaps", "price_volatility_warning", "affiliate_cta", "sources"]) });
  });
}

const citation = (number, label) => `<sup class="citation"><a href="#source-${number}" aria-label="${esc(label)}">${number}</a></sup>`;
const renderList = (items, citeNumber = null) => items.map((item) => `<li>${esc(item)}${citeNumber ? citation(citeNumber, "Official merchant source") : ""}</li>`).join("");
const renderCriteria = (criteria) => criteria.map((row) => `<li><span><strong>${esc(row.name)}</strong><small>${esc(row.weight_percent)}% of the standard rubric</small></span><b>${esc(row.result)}</b></li>`).join("");

function ready6ShellNav() {
  // Backward-compatible static renderer shell. The candidate build requests
  // `shared-interactive`, omits this legacy chrome, and wraps the governed READY6
  // editorial body in the same search/drawer/runtime shell as current reviews.
  return `<a class="skip-link" href="#main">Skip to main content</a><nav class="gcs-nav" aria-label="Primary"><div class="gcs-nav-inner"><a class="gcs-brand" href="/"><span>Clinic <span class="cs-grad-words">Scout</span></span></a><ul class="gcs-links"><li><a href="/insights/">Insights</a></li><li><a href="/providers/">Providers</a></li><li><a href="/pharmacies/">Pharmacies</a></li><li><a href="/tools/glp-1-cost-calculator/">Calculator</a></li><li><a class="cta primary cs-palette-action" href="/quiz/provider-fit/">Find your fit</a></li></ul></div></nav>`;
}

function ready6ProviderMark(model, logoByRegistryId = {}) {
  const logo = logoByRegistryId[model.registry_id];
  if (!logo) {
    return `<span class="ready6-provider-mark provider-logo provider-logo--wordmark" role="img" aria-label="${esc(model.display_name)}"><span class="provider-wordmark" aria-hidden="true">${esc(model.display_name)}</span></span>`;
  }
  if (!/^\/assets\/provider-logos\/[a-z0-9.-]+\.(?:svg|webp)$/.test(logo.path || "")
    || !logo.alt || !Number.isFinite(logo.width) || !Number.isFinite(logo.height)
    || logo.runtime_remote_load !== false) {
    fail("ready6_provider_logo_invalid", model.registry_id);
  }
  const chip = logo.treatment === "dark-chip" ? "dark" : "light";
  const scale = Number(logo.content_scale) > 1
    ? ` style="--logo-content-scale:${Number(logo.content_scale).toFixed(3)}"` : "";
  return `<span class="ready6-provider-mark provider-logo provider-logo--${chip}"${scale}><img src="${esc(logo.path)}" alt="${esc(logo.alt)}" width="${esc(logo.width)}" height="${esc(logo.height)}" decoding="async"></span>`;
}

function ready6TrustFooter() {
  return `<footer class="site-footer ready6-trust-footer"><div><a class="gcs-brand" href="/"><span>Clinic Scout</span></a><p>Commercial evidence, dated sources, and explicit unknowns. Not medical advice.</p></div><nav aria-label="Trust links"><a href="/editorial-guidelines/">Editorial policy</a><a href="/how-we-make-money/">How we make money</a><a href="/privacy/">Privacy</a></nav></footer>`;
}

// 2026-08-06 coverage repair: READY6 pages shipped with one affiliate anchor, no
// internal funnel, and no route out. The sibling links are rotated per page so the
// block does not become shared boilerplate across six near-adjacent reviews.
function keepComparing(model, unavailableRoutes = new Set()) {
  // SHED-301: an alias merchant's route is a permanent redirect, so it is never
  // offered as a sibling — a "keep comparing" link must land on a page, not a hop.
  // 2026-08-17: the same rule covers a route suppressed by a network pause; it is
  // now a 301 too, and a sibling link must never point at one.
  const routes = READY6_ROUTES.filter((route) => route === model.route || !unavailableRoutes.has(route));
  const index = routes.indexOf(model.route);
  const siblings = [1, 2].map((offset) => routes[(index + offset) % routes.length]);
  const links = siblings.map((route) => `<a class="cta internal" href="${esc(route)}">Open the ${esc(route.replace(/^\/reviews\/|\/$/g, ""))} record</a>`).join("");
  return `<section class="panel keep-comparing" id="keep-comparing"><h2>Set ${esc(model.display_name)} beside another record</h2><div class="keep-comparing-actions">${links}<a class="cta internal" href="/tools/glp-1-cost-calculator/">Estimate your monthly cost</a></div></section>`;
}

export function renderReady6ReviewPage(model, unavailableRoutes = new Set(), options = {}) {
  return renderReady6ReviewPageWithCopy(model, unavailableRoutes, options, pageSeoCopy(model.route));
}

function renderReady6ReviewPageWithCopy(model, unavailableRoutes, options, seo) {
  if (model.candidate_state !== "READY6_PRODUCTION_REVIEW_INDEXABLE" || model.bridge_review_state !== "PENDING" || model.deployed !== false || model.indexable !== true || model.sitemap_included !== true || model.cta.active !== true || model.cta.mode !== "transparent_direct" || JSON.stringify(model.cta.rel) !== JSON.stringify(READY6_REL) || model.tracking_clicked !== false) fail("ready6_render_model_invalid", model.registry_id);
  const sharedInteractiveShell = options.shell === "shared-interactive";
  // Keep the six historical adjudications immutable. Current scoped authority
  // supersedes only the outbound destination/network of this rendered view.
  const selected = selectedGoOutbound({ program_id: model.registry_id }, 'reviews.rv2');
  if (selected && !selected.held) model = { ...model, network: selected.network, cta: { ...model.cta, href: selected.href } };
  const canonical = `https://glpclinicscout.com${model.route}`;
  // AEO P0-C: one publisher entity, referenced by @id and defined once in the
  // page graph. These routes are byte-frozen against this renderer, so the
  // canonical entity has to be emitted HERE rather than patched afterwards.
  const schema = { "@context": "https://schema.org", "@graph": [
    { "@type": "Review", "@id": `${canonical}#review`, url: canonical, name: seo?.title ?? model.page.title, description: seo?.meta ?? model.page.description, datePublished: READY6_DATE_PUBLISHED, dateModified: READY6_DATE_MODIFIED, author: { "@id": EDITORIAL_TEAM_ID }, publisher: { "@id": ORGANIZATION_ID }, itemReviewed: { "@type": "Organization", name: model.display_name, url: model.sources[0].url }, citation: model.sources.map((source) => source.url) },
    { "@type": "Organization", "@id": EDITORIAL_TEAM_ID, name: "Clinic Scout Editorial Team", url: "https://glpclinicscout.com/authors/clinic-scout-editorial-team/", worksFor: { "@id": ORGANIZATION_ID } },
    canonicalOrganizationNode(),
  ] };
  const disclosure = "Affiliate disclosure: Clinic Scout is independent and reader-supported. If you use the partner link on this page, we may earn a commission at no extra cost to you. Commission does not change the evidence, gaps, or scoring decision.";
  const css = `<style${sharedInteractiveShell ? " data-preserve data-ready6-review" : ""}>:root{--navy:#102b3a;--ink:#173643;--paper:#f4efe6;--card:#fffdf9;--sage:#557b6e;--mint:#e1ece6;--gold:#d6ae70;--line:rgba(16,43,58,.16);--muted:#5e7078;--serif:"Iowan Old Style",Georgia,serif;--sans:Inter,Avenir,"Segoe UI",system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 92% 0,rgba(214,174,112,.22),transparent 32rem),linear-gradient(#fbf8f1,var(--paper));color:var(--ink);font:17px/1.68 var(--sans)}a{color:#245f69;text-underline-offset:3px}a:focus-visible{outline:3px solid var(--gold);outline-offset:4px}.topbar{background:var(--navy);color:#fff}.topbar nav,header,main,footer{width:min(980px,calc(100% - 32px));margin:auto}.topbar nav{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:24px}.topbar a{color:#fff}.brand{font-weight:900;text-decoration:none}.navlinks{display:flex;gap:20px}header{padding:clamp(52px,8vw,92px) 0 30px}.eyebrow{color:var(--sage);font-size:.78rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}h1,h2{font-family:var(--serif);color:var(--navy);text-wrap:balance}h1{max-width:17ch;margin:.2em 0;font-size:clamp(2.7rem,7vw,5.5rem);line-height:.98;letter-spacing:-.045em}h2{margin-top:0;font-size:clamp(1.55rem,3vw,2.35rem);line-height:1.1}.lede{max-width:70ch;font-size:1.15rem;color:var(--muted)}.meta{font-size:.9rem;color:var(--muted)}.disclosure,.panel,.warning,.cta-panel,.sources{margin:22px 0;padding:clamp(22px,4vw,36px);border:1px solid var(--line);border-radius:24px;background:rgba(255,253,249,.96);box-shadow:0 18px 55px rgba(16,43,58,.07)}.disclosure{border-left:6px solid var(--sage);background:#eef5f1}.bottom-line{border-top:6px solid var(--gold)}ul{padding-left:1.25rem}.rubric ul{list-style:none;padding:0}.rubric li{display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--line)}.rubric span{display:grid}.rubric small,.sources small{color:var(--muted)}.rubric b{color:var(--sage);white-space:nowrap}.score-status{display:inline-block;padding:6px 10px;border-radius:999px;background:var(--mint);font-weight:800}.score-status--scored{font-size:1.5rem;background:var(--gold);color:var(--navy)}.alias-notice{border-left:6px solid var(--gold)}.warning{border-left:6px solid var(--gold)}.cta-panel{text-align:center;background:var(--navy);color:#fff}.cta-panel h2{color:#fff}.affiliate-cta{display:inline-block;margin:10px 0;padding:15px 24px;border-radius:999px;background:var(--gold);color:var(--navy);font-weight:900;text-decoration:none}.sources ol{list-style:none;padding:0}.sources li{display:flex;gap:14px;margin:14px 0}.sources li>span{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--mint);font-weight:900}.keep-comparing{border-left:6px solid var(--sage)}.keep-comparing-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}.cta.internal{display:inline-block;padding:13px 20px;border:1px solid var(--line);border-radius:999px;background:var(--mint);color:var(--navy);font-weight:800;text-decoration:none}.cta.internal:hover{background:#d6e6de}footer{padding:38px 0 64px;color:var(--muted)}@media(max-width:620px){.navlinks{display:none}.rubric li{display:grid}.rubric b{white-space:normal}}</style>`;
  const sources = model.sources.map((source, index) => `<li id="source-${index + 1}"><span>${index + 1}</span><div>${renderCitationAnchor({ url: source.url, label: `${source.publisher} — ${source.source_type === "official_regulator" ? "official regulator source" : "official site"}`, reason: CITATION_REASONS.READY6_SOURCE_LEDGER, rel: "noopener noreferrer" })}<small>current as of ${esc(source.checked_as_of)}</small></div></li>`).join("");
  const scoreLine = model.merit
    ? `<p class="score-status score-status--scored">${esc((model.merit.overall / 10).toFixed(1))}/10 on our published evidence rubric</p>`
    : model.alias_of
      ? `<p class="score-status">Scored on our main ${esc(model.alias_of.brand)} record</p>`
      : `<p class="score-status">Not scored — evidence gaps remain</p>`;
  // An alias must not restate the five criteria as "Pending evidence": the
  // criteria are not pending, they are published on the canonical record.
  const rubricCriteria = model.merit ? model.merit.criteria : model.alias_of ? [] : model.score_rubric.criteria;
  const rubricExplanation = model.merit
    ? `Scores measure how completely ${esc(model.display_name)} publishes the commercial terms a buyer needs, weighted as below. A criterion the provider does not publish scores zero and is never estimated; commission is excluded. This is the rubric score for ${esc(model.display_name)}; other lists may use price, name or the ordering method stated on the page.`
    : model.alias_of
      ? `${esc(model.display_name)} is the same provider as ${esc(model.alias_of.brand)}, listed here under the brand its ${esc(model.network)} offer uses. To avoid publishing two different scores for one provider, the score lives on the main record.`
      : esc(model.score_rubric.explanation);
  // Only added where it says something page-specific. A line identical across six
  // near-adjacent reviews is boilerplate, and boilerplate is what the doorway-band
  // near-duplicate gate exists to catch.
  const scoreMethodLink = model.alias_of
    ? `<p class="meta"><a href="${esc(model.alias_of.route)}">See the scored ${esc(model.alias_of.brand)} review</a></p>`
    : model.merit ? `<p class="meta"><a href="/how-we-rate/">Read the full scoring method</a></p>` : "";
  const aliasNotice = model.alias_of
    ? `<aside class="panel alias-notice" id="same-provider"><h2>Same provider, second listing</h2><p>This page covers the ${esc(model.network)}-listed <strong>${esc(model.display_name)}</strong> offer. It is the same provider as <strong>${esc(model.alias_of.brand)}</strong>, which carries our full scored review and appears once — not twice — in our comparison tables and cost calculator.</p><a class="cta internal" href="${esc(model.alias_of.route)}">Read the full ${esc(model.alias_of.brand)} review</a></aside>`
    : "";
  const reviewSections = model.page.review_sections.map((section, index) => `<section class="panel" id="review-section-${index + 1}"><h2>${esc(section.heading)}</h2><p>${esc(section.body)}</p></section>`).join("");
  const pageSlug = model.route.replace(/^\/reviews\/|\/$/g, "");
  const subid = selected?.surfaceCode || `review-${model.registry_id}-conclusion-${READY6_DATE_MODIFIED.slice(0, 7).replace("-", "")}`;
  const subids = subidAttributes({ programId: model.registry_id, network: selected?.network || model.network, position: "review-closing", rankPosition: 1, pageSlug: `review-${pageSlug}`, pageType: "review", providerSlug: pageSlug });
  const stylesheetLinks = sharedInteractiveShell ? "" : `<link rel="stylesheet" href="/assets/site-review.css"><link rel="stylesheet" href="/assets/site-editorial.css">`;
  const bodyAttributes = sharedInteractiveShell ? "" : ' data-cs-template="review"';
  const shellNav = sharedInteractiveShell ? "" : ready6ShellNav();
  const shellFooter = sharedInteractiveShell ? "" : ready6TrustFooter();
  const providerScene = `<figure class="cs-review-scene" data-provider-scene="${esc(model.registry_id)}">${renderProviderEvidencePicture({ program_id: model.registry_id, display_name: model.display_name }, { className: "cs-review-scene__picture" })}<figcaption>Original editorial evidence scene for the ${esc(model.display_name)} provider record. Provider identity and findings remain text and source governed.</figcaption></figure>`;
  const html = `<!doctype html><html lang="en" data-release="release-ready"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow,max-image-preview:large"><title>${esc(seo?.title ?? `${model.page.title} | Clinic Scout`)}</title><meta name="description" content="${esc(seo?.meta ?? model.page.description)}"><link rel="canonical" href="${esc(canonical)}">${stylesheetLinks}${css}<script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script></head><body${bodyAttributes}>${shellNav}<header class="ready6-review-hero"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><a href="/providers/">Providers</a><span aria-current="page">${esc(model.display_name)}</span></nav>${ready6ProviderMark(model, options.logoByRegistryId)}<p class="eyebrow">Independent provider review</p><h1>${esc(seo?.h1 ?? model.page.title)}</h1><p class="lede">${esc(model.page.description)}</p><p class="meta">By the <a href="/authors/clinic-scout-editorial-team/">Clinic Scout Editorial Team</a> · Evidence current as of ${esc(model.sources[0].checked_as_of)}</p></header><main id="main" class="ready6-review">${providerScene}<nav class="ready6-jump-nav" aria-label="Review sections"><a href="#bottom-line">Bottom line</a><a href="#pricing">Pricing</a><a href="#score-rubric">How we rate</a><a href="#sources">Sources</a></nav><aside class="disclosure" id="affiliate-disclosure"><strong>${esc(disclosure)}</strong></aside><section class="panel bottom-line" id="bottom-line"><h2>Bottom line</h2><p>${esc(model.page.bottom_line)}${citation(1, "Official merchant source")}</p>${scoreLine}</section>${aliasNotice}<section class="panel" id="published-findings"><h2>What ${esc(model.display_name)} says</h2><p>These are attributed first-party merchant statements, not neutral medical evidence:</p><ul>${renderList(model.page.first_party_findings, 1)}</ul></section>${reviewSections}<section class="panel" id="pricing"><h2>Pricing and billing</h2><p>${esc(model.page.pricing)}${citation(1, "Official merchant pricing source")}</p></section><section class="panel" id="clinician-boundary"><h2>Clinician and prescription boundary</h2><p>${esc(model.page.clinician_boundary)}${citation(1, "Official merchant source")}</p></section><section class="panel" id="regulatory-status"><h2>Compounded-drug and FDA status</h2><p>${esc(model.page.regulatory)}${citation(2, "Official FDA source")}</p></section><section class="panel rubric" id="score-rubric"><h2>${model.merit ? "How this score was built" : "Conservative evidence rubric"}</h2><p>${rubricExplanation}</p>${rubricCriteria.length ? `<ul>${renderCriteria(rubricCriteria)}</ul>` : ""}${scoreMethodLink}</section><section class="panel" id="evidence-gaps"><h2>What remains unknown</h2><ul>${renderList(model.page.evidence_gaps)}</ul></section><aside class="warning" id="price-warning"><h2>Recheck before paying</h2><p>${esc(model.page.price_volatility_warning)}</p></aside>${keepComparing(model, unavailableRoutes)}<section class="cta-panel" id="partner-action"><h2>Visit ${esc(model.display_name)}</h2><p>${esc(disclosure)}</p><a class="affiliate-cta" href="${esc(model.cta.href)}" rel="${esc(model.cta.rel.join(" "))}" data-analytics-event="affiliate_click" data-affiliate-state="active" data-link-mode="transparent-direct" data-program="${esc(model.registry_id)}" data-merchant="${esc(model.display_name)}" data-page-slug="review-${esc(pageSlug)}" data-link-position="conclusion" data-variant="a" data-subid="${esc(subid)}" data-affiliate-network="${esc(model.network)}" ${subids}>${esc(model.cta.label)} →</a></section><section class="sources" id="sources"><h2>Sources</h2><ol>${sources}</ol></section></main>${shellFooter}</body></html>`;
  const finalHtml = html
    .replace('data-link-mode="transparent-direct"', selected?.href ? 'data-link-mode="server-redirect" data-funnel-v2-go' : 'data-link-mode="transparent-direct"')
    .replace(/\bwas checked (2026-\d{2}-\d{2})\b/gi, "is current as of $1")
    .replace(/\bchecked through (2026-\d{2}-\d{2})\b/gi, "current through $1")
    .replace(/\bchecked (2026-\d{2}-\d{2})\b/gi, "current as of $1");
  const lower = finalHtml.toLowerCase();
  for (const phrase of FORBIDDEN_VISITOR_PHRASES) if (lower.includes(phrase)) fail("ready6_visitor_governance_leak", phrase);
  return finalHtml;
}

export async function buildReady6EditorialPages(root, options = {}) {
  const inputs = await loadReady6EditorialInputs(root);
  const adjudicated = buildReady6ReviewModels(inputs, options);
  // 2026-08-17 network pause. The READY6 contract, its readjudication record and
  // every review brief's sha256 pin describe what was ADJUDICATED on 2026-08-02;
  // that history stays 6 and is still validated above in full. What SHIPS is
  // governed by data/program-registry.json. When a network pauses a program we
  // drop its registry row, and this lane must then not publish its review page,
  // because that page carries a transparent-direct affiliate CTA to an offer
  // nobody can join. Suppression is DERIVED from the registry, so the next pause
  // needs no edit here.
  const active = options.activeRegistryIds ? new Set(options.activeRegistryIds) : null;
  const models = active ? adjudicated.filter((model) => active.has(model.registry_id)) : adjudicated;
  const suppressed = adjudicated.filter((model) => !models.includes(model));
  const aliasRoutes = new Set(models.filter((model) => model.alias_of).map((model) => model.route));
  const unavailableRoutes = new Set([...aliasRoutes, ...suppressed.map((model) => model.route)]);
  return { inputs, models, alias_routes: [...aliasRoutes], suppressed_routes: suppressed.map((model) => model.route), pages: models.map((model) => {
    const rendered = renderReady6ReviewPage(model, unavailableRoutes, {
      shell: options.shell || "static-safe",
      logoByRegistryId: options.logoByRegistryId || {},
    });
    // Metadata must not reslice the preserved clinical wording excerpts. Generate
    // the supplement from the original evidence contract, then verify the real
    // SEO-bearing page against the unchanged minimum-word gate.
    const evidenceRendered = renderReady6ReviewPageWithCopy(model, unavailableRoutes, {
      shell: options.shell || "static-safe",
      logoByRegistryId: options.logoByRegistryId || {},
    }, null);
    const depth = ensureReviewDepth(evidenceRendered, model.route);
    const marker = evidenceRendered.includes("</main>") ? "</main>" : "</body>";
    const at = evidenceRendered.indexOf(marker);
    const supplement = depth.changed ? depth.html.slice(at, at + depth.html.length - evidenceRendered.length) : "";
    const withDepth = rendered.replace(marker, () => `${supplement}${marker}`);
    return { route: model.route, html: ensureReviewDepth(withDepth, model.route).html };
  }), state_counts: { research_records_total: 32, ready_editorial_direct: 6, adjacent_sister_pool: 25, drop_genuine_legal_route_block: 1, held: 0, published: models.length, suppressed_network_paused: suppressed.length }, effects: structuredClone(inputs.contract.effects) };
}
