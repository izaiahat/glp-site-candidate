import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { constructNetworkUrl } from "../src/network-constructors.mjs";
import { handleGoRequest, parseGoQuery } from "../src/worker.mjs";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";
import { loadGoSelection, loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";
import { redirectorTermsAllowed } from "../src/go-redirector-authority.mjs";
import { onRequest as onGoRequest } from "../functions/go/[program].js";

const ROOT = new URL("../", import.meta.url);
const CLICK_ID = "01995a42-0a1b-7abc-8def-0123456789ab";

function requireText(url) {
  return readFileSync(url, "utf8");
}

test("the editorial route bundle includes the complete Funnel V2 component layer", async () => {
  const { CSS_BUNDLE_LAYERS } = await import("../src/css-build-freshness.mjs");
  assert.ok(CSS_BUNDLE_LAYERS["site-editorial.css"].includes("47-funnel-v2.css"));
});

// S12 retired commercial EPC shortlists, not the complete source-backed results.
function assertCurrentResults(html, route) {
  // Existing card CTA data-funnel-v2-go attributes are attribution, not the retired module.
  assert.doesNotMatch(html, /data-funnel-v2(?:\s|>|=)|data-funnel-v2-(?:provider|empty|runtime)|data-economic-rank|\bEPC\b|earnings per outbound click|earning the most per measured outbound click/i, route);
  const results = html.match(/<section\b[^>]*data-three-column-results[^>]*>[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(results, /data-phase3-provider-grid/, route);
  assert.match(results, /data-filter-result/, route);
  assert.match(results, /data-filter-reset/, route);
  if (['mounjaro','wegovy-pill','ozempic','zepbound','3-month','6-month'].includes(route)) {
    assert.match(results, /(?:0 providers had a matching, source-dated price row|0 source-backed options)/, route);
    assert.match(results, /(?:No matching provider price is published in the bound data\.|No matching term is published in the bound capture\.)/, route);
    assert.doesNotMatch(results, /<article\b|\/go\//, route);
  } else {
    assert.match(results, /<article\b[^>]*\bp3-provider-card\b[^>]*data-program="[^"]+"/, route);
  }
  assert.match(html, /data-unpublished-provider-section/, route);
  assert.match(html, /Check the ordering method stated for each comparison\./, route);
  return results;
}

test("operator-mapped bulk routes retain full source-backed results without an EPC shortlist", () => {
  for (const route of ["3-month", "6-month"]) {
    const html = requireText(new URL(`../public/${route}/index.html`, import.meta.url));
    const results = assertCurrentResults(html, route);
    const programs = [...results.matchAll(/<article\b[^>]*data-program="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(programs, [], `${route}: S30 removed both unsupported bulk schedules; no offer may be recreated`);
  }
});

test("every phase-3 decision leaf exposes full results or an honest empty state without EPC ordering", () => {
  const routes = [
    "lp/best-providers/compounded-semaglutide",
    "lp/best-providers/compounded-tirzepatide",
    "wegovy-pill",
    "wegovy",
    "ozempic",
    "mounjaro",
    "zepbound",
    "3-month",
    "6-month",
  ];
  for (const route of routes) {
    const html = requireText(new URL(`../public/${route}/index.html`, import.meta.url));
    assertCurrentResults(html, route);
  }
});

test("/go parser accepts one UUIDv7 cs_click_id and rejects malformed or surplus attribution", () => {
  const parsed = parseGoQuery(new URL(`https://glpclinicscout.com/go/wellmedr-review?s=providers.fv2s1&v=a&cs_click_id=${CLICK_ID}`));
  assert.equal(parsed.csClickId, CLICK_ID);
  assert.equal(parsed.pageSlug, "providers");
  assert.equal(parsed.linkPosition, "fv2s1");
  assert.throws(() => parseGoQuery(new URL("https://glpclinicscout.com/go/wellmedr-review?s=providers.fv2s1&v=a&cs_click_id=bad")), /query_value_invalid/);
  assert.throws(() => parseGoQuery(new URL(`https://glpclinicscout.com/go/wellmedr-review?s=providers.fv2s1&v=a&cs_click_id=${CLICK_ID}&extra=x`)), /query_shape_invalid/);
});

test("network constructor accepts UUIDv7 as the owned click identity", () => {
  const url = new URL(constructNetworkUrl({
    network: "katalys",
    constructor_verified: true,
    advertiser_permission_verified: true,
    tracking: { base_url: "https://example.katalys.com/?offer_id=1&aff_id=2", allowed_tracking_hosts: ["example.katalys.com"], generated_link_readback_verified: true },
  }, CLICK_ID));
  assert.equal(url.searchParams.get("sub1"), CLICK_ID);

  const affiliati = new URL(constructNetworkUrl({
    network: "affiliati",
    network_offer_id: "42896",
    constructor_verified: true,
    advertiser_permission_verified: true,
    tracking: { base_url: "https://example.affiliati.test/?offer_id=42896&aff_id=15309", allowed_tracking_hosts: ["example.affiliati.test"], generated_link_readback_verified: true },
  }, CLICK_ID, "providers.pc1"));
  // AFFILIATI_S1_S2_CONTRACT_V1: s1 is the PLACEMENT subid, s2 is the click
  // id. They are asserted to DIFFER, because setting both to the click id
  // is exactly the defect this contract fixed.
  assert.equal(affiliati.searchParams.get("s1"), "providers.pc1");
  assert.equal(affiliati.searchParams.get("s2"), CLICK_ID);
  assert.notEqual(affiliati.searchParams.get("s1"), affiliati.searchParams.get("s2"));
  assert.throws(() => constructNetworkUrl({
    network: "affiliati",
    network_offer_id: "42896",
    constructor_verified: true,
    advertiser_permission_verified: true,
    tracking: { base_url: "https://example.affiliati.test/?offer_id=42896&aff_id=15309", allowed_tracking_hosts: ["example.affiliati.test"], generated_link_readback_verified: true },
  }, "c1-0123456789abcdef01234567", "providers.pc1"), /affiliati_uuidv7_required/);
});

test("/go resolves a reader-facing route slug and persists its canonical program identity", async () => {
  const binds = [];
  const receipt = "a".repeat(64);
  const program = {
    program_id: "katalys-1286",
    route_slug: "sprout-health",
    status: "live_operator_approved",
    link_mode: "server_redirect",
    go_route_wired: true,
    live_link_allowed: true,
    promotion_authorized: true,
    operator_selection_receipt_sha256: receipt,
    allowed_page_roles: ["providers"],
    allowed_positions: ["fv2s1"],
    allowed_variants: ["a"],
    constructor_verified: true,
    advertiser_permission_verified: true,
    encoding_verified: true,
    privacy_qa_passed: true,
    redirector_tos_verified: true,
    redirector_tos_source_url: "https://example.com/terms",
    redirector_tos_verified_as_of: "2026-08-29",
    official_fallback: "https://wellmedr.com/",
    allowed_fallback_hosts: ["wellmedr.com"],
    network: "katalys",
    tracking: { base_url: "https://example.katalys.com/?offer_id=1&aff_id=2", allowed_tracking_hosts: ["example.katalys.com"], generated_link_readback_verified: true },
  };
  const env = {
    AFFILIATE_RUNTIME_MODE: "production",
    AFFILIATE_LIVE_GATE: `operator-approved:${receipt}`,
    PROGRAM_MANIFEST: { internal_fallback: "https://glpclinicscout.com/providers/", programs: [program] },
    CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) },
    GLP_DB: { prepare: () => ({ bind: (...values) => { binds.push(values); return { run: async () => ({ success: true }) }; } }) },
  };
  const request = new Request(`https://glpclinicscout.com/go/sprout-health?s=providers.fv2s1&v=a&cs_click_id=${CLICK_ID}`, {
    headers: { "user-agent": "Mozilla/5.0", referer: "https://glpclinicscout.com/providers/" },
  });
  const response = await handleGoRequest(request, env, "sprout-health");
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("x-attribution-log"), "mapped");
  const destination = new URL(response.headers.get("location"));
  assert.equal(destination.searchParams.get("sub1"), CLICK_ID);
  assert.equal(binds[0][0], CLICK_ID);
  assert.equal(binds[0][1], CLICK_ID);
  assert.equal(binds[0][4], "katalys-1286");
  assert.equal(binds[0][6], "katalys");
  assert.equal(binds[0][7], "1");
});

test("every go manifest entry is governed active or explicitly held", () => {
  const candidates = Object.values(GO_RUNTIME_MANIFEST.programs);
  assert.ok(candidates.length >= 32);
  const selection = loadGoSelection();
  const promotions = loadGoPromotionAuthority().programs;
  const adopted = Object.values(selection.programs).filter((row) => row.status === "VERIFIED");
  assert.equal(adopted.length, 17);
  assert.equal(adopted.filter((row) => ["held8", "supersession4", "affiliati_mint2"].includes(row.group)).length, 12);
  assert.deepEqual(Object.values(selection.programs).filter((row) => row.status === "WITHHELD").map((row) => row.program_id).sort(), ["longevity-meds-glp-1-review", "nu-image-medical-review"]);
  assert.equal(selection.programs["longevity-meds-glp-1-review"].network_offer_id, "3277");
  assert.deepEqual(adopted.filter((row) => row.group === "supersession4").map((row) => row.program_id).sort(), ["awin-128761", "katalys-1286", "katalys-1304", "katalys-647"]);
  assert.deepEqual(candidates.filter((row) => row.live_link_allowed === true).map((row) => row.program_id).sort(), adopted.map((row) => row.program_id).sort());
  for (const program of candidates) {
    const selected = selection.programs[program.program_id];
    if (selected?.status === "WITHHELD") {
      assert.equal(promotions[program.program_id].status, "WITHHELD");
      assert.equal(program.live_link_allowed, false);
      assert.equal(program.tracking, undefined);
      continue;
    }
    if (selected?.status === "VERIFIED") {
      assert.equal(program.link_mode, "server_redirect");
      assert.equal(program.tracking.base_url, selected.issued_link);
      assert.equal(program.operator_selection_receipt_sha256, selection.selection_sha256);
      for (const key of ["live_link_allowed", "promotion_authorized", "constructor_verified", "advertiser_permission_verified", "encoding_verified", "privacy_qa_passed"]) assert.equal(program[key], true, `${program.program_id}:${key}`);
      assert.equal(redirectorTermsAllowed(program), true);
    } else {
      assert.equal(program.link_mode, "instrumented_redirect_candidate");
      assert.equal(program.live_link_allowed, false);
      assert.equal(program.promotion_authorized, false);
      assert.ok(String(program.candidate_gate || "").length > 5);
    }
    assert.equal(program.go_route_wired, true);
    assert.ok(program.allowed_page_roles.includes("providers") && program.allowed_positions.includes("fv2s1") && program.allowed_positions.includes("pc1"));
  }
});

test("Direct Meds review go pointer uses the exact selected Affiliati destination and s1/s2 contract", async () => {
  const html = requireText(new URL("../public/reviews/direct-meds/index.html", import.meta.url));
  assert.match(html, /href="\/go\/direct-meds\?s=reviews.rv2&amp;v=a"/);
  const program = GO_RUNTIME_MANIFEST.programs["direct-meds"];
  assert.equal(program.program_id, "katalys-1304");
  assert.equal(program.tracking.base_url, "https://epsilonmkt.com/?a=15309&c=169817");
  const binds = [];
  const response = await onGoRequest({ request: new Request(`https://glpclinicscout.com/go/direct-meds?s=reviews.rv2&v=a&cs_click_id=${CLICK_ID}`, {
    headers: { "user-agent": "Mozilla/5.0", referer: "https://glpclinicscout.com/reviews/direct-meds/" },
  }), env: {
    AFFILIATE_RUNTIME_MODE: "production",
    AFFILIATE_LIVE_GATE: `operator-approved:${loadGoSelection().selection_sha256}`,
    CLICK_RATE_LIMITER: { limit: async () => ({ success: true }) },
    GLP_DB: { prepare: () => ({ bind: (...values) => { binds.push(values); return { run: async () => ({ success: true }) }; } }) },
  }, params: { program: "direct-meds" } });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("x-attribution-log"), "mapped");
  assert.equal(response.headers.get("location"), `https://epsilonmkt.com/?a=15309&c=169817&s1=reviews.rv2&s2=${CLICK_ID}`);
  assert.equal(binds[0][0], CLICK_ID);
  assert.equal(binds[0][4], "katalys-1304");
});

test("browser instrumentation creates a fresh UUID and appends it to first-party /go", async () => {
  const source = await readFile(new URL("../assets/analytics.js", import.meta.url), "utf8");
  assert.match(source, /const record = \{ clickId: uuidv7\(\)/);
  assert.match(source, /url\.searchParams\.set\("cs_click_id", clickId\)/);
  assert.match(source, /url\.origin === window\.location\.origin/);
  const postback = await readFile(new URL("../functions/api/postback/affiliati.js", import.meta.url), "utf8");
  // The registered callback returns s2 in subid and s1 in placement.
  assert.match(postback, /const placement = identity\(url.searchParams.get\("placement"\), "placement"\)/);
  assert.match(postback, /const clickId = identity\(url.searchParams.get\("subid"\), "subid", \{ required: true \}\)/);
  assert.match(postback, /compatibilityClickId !== clickId/);
  assert.match(postback, /if \(!isUuidV7\(clickId\)\) throw new Error\("cs_click_id_invalid"\)/);
  assert.match(postback, /clickId: payload.clickId/);
  assert.doesNotMatch(postback, /clickId: subid/);
  assert.match(postback, /FROM affiliate_click_map/);
  assert.match(postback, /click_identity_not_owned/);
  assert.match(postback, /analytics_revenue_ledger_v1/);
});
