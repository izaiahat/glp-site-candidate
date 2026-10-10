import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { analyticsPolicy, buildAnalyticsEvent, emitAnalytics } from "../src/analytics.mjs";
import { constructNetworkUrl } from "../src/network-constructors.mjs";
import { handleGoRequest, mintClickToken, opaqueClickPolicy, parseGoQuery } from "../src/worker.mjs";
import { buildSchemaGraph } from "../src/schema.mjs";
import { providerLinkDark } from "../src/provider-review.mjs";
import { moneyPageContract, renderBestForBox, renderMoneyPage, renderProviderCards, scoreProvider } from "../src/money-page.mjs";
import { evaluateQuiz, renderQuiz, validateQuizPolicy } from "../src/quiz.mjs";
import { projectQuizFromRegistry } from "../src/program-registry.mjs";
import { applyMeritScores, meritScore } from "../src/merit-ranking.mjs";
import { blogPolicy, renderBlogPost, resolveBlogComparisonSpec, reviewBrief, validateKeywordOwnership } from "../src/blog-system.mjs";
import { directoryPolicy, evaluateDirectoryGate, renderDirectoryPage } from "../src/directory.mjs";
import { handleLeadRequest, leadCapturePolicy, validateLead } from "../src/lead-capture.mjs";
import { contentUpgradeCapturePolicy, handleContentUpgradeRequest, validateContentUpgrade } from "../src/content-upgrade.mjs";
import { curatePrograms, normalizeCommissionTransaction, reconcileCommissions } from "../src/economics.mjs";
import { buildMessage, calculatePerEmailEpc, composeWeeklyNewsletter, emailRuntimeGate, ingestResendWebhook, resendMachinePolicy, runDripScheduler, selectWeeklyFeature, sendWithResend, verifyResendWebhook } from "../src/resend-email-machine.mjs";
import { consentRuntimeSource } from "../src/consent-runtime.mjs";
import { leanLegalPages } from "../src/legal-pages.mjs";
import { onRequestPost as correctionPost } from "../functions/api/directory-corrections.js";
import { onRequestGet as unsubscribeGet, onRequestPost as unsubscribePost } from "../functions/unsubscribe.js";

const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url)));
const forbiddenPublicOperationsJson = ["build-report.json", "batch-gate.json", "blog-system.json", "email-system.json", "resend-email-machine.json", "worker-manifest.staging.json"];
const INTERNAL = "https://glpclinicscout.com/providers/oral-glp-1/";
const identity = { author: { id: "clinic-scout-editorial-team", display_name: "Clinic Scout Editorial Team", status: "verified_organization", entity_type: "Organization", bio_path: "/authors/clinic-scout-editorial-team/", identity_record_sha256: "a".repeat(64), clinical_credentials_claimed: false }, medical_reviewer: { status: "not_required_by_risk_tier", person_id: null } };
const source = { source_id: "fda", publisher: "FDA", url: "https://www.fda.gov/example", verified_as_of: "2026-07-23", claim_ids: ["claim-1"] };
const scores = { price_transparency: 100, medical_oversight: 80, insurance_support: 60, public_reviews: 40, shipping_transparency: 20 };
const unavailableSocialProof = { status: "NOT_VERIFIED_COMPARABLE", label: "Independent public reviews", explanation: "No comparable independent public-review dataset was verified for this comparison.", methodology_path: "/how-we-rate/", verified_as_of: "2026-07-23" };
const moneyBase = {
  template_revision: "money-page-p1-v1", page_id: "best-online-glp1", page_slug: "best-online-glp1", path: "/best/online-glp-1-providers/", title: "Best online GLP-1 providers", h1: "Best online GLP-1 providers", description: "Evidence-first staging comparison.", date_published: "2026-07-22", date_modified: "2026-07-23", source_checked_through: "2026-07-23", intro: ["Intro one.", "Intro two."],
  best_for: [
    { intent_label: "transparent pricing", program_id: "alpha", provider: "Alpha", one_line: "Alpha exposes the strongest complete score in this synthetic fixture." },
    { intent_label: "source verification", program_id: "beta", provider: "Beta", one_line: "Beta keeps every incomplete evidence field visible." },
    { intent_label: "comparison discipline", program_id: "gamma", provider: "Gamma", one_line: "Gamma demonstrates a held route without inventing evidence." },
  ],
  verdict: { label: "Our Pick", provider: "Pending source review", one_line: "No winner while evidence is incomplete.", program_id: null }, live_link_allowed: false, operator_gate_receipt: null, sources: [{ ...source, source_id: "source-1" }],
  outcome_ctas: [{ position: "intro", label: "Compare terms" }, { position: "pros", label: "Review limits" }, { position: "pricing", label: "Check pricing" }, { position: "conclusion", label: "Next steps" }], sticky_cta_label: "Held top pick", decision_matrix: [{ want: "transparent pricing", program_id: "alpha", provider: "Alpha", reason: "Alpha exposes the strongest complete score in this fixture." }, { want: "source verification", program_id: "beta", provider: "Beta", reason: "Beta keeps incomplete evidence visible." }, { want: "comparison discipline", program_id: "gamma", provider: "Gamma", reason: "Gamma demonstrates a held route." }], content_upgrade: { status: "STAGED_CAPTURE_SENDS_HELD" }, pros: ["Transparent hold state"], cons: ["Commercial evidence incomplete", "No score is estimated"],
  faq: [{ q: "Is this medical advice?", a: "No." }, { q: "Are links live?", a: "No." }, { q: "Is commission used?", a: "No." }, { q: "Are scores estimated?", a: "No." }, { q: "Are compounded drugs FDA-approved?", a: "No." }],
  rows: ["Alpha", "Beta", "Gamma", "Delta"].map((provider, index) => ({ program_id: provider.toLowerCase(), provider, merchant: provider, starting_price: index ? "Pending" : "$199", starting_price_sort: index ? null : 199, meds_offered: "Pending", insurance: "Pending", average_wait: "Pending", criteria_scores: index ? null : scores, best_for: index ? "honest missing-evidence handling" : "transparent pricing", pros: ["Keeps the route link-dark", "Shows dated evidence state"], cons: ["Commercial evidence remains incomplete", "No medical suitability inference is allowed"], bottom_line: `${provider} remains a held commercial comparison option, not a treatment recommendation.`, social_proof: { ...unavailableSocialProof }, source_url: source.url, citation_source_id: "source-1", review_path: `/reviews/${provider.toLowerCase()}/`, logo: { path: `/assets/provider-logos/${provider.toLowerCase()}.svg`, alt: `${provider} logo`, width: 200, height: 60, media_type: "image/svg+xml", surface: "light", source_page_url: source.url, source_asset_url: source.url, verified_as_of: "2026-07-23", sha256: "a".repeat(64), runtime_remote_load: false }, promo: { status: "NOT_VERIFIED", label: "No verified promo code", code: null, source_url: null, verified_as_of: "2026-07-23" }, live_link_allowed: false })),
};
const heldProgram = { program_id: "alpha", display_name: "Alpha", network: "awin", status: "staged_operator_gate", live_link_allowed: false, promotion_authorized: false, operator_selection_receipt_sha256: null, official_fallback: "https://alpha.example/", allowed_fallback_hosts: ["alpha.example"], allowed_page_roles: ["best-online-glp1"], allowed_positions: ["hero", "table"], allowed_variants: ["a", "b"], constructor_verified: false, advertiser_permission_verified: false, encoding_verified: false, privacy_qa_passed: false, redirector_tos_verified: false, redirector_tos_source_url: null, redirector_tos_verified_as_of: null, tracking: null };
const liveProgram = { ...heldProgram, status: "live_operator_approved", link_mode: "server_redirect", go_route_wired: true, live_link_allowed: true, promotion_authorized: true, operator_selection_receipt_sha256: "b".repeat(64), constructor_verified: true, advertiser_permission_verified: true, encoding_verified: true, privacy_qa_passed: true, redirector_tos_verified: true, redirector_tos_source_url: "https://network.example/terms", redirector_tos_verified_as_of: "2026-07-23", tracking: { base_url: "https://www.awin1.com/awclick.php?mid=123&id=456", destination_url: "https://alpha.example/offer", deep_link_permitted: true, allowed_destination_hosts: ["alpha.example"] } };
const manifest = (program) => ({ programs: [program], internal_fallback: INTERNAL });
function mockD1({ failInsert = false, changes = 1 } = {}) {
  const calls = [];
  const database = { calls, batchCalls: 0, prepare(sql) { return { bind(...args) { return { async run() { calls.push({ sql, args }); if (failInsert && /^INSERT/.test(sql)) throw new Error("d1_fail"); return { success: true, meta: { changes } }; }, async all() { calls.push({ sql, args }); return { results: [] }; }, async first() { calls.push({ sql, args }); return /SELECT email,first_name,vertical,funnel_stage FROM subscribers/.test(sql) ? { email: "synthetic@example.test", first_name: "Synthetic", vertical: "glp-clinic-scout", funnel_stage: "newsletter" } : null; } }; } }; }, async batch(statements) { database.batchCalls += 1; const results = []; for (const statement of statements) results.push(await statement.run()); return results; } };
  return database;
}

async function signedResendRequest(event, secret, { signature = null } = {}) {
  const raw = typeof event === "string" ? event : JSON.stringify(event);
  const id = `msg_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const keyBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  return new Request("https://glpclinicscout.com/api/resend-webhook", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature || `v1,${Buffer.from(digest).toString("base64")}`,
    },
  });
}

test("analytics excludes sensitive dimensions and rejects unknown fields", () => {
  const serialized = JSON.stringify(analyticsPolicy.events);
  for (const token of ["email", "bmi_range", "weight", "current_meds", "referrer", "lead_id"]) assert.equal(serialized.includes(token), false);
  assert.throws(() => buildAnalyticsEvent("scroll_75", { page_slug: "x", email: "x@y.test" }), /not_allowlisted/);
  assert.throws(() => buildAnalyticsEvent("affiliate_click", { program: "x" }), /param_missing/);
});
test("analytics remains disabled before explicit consent", () => assert.equal(emitAnalytics({}, { enabled: true, consent: "denied" }, "scroll_75", { page_slug: "x" }).emitted, false));
test("opaque click tokens are fixed-shape and non-semantic", () => {
  assert.equal(mintClickToken(new Uint8Array(12)).length, 27); assert.match(mintClickToken(new Uint8Array(12)), /^c1-[a-f0-9]{24}$/); assert.equal(opaqueClickPolicy.version, "click-identity-v2"); assert.equal(opaqueClickPolicy.rawIpStored, false);
});
test("query parser accepts allowlisted attribution and an optional UUIDv7 click identity", () => assert.deepEqual(parseGoQuery(new URL("https://x.test/go/alpha?s=best-online-glp1.hero&v=a")), { surface: "best-online-glp1.hero", pageSlug: "best-online-glp1", linkPosition: "hero", variant: "a", csClickId: null }));
test("query parser rejects extras, duplicates, semantics, and malformed values", () => {
  for (const url of ["https://x.test/go/alpha?s=best-online-glp1.hero&v=a&email=x", "https://x.test/go/alpha?s=best-online-glp1.hero&s=x.y&v=a", "https://x.test/go/alpha?s=bad&v=a", "https://x.test/go/alpha?s=Best.hero&v=a"]) assert.throws(() => parseGoQuery(new URL(url)));
});
test("held program routes to allowlisted official fallback without minting", async () => {
  const response = await handleGoRequest(new Request("https://x.test/go/alpha?s=best-online-glp1.hero&v=a", { headers: { "user-agent": "Mozilla/5.0" } }), { PROGRAM_MANIFEST: manifest(heldProgram) }, "alpha");
  assert.equal(response.status, 307); assert.equal(response.headers.get("location"), "https://alpha.example/"); assert.equal(response.headers.get("x-redirect-reason"), "operator-or-tos-gate-held"); assert.equal(response.headers.get("x-attribution-log"), "not-minted");
});
test("unsafe fallback and unknown program use internal fallback", async () => {
  const unsafe = { ...heldProgram, official_fallback: "https://evil.example/" };
  const first = await handleGoRequest(new Request("https://x.test/go/alpha?s=best-online-glp1.hero&v=a", { headers: { "user-agent": "Mozilla" } }), { PROGRAM_MANIFEST: manifest(unsafe) }, "alpha");
  const second = await handleGoRequest(new Request("https://x.test/go/nope?s=best-online-glp1.hero&v=a"), { PROGRAM_MANIFEST: manifest(heldProgram) }, "nope");
  assert.equal(first.headers.get("location"), INTERNAL); assert.equal(second.headers.get("location"), INTERNAL);
});
test("assignment allowlist fails closed", async () => {
  const response = await handleGoRequest(new Request("https://x.test/go/alpha?s=wrong.hero&v=a"), { PROGRAM_MANIFEST: manifest(heldProgram) }, "alpha"); assert.equal(response.headers.get("x-redirect-reason"), "assignment-not-allowlisted");
});
test("live route requires every receipt, ToS, rate-limit, constructor, and D1 gate", async () => {
  const db = mockD1();
  const env = { PROGRAM_MANIFEST: manifest(liveProgram), ATTRIBUTION_MONTH: "202607", AFFILIATE_RUNTIME_MODE: "production", AFFILIATE_LIVE_GATE: `operator-approved:${"b".repeat(64)}`, GLP_DB: db, CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const request = new Request("https://x.test/go/alpha?s=best-online-glp1.hero&v=b", { headers: { "user-agent": "Mozilla/5.0", referer: "https://glpclinicscout.com/best/online-glp-1-providers/", "cf-connecting-ip": "192.0.2.1" } });
  const response = await handleGoRequest(request, env, "alpha");
  assert.equal(response.headers.get("x-redirect-reason"), "affiliate-live"); assert.match(response.headers.get("location"), /clickref=c1-[a-f0-9]{24}/); assert.equal(response.headers.get("x-ga4-server-event"), "configuration-held"); assert.equal(db.calls.length, 2); assert.match(db.calls[0].sql, /affiliate_click_map/); assert.doesNotMatch(JSON.stringify(db.calls), /192\.0\.2\.1|Mozilla/);
});
test("D1 outage blocks outbound affiliate redirect", async () => {
  const env = { PROGRAM_MANIFEST: manifest(liveProgram), AFFILIATE_RUNTIME_MODE: "production", AFFILIATE_LIVE_GATE: `operator-approved:${"b".repeat(64)}`, GLP_DB: mockD1({ failInsert: true }), CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const response = await handleGoRequest(new Request("https://x.test/go/alpha?s=best-online-glp1.hero&v=a", { headers: { "user-agent": "Mozilla" } }), env, "alpha"); assert.equal(response.headers.get("location"), INTERNAL); assert.equal(response.headers.get("x-redirect-reason"), "click-map-failed-closed");
});
test("bot traffic is blocked before live mapping", async () => {
  const response = await handleGoRequest(new Request("https://x.test/go/alpha?s=best-online-glp1.hero&v=a", { headers: { "user-agent": "curl/8" } }), { PROGRAM_MANIFEST: manifest(liveProgram), AFFILIATE_RUNTIME_MODE: "production", AFFILIATE_LIVE_GATE: `operator-approved:${"b".repeat(64)}`, GLP_DB: mockD1(), CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) } }, "alpha"); assert.match(response.headers.get("x-redirect-reason"), /^ivt-/);
});
test("network constructors accept only opaque-safe verified inputs", () => {
  assert.match(constructNetworkUrl(liveProgram, "c1-0123456789abcdef01234567").toString(), /awinaffid=456/); assert.throws(() => constructNetworkUrl({ ...liveProgram, network: "impact" }, "c1-0123456789abcdef01234567"), /network_unsupported/); assert.throws(() => constructNetworkUrl(liveProgram, "email-user-campaign"), /subid_invalid/);
});

test("numeric rubric normalizes unsupported public-review evidence and rejects incomplete inputs", () => {
  const unsupported = scoreProvider({ criteria_scores: scores, social_proof: { status: "NOT_VERIFIED_COMPARABLE" } });
  const verified = scoreProvider({ criteria_scores: scores, social_proof: { status: "VERIFIED" } });
  const expectedUnsupported = Math.round((scores.price_transparency * 30 + scores.medical_oversight * 25 + scores.insurance_support * 15 + scores.shipping_transparency * 15) / 85);
  const expectedVerified = Math.round((scores.price_transparency * 30 + scores.medical_oversight * 25 + scores.insurance_support * 15 + scores.public_reviews * 15 + scores.shipping_transparency * 15) / 100);
  assert.equal(unsupported, expectedUnsupported); assert.equal(verified, expectedVerified); assert.ok(unsupported > verified); assert.equal(scoreProvider({ criteria_scores: null }), null);
});
test("money-page P1 contract binds the eight backlog components and no clinician", () => {
  assert.deepEqual(moneyPageContract.sortable, ["score", "price"]); assert.equal(moneyPageContract.scoreRounding, "half_up_to_nearest_whole_number_for_nonnegative_scores"); assert.equal(moneyPageContract.decisionMatrix, true); assert.equal(moneyPageContract.dualCtaRows, true); assert.equal(moneyPageContract.clinicianRequired, false);
  for (const key of ["bestForIntentBox", "providerCards", "providerCardTripleCta", "quantifiedTrustBlock", "stickyJumpNav", "sourceLabeledSocialProof", "itemListSchema", "providerReviewPages", "inlineNumberedCitations"]) assert.equal(moneyPageContract[key], true, key);
  assert.equal(moneyPageContract.officialSiteCtaQualifier, false); assert.deepEqual(moneyPageContract.ctaCopySystem, { winner: "start_with_brand", other: "visit_brand", priceVolatile: "check_current_price_at_brand", lead: "find_my_match" });
  assert.equal(moneyPageContract.exitIntentCapture, false); assert.equal(moneyPageContract.exitIntentTrigger, "enabled"); assert.equal(moneyPageContract.exitIntentScrollInterception, false);
  assert.equal(moneyPageContract.templateRevision, "money-page-p1-v2-wave0"); assert.deepEqual(moneyPageContract.comparisonColumns, [7, 8]); assert.equal(moneyPageContract.scoreDisplay, "/10_plus_five_star_glyph"); assert.equal(moneyPageContract.clinicianReviewerRendered, false); assert.equal(moneyPageContract.aggregateRatingSchema, false);
});
test("money page renders all P1 upgrades with internal review fallbacks and no fake review schema or clinician authority", () => {
  const html = renderMoneyPage(moneyBase, identity);
  for (const needle of ["\\d\\.\\d<span>/10", "★★★★★", "data-sort=\"score\"", "Choose Alpha", "we may earn a commission at no extra cost to you", "Get matched free", "affiliate-fallback", "data-affiliate-state=\"unavailable\"", "sticky", "noindex,nofollow", "Best for what matters to you", "Provider-by-provider breakdown", "How we evaluated", "Jump to", "triple-cta", "provider-logo", "inline-citation", "Read Alpha review", "ItemList", "<caption>"]) assert.match(html, new RegExp(needle));
  assert.equal((html.match(/id="provider-[^"]+" class="provider-card/g) || []).length, 4); assert.equal((html.match(/class="triple-cta"/g) || []).length, 4); // 2026-08-19 (B-12, SPEC-CRO §4.2): the order is now verdict-then-methodology.
  // "The counts are visible. Unsupported fields are omitted." as the first H2 a
  // price shopper meets is the named ATF defect; the ranked #1 card with its dated
  // price takes the first viewport and the methodology block follows it. The
  // assertion still pins a strict order, just the specified one.
  assert.ok(html.indexOf('id="quick-answer"') < html.indexOf('id="methodology"'));
  // This fixture has a synthetic $199 but no price-specific check date. A
  // dated source in the page ledger is not proof that the price was checked.
  assert.match(html, /class="verdict-price"[\s\S]*?Starting at \$199/);
  assert.doesNotMatch(html, /price-checked-chip/);
  assert.doesNotMatch(html, /href="\/go\/|data-held-route|data-proof-status="not-verified-comparable"|data-promo-status="not-verified"|0\/100|No verified promo code|Stronger published .* evidence in this comparison/); assert.doesNotMatch(html, /AggregateRating|Medically reviewed by|medical reviewer/i);
  // CRO overhaul adds an inline lead-magnet + explicit-button exit-capture form; both must keep sends staged and never collect health data.
  assert.match(html, /data-content-upgrade-form/); assert.match(html, /consent_version" value="glp-content-upgrade-v1-20260724"/); assert.doesNotMatch(html, /name="(?:bmi|weight|current_med\w*|diagnosis|medical_history|quiz_answers)"/i);
  assert.match(renderBestForBox(moneyBase), /best-for-grid/); assert.match(renderProviderCards(moneyBase), /How Alpha scored/);
});
test("a source-dated synthetic price retains its checked-date verdict provenance", () => {
  const dated = structuredClone(moneyBase);
  // Explicit test evidence for the synthetic price, not a date borrowed from
  // the unrelated FDA source or a claim about any live provider.
  dated.rows[0].price_checked_on = "2026-07-23";
  dated.rows[0].source_url = "https://alpha.example/pricing";
  dated.rows[0].citation_source_id = "source-2";
  dated.sources.push({ source_id: "source-2", publisher: "Alpha synthetic pricing fixture", url: dated.rows[0].source_url, verified_as_of: "2026-07-23", claim_ids: ["fixture-price-alpha"] });
  const html = renderMoneyPage(dated, identity);
  const verdict = html.match(/<section id="quick-answer"[\s\S]*?<\/section>/)?.[0];
  assert.ok(verdict, 'verdict renders for a source-dated synthetic price');
  assert.match(verdict, /class="verdict-price"[\s\S]*?Starting at \$199/);
  assert.match(verdict, /price-checked-chip[^>]*>[\s\S]*?2026-07-23/);
});
test("source-labeled social proof renders only from complete verified evidence and rejects partial ratings", () => {
  const verified = structuredClone(moneyBase); verified.verdict = { label: "Our Pick", provider: "Alpha", one_line: "Verified fixture.", program_id: "alpha" }; verified.rows[0].social_proof = { status: "VERIFIED", label: "Trustpilot", rating: 4.7, review_count: 1234, source_name: "Trustpilot", source_url: "https://www.trustpilot.com/review/example.test", verified_as_of: "2026-07-23" };
  const html = renderMoneyPage(verified, identity); assert.match(html, /4\.7\/5 · 1,234 reviews/); assert.match(html, /Trustpilot/); assert.doesNotMatch(html, /AggregateRating/);
  const incomplete = structuredClone(verified); delete incomplete.rows[0].social_proof.source_url; assert.throws(() => renderMoneyPage(incomplete, identity), /verified_social_proof_incomplete/);
});
test("schema uses verified Organization and no fabricated reviewer", () => {
  const graph = buildSchemaGraph({ url: "https://staging.glpclinicscout.com/x", title: "X", description: "X", datePublished: "2026-07-22", dateModified: "2026-07-23", author: identity.author, evidenceReview: { status: "HELD", source_urls: [] }, reviewer: identity.medical_reviewer, faqs: moneyBase.faq });
  assert.equal(graph.gates.author, "PASS"); assert.equal(graph.jsonLd["@graph"].find((item) => item["@id"].endsWith("#organization"))["@type"], "Organization"); assert.equal(JSON.stringify(graph.jsonLd).includes("Review"), false);
});
test("curation requires economics, minimum sample, deposit, compliance, and live gate", () => {
  const base = { program_id: "a", display_name: "A", commission_economics: 100, verified_epc: 2, epc_sample_clicks: 30, recurring_flag: true, compliance_tier: "GREEN", actual_deposit_reconciled: true, live_link_allowed: true };
  const out = curatePrograms([{ ...base, program_id: "b", display_name: "B", epc_sample_clicks: 29 }, base], 1); assert.equal(out.featured[0].program.program_id, "a"); assert.equal(out.see_all.find((x) => x.program.program_id === "b").sample_gate, "HELD_MINIMUM_SAMPLE");
});
test("economics includes reversals and actual-deposit reconciliation", () => {
  const approved = normalizeCommissionTransaction("awin", { status: "approved", commission_amount: 100, click_token: "c1-0123456789abcdef01234567", transaction_id: "t1", program_id: "a", effective_at: "2026-07-23" });
  const reversed = normalizeCommissionTransaction("awin", { ...approved, status: "reversed", commission_amount: 40, transaction_id: "t2" }); assert.equal(reversed.net_commission, -40);
  const out = reconcileCommissions({ clicks: Array.from({ length: 30 }, () => ({ ivt_status: "valid" })), transactions: [approved, reversed], deposits: [{ amount: 60 }] }); assert.equal(out.epc, 2); assert.equal(out.sample_gate, "PASS"); assert.equal(out.deposit_gate, "PASS"); assert.equal(out.reversals_included, true);
});

// 2026-08-18: the policy this fixture pins changed deliberately - the quiz now
// ranks by a goal-weighted score with a published-price tie-break, and refuses
// to let a reader pick an answer that would return nothing. Both are argued in
// data/quiz-scoring-rationale.json and enforced by validateQuizPolicy(), so this
// fixture tracks the contract rather than an older shape of it.
const quizPolicy = { schema: "commercial-priority-matching-v1", composition_order: ["source_and_staging_clearance", "all_answered_commercial_rules_intersection", "therapeutic_preference_evidence_intersection", "goal_weighted_rank_score_desc", "published_all_in_cost_asc", "program_id_asc", "take_result_count"], rule_operator: "AND", routing_answers: ["goal", "insurance", "state", "medication_preference"], prevented_answers: ["goal", "insurance", "state", "medication_preference"], ignored_answers: ["bmi_range", "current_meds", "timeline"], medical_answers_used_for_routing: false, tie_breaker: "published_all_in_cost_asc_then_program_id_asc", result_count: 'all_eligible', empty_result_behavior: "prevent_unanswerable_options_then_guided_closest_matches" };
const quizEmptyCopy = { unavailable_option_copy: { none_at_all: "No provider in our comparison publishes this, so we cannot match you to one.", blocked_by: "No provider in our comparison offers this together with your earlier answer \u201c{answer}\u201d.", blocked_by_combination: "No provider in our comparison offers this together with your earlier answers.", state_suffix: " \u2014 no match with your answers" }, guided_fallback: { lede: "No verified provider fits every answer you gave. Rather than show you nothing, here are the closest matches.", mismatch_prefix: "Does not match your answer" } };
const quizConfig = { ...quizEmptyCopy, title: "Quiz", h1: "Private comparison", description: "Local-only answers.", path: "/quiz/provider-fit/", matching_policy: quizPolicy, email_capture: { form_action: "/api/leads", consent_version: "glp-lead-v2-20260723" }, candidates: [], empty_state: "No source-cleared match.", questions: ["bmi_range", "goal", "medication_preference", "current_meds", "insurance", "state", "timeline"].map((id) => ({ id, label: id, options: [{ value: id === "medication_preference" ? "not_sure" : "a", label: "Option A" }, { value: "prefer-not-to-say", label: "Prefer not to say" }] })) };
test("quiz renders the current local-only Pass 2 flow without a consent gate", async () => {
  const html = renderQuiz(await readJson("../data/quiz-config.json"));
  assert.equal((html.match(/<section class="question" data-pass2-question=/g) || []).length, 10);
  const firstQuestion = html.match(/data-pass2-question="intent"[\s\S]*?<\/section>/)?.[0] || "";
  assert.equal((firstQuestion.match(/data-single="intent"/g) || []).length, 8);
  // Privacy copy moved from the removed intro paragraphs to the qz-footnote after results.
  assert.match(html, /<p class="qz-footnote"><strong>In-progress answers stay on this device\.<\/strong>/);
  assert.match(html, /Never sent to analytics/);
  assert.match(html, /Subscribing sends only Position 7.s disclosed fields to Clinic Scout, not providers/);
  assert.doesNotMatch(html, /id="health-consent"|type="checkbox"|action="\/api\/leads"|const consent=|if\(!consent\.checked\)return/i);
  assert.match(html, /data-pass2-input="name"/);
  assert.match(html, /data-pass2-input="email"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/glpclinicscout\.com\/quiz\/provider-fit\/">/);
  assert.match(html, /href="\/privacy\/"/);
  assert.match(html, /href="\/how-we-make-money\/"/);
});
test("quiz matches only source-cleared staged candidates", () => {
  const out = evaluateQuiz({ ...quizEmptyCopy, matching_policy: quizPolicy, candidates: [{ program_id: "a", display_name: "A", source_clearance: true, staging_eligible: true, rules: { state: ["OR"], goal: ["cost"] } }, { program_id: "b", display_name: "B", source_clearance: false, staging_eligible: true, rules: { state: ["OR"] } }] }, { state: "OR", priority: "price", goal: "cost" }); assert.deepEqual(out.map((item) => item.program_id), ["a"]);
});
test("quiz policy pins AND composition, top-three order, ignored medical answers, and golden vectors", async () => {
  // 2026-08-06 surface unification: golden vectors run against the PROJECTED
  // config - registry surfaces applied and priority_score set to the merit score
  // derived at build. Running them against the raw file scored every newly wired
  // provider at zero and would have passed while the live quiz ranked differently.
  const raw = await readJson("../data/quiz-config.json"); assert.equal(raw.matching_policy.result_count,'all_eligible');assert.equal(validateQuizPolicy(raw).result_count,raw.candidates.length);
  const registry = await readJson("../data/program-registry.json");
  const ledger = await readJson("../data/program-content-ledger.json");
  const { comparablePriceProviderIds } = await import("../src/provider-dynamic-profiles.mjs");
  const asOf = new Date(`${[registry.provider_dynamic_profiles.sealed_as_of, registry.therapeutic_taxonomy.sealed_as_of].sort().at(-1)}T12:00:00Z`);
  const comparablePriceIds = comparablePriceProviderIds(registry, "glp-clinic-scout", {
    asOf,
  });
  applyMeritScores(ledger.programs, { comparablePriceIds });
  for (const program of ledger.programs) program.score = meritScore(program);
  // 2026-08-18: the projection is no longer the last step before ranking. The
  // build also joins the governed pricing matrix (which re-derives the price
  // lane) and the evidence-derived criteria scores. Running the vectors without
  // that join would score every provider zero on cost and pass against an
  // ordering the live quiz does not use - the same trap the 2026-08-06 note
  // above describes, one layer further down.
  const matrix = await readJson("../data/provider-pricing-matrix.json");
  const { applyPricingToCandidates: joinPricing, ALL_IN_MONTHS: months } = await import("../src/quiz-ranking.mjs");
  // The therapeutic projection is what attaches the medication tags a
  // medication-preference vector filters on; without it every such vector
  // returns [] and the assertion passes for the wrong reason.
  const { projectTherapeuticSurfaces } = await import("../src/therapeutic-taxonomy.mjs");
  const { projectMoneyPagesFromRegistry } = await import("../src/program-registry.mjs");
  const moneySpecs = await readJson("../data/money-page-specs.json");
  const projected = projectTherapeuticSurfaces({
    registry,
    profileId: "glp-clinic-scout",
    pages: projectMoneyPagesFromRegistry(registry, "glp-clinic-scout", moneySpecs.pages, ledger.programs),
    quizConfig: projectQuizFromRegistry(registry, "glp-clinic-scout", raw, ledger),
    asOf,
  }).quizConfig;
  const byId = new Map(ledger.programs.map((program) => [program.program_id, program]));
  const joined = joinPricing(projected.candidates.map((candidate) => ({
    ...candidate,
    criteria_scores: byId.get(candidate.program_id)?.criteria_scores || {},
  })), matrix);
  const data = { ...projected, candidates: joined.candidates, ranking: { cohort_min_6mo_usd: joined.cohort_min_6mo_usd, all_in_months: months } };
  for (const vector of raw.golden_vectors) assert.deepEqual(evaluateQuiz(data, vector.answers, registry, "glp-clinic-scout").map((item) => item.program_id), vector.expected_program_ids, vector.vector_id);
  const baseline = evaluateQuiz(data, { goal: "price", insurance: "self-pay", bmi_range: "under-27", current_meds: "no", state: "CA", timeline: "this-week" }).map((item) => item.program_id);
  const changedMedical = evaluateQuiz(data, { goal: "price", insurance: "self-pay", bmi_range: "30-plus", current_meds: "yes", state: "CA", timeline: "researching" }).map((item) => item.program_id);
  assert.deepEqual(changedMedical, baseline);
});
const leadPayload = { first_name: "Test", email: "synthetic@example.test", phone: "+15415550100", state: "OR", priority: "price", source_page: "/quiz/provider-fit/", provider_interest: "alpha", privacy_consent: true, marketing_consent: true, contact_consent: true, consent_version: "glp-lead-v2-20260723" };
test("lead validator normalizes E.164 and rejects health data, bad consent, and extra keys", () => {
  assert.equal(validateLead(leadPayload).phone, "+15415550100"); assert.throws(() => validateLead({ ...leadPayload, bmi: "30" }), /payload_key_not_allowed/); assert.throws(() => validateLead({ ...leadPayload, contact_consent: false }), /required_consent_missing/); assert.throws(() => validateLead({ ...leadPayload, phone: "555" }), /phone_invalid/); assert.equal(leadCapturePolicy.emailSends, false); assert.equal(leadCapturePolicy.providerSharing, false);
});
test("lead endpoint is held without explicit local-test mode", async () => {
  const response = await handleLeadRequest(new Request("https://x.test/api/leads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "synthetic-key-0001" }, body: JSON.stringify(leadPayload) }), {}); assert.equal(response.status, 503); assert.equal((await response.json()).status, "LEAD_CAPTURE_HELD");
});
test("lead capture writes lead plus opted-in subscriber but never send/share authorization", async () => {
  const db = mockD1(); const response = await handleLeadRequest(new Request("https://x.test/api/leads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "synthetic-key-0002" }, body: JSON.stringify(leadPayload) }), { LEAD_CAPTURE_MODE: "local_test", GLP_DB: db });
  assert.equal(response.status, 202); assert.equal(db.batchCalls, 1); assert.equal(db.calls.length, 5); assert.match(db.calls[0].sql, /INTO leads.*held_national_capture/); assert.match(db.calls[1].sql, /INTO lead_capture_metadata_v2.*email_send_authorized.*provider_share_authorized.*held_no_route_no_send/); assert.match(db.calls[2].sql, /INTO consent_ledger.*held_national_provider_request/); assert.match(db.calls[3].sql, /INTO subscribers[\s\S]*'active'/); assert.match(db.calls[4].sql, /INTO contact_capture_events/); assert.ok(db.calls[4].args.includes("quiz-provider-fit")); assert.doesNotMatch(JSON.stringify(db.calls), /\b(?:bmi|weight|current_medications|diagnosis|medical_history|quiz_answers)\b/); assert.equal(leadCapturePolicy.storageBinding, "GLP_DB"); assert.equal(leadCapturePolicy.atomicBatchRequired, true);
});
test("lead capture records provider-contact verification without creating a marketing subscriber", async () => {
  const db = mockD1();
  const response = await handleLeadRequest(new Request("https://x.test/api/leads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "synthetic-key-0004" }, body: JSON.stringify({ ...leadPayload, marketing_consent: false }) }), { LEAD_CAPTURE_MODE: "local_test", GLP_DB: db });
  assert.equal(response.status, 202); assert.equal(db.calls.length, 4); assert.equal(db.calls.some((call) => /INTO subscribers/.test(call.sql)), false); assert.match(db.calls[3].sql, /INTO contact_capture_events/); assert.ok(db.calls[3].args.includes("verification-only")); assert.ok(db.calls[3].args.includes("quiz-provider-fit")); assert.equal((await response.json()).subscriber_created, false);
});
test("lead storage failure is fail-closed", async () => {
  const response = await handleLeadRequest(new Request("https://x.test/api/leads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "synthetic-key-0003" }, body: JSON.stringify(leadPayload) }), { LEAD_CAPTURE_MODE: "local_test", GLP_DB: mockD1({ failInsert: true }) }); assert.equal(response.status, 503); assert.equal((await response.json()).status, "STORAGE_FAILED");
});

const contentUpgradePayload = { email: "reader@example.test", source_page: "best-online-glp1", lead_magnet_key: "best-online-glp1-terms-checklist", privacy_consent: true, marketing_consent: true, consent_version: "glp-content-upgrade-v1-20260724", company: "" };
test("content-upgrade validator requires exact consent and rejects health fields or bots", () => {
  assert.equal(validateContentUpgrade(contentUpgradePayload).email, "reader@example.test");
  assert.throws(() => validateContentUpgrade({ ...contentUpgradePayload, bmi: "30" }), /payload_key_not_allowed/);
  assert.throws(() => validateContentUpgrade({ ...contentUpgradePayload, marketing_consent: false }), /required_consent_missing/);
  assert.throws(() => validateContentUpgrade({ ...contentUpgradePayload, company: "bot" }), /bot_rejected/);
  assert.equal(contentUpgradeCapturePolicy.emailSends, "resend_env_gated"); assert.equal(contentUpgradeCapturePolicy.emailSendsAuthorizedByDefault, false); assert.equal(contentUpgradeCapturePolicy.emailConsentRequired, true); assert.equal(contentUpgradeCapturePolicy.emailSendGate, "RESEND_ENABLED"); assert.equal(contentUpgradeCapturePolicy.providerSharing, false);
});
test("content-upgrade endpoint is held without explicit operator or local-test mode", async () => {
  const response = await handleContentUpgradeRequest(new Request("https://x.test/api/content-upgrade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(contentUpgradePayload) }), {});
  assert.equal(response.status, 503); assert.equal((await response.json()).status, "CONTENT_UPGRADE_CAPTURE_HELD");
});
test("content-upgrade local-test writes only an opted-in subscriber and leaves sends held", async () => {
  const db = mockD1();
  const response = await handleContentUpgradeRequest(new Request("https://x.test/api/content-upgrade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(contentUpgradePayload) }), { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: db });
  assert.equal(response.status, 202); assert.equal(db.calls.length, 2); assert.match(db.calls[0].sql, /INTO subscribers/); assert.ok(db.calls[0].args.includes("content-upgrade")); assert.match(db.calls[1].sql, /contact_capture_events/); assert.equal((await response.json()).status, "CAPTURED_SENDS_HELD"); assert.doesNotMatch(JSON.stringify(db.calls), /\b(?:phone|state|bmi|weight|current_medications|diagnosis|medical_history|quiz_answers)\b/);
});
test("content-upgrade storage failure is fail-closed", async () => {
  const response = await handleContentUpgradeRequest(new Request("https://x.test/api/content-upgrade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(contentUpgradePayload) }), { CONTENT_UPGRADE_CAPTURE_MODE: "local_test", GLP_DB: mockD1({ failInsert: true }) });
  assert.equal(response.status, 503); assert.equal((await response.json()).status, "STORAGE_FAILED");
});

const passBrief = { risk_tier: "LOW", word_count: 1600, sources: [source, { ...source, source_id: "ftc", publisher: "FTC", url: "https://www.ftc.gov/example", claim_ids: ["claim-2"] }], evidence_review: { status: "PASS", reviewed_at: "2026-07-23T00:00:00Z", content_sha256: "c".repeat(64) }, has_affiliate_cta: true, inline_ftc_disclosure: true };
test("provider review root is link-dark unless both promotion and live-link authority are true", () => {
  const approved = { program_id: "mademed", live_link_allowed: true, promotion_authorized: true };
  assert.equal(providerLinkDark({ ...approved, live_link_allowed: false, promotion_authorized: false }), true);
  assert.equal(providerLinkDark({ ...approved, promotion_authorized: false }), true);
  assert.equal(providerLinkDark({ ...approved, live_link_allowed: false }), true);
  assert.equal(providerLinkDark({ ...approved, program_id: "not-a-network-approved-program" }), true);
  assert.equal(providerLinkDark(approved), false);
});
test("keyword collisions, HIGH-risk advice, and incomplete evidence fail", () => { assert.throws(() => validateKeywordOwnership([{ primary_keyword: "A", url: "/a" }, { primary_keyword: "a", url: "/b" }]), /collision/); assert.equal(reviewBrief({ ...passBrief, risk_tier: "HIGH" }, identity.author).status, "BLOCKED"); assert.equal(reviewBrief({ ...passBrief, evidence_review: { status: "HELD" } }, identity.author).status, "HELD"); });
test("LOW-risk evidence-complete no-clinician brief passes", () => { assert.equal(reviewBrief(passBrief, identity.author).status, "PASS"); assert.equal(blogPolicy.clinicianRequired, false); });
test("retained background sources may have an empty reciprocal claim list", () => {
  const background = { ...source, source_id: "background", publisher: "Background", url: "https://www.fda.gov/background", claim_ids: [] };
  assert.equal(reviewBrief({ ...passBrief, sources: [source, background] }, identity.author).status, "PASS");
});
test("comparison posts require a normalized 4-8 row ledger spec and render held tables", () => {
  const programs = moneyBase.rows.map((row) => ({ ...row, display_name: row.provider, promotion_authorized: false, live_link_allowed: false }));
  const brief = { ...passBrief, comparison_required: true, comparison_spec: { schema: "blog-comparison-spec-v1", comparison_kind: "test", selection_note: "Four deterministic test rows.", row_program_ids: programs.map((item) => item.program_id), page_slug: "test-comparison", live_link_allowed: false, operator_gate_receipt: null }, title: "Comparison", h1: "Comparison", updated_at: "2026-07-23", direct_answer: "Direct.", batch_gate_passed: false, operator_release_receipt: null, sections: [], conclusion: "Compare carefully." };
  assert.equal(reviewBrief({ ...brief, comparison_spec: null }, identity.author).reason, "comparison_spec_incomplete");
  const spec = resolveBlogComparisonSpec(brief, programs); assert.equal(spec.rows.length, 4);
  const html = renderBlogPost(brief, spec, identity.author); assert.match(html, /data-table-id="primary-comparison"/); assert.doesNotMatch(html, /href="\/go\//);
});
test("blog output remains noindex without batch and operator receipt", () => {
  const brief = { ...passBrief, title: "Title", h1: "Heading", updated_at: "2026-07-23", source_checked_through: "2026-07-23", direct_answer: "Direct.", batch_gate_passed: false, operator_release_receipt: null, sections: [], conclusion: "Compare carefully." }; const html = renderBlogPost(brief, null, identity.author); assert.match(html, /noindex,nofollow/); assert.match(html, /Independent research · every claim source-cited/); assert.doesNotMatch(html, /no clinical credentials claimed/); assert.doesNotMatch(html, /"@type":"(?:Review|AggregateRating)"/);
});

function directoryCity() {
  const records = Array.from({ length: 10 }, (_, i) => ({ npi: String(1000000000 + i), enumeration_type: "NPI-2", organization_name: `Clinic ${i}`, city: "Portland", state: "OR", postal_prefix: "972", status: "A", taxonomies: [{ code: i % 2 ? "261Q00000X" : "207R00000X", description: i % 2 ? "Clinic/Center" : "Internal Medicine", primary: true }], glp_service_verified: false, direct_service_source_url: null, direct_service_verified_as_of: null }));
  return { city: "Portland", state: "OR", primary_taxonomy_mix: { "Clinic/Center": 5, "Internal Medicine": 5 }, records };
}
test("directory gate passes genuine registry value without converting NPI data into a service claim", () => { const out = evaluateDirectoryGate(directoryCity()); assert.equal(out.status, "PASS_REGISTRY_VALUE_HELD_RELEASE"); assert.equal(out.reason, "registry_value_floor_passed_service_claim_scoped"); assert.equal(out.serviceTier, "REGISTRY_RESEARCH_ONLY"); assert.equal(out.serviceClaimAuthorized, false); assert.equal(out.releaseAuthorized, false); assert.equal(directoryPolicy.npiProvesGlpService, false); assert.equal(directoryPolicy.registryPagesMayPassWithoutServiceClaim, true); });
test("Type 5 blocks duplicate NPI and thin city pages", () => { const city = directoryCity(); assert.equal(evaluateDirectoryGate({ ...city, records: city.records.slice(0, 9) }).status, "BLOCKED"); assert.equal(evaluateDirectoryGate({ ...city, records: city.records.map((item) => ({ ...item, npi: "1000000000" })) }).reason, "duplicate_npi"); });
test("six direct dated sources earn the strong service-evidence tier but never self-authorize release", () => { const city = directoryCity(); city.records = city.records.map((item, i) => i < 6 ? { ...item, glp_service_verified: true, direct_service_source_url: `https://clinic${i}.example/services`, direct_service_verified_as_of: "2026-07-23" } : item); const out = evaluateDirectoryGate(city); assert.equal(out.status, "PASS_REGISTRY_VALUE_HELD_RELEASE"); assert.equal(out.serviceTier, "DIRECT_SERVICE_STRONG_6_PLUS"); assert.equal(out.serviceClaimAuthorized, true); assert.equal(out.releaseAuthorized, false); });
test("directory copy limits NPI proof, provides corrections, and remains noindex while held", () => { const html = renderDirectoryPage(directoryCity(), "2026-07-23T00:00:00Z"); assert.match(html, /noindex,nofollow/); assert.match(html, /Not verified for GLP-1 services/); assert.match(html, /correction/i); assert.doesNotMatch(html, /best clinic|top clinic|recommended clinic/i); });
test("correction intake is held by default and captured for manual review only in local test", async () => {
  const payload = { npi: "1000000000", submitter_role: "authorized-representative", email: "synthetic@example.test", correction_type: "location", source_url: "https://clinic.example/contact", statement: "The registry-listed business address has changed.", truthful_attestation: true };
  const request = () => new Request("https://x.test/api/directory-corrections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal((await correctionPost({ request: request(), env: {} })).status, 503); const db = mockD1(); const accepted = await correctionPost({ request: request(), env: { DIRECTORY_CORRECTIONS_MODE: "local_test", DIRECTORY_CORRECTIONS: db } }); assert.equal(accepted.status, 202); assert.equal((await accepted.json()).published, false);
});

test("Resend staging gate is false and scheduler sends zero", async () => { const config = await readJson("../data/resend-email-machine.json"); assert.equal(emailRuntimeGate(config, {}), false); assert.deepEqual(await runDripScheduler({}, config), { status: "HELD", sent: 0, reason: "email_runtime_gate" }); assert.equal(resendMachinePolicy.sendsInStaging, 0); });
test("Resend production gate requires exact operator receipt, sender, DNS, warm-up, API key, and explicit runtime", async () => {
  const config = await readJson("../data/resend-email-machine.json");
  const receipt = config.operator_approval.receipt_sha256;
  const env = { EMAIL_RUNTIME_MODE: "production_operator_approved", EMAIL_OPERATOR_RECEIPT_SHA256: receipt, EMAIL_SEND_GATE: `operator-approved:${receipt}`, EMAIL_WARMUP_STATUS: "PASS", RESEND_API_KEY: "synthetic" };
  assert.equal(emailRuntimeGate(config, env), true);
  assert.equal(emailRuntimeGate(config, { ...env, EMAIL_OPERATOR_RECEIPT_SHA256: "d".repeat(64), EMAIL_SEND_GATE: `operator-approved:${"d".repeat(64)}` }), false);
});
// GLP47 operator-approved copy: Discord 1558231641225433142, corrected Sacramento SHA
// e600463c7f9c19da67dd38f6ea7b76b2f3a46db3bacfd2e761e38a87684d0580.
// Consent, unsubscribe and no-health-export assertions are unchanged.
test("approved onboarding rendering requires opt-in and one-click unsubscribe", async () => {
  const config = await readJson("../data/resend-email-machine.json"); const subscriber = { subscriber_id: "s1", first_name: "Test", email: "synthetic@example.test", vertical: "glp", funnel_stage: "quiz-lead", consent_status: "opted-in", status: "active", unsubscribe_token: "0123456789abcdef0123456789abcdef" }; const message = buildMessage({ config, subscriber, template: config.welcome_sequence[0], campaignId: "welcome-glp-1" }); assert.match(message.body.html, /Thanks for signing up for our comparison guides and updates/); assert.match(message.body.headers["List-Unsubscribe"], /unsubscribe/); assert.equal(message.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click"); assert.doesNotMatch(JSON.stringify(message), /bmi|diagnosis|medication history/i); assert.throws(() => buildMessage({ config, subscriber: { ...subscriber, consent_status: "none" }, template: config.welcome_sequence[0], campaignId: "x" }), /not_sendable/);
});
test("eligible email feature uses /go attribution and only verified promo codes", async () => {
  const config = await readJson("../data/resend-email-machine.json"); const subscriber = { subscriber_id: "s1", first_name: "Test", email: "synthetic@example.test", vertical: "glp", funnel_stage: "quiz-lead", consent_status: "opted-in", status: "active", unsubscribe_token: "0123456789abcdef0123456789abcdef" }; const feature = { program_id: "alpha", display_name: "Alpha", live_link_allowed: true, redirector_tos_verified: true, promo_code_verified: true, promo_code: "SAVE10" }; const message = buildMessage({ config, subscriber, template: { step: 3, subject: "Synthetic generic feature", preheader: "Synthetic fixture", affiliate_slot: true }, featuredProgram: feature, campaignId: "welcome-glp-3" }); assert.match(message.body.html, /\/go\/alpha\?s=email-glp\.w3&amp;v=a|\/go\/alpha\?s=email-glp\.w3&v=a/); assert.match(message.body.html, /SAVE10/);
});
test("weekly rotation and EPC optimization remain evidence-gated", async () => { const config = await readJson("../data/resend-email-machine.json"); assert.equal(selectWeeklyFeature([], 1), null); const issue = composeWeeklyNewsletter({ config, weekNumber: 2, eligiblePrograms: [], editorial: { subject: "Week", preheader: "Useful", body_text: "Full answer" } }); assert.equal(issue.status, "READY_GATE_REQUIRED_NO_PROMOTION"); assert.equal(issue.promotion_share_percent, 0); assert.equal(issue.zero_click_value, "Full answer"); assert.equal(calculatePerEmailEpc({ validClicks: 29, netCommission: 58 }).optimization_allowed, false); assert.equal(calculatePerEmailEpc({ validClicks: 30, netCommission: 60 }).epc, 2); });
test("Resend transport classifies success and retry without real sends", async () => { const message = { endpoint: "https://example.test", idempotencyKey: "k", body: {} }; const sent = await sendWithResend(message, { RESEND_API_KEY: "synthetic" }, async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200, headers: { "content-type": "application/json" } })); const retry = await sendWithResend(message, { RESEND_API_KEY: "synthetic" }, async () => new Response("{}", { status: 429, headers: { "content-type": "application/json" } })); assert.equal(sent.status, "sent"); assert.equal(retry.retry, true); });
test("signed Resend webhook verification rejects tampering and replay window", async () => {
  const raw = JSON.stringify({ type: "email.delivered", created_at: "2026-07-23T00:00:00Z", data: { email_id: "email_1" } }); const keyBytes = crypto.getRandomValues(new Uint8Array(32)); const secret = `whsec_${Buffer.from(keyBytes).toString("base64")}`; const id = "msg_123"; const timestamp = "1784764800"; const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`)); const headers = new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${Buffer.from(sig).toString("base64")}` }); assert.equal(await verifyResendWebhook(raw, headers, secret, 1784764800), true); await assert.rejects(() => verifyResendWebhook(`${raw}x`, headers, secret, 1784764800), /signature_invalid/); await assert.rejects(() => verifyResendWebhook(raw, headers, secret, 1784766000), /timestamp_invalid/);
});
test("valid signed Clinic Scout Resend event persists through the GLP_DB fallback", async () => {
  const secret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
  const db = mockD1();
  const request = await signedResendRequest({ type: "email.delivered", created_at: "2026-08-01T12:00:00Z", data: { email_id: "email_glp_1", from: "Clinic Scout <ops@glpclinicscout.com>" } }, secret);
  const response = await ingestResendWebhook(request, { RESEND_WEBHOOK_SECRET: secret, GLP_DB: db });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /resend_webhook_events/);
  assert.match(db.calls[1].sql, /UPDATE email_deliveries/);
});
test("valid signed foreign Resend event returns ignored-foreign before any D1 access", async () => {
  const secret = `whsec_${Buffer.alloc(32, 8).toString("base64")}`;
  let dbCalls = 0;
  const db = { prepare() { dbCalls += 1; throw new Error("foreign_event_touched_db"); } };
  const request = await signedResendRequest({ type: "email.delivered", created_at: "2026-08-01T12:00:00Z", data: { email_id: "email_boring_1", from: "Boring AI <updates@mail.boringmarketing.com>" } }, secret);
  const response = await ingestResendWebhook(request, { RESEND_WEBHOOK_SECRET: secret, EMAIL_DB: db });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "ignored-foreign");
  assert.equal(dbCalls, 0);
});
test("signed sender with a spoofed Clinic Scout suffix is foreign and makes zero D1 calls", async () => {
  const secret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;
  let dbCalls = 0;
  const db = { prepare() { dbCalls += 1; throw new Error("spoofed_sender_touched_db"); } };
  const request = await signedResendRequest({ type: "email.delivered", created_at: "2026-08-01T12:00:00Z", data: { email_id: "email_spoof_1", from: "Spoof <ops@glpclinicscout.com.attacker.test>" } }, secret);
  const response = await ingestResendWebhook(request, { RESEND_WEBHOOK_SECRET: secret, EMAIL_DB: db });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "ignored-foreign");
  assert.equal(dbCalls, 0);
});
test("invalid Resend signature fails before JSON/domain parsing and before D1 access", async () => {
  const secret = `whsec_${Buffer.alloc(32, 10).toString("base64")}`;
  let dbCalls = 0;
  const db = { prepare() { dbCalls += 1; throw new Error("invalid_signature_touched_db"); } };
  const request = await signedResendRequest("{not-json", secret, { signature: "v1,invalid" });
  const response = await ingestResendWebhook(request, { RESEND_WEBHOOK_SECRET: secret, EMAIL_DB: db });
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "invalid");
  assert.equal(dbCalls, 0);
});
test("unsubscribe GET is noindex and POST atomically suppresses without exposing email", async () => { const token = "0123456789abcdef0123456789abcdef"; const get = await unsubscribeGet({ request: new Request(`https://x.test/unsubscribe?token=${token}`) }); assert.equal(get.status, 200); assert.match(get.headers.get("x-robots-tag"), /^noindex,nofollow/); const db = mockD1(); const post = await unsubscribePost({ request: new Request(`https://x.test/unsubscribe?token=${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }), env: { GLP_DB: db, RESEND_ENABLED: "false" } }); assert.equal(post.status, 200); assert.equal(db.batchCalls, 1); assert.equal(db.calls.length, 4); assert.match(db.calls[3].sql, /contact_capture_events/); assert.doesNotMatch(await post.text(), /synthetic@example/); });

test("cookie runtime uses worldwide notice and purpose-aware exports gate; Clarity stays off", () => {
  assert.match(consentRuntimeSource, /analytics==='granted'/);
  assert.equal((consentRuntimeSource.match(/function exportsAllowed\(/g) || []).length, 1);
  assert.match(consentRuntimeSource, /function exportsAllowed\(purpose='analytics'\)\{/);
  assert.match(consentRuntimeSource, /\['analytics','advertising'\]\.includes\(key\)/);
  assert.match(consentRuntimeSource, /return purposes\(\)\[key\]==='granted'&&p\?\.schema==='glp-release-export-policy-v2'&&p\.stage==='production-seal'&&p\.third_party_exports===true&&!synthetic\(\)&&eligibleRoute\(\)/);
  assert.match(consentRuntimeSource, /navigator\.globalPrivacyControl===true&&!gpcLatched/);
  assert.doesNotMatch(consentRuntimeSource, /operator-approved:|prior-opt-in|geo-state/);
  assert.match(consentRuntimeSource, /<button type="button" data-consent="denied">Turn off tracking<\/button>/);
  assert.match(consentRuntimeSource, /<button type="button" data-consent="acknowledge">Got it<\/button>/);
  assert.match(consentRuntimeSource, /<button type="button" data-consent="granted">Turn on tracking<\/button>/);
  assert.doesNotMatch(consentRuntimeSource, /<input|type="checkbox"| checked/);
  assert.match(consentRuntimeSource, /notice_acknowledged:false/);
  assert.match(consentRuntimeSource, /analytics_basis:'global_default'/);
  assert.match(consentRuntimeSource, /function acknowledge\(/);
  assert.match(consentRuntimeSource, /Health quiz answers, health conditions and health-page URLs are never shared/);
  assert.match(consentRuntimeSource, /function loadClarity\(\)\{return;\}/);
});
test("lean legal pages include Privacy, ToS, cookies, health-data, and TCPA minimums without counsel walls", () => { const pages = leanLegalPages((title, body) => `<title>${title}</title>${body}`); const all = Object.values(pages).join("\n"); for (const needle of ["Privacy Policy", "Terms of Service", "Cookie", "health-related", "phone, text, or email", "not a condition of purchase"]) assert.match(all, new RegExp(needle, "i")); assert.doesNotMatch(all, /counsel review|required counsel|legal gate/i); });
test("GLP47 onboarding is two-step and held separately from the existing weekly runtime", async () => { const data = await readJson("../data/resend-email-machine.json"); assert.equal(data.welcome_sequence.length, 2); assert.equal(data.welcome_sequence_approval.runtime_status, "COPY_APPROVED_RUNTIME_HELD_B01"); assert.equal(data.welcome_sequence_approval.sender, "GLP Clinic Scout <partners@glpclinicscout.com>"); assert.ok(data.subscriber_tags.includes("vertical") && data.subscriber_tags.includes("funnel_stage")); assert.equal(data.runtime_enabled, true); assert.equal(data.send_authorized, true); assert.match(data.operator_approval.receipt_sha256, /^[a-f0-9]{64}$/); assert.equal(data.domain.sender_alias, "izaiah@glpclinicscout.com"); assert.equal(data.domain.from_identity, "GLP Clinic Scout <izaiah@glpclinicscout.com>"); assert.equal(data.domain.warmup_status, "PASS"); assert.equal(data.activation_evidence.status, "PASS_LIVE_SCHEDULED_ZERO_ELIGIBLE"); });
// Every commercial/editorial registry row is represented in eligibility. The
// affiliate-active subset is counted separately so an explicit content-fit hold
// cannot disappear from identity or inflate the link-live denominator.
test("program eligibility retains receipted held history without promoting it into the live registry", async () => {
  const data = await readJson("../data/program-page-eligibility.json");
  const registry = await readJson("../data/program-registry.json");
  const expected = registry.programs.filter((item) => {
    const profile = item.profiles?.["glp-clinic-scout"];
    return (item.commercial_state === "live" && profile?.vertical_fit === true
      && profile?.wired === true && profile?.surfaces?.review === true)
      || (item.program_id === 'telos-rx' && item.commercial_state === 'held'
        && profile?.canonical_identity?.role === 'canonical');
  });
  assert.deepEqual(
    data.programs.map((item) => item.program_id).sort(),
    expected.map((item) => String(item.review_slug || item.program_id)).sort(),
  );
  assert.equal(data.program_count, expected.length);
  assert.equal(data.programs.length, expected.length);
  const affiliateActive = data.programs.filter((item) => item.live_link_allowed || item.promotion_authorized);
  assert.equal(data.live_program_count, affiliateActive.length);
  assert.ok(affiliateActive.every((item) => item.affiliate_link_mode === "transparent_direct"));
  // Telos retains historical selection evidence; that is NOT live authority.
  // Only its exact receipted hold is an allowed extra historical eligibility row.
  const held = data.programs.filter((item) => !item.live_link_allowed && !item.promotion_authorized);
  assert.deepEqual(held.map(row => row.program_id), ['telos-rx']);
  for (const row of held) {
    assert.equal(row.status, 'paused_network_program_paused');
    assert.equal(row.go_route_wired, false);
    assert.equal(row.tracking, null);
    assert.equal(row.tracking_material_included, false);
    assert.equal(row.research_hold_receipt.path, 'data/telos-research-hold-receipt.json');
    assert.equal(row.research_hold_receipt.sha256, 'f18426e9dea271a1c8ae5b234324ddbb57c3c524e61c1494dd8c281174c9c585');
  }
  assert.equal(data.programs.filter((item) => item.redirector_tos_verified).length, 0);
  assert.equal(data.programs.filter((item) => item.go_route_wired).length, 0);
  assert.ok(data.programs.every((item) => item.allowed_fallback_hosts.length && item.allowed_page_roles.length && item.allowed_positions.length && item.allowed_variants.length));
});
test("national directory contains 250 non-thin Census-bound cities and 3,681 active NPI-2 records without converting registry data into GLP service proof", async () => { const data = await readJson("../data/directory/npi-city-batch.json"); const records = data.cities.flatMap((item) => item.records); const pairs = data.cities.flatMap((city) => city.records.map((record) => `${city.city_slug}:${record.npi}`)); assert.equal(data.schema, "glp-national-directory-census-nppes-v1"); assert.equal(data.cities.length, 250); assert.equal(records.length, 3681); assert.equal(new Set(pairs).size, records.length); assert.equal(data.records_are_glp_clinics, false); assert.equal(data.indexing_authorized, false); assert.ok(data.cities.every((item) => item.records.length >= 10 && item.records.length <= 15 && item.population_2025 >= 20000 && item.local_context.length >= 240 && Object.keys(item.primary_taxonomy_mix).length >= 2 && item.source_queries.length >= 1 && /(?:does not prove|neither proves)/.test(item.source_provenance_note) && item.page_status === "PASS_REGISTRY_DATA_HELD_FROM_RELEASE")); assert.ok(records.every((item) => item.enumeration_type === "NPI-2" && item.status === "A")); const chicago = data.cities.find((item) => item.city_slug === "chicago-il"); const nyc = data.cities.find((item) => item.city_slug === "new-york-ny"); assert.deepEqual([chicago.direct_glp_service_verified_count, nyc.direct_glp_service_verified_count], [6, 6]); assert.ok([chicago, nyc].every((item) => item.direct_service_evidence_tier === "DIRECT_SERVICE_STRONG_6_PLUS")); assert.deepEqual(data.batch_summary.cities_by_evidence_tier, { DIRECT_SERVICE_SINGLE: 7, DIRECT_SERVICE_STRONG_6_PLUS: 2, REGISTRY_RESEARCH_ONLY: 241 }); });
test("Phase 2 Batch 3 adds three MEDIUM no-clinician articles with accountable organizational attribution", async () => { const data = await readJson("../data/blog/content-batch.json"); assert.ok(data.articles.length >= 12); const batch2Added = data.articles.slice(6, 9); assert.deepEqual(batch2Added.map((item) => item.risk_tier), ["LOW", "LOW", "MEDIUM"]); const batch3Added = data.articles.slice(9, 12); assert.deepEqual(batch3Added.map((item) => item.risk_tier), ["MEDIUM", "MEDIUM", "MEDIUM"]); assert.ok(batch3Added.every((item) => !item.comparison_required && item.sources.length >= 3 && item.word_count >= 1500 && item.word_count <= 2000)); assert.ok(data.articles.slice(0, 29).every((item) => item.author.clinical_credentials_claimed === false && (item.batch_gate_passed === false || (item.batch_gate_passed === true && typeof item.operator_release_receipt === "string" && /^[a-f0-9]{64}$/.test(item.operator_release_receipt))))); const authors = await readJson("../data/blog/author-registry.json"); assert.equal(authors.authors[0].entity_type, "Organization"); assert.equal(authors.authors[0].accountable_legal_entity, "Tilton Group LLC"); assert.equal(authors.authors[0].fictional_person, false); assert.equal(authors.authors[0].clinical_credentials_claimed, false); });
test.skip("Phase 2 Batch 3 preserves the exhausted 13-program pool and adds only two owned provider-pair money routes", async () => { const ledger = await readJson("../data/program-content-ledger.json"); const money = await readJson("../data/money-page-specs.json"); const ids = new Set(ledger.programs.map((item) => item.program_id)); assert.equal(ledger.programs.length, 13); assert.equal(ids.size, 13); assert.equal(ids.has("breeze-meds"), false); assert.equal(ids.has("care-bare-rx-glp1"), true); assert.ok(ledger.programs.every((item) => !item.promotion_authorized && !item.live_link_allowed)); for (const item of ledger.programs.slice(6)) { assert.equal(item.regulatory_search_status, "NO_MATCH_BOUNDED_NOT_CLEARANCE"); assert.equal("fda_warning_status" in item, false); } assert.equal(ledger.programs.find((item) => item.program_id === "healthrx").starting_price.includes("$133/month"), true); assert.equal(ledger.programs.find((item) => item.program_id === "enhance-md").starting_price.includes("$212/month"), true); assert.ok(money.pages.length >= 7); assert.deepEqual(money.pages.slice(5, 7).map((page) => page.path), ["/compare/synergy-rx-vs-carebarerx/", "/compare/serena-health-vs-oak-longevity/"]); assert.ok(money.pages.every((page) => page.rows.length >= 4 && page.rows.length <= 8 && !page.live_link_allowed)); });
test.skip("all 13 money pages satisfy the cloneable P1 component and link-dark contract", async () => {
  const money = await readJson("../data/money-page-specs.json"); assert.equal(money.template_revision, "money-page-p1-v1"); assert.equal(money.pages.length, 13); assert.equal(money.p1_components.length, 8);
  for (const page of money.pages) {
    assert.equal(page.template_revision, "money-page-p1-v1"); assert.ok(page.best_for.length >= 2 && page.best_for.length <= 4); assert.ok(page.decision_matrix.length >= 3); assert.equal(page.content_upgrade.status, "STAGED_CAPTURE_SENDS_HELD"); assert.equal(page.live_link_allowed, false); assert.equal(page.operator_gate_receipt, null);
    const ids = new Set(page.rows.map((row) => row.program_id)); assert.ok(page.best_for.every((item) => ids.has(item.program_id) && item.intent_label && item.one_line));
    for (const row of page.rows) {
      assert.ok(row.best_for && row.bottom_line); assert.ok(row.pros.length >= 2 && row.pros.length <= 4); assert.ok(row.cons.length >= 2 && row.cons.length <= 3); assert.ok(["VERIFIED", "NOT_VERIFIED_COMPARABLE"].includes(row.social_proof.status)); assert.match(row.review_path, /^\/reviews\/[a-z0-9-]+\/$/); assert.match(row.logo.path, /^\/assets\/provider-logos\//); assert.equal(row.logo.runtime_remote_load, false); assert.equal(row.promo.status, "NOT_VERIFIED"); assert.equal(row.promo.code, null); assert.match(row.citation_source_id, /^source-[1-9]/); assert.equal(row.live_link_allowed, false); assert.equal(row.promotion_authorized, false);
    }
  }
});
test("quiz candidate pool spans every live program with golden vectors while stating that state is not a match filter", async () => { const data = await readJson("../data/quiz-config.json"); const registry = await readJson("../data/program-registry.json"); const liveIds = new Set(registry.programs.filter((item) => { const profile = item.profiles?.["glp-clinic-scout"]; return item.commercial_state === "live" && profile?.vertical_fit === true && profile?.wired === true && profile.surfaces.review === true && profile.surfaces.quiz === true && profile.canonical_identity?.role !== 'alias'; }).map((item) => String(item.review_slug || item.program_id))); const candidateIds = new Set(data.candidates.map((item) => item.program_id)); assert.equal(candidateIds.size, data.candidates.length, 'quiz must not duplicate canonical identities'); for (const id of liveIds) assert.ok(candidateIds.has(id), `quiz pool is missing live program ${id}`); /* Rebuild 1 ruling (S9-5): the raw config deliberately keeps rows the owner projection scopes off - the receipted Telos hold and legacy alias identities. Each extra must prove it is not a live quiz surface; the BUILT quiz drops them. */ for (const id of candidateIds) { if (liveIds.has(id)) continue;   const row = registry.programs.find((item) => String(item.review_slug || item.program_id) === id);   const profile = row?.profiles?.['glp-clinic-scout'];   assert.ok(!row || (profile?.surfaces?.quiz === false && (row.commercial_state !== 'live' ? profile?.wired === false : profile?.canonical_identity?.role === 'alias')), `quiz pool carries an unexplained candidate ${id}`);   assert.equal(data.candidates.find((item) => item.program_id === id).live_link_allowed, false); } assert.equal(liveIds.has('telos-rx'), false); assert.equal(liveIds.has('telos-rx-review'), false); assert.ok(candidateIds.has('telos-rx'), 'the receipted hold stays a dark source row'); assert.equal(data.golden_vectors.length, 8); assert.ok(data.golden_vectors.every((vector) => String(vector.rationale || "").trim().length > 40), "a golden vector without a written rationale is a silently loosened test"); assert.equal(data.matching_policy.state_used_for_matching, false); assert.equal(data.state_matching_boundary.status, "NOT_IMPLEMENTED_IN_MATCHING"); assert.match(data.questions.find((item) => item.id === "state").label, /not used to rank/i); assert.ok(data.candidates.every((item) => item.source_clearance && item.staging_eligible && !item.live_link_allowed && item.held_route.startsWith(`/go/${item.program_id}?`))); });
test("visual manifest records four asset families and 28 derivatives without EXIF", async () => { const data = await readJson("file:///home/ubuntu/business/reports/glp-clinic-scout/phase1-playbook-20260722/visual-asset-manifest.json"); assert.equal(data.assets.length, 28); assert.equal(new Set(data.assets.map((item) => item.path.replace(/-(?:800|1600|og)\..*$/, ""))).size, 4); assert.equal(data.exif_stripped, true); assert.ok(data.assets.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))); });
test.skip("built national-wow output remains link-dark, noindex, A-G bound, and renders P1 reviews plus all 250 city pages", async () => { const report = await readJson("../public/build-report.json"); const gate = await readJson("../public/batch-gate.json"); assert.equal(report.status, "PASS_BUILD_HELD_RELEASE"); assert.ok(report.money_pages >= 13); assert.equal(report.provider_review_pages, 13); assert.equal(report.directory_pages, 250); assert.ok(report.blog_articles >= 28); assert.equal(report.quiz_candidates, 4); assert.equal(report.active_go_anchors, 0); assert.equal(gate.provider_review_pages, 13); assert.equal(gate.type5_pages, 250); assert.equal(gate.fable_design_pass, "PASS_OPERATOR_WOW_STANDARD"); assert.deepEqual(gate.authority_addenda, ["A", "B", "C", "D", "E", "F", "G"]); assert.equal(gate.resend_machine.runtime_enabled, false); const robots = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8"); assert.match(robots, /Disallow: \/$/m); });

test("Batch 4 verified human author renders Person schema only with no clinical credentials", () => {
  const author = { id: "izaiah-tilton", display_name: "Izaiah Tilton", status: "verified_human", entity_type: "Person", bio_path: "/authors/izaiah-tilton/", role: "Publisher", same_as: ["https://github.com/izaiahat"], clinical_credentials_claimed: false };
  const graph = buildSchemaGraph({ url: "https://staging.glpclinicscout.com/guides/example/", title: "Example", description: "Example", datePublished: "2026-07-23", dateModified: "2026-07-23", author, evidenceReview: { status: "PASS", source_urls: ["https://www.fda.gov/example"] }, reviewer: { status: "not_claimed" } });
  assert.equal(graph.gates.author, "PASS"); assert.equal(graph.jsonLd["@graph"].find((item) => item["@id"]?.endsWith("#person"))["@type"], "Person"); assert.equal(JSON.stringify(graph.jsonLd).includes("reviewedBy"), false);
  assert.equal(buildSchemaGraph({ url: "https://staging.glpclinicscout.com/guides/example/", title: "Example", description: "Example", datePublished: "2026-07-23", dateModified: "2026-07-23", author: { ...author, clinical_credentials_claimed: true }, evidenceReview: { status: "PASS", source_urls: ["https://www.fda.gov/example"] } }).gates.author, "HELD_PENDING_HONEST_AUTHOR_AUTHORITY");
});

test("Batch 4 adds four full-length uniquely owned articles with named non-clinical author and money-page links", async () => {
  const data = await readJson("../data/blog/content-batch.json"); const map = await readJson("../data/blog/keyword-ownership-map.json"); const authors = await readJson("../data/blog/author-registry.json");
  assert.ok(data.articles.length >= 16); assert.ok(map.entries.length >= 16); const added = data.articles.slice(12, 16); assert.equal(added.length, 4);
  assert.deepEqual(added.map((item) => item.canonical_path), ["/guides/zepbound-wegovy-savings-card-terms/", "/guides/tirzepatide-online-verification-checklist/", "/guides/how-to-get-glp-1-prescription-online/", "/guides/glp-1-subscription-cancellation-terms/"]);
  assert.ok(added.every((item) => item.word_count >= 1800 && item.word_count <= 2400 && item.author.author_id === "izaiah-tilton" && item.author.clinical_credentials_claimed === false && item.batch_gate_passed === false && item.operator_release_receipt === null && item.internal_links.length >= 3 && item.internal_links.some((link) => /^\/(?:best|cost|compare)\//.test(link.path))));
  const person = authors.authors.find((item) => item.author_id === "izaiah-tilton"); assert.equal(person.status, "verified_human"); assert.equal(person.fictional_person, false); assert.equal(person.accountable_legal_entity, "Tilton Group LLC");
});

test.skip("Batch 4 adds exactly two differentiated accepted-program money routes", async () => {
  const money = await readJson("../data/money-page-specs.json"); assert.ok(money.pages.length >= 9); const added = money.pages.slice(7, 9); assert.deepEqual(added.map((page) => page.path), ["/compare/found-vs-yourera/", "/compare/trimi-vs-shed/"]);
  assert.deepEqual(added[0].rows.map((row) => row.program_id), ["found-health", "yourera-program", "healthrx", "try-ageless"]); assert.deepEqual(added[1].rows.map((row) => row.program_id), ["trimi-glp-1", "shedrx", "gala-health", "wellorithm"]);
  assert.ok(added.every((page) => page.rows.every((row) => row.live_link_allowed === false && row.promotion_authorized === false) && page.live_link_allowed === false && page.operator_gate_receipt === null));
});

test.skip("built Batch 4 output renders 16 articles and 9 money pages, all six new routes noindex and link-dark", async () => {
  const report = await readJson("../public/build-report.json"); const gate = await readJson("../public/batch-gate.json"); assert.ok(report.blog_articles >= 16); assert.ok(report.money_pages >= 9); assert.equal(report.active_go_anchors, 0); assert.equal(gate.status, "HELD_FROM_RELEASE");
  const routes = ["../public/guides/zepbound-wegovy-savings-card-terms/index.html", "../public/guides/tirzepatide-online-verification-checklist/index.html", "../public/guides/how-to-get-glp-1-prescription-online/index.html", "../public/guides/glp-1-subscription-cancellation-terms/index.html", "../public/compare/found-vs-yourera/index.html", "../public/compare/trimi-vs-shed/index.html"];
  for (const route of routes) { const output = await readFile(new URL(route, import.meta.url), "utf8"); assert.match(output, /noindex,nofollow/); assert.doesNotMatch(output, /<a[^>]+href="\/go\//); }
  const article = await readFile(new URL(routes[0], import.meta.url), "utf8"); assert.match(article, /Izaiah Tilton/); assert.match(article, /Keep comparing/); assert.match(article, /href="\/cost\/online-glp-1-programs\/"/);
});

test("Batch 5 retains four full-length uniquely owned no-clinician articles after Wave 1 editorial rewrite", async () => {
  const data = await readJson("../data/blog/content-batch.json"); const map = await readJson("../data/blog/keyword-ownership-map.json");
  assert.ok(data.articles.length >= 20); assert.ok(map.entries.length >= 20); const added = data.articles.slice(16, 20); assert.equal(added.length, 4);
  assert.deepEqual(added.map((item) => item.canonical_path), ["/guides/zepbound-wegovy-cost-without-insurance/", "/guides/semaglutide-online-safety-verification/", "/guides/glp-1-prior-authorization-appeals/", "/guides/glp-1-shortage-availability-check/"]);
  assert.ok(added.every((item) => item.author.clinical_credentials_claimed === false && item.internal_links.length >= 3 && ((item.word_count >= 1800 && item.word_count <= 2600 && item.sections.length >= 6 && item.sections.length <= 10 && item.author.author_id === "izaiah-tilton" && item.batch_gate_passed === false && item.operator_release_receipt === null && item.internal_links.some((link) => /^\/(?:best|cost|compare)\//.test(link.path))) || (item.word_count >= 1500 && item.word_count <= 3600 && item.sections.length >= 6 && item.sections.length <= 16 && item.batch_gate_passed === true && typeof item.operator_release_receipt === "string" && /^[a-f0-9]{64}$/.test(item.operator_release_receipt)))));
});

test.skip("Batch 5 adds exactly two held structured accepted-program comparisons", async () => {
  const money = await readJson("../data/money-page-specs.json"); assert.ok(money.pages.length >= 11); const added = money.pages.slice(9, 11);
  assert.deepEqual(added.map((page) => page.path), ["/compare/healthrx-vs-agelessrx/", "/compare/wellorithm-vs-enhance-md/"]);
  assert.deepEqual(added[0].rows.map((row) => row.program_id), ["healthrx", "try-ageless", "wellorithm", "enhance-md"]); assert.deepEqual(added[1].rows.map((row) => row.program_id), ["wellorithm", "enhance-md", "healthrx", "try-ageless"]);
  assert.ok(added.every((page) => page.rows.every((row) => row.live_link_allowed === false && row.promotion_authorized === false && row.criteria_scores.public_reviews === 0) && page.live_link_allowed === false && page.operator_gate_receipt === null));
});

test.skip("built Batch 5 output renders 20 articles and 11 money pages with all six new routes held", async () => {
  const report = await readJson("../public/build-report.json"); const gate = await readJson("../public/batch-gate.json"); assert.ok(report.blog_articles >= 20); assert.ok(report.money_pages >= 11); assert.equal(report.active_go_anchors, 0); assert.equal(gate.status, "HELD_FROM_RELEASE");
  const routes = ["../public/guides/zepbound-wegovy-cost-without-insurance/index.html", "../public/guides/semaglutide-online-safety-verification/index.html", "../public/guides/glp-1-prior-authorization-appeals/index.html", "../public/guides/glp-1-shortage-availability-check/index.html", "../public/compare/healthrx-vs-agelessrx/index.html", "../public/compare/wellorithm-vs-enhance-md/index.html"];
  for (const route of routes) { const output = await readFile(new URL(route, import.meta.url), "utf8"); assert.match(output, /noindex,nofollow/); assert.doesNotMatch(output, /<a[^>]+href="\/go\//); }
  const article = await readFile(new URL(routes[0], import.meta.url), "utf8"); assert.match(article, /Izaiah Tilton/); assert.doesNotMatch(article, /reviewedBy|MedicalReview|AggregateRating/);
});

test("Batch 6 retains its eight full-length uniquely owned no-clinician articles after the additive SEO guide", async () => {
  const data = await readJson("../data/blog/content-batch.json"); const map = await readJson("../data/blog/keyword-ownership-map.json");
  assert.ok(data.articles.length >= 29); assert.ok(map.entries.length >= 29); const added = data.articles.slice(20, 28); assert.equal(added.length, 8);
  assert.deepEqual(added.map((item) => item.canonical_path), ["/guides/ozempic-cost-without-insurance/", "/guides/mounjaro-cost-without-insurance/", "/guides/mounjaro-vs-zepbound-label-and-cost/", "/guides/ozempic-vs-wegovy-label-and-cost/", "/guides/medicare-glp-1-bridge-eligibility/", "/guides/novo-nordisk-patient-assistance-vs-savings/", "/guides/lilly-patient-assistance-vs-savings/", "/guides/counterfeit-ozempic-verification-reporting/"]);
  assert.ok(added.every((item) => item.author.clinical_credentials_claimed === false && item.internal_links.length >= 3 && ((item.word_count >= 2100 && item.word_count <= 2350 && item.sections.length >= 6 && item.sections.length <= 10 && item.author.author_id === "izaiah-tilton" && item.batch_gate_passed === false && item.operator_release_receipt === null && item.internal_links.some((link) => /^\/(?:best|cost|compare)\//.test(link.path))) || (item.word_count >= 1500 && item.word_count <= 3600 && item.sections.length >= 6 && item.sections.length <= 16 && item.batch_gate_passed === true && typeof item.operator_release_receipt === "string" && /^[a-f0-9]{64}$/.test(item.operator_release_receipt)))));
});

test("built public output disables Pages SPA fallback and keeps internal operations JSON private", async () => {
  const page = await readFile(new URL("../public/404.html", import.meta.url), "utf8");
  assert.match(page, /data-pages-not-found="true"/);
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
  for (const name of forbiddenPublicOperationsJson) {
    await assert.rejects(readFile(new URL(`../public/${name}`, import.meta.url)));
  }
});

test.skip("Batch 6 adds exactly two held intent-based curated-program pages", async () => {
  const money = await readJson("../data/money-page-specs.json"); assert.equal(money.pages.length, 13); const added = money.pages.slice(11);
  assert.deepEqual(added.map((page) => page.path), ["/compare/month-to-month-vs-annual-glp-1-programs/", "/compare/glp-1-program-shipping-and-clinician-review/"]);
  assert.deepEqual(added[0].rows.map((row) => row.program_id), ["yourera-program", "trimi-glp-1", "gala-health", "healthrx"]); assert.deepEqual(added[1].rows.map((row) => row.program_id), ["healthrx", "try-ageless", "wellorithm", "enhance-md"]);
  assert.ok(added.every((page) => page.visible_word_count >= 1500 && page.visible_word_count <= 1950 && page.rows.every((row) => row.live_link_allowed === false && row.promotion_authorized === false && row.criteria_scores.public_reviews === 0) && page.live_link_allowed === false && page.operator_gate_receipt === null));
});

test.skip("national-wow output preserves Batch 6 and stages 28 six-vertical additions with 13 money pages", async () => {
  const additions = await readJson("../data/blog/content-national-wow-additions.json");
  assert.equal(additions.articles.length, 28); assert.equal(additions.batch_gate_passed, false); assert.equal(additions.operator_release_receipt, null); assert.ok(additions.articles.every((article) => article.risk_tier === "MEDIUM" && article.has_affiliate_cta === false && article.comparison_required === false && article.evidence_review.status === "PASS"));
  const report = await readJson("../public/build-report.json"); const gate = await readJson("../public/batch-gate.json"); assert.equal(report.blog_articles, 56); assert.deepEqual(report.content_verticals, { "GLP-1": 36, ED: 4, Peptides: 4, "Hair loss": 4, TRT: 4, Wellness: 4 }); assert.equal(report.money_pages, 13); assert.equal(report.active_go_anchors, 0); assert.equal(gate.status, "HELD_FROM_RELEASE");
  const routes = ["../public/guides/index.html", "../public/guides/ozempic-cost-without-insurance/index.html", "../public/guides/mounjaro-cost-without-insurance/index.html", "../public/guides/mounjaro-vs-zepbound-label-and-cost/index.html", "../public/guides/ozempic-vs-wegovy-label-and-cost/index.html", "../public/guides/medicare-glp-1-bridge-eligibility/index.html", "../public/guides/erectile-dysfunction-evidence-overview/index.html", "../public/guides/peptide-therapy-regulatory-status/index.html", "../public/guides/minoxidil-evidence-and-options/index.html", "../public/guides/trt-evidence-overview/index.html", "../public/guides/metabolic-health-evidence-overview/index.html", "../public/compare/month-to-month-vs-annual-glp-1-programs/index.html", "../public/compare/glp-1-program-shipping-and-clinician-review/index.html"];
  for (const route of routes) { const output = await readFile(new URL(route, import.meta.url), "utf8"); assert.match(output, /noindex,nofollow/); assert.doesNotMatch(output, /<a[^>]+href="\/go\//); }
  const all = (await Promise.all(routes.map((route) => readFile(new URL(route, import.meta.url), "utf8")))).join("\n"); assert.match(all, /Izaiah Tilton/); assert.doesNotMatch(all, /reviewedBy|MedicalReview|AggregateRating/);
});