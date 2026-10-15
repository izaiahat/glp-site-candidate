import assert from "node:assert/strict";
import test from "node:test";
import { historicalAgelessPromotion } from './fixtures/historical-ageless-promotion.mjs';
import { assertPausedTrimiReview } from './helpers/current-review-holds.mjs';
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderMoneyPage } from "../src/money-page.mjs";
import { buildProviderReviewSpecs, renderProviderReviewPage } from "../src/provider-review.mjs";
import { handleGoRequest } from "../src/worker.mjs";
import { loadGoSelection, loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";
import { loadAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const identity = await readJson("../data/identity-registry.json");
const selection = await readJson("../data/affiliate-activation-selection.json");
const money = await readJson("../data/money-page-specs.json");
const providerPages = await readJson("../data/provider-page-contracts.json");
const providerFastpath = await readJson("../data/provider-fastpath-contract.json");
const registry = await readJson("../data/program-registry.json");
const approved = await readJson("../data/approved-program-registry.json");
const wireApprovals = await readJson("../data/affiliate-wire-in-approvals.json");
const privateRoot = process.env.GLP_PRIVATE_EVIDENCE_ROOT;
assert.ok(privateRoot && path.isAbsolute(privateRoot), "GLP_PRIVATE_EVIDENCE_ROOT must be an absolute path for affiliate expansion approval");
const evidenceRoot = pathToFileURL(path.resolve(privateRoot) + path.sep);
const operatorDecision = await readFile(new URL("ops/linear/approvals/OPERATOR-DECISION-20260924-all-approved-providers-live.md", evidenceRoot), "utf8");
const selectedIds = new Set(selection.programs.map((item) => item.program_id));
const goSelection = loadGoSelection();
const selectedGo = new Map(Object.values(goSelection.programs).map((row) => [row.render_id, row]));
const promotion = loadGoPromotionAuthority().programs;
function assertSelectedReview(html, review) {
  const selected = selectedGo.get(review.program_id);
  assert.equal(selected.status, "VERIFIED");
  assert.equal(GO_RUNTIME_MANIFEST.programs[selected.render_id].tracking.base_url, selected.issued_link);
  assert.ok(html.includes(`href="${selected.route}?s=reviews.rv2&amp;v=a"`));
  assert.match(html, /data-link-mode="server-redirect"/);
  assert.match(html, /data-subid="reviews.rv2"/);
}
// 2026-08-06 surface unification: the Sheet selection is one wire-in authority
// among three, so it is no longer the set of programs that render an affiliate
// anchor. Approved GLP-1 offers now render even when an internal promotion row
// was historically missing; only network-unapproved/paused offers remain dark.
const NETWORK_HOSTS = /^https:\/\/(?:track\.revoffers\.com|www\.awin1\.com)/;
const shedAlias = registry.programs.find((item) => item.program_id === "katalys-1516");
const shedCanonicalId = shedAlias.profiles["glp-clinic-scout"].canonical_identity.canonical_program_id;
const isApprovedShedOffer = (row) => [shedAlias.review_slug, shedCanonicalId].includes(row.program_id)
  && row.affiliate_href && new URL(row.affiliate_href).searchParams.get("offer_id") === "1516";
const promotionId = (id) => registry.programs.find((item) => item.review_slug === id)?.program_id || id;
const PAUSED_AGELESS = "try-ageless";
function assertPausedAgeless() {
  assert.ok(!selectedIds.has(PAUSED_AGELESS), 'paused offer is removed from current activation');
  const selected = selection.excluded_selection_evidence.find((item) => item.program_id === PAUSED_AGELESS);
  assert.equal(selected?.disposition, 'historical_snapshot_only_not_activation_authority');
  assert.equal(selected?.network, "Katalys");
  assert.equal(selected.network_program_id, "1538");
  assert.equal(promotion[PAUSED_AGELESS]?.status, "WITHHELD");
  // The original pause reason is historical; current denial retains writer provenance.
  assert.equal(historicalAgelessPromotion().reason, "network_paused_katalys_offer_1538");
  assert.equal(promotion[PAUSED_AGELESS]?.reason, "sole_writer_relationship_paused");
  assert.equal(promotion[PAUSED_AGELESS]?.promotion_authorized, false);
  assert.deepEqual(promotion[PAUSED_AGELESS]?.relationship_snapshot, {program_id: "try-ageless", render_id: "try-ageless", ...registry.programs.find(row => row.program_id === "try-ageless").affiliate_relationship_snapshot});
}
const networkAnchorIds = new Set(money.pages.flatMap((page) => (page.rows || [])
  .filter((row) => row.promotion_authorized && NETWORK_HOSTS.test(row.affiliate_href || ""))
  .map((row) => row.program_id)));
const authorizedNetworkAnchorIds = new Set([...networkAnchorIds].filter((id) =>
  promotion[promotionId(id)]?.status === "VERIFIED" && promotion[promotionId(id)]?.promotion_authorized === true));

// 2026-08-17: Katalys paused Synergy Rx (1520) and Care Bare Rx GLP1 (1519), so
// the Sheet-derived selection went 13 -> 11. The count is asserted against the
// list it describes, and the two paused ids must be gone from both.
const PAUSED_20260817 = ["synergy-rx", "care-bare-rx-glp1"];
test("Sheet-derived selection excludes paused offer 1538 and has ten unique transparent-direct programs", () => {
  assertPausedAgeless();
  assert.equal(selection.program_count, 10);
  assert.equal(selection.programs.length, selection.program_count);
  for (const paused of PAUSED_20260817) assert.equal(selectedIds.has(paused), false, paused);
  assert.equal(selectedIds.size, selection.program_count);
  assert.equal(selection.go_route_program_count, 0);
  assert.ok(selection.programs.every((item) => item.link_mode === "transparent_direct" && ["track.revoffers.com", "www.awin1.com"].includes(item.tracking_host)));
});

test("approved GLP-1 Shed offer remains live under the 2026-09-24 operator decision", () => {
  assert.match(operatorDecision, /trt nation and shed are both approved to deploy if they do glp-1s/i);
  const listing = approved.programs.find((item) => item.registry_id === "katalys-1516");
  assert.equal(listing.network, "Katalys");
  assert.ok(listing.source_refs.some((ref) => ref.includes("offerId=1516;relationship=Approved")));
  assert.equal(listing.canonical_vertical, "glp1-weightloss");
  assert.ok(money.pages.flatMap((page) => page.rows || []).some((row) => row.program_id === "shed"
    && /compounded semaglutide and compounded tirzepatide/i.test(row.meds_offered)));
  assert.equal(promotion["katalys-1516"]?.status, "VERIFIED", "registered producer must issue offer-specific authority");
  assert.equal(promotion["katalys-1516"]?.promotion_authorized, true);
  for (const surface of ["compare", "calculator", "quiz", "review"]) {
    const map = loadAffiliateLinkMap(surface);
    assert.equal(map.shedrx?.live, true, `${surface}: approved canonical ShedRX must remain live`);
    assert.equal(new URL(map.shedrx.affiliate_href).searchParams.get("offer_id"), "1516");
  }
});

test("money programs render approved GLP-1 anchors and withhold network-unapproved rows", () => {
  assertPausedAgeless();
  assert.ok(networkAnchorIds.has(PAUSED_AGELESS), "paused offer must be exercised by the money-page fixture");
  assert.equal(authorizedNetworkAnchorIds.has(PAUSED_AGELESS), false);
  assert.equal(shedCanonicalId, "shedrx");
  assert.equal(shedAlias.review_slug, "shed");
  assert.equal(promotion["trt-nation"]?.status, "VERIFIED");
  const hankApproval = wireApprovals.programs.find((row) => row.existing_release_alias === 'mydrhank');
  assert.equal(hankApproval.approval_state, 'approved_active');
  assert.equal(String(hankApproval.provider_program_id), '1425');
  assert.equal(promotion.mydrhank?.status, "VERIFIED");
  const seen = new Set();
  const targetRows = new Set();
  for (const page of money.pages) {
    const html = renderMoneyPage(page, identity);
    for (const row of page.rows.filter((item) => ["trt-nation", "shed", "shedrx", "mydrhank"].includes(item.program_id))) {
      targetRows.add(row.program_id);
      if (["shed", "shedrx"].includes(row.program_id))
        assert.equal(isApprovedShedOffer(row), true, `${row.program_id}: offer 1516 stays bound to its own network destination`);
      const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0])
        .filter((anchor) => anchor.includes(`data-program="${row.program_id}"`));
      assert.ok(anchors.length > 0, `${page.path}: ${row.program_id} has no CTA`);
      assert.ok(anchors.some((anchor) => /\brel="[^"]*\bsponsored\b/.test(anchor)),
        `${page.path}: approved ${row.program_id} lost its sponsored anchor`);
    }
    for (const match of html.matchAll(/<a[^>]+href="(\/go\/[^"?]+)[^"]*"[^>]+data-program="([a-z0-9-]+)"/g)) {
      const selected = selectedGo.get(match[2]);
      assert.equal(selected?.status, "VERIFIED", match[2]);
      assert.equal(promotion[selected.program_id]?.status, "VERIFIED", match[2]);
      assert.equal(match[1], selected.route);
      if (authorizedNetworkAnchorIds.has(match[2])) seen.add(match[2]);
    }
    for (const match of html.matchAll(/<a[^>]+href="(https:\/\/(?:track\.revoffers\.com|www\.awin1\.com)[^"]+)"[^>]+data-program="([a-z0-9-]+)"/g)) {
      assert.equal(promotion[promotionId(match[2])]?.status, "VERIFIED", match[2]);
      seen.add(match[2]);
    }
  }
  assert.deepEqual(targetRows, new Set(["trt-nation", "shed", "shedrx", "mydrhank"]));
  assert.deepEqual(new Set([...networkAnchorIds].filter((id) => !authorizedNetworkAnchorIds.has(id))),
    new Set([PAUSED_AGELESS]), "only the exact network-paused offer may be link-dark");
  assert.deepEqual(seen, authorizedNetworkAnchorIds);
  for (const id of selectedIds) {
    if (id === PAUSED_AGELESS) assert.equal(seen.has(id), false, "paused offer must not have an anchor");
    else assert.ok(seen.has(id), `sheet-selected program lost its anchor: ${id}`);
  }
});

test("physical canonical Shed review ships approved offer 1516 sponsored anchor", async () => {
  const html = await readFile(new URL("../public/reviews/shedrx/index.html", import.meta.url), "utf8");
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0])
    .filter((anchor) => anchor.includes('data-program="shedrx"') && /\brel="[^"]*\bsponsored\b/.test(anchor));
  assert.ok(anchors.length > 0, "approved Shed offer has no physical sponsored CTA");
  assert.ok(anchors.some((anchor) => /offer_id=1516(?:&amp;|&|\b)/.test(anchor)),
    "approved Shed CTA must use offer 1516, not another identity");
});

test("generated provider reviews use selected go routes, direct anchors, or explicit holds", () => {
  const reviews = buildProviderReviewSpecs(money.pages, providerPages, providerFastpath, registry, "glp-clinic-scout");
  assert.equal(reviews.length, providerFastpath.expected_provider_review_count);
  assert.equal(reviews.filter(review => review.program_id === 'trimi-glp-1').length, 1);
  const trimi = reviews.find(review => review.program_id === 'trimi-glp-1');
  assert.equal(trimi.fastpath_contract, undefined, 'paused Trimi must not enter the active fastpath partition');
  for (const id of ["trt-nation", "shedrx", "mydrhank"]) {
    const review = reviews.find((item) => item.program_id === id);
    assert.ok(review, `${id}: editorial review exists`);
    const html = renderProviderReviewPage(review, identity);
    assert.match(html, /data-affiliate-state="active"/, `${id}: approved GLP-1 review must be live`);
    assert.match(html, /\brel="[^"]*\bsponsored\b/, `${id}: sponsored review anchor required`);
  }

  for (const review of reviews.filter((item) => !item.fastpath_contract)) {
    const html = renderProviderReviewPage(review, identity);
    if (review.program_id === PAUSED_AGELESS) {
      assertPausedAgeless();
      assert.match(html, /data-link-dark="true"/);
      assert.doesNotMatch(html, /data-link-mode="transparent-direct"|href="\/go\/try-ageless|data-affiliate-state="active"/);
      continue;
    }
    if (review.program_id === 'trimi-glp-1') {
      assertPausedTrimiReview({html, review, selection, registry, promotion});
      continue;
    }
    if (selectedGo.get(review.program_id)?.status === "VERIFIED") {
      assertSelectedReview(html, review);
      continue;
    }
    assert.match(html, /data-link-mode="transparent-direct"/);
    assert.match(html, new RegExp(`data-subid="review-${review.program_id}-conclusion-\\d{6}"`));
    assert.doesNotMatch(html, /href="\/go\//);
  }
  for (const review of reviews.filter((item) => item.fastpath_contract)) {
    const html = renderProviderReviewPage(review, identity);
    // measured joined the holds 2026-08-13: operator rejected Awin advertiser
    // 126727 terms, so its review is link-dark like the other explicit holds.
    if (html.includes('data-affiliate-state="held"')) {
      assert.match(html, /data-affiliate-state="held"/);
      assert.match(html, /data-link-dark="true"/);
      assert.doesNotMatch(html, /data-link-mode="transparent-direct"|href="\/go\/|dpbolvw|17100444/);
    } else {
      assert.match(html, /data-affiliate-state="active"/);
      if (selectedGo.get(review.program_id)?.status === "VERIFIED") assertSelectedReview(html, review);
      else {
        assert.match(html, /data-link-mode="transparent-direct"/);
        assert.doesNotMatch(html, /href="\/go\//);
      }
    }
  }
});

test("transparent-direct programs cannot be activated through Worker go route", async () => {
  const p = selection.programs[0];
  const manifest = { internal_fallback: "https://glpclinicscout.com/providers/oral-glp-1/", programs: [{ program_id: p.program_id, display_name: p.display_name, link_mode: "transparent_direct", go_route_wired: false, live_link_allowed: true, promotion_authorized: true, status: "live_operator_approved", operator_selection_receipt_sha256: selection.operator_gate_receipt_sha256, allowed_page_roles: ["best-online-glp1"], allowed_positions: ["hero"], allowed_variants: ["a"], official_fallback: "https://glpclinicscout.com/providers/oral-glp-1/", allowed_fallback_hosts: ["glpclinicscout.com"], constructor_verified: true, advertiser_permission_verified: true, encoding_verified: true, privacy_qa_passed: true, redirector_tos_verified: true, redirector_tos_source_url: "https://example.test/terms", redirector_tos_verified_as_of: "2026-07-25" }] };
  const response = await handleGoRequest(new Request(`https://x.test/go/${p.program_id}?s=best-online-glp1.hero&v=a`, { headers: { "user-agent": "Mozilla/5.0" } }), { PROGRAM_MANIFEST: manifest, AFFILIATE_RUNTIME_MODE: "production", AFFILIATE_LIVE_GATE: `operator-approved:${selection.operator_gate_receipt_sha256}`, GLP_DB: { prepare() { return {}; } } }, p.program_id);
  assert.equal(response.headers.get("x-redirect-reason"), "operator-or-tos-gate-held");
  assert.equal(response.headers.get("x-attribution-log"), "not-minted");
});
