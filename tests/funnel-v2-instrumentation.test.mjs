import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

// R11 restores commercial ordering only on paid /lp/ routes. Card CTA
// data-funnel-v2-go attributes on organic cards remain attribution only.
function assertCurrentResults(html, route, { paid = false } = {}) {
  if (!paid) assert.doesNotMatch(html, /data-funnel-v2(?:\s|>|=)|data-funnel-v2-(?:provider|empty|runtime)|data-economic-(?:rank|epc)|\bEPC\b|earnings per outbound click|earning the most per measured outbound click/i, `${route}: organic output cannot carry commercial ordering`);
  const results = html.match(/<section\b[^>]*data-three-column-results[^>]*>[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(results, /data-phase3-provider-grid/, route);
  assert.match(results, /data-filter-empty/, route);
  assert.match(results, /data-filter-reset/, route);
  if (['mounjaro','wegovy-pill','ozempic','zepbound','3-month','6-month'].includes(route)) {
    assert.match(results, route === "6-month"
      ? /No source-backed record matches those filters\. An empty result is not a medical or availability conclusion\./
      : /No comparable price matches those filters\. Records without a comparable price are listed separately below\. This is not a medical or availability conclusion\./, route);
    assert.match(results, /<p data-active-filter-label>Active filters: none\.<\/p><button type="button" data-filter-reset>Reset filters<\/button>/, `${route}: truthful initial filters and operable reset`);
    assert.doesNotMatch(results, /<article\b|\/go\//, route);
    if (route === "6-month") assert.doesNotMatch(html, /data-unpublished-provider-section|<article\b[^>]*data-program=/, "zero eligible records means all-record-empty, not a fabricated non-priced cohort");
    else if (route === "3-month") assert.match(html, /data-unpublished-provider-section[^>]*>[\s\S]*?data-unpublished-price-card/, "non-priced records remain outside the empty numeric section");
  } else {
    assert.match(results, /<article\b[^>]*\bp3-provider-card\b[^>]*data-program="[^"]+"/, route);
  }
  if (route === "6-month") assert.doesNotMatch(html, /data-unpublished-provider-section/, "no unsupported six-month providers may be invented");
  else assert.match(html, /data-unpublished-provider-section/, route);
  assert.match(html, /Check the ordering method stated for each comparison\./, route);
  return results;
}

test("operator-mapped organic bulk routes retain honest empty results without an EPC shortlist", () => {
  for (const route of ["3-month", "6-month"]) {
    const html = requireText(new URL(`../public/${route}/index.html`, import.meta.url));
    const results = assertCurrentResults(html, route);
    const programs = [...results.matchAll(/<article\b[^>]*data-program="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(programs, [], `${route}: S30 removed both unsupported bulk schedules; no offer may be recreated`);
  }
});

test("operator-approved R11 paid /lp/ routes order eligible source-backed EPC and disclose it last", () => {
  const decision = JSON.parse(requireText(new URL("../../../../ops/linear/approvals/OPERATOR-DECISION-20260918-paid-page-payout-order.json", ROOT)));
  const ruling = JSON.parse(requireText(new URL("../../../../reports/ops/glp38-20260915/p19-rulings/R11-RESTORE.json", ROOT)));
  assert.equal(decision.id, "OPERATOR-DECISION-20260918-paid-page-payout-order");
  assert.equal(ruling.family, "R11");
  assert.equal(ruling.branch, "RESTORE");
  assert.equal(ruling.status, "APPROVED");
  assert.equal(ruling.allow_commercial_order, true);
  assert.equal(ruling.scope, "paid /lp/ funnel routes only");
  const economicsBytes = readFileSync(new URL("data/funnel-v2-economics.json", ROOT));
  const blobHash = createHash("sha1").update(`blob ${economicsBytes.length}\0`).update(economicsBytes).digest("hex");
  assert.equal(blobHash, ruling.economics_git_blob, "R11 approves these exact economics bytes");
  const economics = JSON.parse(economicsBytes);
  assert.equal(economics.schema, "glp-funnel-v2-economics-v1");
  assert.equal(createHash("sha256").update(readFileSync(economics.source.path)).digest("hex"), economics.source.sha256, "network report provenance");
  const pricing = JSON.parse(requireText(new URL("data/provider-pricing-matrix.json", ROOT)));
  const priceById = new Map(Object.values(pricing.providers).map(row => [row.program_id, row]));
  const rows = economics.paid_search_provider_order;
  assert.ok(rows.length >= 3);
  assert.equal(new Set(rows.map(row => row.program_id)).size, rows.length);
  const eligible = rows.filter(row => {
    assert.ok(Number.isFinite(row.network_epc_usd) && row.network_epc_usd >= 0, row.program_id);
    for (const gate of ["paid_search_allowed", "tracking_ready", "wired_live"]) assert.equal(row[gate], true, `${row.program_id}:${gate}`);
    return true;
  }).sort((a, b) => b.network_epc_usd - a.network_epc_usd || a.program_id.localeCompare(b.program_id));
  for (const [route, medication] of [
    ["lp/best-providers/compounded-semaglutide", "compounded-semaglutide-injection"],
    ["lp/best-providers/compounded-tirzepatide", "compounded-tirzepatide-injection"],
  ]) {
    const html = requireText(new URL(`public/${route}/index.html`, ROOT));
    assertCurrentResults(html, route, { paid: true });
    assert.match(html, /<meta name="robots" content="noindex/);
    const funnel = html.match(/<section\b[^>]*\bdata-funnel-v2(?:\s|>)[\s\S]*?<\/section>/g) || [];
    assert.equal(funnel.length, 1, `${route}: exactly one paid shortlist`);
    const table = funnel[0].match(/<div class="fv2-table-shell">[\s\S]*?<\/table>/)?.[0] || "";
    const actual = [...table.matchAll(/<tr\b[^>]*data-funnel-v2-provider[^>]*>/g)].map(([tag]) => ({
      id: tag.match(/data-program="([^"]+)"/)?.[1],
      epc: Number(tag.match(/data-economic-epc="([^"]+)"/)?.[1]),
      rank: Number(tag.match(/data-economic-rank="([^"]+)"/)?.[1]),
    }));
    const expected = eligible.filter(row => (priceById.get(row.program_id)?.medications || [])
      .some(price => price.medication_id === medication && (Object.hasOwn(price, "price_kind") || Number.isFinite(price.ongoing_usd))));
    assert.ok(expected.length >= 3, `${route}: evidence-backed paid cohort`);
    assert.deepEqual(actual, expected.map(row => ({ id: row.program_id, epc: row.network_epc_usd, rank: eligible.indexOf(row) + 1 })), `${route}: descending reported EPC, never page-derived order`);
    assert.equal((funnel[0].match(/data-funnel-v2-disclosure/g) || []).length, 1);
    assert.ok(funnel[0].trimEnd().endsWith(`<aside class="fv2-disclosure" id="p19-R11-disclosure" data-funnel-v2-disclosure>${economics.public_disclosure}</aside></section>`), `${route}: sourced disclosure must close shortlist`);
  }
});

for (const route of [
  "wegovy-pill",
  "wegovy",
  "ozempic",
  "mounjaro",
  "zepbound",
  "3-month",
  "6-month",
]) {
  test(`${route} exposes full results or an honest empty state without EPC ordering`, () => {
    const html = requireText(new URL(`../public/${route}/index.html`, import.meta.url));
    assertCurrentResults(html, route);
  });
}

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

test("every go manifest entry is minted only by adopted selection or retained as a non-minting candidate", () => {
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
  const eligible = adopted.filter(row => promotions[row.program_id]?.status === 'VERIFIED');
  assert.equal(eligible.length, 10, 'seven historical XenTraffic ADOPTs now held');
  for (const row of adopted.filter(row => !eligible.includes(row))) {
    assert.equal(row.network.toLowerCase(), 'xentraffic');
    assert.equal(promotions[row.program_id].current_hold_decision.sha256, '147069fc66b2f66639321828e723dc2859d37a4b2c205f2239369724ab1b74ad');
  }
  assert.deepEqual(candidates.filter((row) => row.live_link_allowed === true).map((row) => row.program_id).sort(), eligible.map((row) => row.program_id).sort());
  for (const program of candidates) {
    const selected = selection.programs[program.program_id];
    if (program.live_link_allowed === true) {
      assert.equal(selected?.status, "VERIFIED", `${program.program_id}: minting requires adopted selection`);
      assert.equal(program.link_mode, "server_redirect");
      assert.equal(program.tracking.base_url, selected.issued_link);
      assert.equal(program.operator_selection_receipt_sha256, selection.selection_sha256);
      for (const key of ["live_link_allowed", "promotion_authorized", "constructor_verified", "advertiser_permission_verified", "encoding_verified", "privacy_qa_passed"]) assert.equal(program[key], true, `${program.program_id}:${key}`);
      assert.equal(redirectorTermsAllowed(program), true);
    } else {
      // A source-backed direct anchor may coexist with a non-minting /go
      // candidate. Do not relabel that candidate as a server redirect.
      assert.notEqual(program.link_mode, "server_redirect", `${program.program_id}: unadopted go route must not mint`);
      assert.equal(program.live_link_allowed, false);
      assert.equal(program.promotion_authorized, false);
      assert.ok(String(program.candidate_gate || "").length > 5);
      if (program.link_mode === "instrumented_redirect_candidate") {
        assert.equal(program.status, "candidate_preview_only");
        assert.equal(program.candidate_gate, "operator_approved_glp_live");
        assert.ok(program.tracking?.base_url, `${program.program_id}: candidate destination stays explicit`);
        assert.equal(promotions[program.program_id]?.status, "VERIFIED", `${program.program_id}: live decision must be source-bound`);
        assert.ok(promotions[program.program_id]?.operator_approved_live_decision, `${program.program_id}: operator receipt required`);
      } else {
        assert.equal(program.link_mode, undefined);
        assert.equal(program.tracking, undefined);
        assert.notEqual(program.go_route_wired, true, `${program.program_id}: no wiring authority for held entry`);
      }
    }
    if (program.link_mode) {
      assert.equal(program.go_route_wired, true);
      assert.ok(program.allowed_page_roles.includes("providers") && program.allowed_positions.includes("fv2s1") && program.allowed_positions.includes("pc1"));
    }
  }
});

test("unadopted go candidates cannot mint outbound tracking even with a live gate", async () => {
  for (const id of ["found-health", "nu-image-medical-review", "altrx-glp1-us-cps"]) {
    const program = GO_RUNTIME_MANIFEST.programs[id];
    assert.equal(program.live_link_allowed, false);
    const response = await onGoRequest({
      request: new Request(`https://glpclinicscout.com/go/${id}?s=providers.fv2s1&v=a&cs_click_id=${CLICK_ID}`, {
        headers: {"user-agent": "Mozilla/5.0", referer: "https://glpclinicscout.com/providers/"},
      }),
      env: {
        AFFILIATE_RUNTIME_MODE: "production",
        AFFILIATE_LIVE_GATE: `operator-approved:${loadGoSelection().selection_sha256}`,
        CLICK_RATE_LIMITER: {limit: async () => ({success: true})},
      },
      params: {program: id},
    });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), program.official_fallback || GO_RUNTIME_MANIFEST.internal_fallback, `${id}: fallback only`);
    assert.notEqual(response.headers.get("x-attribution-log"), "mapped", `${id}: no click mint`);
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
