import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderMoneyPage } from "../src/money-page.mjs";
import { buildProviderReviewSpecs, renderProviderReviewPage } from "../src/provider-review.mjs";
import { handleGoRequest } from "../src/worker.mjs";
import { loadGoSelection } from "../src/go-runtime-selection.mjs";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const identity = await readJson("../data/identity-registry.json");
const selection = await readJson("../data/affiliate-activation-selection.json");
const money = await readJson("../data/money-page-specs.json");
const providerPages = await readJson("../data/provider-page-contracts.json");
const providerFastpath = await readJson("../data/provider-fastpath-contract.json");
const registry = await readJson("../data/program-registry.json");
const selectedIds = new Set(selection.programs.map((item) => item.program_id));
const goSelection = loadGoSelection();
const selectedGo = new Map(Object.values(goSelection.programs).map((row) => [row.render_id, row]));
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
// anchor. The set that must render one is every live provider whose row carries a
// network-hosted tracking link.
const NETWORK_HOSTS = /^https:\/\/(?:track\.revoffers\.com|www\.awin1\.com)/;
const networkAnchorIds = new Set(money.pages.flatMap((page) => (page.rows || [])
  .filter((row) => row.promotion_authorized && NETWORK_HOSTS.test(row.affiliate_href || ""))
  .map((row) => row.program_id)));

// 2026-08-17: Katalys paused Synergy Rx (1520) and Care Bare Rx GLP1 (1519), so
// the Sheet-derived selection went 13 -> 11. The count is asserted against the
// list it describes, and the two paused ids must be gone from both.
const PAUSED_20260817 = ["synergy-rx", "care-bare-rx-glp1"];
test("Sheet-derived selection has eleven unique transparent-direct programs and zero go routes", () => {
  assert.equal(selection.program_count, 11);
  assert.equal(selection.programs.length, selection.program_count);
  for (const paused of PAUSED_20260817) assert.equal(selectedIds.has(paused), false, paused);
  assert.equal(selectedIds.size, selection.program_count);
  assert.equal(selection.go_route_program_count, 0);
  assert.ok(selection.programs.every((item) => item.link_mode === "transparent_direct" && ["track.revoffers.com", "www.awin1.com"].includes(item.tracking_host)));
});

test("money programs render direct anchors or exact selected go routes", () => {
  const seen = new Set();
  for (const page of money.pages) {
    const html = renderMoneyPage(page, identity);
    for (const match of html.matchAll(/<a[^>]+href="(\/go\/[^"?]+)[^"]*"[^>]+data-program="([a-z0-9-]+)"/g)) {
      const selected = selectedGo.get(match[2]);
      assert.equal(selected?.status, "VERIFIED", match[2]);
      assert.equal(match[1], selected.route);
      if (networkAnchorIds.has(match[2])) seen.add(match[2]);
    }
    for (const match of html.matchAll(/<a[^>]+href="(https:\/\/(?:track\.revoffers\.com|www\.awin1\.com)[^"]+)"[^>]+data-program="([a-z0-9-]+)"/g)) seen.add(match[2]);
  }
  assert.deepEqual(seen, networkAnchorIds);
  for (const id of selectedIds) assert.ok(seen.has(id), `sheet-selected program lost its anchor: ${id}`);
});

test("generated provider reviews use selected go routes, direct anchors, or explicit holds", () => {
  const reviews = buildProviderReviewSpecs(money.pages, providerPages, providerFastpath, registry, "glp-clinic-scout");
  assert.equal(reviews.length, providerFastpath.expected_provider_review_count);
  for (const review of reviews.filter((item) => !item.fastpath_contract)) {
    const html = renderProviderReviewPage(review, identity);
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
