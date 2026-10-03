import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGoSelection, loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative));
const readText = async (relative) => (await read(relative)).toString("utf8");
const readJson = async (relative) => JSON.parse(await readText(relative));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const { loadProviderPageContracts } = await import("../src/provider-cta-contract.mjs");
const contracts = loadProviderPageContracts(new URL("../", import.meta.url));
const fastpath = await readJson("data/provider-fastpath-contract.json");
const money = await readJson("data/money-page-specs.json");
const programRegistry = await readJson("data/program-registry.json");
const currentSelection = loadGoSelection(root);
const promotionAuthority = loadGoPromotionAuthority(root).programs;
const approvedRegistry = await readJson("data/approved-program-registry.json");
// Programs wired after the frozen approved-53 wave carry their corroborating
// approval + provider-issued tracking record here instead. Same strictness.
const wireInApprovals = await readJson("data/affiliate-wire-in-approvals.json");
assert.equal(wireInApprovals.schema, "glp-affiliate-wire-in-approvals-v1");
const reassessment = wireInApprovals.current_terms_reassessment;
// 2026-08-13: the rejected-terms program (126727 Measured) is de-linked on
// EVERY surface; only accepted/undecided programs preserve existing live links.
assert.equal(reassessment.governance_scope, "accepted_live_preserved_rejected_terms_rescinded_20260831");
assert.equal(reassessment.evidence_sha256, "7eb6660110af1b7f64149036217723c1095398b9d2016dfb7da32135dfc6ae73");
assert.equal(reassessment.programs.length, 6);
const currentTermsById = new Map(reassessment.programs.map((item) => [String(item.provider_program_id), item]));
// MEASURED_TERMS_RESCISSION_V1: 126727 joined the accepted set on 2026-08-31.
assert.deepEqual([...currentTermsById.values()].filter((item) => item.verdict === "operator_accepted_terms")
  .map((item) => item.provider_program_id).sort(), ["115383", "126727", "80963"]);
// No program is held on rejected terms any more. Pinned to EMPTY, not deleted:
// a new rejection must come back through this assertion to be noticed.
assert.deepEqual([...currentTermsById.values()].filter((item) => item.verdict === "operator_rejected_terms")
  .map((item) => item.provider_program_id).sort(), []);
const expectedExistingSurfaces = new Map([
  ["53271", ["compare", "cost", "quiz"]],
  ["80963", []],
  ["115383", ["compare", "cost", "quiz"]],
  ["126727", ["compare", "cost", "quiz"]],
  ["128203", ["compare", "cost", "quiz", "calculator"]],
  ["128761", ["compare", "cost", "quiz"]],
]);
const expectedExpansionSurfaces = new Map([
  ["53271", ["calculator"]], ["80963", []], ["115383", ["calculator"]],
  ["126727", []], ["128203", []], ["128761", ["calculator"]],
]);
for (const item of currentTermsById.values()) {
  const rejected = item.verdict === "operator_rejected_terms";
  const retiredBestTerms = item.provider_program_id === "80963";
  const disposition = rejected ? "de_link_all_surfaces_operator_rejected_terms"
    : retiredBestTerms ? "retired_best_terms_higher_payout" : "preserve_existing_live";
  assert.equal(item.live_link_disposition, disposition);
  if (rejected) {
    assert.deepEqual(item.existing_live_surfaces, []);
    assert.deepEqual(item.authorized_material_expansion_surfaces, []);
  }
  assert.equal(item.may_authorize_new_activation, false);
  assert.deepEqual(item.existing_live_surfaces, expectedExistingSurfaces.get(item.provider_program_id));
  assert.deepEqual(item.authorized_material_expansion_surfaces, expectedExpansionSurfaces.get(item.provider_program_id));
  assert.equal(item.may_authorize_material_expansion, expectedExpansionSurfaces.get(item.provider_program_id).length > 0);
}
for (const id of ["80963", "115383"]) {
  const item = currentTermsById.get(id);
  assert.equal(item.status, "operator_accepted_terms");
  assert.equal(item.operator_words, `ACCEPT-TERMS ${id}`);
  assert.equal(item.provenance, "discord-message-1537243566156546078");
  assert.equal(item.reversible_by, `REJECT-TERMS ${id}`);
  assert.match(item.decision_receipt_sha256, /^[a-f0-9]{64}$/);
}
// MEASURED_TERMS_RESCISSION_V1. The 2026-08-12 rejection was rescinded by the
// operator on 2026-08-31, and is superseded in policy by the 2026-08-14
// terms-review doctrine, under which the seven mechanical triggers are LOGGED
// RISK-ACCEPTANCES and never holds.
const measuredTerms = currentTermsById.get("126727");
assert.equal(measuredTerms.status, "operator_accepted_terms");
assert.equal(measuredTerms.verdict, "operator_accepted_terms");
assert.equal(measuredTerms.hold_trigger, null);
assert.equal(measuredTerms.hold_reason, null);
assert.equal(measuredTerms.provenance, "operator-decision-supersession-20260831");
assert.match(measuredTerms.decision_receipt_sha256, /^[a-f0-9]{64}$/);
assert.ok(measuredTerms.risk_acceptance, "rescinded terms must carry a risk-acceptance record");
assert.equal(measuredTerms.risk_acceptance.risk_accepted, true);
assert.equal(measuredTerms.risk_acceptance.mechanical_trigger, "advertiser_supplied_copy_indemnity");
assert.equal(measuredTerms.risk_acceptance.trigger_class, "participation_provider_product_liability_indemnity");
assert.ok(String(measuredTerms.risk_acceptance.operator_words || "").length > 20);
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(measuredTerms.risk_acceptance.accepted_on || "")));
const logoManifest = await readJson("assets/provider-logos/manifest.json");
const sitemap = await readText("public/sitemap.xml");
const calculator = await readText("public/tools/glp-1-cost-calculator/index.html");
const siteCss = await readText("public/assets/site.css");

assert.equal(contracts.schema, "glp-provider-fastpath-contracts-v1");
assert.equal(fastpath.schema, "glp-provider-fastpath-integration-v1");
assert.equal(sha256(await read("data/provider-page-contracts.json")), fastpath.current_contract_sha256);
assert.equal(contracts.providers.length, 43);
assert.equal(fastpath.providers.length, 43);
assert.equal(logoManifest.count, 57);
assert.equal(logoManifest.runtime_remote_assets, 0);
assert.equal(programRegistry.schema, "site-program-registry-v1");
// D2w: all 43 editorial contracts remain; only receipted Telos is now held.
// Exact identity sets reject both accidental removals and a Telos reactivation.
const fastpathRegistryPrograms = programRegistry.programs.filter((item) => item.source_kind === "fastpath");
assert.deepEqual(fastpathRegistryPrograms.map((item) => item.program_id).sort(), fastpath.providers.map((item) => item.program_id).sort());
assert.deepEqual(fastpathRegistryPrograms.filter((item) => item.commercial_state !== "live").map((item) => item.program_id).sort(), ["telos-rx"]);
assert.deepEqual(fastpathRegistryPrograms.filter((item) => item.commercial_state === "live").map((item) => item.program_id).sort(), fastpath.providers.map((item) => item.program_id).filter((id) => id !== "telos-rx").sort());

const routes = [];
let activeAffiliateCtas = 0;
for (const provider of fastpath.providers) {
  const contract = contracts.providers.find((item) => item.program_id === provider.program_id);
  const logo = logoManifest.logos.find((item) => item.program_id === provider.program_id);
  assert.ok(contract, `contract:${provider.program_id}`);
  assert.ok(logo, `logo:${provider.program_id}`);
  const logoBytes = await read(`assets/provider-logos/${logo.output_file}`);
  const publicLogoBytes = await read(`public${logo.public_path}`);
  assert.equal(sha256(logoBytes), provider.logo.sha256);
  assert.equal(sha256(publicLogoBytes), provider.logo.sha256);
  const route = contract.review_path;
  const html = await readText(`public${route}index.html`);
  assert.match(html, /data-release="release-ready"/);
  const liveProgram = programRegistry.programs.find((item) => item.program_id === provider.program_id && item.source_kind === "fastpath" && item.commercial_state === "live" && item.profiles?.["glp-clinic-scout"]?.wired === true);
  const commerciallyActive = liveProgram
    && liveProgram.go.entry_state === "transparent_direct"
    && liveProgram.profiles["glp-clinic-scout"].surfaces.go === true
    && provider.route_state === "LIVE_EDITORIAL_AFFILIATE_ACTIVE"
    && provider.affiliate_cta_state === "ACTIVE_PROVIDER_ISSUED_DIRECT"
    && contract.network_contract.activation_blocker === null
    && contract.row_contract.live_link_allowed === true
    && contract.row_contract.promotion_authorized === true
    && promotionAuthority[provider.program_id]?.status === "VERIFIED"
    && promotionAuthority[provider.program_id]?.promotion_authorized === true;
  const selected = currentSelection?.programs?.[provider.program_id];
  if (promotionAuthority[provider.program_id]?.status === 'WITHHELD') {
    // Current denial outranks the immutable historical selection receipt.
    assert.equal(promotionAuthority[provider.program_id].promotion_authorized, false);
    assert.match(html, /data-link-dark="true"/);
    assert.match(html, /data-affiliate-state="held"/);
    assert.doesNotMatch(html, /data-affiliate-state="active"|href="\/go\/|data-analytics-event="affiliate_click"|rel="sponsored/);
    const entry = GO_RUNTIME_MANIFEST.programs[selected?.render_id || provider.program_id];
    if (entry) {
      assert.equal(entry.live_link_allowed, false);
      assert.equal(entry.promotion_authorized, false);
      assert.equal(entry.tracking, undefined);
    }
  } else if (selected?.status === 'VERIFIED') {
    const entry = GO_RUNTIME_MANIFEST.programs[selected.render_id];
    assert.equal(entry?.status, 'live_operator_approved');
    assert.equal(entry.link_mode, 'server_redirect');
    assert.equal(entry.operator_selection_receipt_sha256, currentSelection.selection_sha256);
    assert.equal(entry.tracking.base_url, selected.issued_link);
    assert.equal((html.match(/data-affiliate-state="active"/g) || []).length, 1);
    assert.equal((html.match(/data-link-mode="server-redirect"/g) || []).length, 1);
    assert.ok(html.includes(`href="${selected.route}?s=reviews.rv2&amp;v=a"`), `selected-review-route:${provider.program_id}`);
    assert.ok(html.indexOf("This page contains one active affiliate link") < html.indexOf('data-affiliate-state="active"'));
    activeAffiliateCtas += 1;
  } else if (selected?.disposition === 'HOLD'
      && promotionAuthority[provider.program_id]?.reason !== 'operator_approved_glp_live') {
    assert.match(html, /data-link-dark="true"/);
    assert.match(html, /data-affiliate-state="held"/);
    assert.doesNotMatch(html, /data-affiliate-state="active"|href="\/go\//);
  } else if (commerciallyActive) {
    const approvedProgram = approvedRegistry.programs.find((item) => item.existing_release_alias === provider.program_id)
      || wireInApprovals.programs.find((item) => item.existing_release_alias === provider.program_id);
    assert.ok(approvedProgram, `approved-program:${provider.program_id}`);
    assert.equal(String(approvedProgram.provider_program_id), String(contract.network_contract.provider_offer_id || contract.network_contract.immutable_offer_id || contract.network_contract.immutable_advertiser_id || contract.network_contract.advertiser_id));
    assert.equal(contract.network_contract.tracking_url, approvedProgram.tracking.provider_issued_url);
    assert.equal(liveProgram.go.entry_state, "transparent_direct");
    assert.match(html, /data-link-dark="false"/);
    assert.equal((html.match(/data-affiliate-state="active"/g) || []).length, 1);
    assert.equal((html.match(/data-link-mode="transparent-direct"/g) || []).length, 1);
    assert.equal((html.match(new RegExp(`data-program="${provider.program_id}"`, "g")) || []).length, 1);
    assert.equal((html.match(/data-subid="[a-z0-9-]+"/g) || []).length, 1);
    assert.ok(html.indexOf("This page contains one active affiliate link") < html.indexOf('data-affiliate-state="active"'));
    assert.doesNotMatch(html, /href="\/go\//);
    activeAffiliateCtas += 1;
  } else if (liveProgram?.profiles?.["glp-clinic-scout"]?.surfaces?.go === true
      && liveProgram.go.entry_state === "instrumented_redirect_candidate"
      && promotionAuthority[provider.program_id]?.promotion_authorized === true) {
    // FORM 1 - governed /go promotion. RULING 2026-09-03: a route is active
    // only under a verified promotion authority, and then the page must carry
    // the queried anchor the cs_click_id join needs.
    assert.equal(liveProgram.go.entry_state, "instrumented_redirect_candidate");
    assert.match(String(liveProgram.go.route || ""), /^\/go\/[a-z0-9-]+$/);
    assert.ok((await readText("functions/go/program-manifest.js")).includes(liveProgram.go.route),
      `go-route-unresolvable:${provider.program_id}`);
    assert.match(html, /href="\/go\/[a-z0-9-]+\?s=[a-z0-9-]+\.[a-z0-9]+&amp;v=[a-z0-9]{1,4}"/);
    assert.doesNotMatch(html, /href="\/go\/[a-z0-9-]+"/);
    assert.equal((html.match(/data-affiliate-state="active"/g) || []).length, 1);
    activeAffiliateCtas += 1;
  } else if (provider.route_state === "LIVE_EDITORIAL_AFFILIATE_ACTIVE") {
    assert.ok(liveProgram, `live-registry-row-missing:${provider.program_id}`);
    assert.ok(["held", "transparent_direct"].includes(String((liveProgram.go || {}).entry_state || "")),
      `non_go_entry_state_required:${provider.program_id}`);
    assert.doesNotMatch(html, /href="\/go\//);
    if (promotionAuthority[provider.program_id]?.status === "VERIFIED"
        && promotionAuthority[provider.program_id]?.promotion_authorized === true) {
      assert.equal((html.match(/data-link-mode="transparent-direct"/g) || []).length, 1);
      assert.equal((html.match(/data-affiliate-state="active"/g) || []).length, 1);
      activeAffiliateCtas += 1;
    } else {
      // A live editorial contract is not itself a sealed promotion row.
      assert.ok(html.includes('data-link-dark="true"') && html.includes('data-affiliate-state="held"'),
        `sealed_promotion_hold_missing:${provider.program_id}`);
      assert.ok(!/data-link-mode="transparent-direct"|data-affiliate-state="active"|data-analytics-event="affiliate_click"|rel="sponsored/.test(html),
        `unauthorized_review_anchor:${provider.program_id}`);
    }
  } else {
    // held-by-default, unchanged: no governed promotion authority and not live.
    assert.equal(provider.route_state, "READY_EDITORIAL_LINK_DARK");
    assert.match(provider.affiliate_cta_state, /^HOLD_/);
    assert.match(html, /data-link-dark="true"/);
    assert.match(html, /data-affiliate-state="held"/);
    assert.doesNotMatch(html, /data-link-mode="transparent-direct"|href="\/go\/|track\.revoffers\.com|www\.awin1\.com/);
  }
  // 2026-08-06 cluster 1: this used to assert the OPPOSITE - that every fast-path
  // review says "Pending evidence". It froze the defect in place: the same build
  // ranked these providers on the comparison table off derived criteria while
  // their own review pages told the reader no score existed. The page must now
  // bind that score, or name and explain an unscored state; never a placeholder.
  assert.match(html, /class="score(?:[^"]*)"[^>]*>(?:(?!<\/p>)[\s\S])*?(?:\d{1,2}(?:\.\d)?<span>\/10<\/span>|\d{1,2}(?:\.\d)?\/10|Not scored)/);
  assert.doesNotMatch(html, /Score pending|Pending evidence|pending score/i);
  assert.match(html, /class="score-basis"/);
  // Bounded: an unbounded "0/10" also matches the "10.0/10" a criterion scoring
  // 100 now legitimately renders. The rule is "never show a ZERO score".
  assert.doesNotMatch(html, /(?<![\d.])0(?:\.0)?\/10/);
  assert.match(html, /class="citation fastpath-citation"/);
  assert.ok(html.toLowerCase().includes(`current as of ${provider.checked_as_of || fastpath.checked_as_of}`), `current-date:${provider.program_id}`);
  assert.ok(sitemap.includes(`https://glpclinicscout.com${route}`), route);
  routes.push(route);
}

const strut = await readText("public/reviews/strut-health/index.html");
assert.ok(strut.indexOf("regulatory-warning") < strut.indexOf('data-affiliate-state="active"'));
assert.match(strut, /warning-letters\/strut-health-llc-dba-strut-721448-02202026/);
assert.match(siteCss, /\.regulatory-warning\s*\{/);
assert.match(siteCss, /\.regulatory-warning \.gcs-kicker\s*\{/);
assert.match(siteCss, /\.affiliate-status\s*\{/);
assert.match(siteCss, /\.fastpath-citation a\s*\{/);
assert.doesNotMatch(siteCss, /(^|\n)\.citation a\s*\{/);
// Target-route hold assertion retired: generic data-driven state validation above remains authoritative.
//
// 2026-08-18 content-fit LIFT (BRIDGE-20260818-AFF-TRT-001-CONTENT-FIT-LIFT).
// This block used to assert TRT Nation was link-dark. The thing that assertion
// really protected was never "no link" - it was "never the TESTOSTERONE link on a
// page that reviews the weight-loss program". That protection is kept verbatim
// below and made stricter: the page must now carry the verified weight-loss deep
// link and nothing else.
const trt = await readText("public/reviews/trt-nation/index.html");
assert.match(trt, /data-link-dark="false"/);
assert.match(trt, /data-affiliate-state="active"/);
const trtSelected = currentSelection?.programs?.['trt-nation']?.status === 'VERIFIED';
const trtDestination = trtSelected ? GO_RUNTIME_MANIFEST.programs['trt-nation'].tracking.base_url : trt;
assert.match(trtDestination, /www\.tkqlhce\.com\/click-101822575-17115008/);
assert.match(trtDestination, /trtnation\.com(%2F|\/)weight-loss-therapy/);
// The superseded creative, its click host, and any testosterone destination stay
// banned on this page forever. This is the original incident invariant.
assert.doesNotMatch(trt, /dpbolvw|17100444|testosterone-replacement-therapy/);
assert.doesNotMatch(trtDestination, /dpbolvw|17100444|testosterone-replacement-therapy/);
if (trtSelected) assert.match(trt, /href="\/go\/trt-nation\?s=reviews\.rv2&amp;v=a"/);
else assert.doesNotMatch(trt, /href="\/go\/trt-nation/);

// Synergy RX's comparison rows were fail-closed to safe display copy because its
// page published product prices with no cadence or supply period. 2026-08-17:
// Katalys paused the program, the registry row and its rows were removed, and the
// contract block went with them. Assert they are consistent in BOTH directions -
// present together, or absent together - so this never silently half-applies.
const synergyRows = money.pages.flatMap((page) => page.rows).filter((row) => row.program_id === "synergy-rx");
assert.equal(synergyRows.length > 0, Boolean(fastpath.synergy_rx), "synergy_contract_row_desync");
for (const row of synergyRows) {
  assert.equal(row.starting_price, fastpath.synergy_rx.safe_display_copy);
  assert.equal(row.starting_price_sort, null);
  assert.equal(row.source_url, fastpath.synergy_rx.source_url);
}
// 2026-08-06 coverage repair (G6): the dropdown is gated by the registry's
// calculator surface, not by "fast-path implies no row". strut-health and biltrx
// publish a single comparable monthly figure and are now included; every other
// fast-path program and synergy-rx stay out behind a written registry exception.
const registryCalculatorIds = new Set(programRegistry.programs
  .filter((program) => program.profiles?.["glp-clinic-scout"]?.surfaces?.calculator === true)
  .map((program) => program.program_id));
const calculatorHeldIds = [...(fastpath.synergy_rx ? ["synergy-rx"] : []), ...fastpath.providers.map((provider) => provider.program_id)]
  .filter((programId) => !registryCalculatorIds.has(programId));
for (const programId of calculatorHeldIds) assert.doesNotMatch(calculator, new RegExp(`<option value="${programId}"`));
// Commercial calculator eligibility does not attest a cash schedule.
const currentPricing = await readJson('data/provider-pricing-matrix.json');
const {isComparableCashRow}=await import('../src/price-state.mjs');
for (const programId of ["strut-health", "biltrx"]) {
  assert.ok(registryCalculatorIds.has(programId), `calculator_inclusion_missing:${programId}`);
  const entry=currentPricing.providers[programId];
  if (entry.medications.some(isComparableCashRow)) assert.match(calculator, new RegExp(`<option value="${programId}"`));
  else {
    assert.ok(entry.medications.length || (entry.unavailable_reason && ['not_published','not_attested'].includes(entry.pricing_state)));
    assert.doesNotMatch(calculator,new RegExp(`<option value="${programId}"`));
  }
}
// Every surface a live program does NOT claim must carry a written reason.
for (const program of programRegistry.programs) {
  const profile = program.profiles?.["glp-clinic-scout"];
  if (!profile || program.commercial_state !== "live" || profile.wired !== true) continue;
  for (const [surface, claimed] of Object.entries(profile.surfaces || {})) {
    if (claimed) continue;
    const exception = profile.exceptions?.[surface];
    assert.ok(exception?.enabled === true && String(exception.reason || "").trim().length > 40,
      `surface_off_without_written_reason:${program.program_id}:${surface}`);
  }
}

console.log(JSON.stringify({
  status: "PASS",
  source_contract_sha256: fastpath.source_contract_sha256,
  built_editorial_routes: routes,
  active_affiliate_ctas: activeAffiliateCtas,
  affiliate_ctas_held: fastpath.providers.length - activeAffiliateCtas,
  calculator_rows_held: calculatorHeldIds.length,
  calculator_rows_included_from_fastpath: ["strut-health", "biltrx"],
  synergy_decision: fastpath.synergy_rx?.decision ?? "REMOVED_NETWORK_PAUSED_20260817",
  logo_assets: logoManifest.count,
  provider_deploy_attempts: 0,
  provider_account_mutations: 0,
}));
