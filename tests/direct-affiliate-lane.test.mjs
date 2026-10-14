// G6-R1a iteration 04: the direct-affiliate wire-in lane.
//
// A "Direct affiliate" program has no network redirector — the advertiser
// serves its own click entry point on its own domain — so the renderer's host
// allowlist is the only thing standing between an approved program and an
// arbitrary outbound href. These tests pin that boundary, and they re-prove
// that adding the lane did not disturb the all-or-nothing money-page link map
// (which returns {} for the WHOLE site if any one program fails to resolve).
import assert from "node:assert/strict";
import test from "node:test";
import { historicalAgelessPromotion } from './fixtures/historical-ageless-promotion.mjs';
import { readFile } from "node:fs/promises";
import { buildProviderReviewSpecs, renderProviderReviewPage } from "../src/provider-review.mjs";
import * as reviewModule from '../src/provider-review.mjs';
import { buildAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import { loadGoSelection, loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const registry = await readJson("../data/program-registry.json");
const selection = await readJson("../data/affiliate-activation-selection.json");
const money = await readJson("../data/money-page-specs.json");
const providerPages = await readJson("../data/provider-page-contracts.json");
const providerFastpath = await readJson("../data/provider-fastpath-contract.json");
const identity = await readJson("../data/identity-registry.json");

const specs = buildProviderReviewSpecs(money.pages, providerPages, providerFastpath, registry, "glp-clinic-scout");
const orderly = specs.find((spec) => spec.program_id === "orderlymeds");
const goby = specs.find((spec) => spec.program_id === "gobymeds");

// Exercise the exact renderer boundary with CURRENT authenticated rail inputs;
// the frozen row's old rail is deliberately superseded, never used for output.
function assertCurrentDestinationRefused(spec, href) {
  const selected=loadGoSelection().programs[spec.program_id];
  assert.equal(selected.status,'VERIFIED');
  assert.equal(loadGoPromotionAuthority().programs[spec.program_id].status,'VERIFIED');
  assert.equal(reviewModule.reviewAffiliateUrl(spec.program_id,selected.network,selected.issued_link).href,selected.issued_link);
  assert.throws(()=>reviewModule.reviewAffiliateUrl(spec.program_id,selected.network,href),/review_direct_link_host_invalid/);
  const html=renderProviderReviewPage({...spec,row:{...spec.row,affiliate_href:href}},identity);
  assert.ok(html.includes(selected.route+'?s=reviews.rv2&amp;v=a'),'row substitution cannot replace receipted destination');
  assert.ok(!html.includes(href),'untrusted row href never rendered');
}

test('active nonselected renderer refuses malformed destinations through the same host gate',()=>{
 const active=specs.find(spec=>spec.program_id==='mademed');
 assert.match(renderProviderReviewPage(active,identity), /data-affiliate-state="active"/);
 for(const href of ['https://attacker.invalid/','http://track.revoffers.com/'])
  assert.throws(()=>renderProviderReviewPage({...active,row:{...active.row,affiliate_href:href}},identity),/review_direct_link_host_invalid/);
});

test("the direct-affiliate program is present and carries the direct-affiliate network", () => {
  assert.ok(orderly, "orderlymeds review spec missing");
  assert.equal(orderly.row.affiliate_network, "Direct affiliate");
  assert.equal(orderly.row.affiliate_link_mode, "transparent_direct");
});

test("its rendered CTA is a sponsored selected go route bound to the adopted Orderly link", () => {
  const html = renderProviderReviewPage(orderly, identity);
  assert.match(html, /href="\/go\/orderlymeds\?s=reviews.rv2&amp;v=a"[^>]*data-link-mode="server-redirect"/);
  const selected = loadGoSelection().programs.orderlymeds;
  assert.equal(selected.status, "VERIFIED");
  const runtime = GO_RUNTIME_MANIFEST.programs.orderlymeds;
  assert.equal(runtime.tracking.base_url, selected.issued_link);
  const url = new URL(runtime.tracking.base_url);
  assert.equal(url.href, "https://www.tzca1z1u.com/57D8F2P/3QQG7/");
  assert.match(html, /rel="sponsored nofollow noopener"/);
});

test("an unlisted direct-affiliate host is refused rather than rendered", () => {
  const rogue = { ...orderly, row: { ...orderly.row, affiliate_href: "https://orderlymeds.example.com/?oid=2&affid=2608" } };
  assertCurrentDestinationRefused(orderly, rogue.row.affiliate_href);
});

test("a non-https direct-affiliate href is refused", () => {
  assertCurrentDestinationRefused(orderly, loadGoSelection().programs.orderlymeds.issued_link.replace('https:', 'http:'));
});

// 2026-08-06 surface unification: the direct-affiliate lane no longer ships
// unrated. Its evidence score is derived from its own dated research, so it is on
// compare, quiz and the calculator like every other live provider.
test("the direct-affiliate lane reaches every surface its evidence supports", () => {
  const entry = registry.programs.find((item) => item.program_id === "orderlymeds");
  const profile = entry.profiles["glp-clinic-scout"];
  assert.equal(profile.surfaces.compare, true);
  assert.equal(profile.surfaces.quiz, true);
  assert.equal(profile.surfaces.review, true);
  // $74 introductory / $149 thereafter is a comparable pair, so it autofills.
  assert.equal(profile.surfaces.calculator, true);
  assert.equal(profile.exceptions.calculator, undefined);
});

test("the all-or-nothing money link map still resolves every selected program", () => {
  const promotionAuthority = loadGoPromotionAuthority();
  const links = buildAffiliateLinkMap(money.pages, registry, selection, "review", "glp-clinic-scout", { promotionAuthority });
  const live = Object.values(links).filter((item) => item.live === true);
  // D3 excludes paused offer 1538 from current activation, preserving the
  // authentic former selection row as historical-only evidence.
  assert.equal(selection.program_count, 10);
  assert.equal(selection.programs.length, selection.program_count);
  assert.ok(!selection.programs.some(item => item.program_id === 'try-ageless'));
  const paused = selection.excluded_selection_evidence.find((item) => item.program_id === "try-ageless");
  assert.equal(paused?.disposition, 'historical_snapshot_only_not_activation_authority');
  assert.equal(paused?.network_program_id, "1538");
  // The original pause reason is historical; current denial retains writer provenance.
  assert.equal(historicalAgelessPromotion().reason, "network_paused_katalys_offer_1538");
  assert.equal(promotionAuthority.programs["try-ageless"]?.reason, "sole_writer_relationship_paused");
  assert.equal(promotionAuthority.programs["try-ageless"]?.promotion_authorized, false);
  assert.deepEqual(promotionAuthority.programs["try-ageless"]?.relationship_snapshot, {program_id: "try-ageless", render_id: "try-ageless", ...registry.programs.find(row => row.program_id === "try-ageless").affiliate_relationship_snapshot});
  assert.equal(promotionAuthority.programs["try-ageless"]?.status, "WITHHELD");
  assert.equal(links["try-ageless"]?.live, false);
  const eligible = selection.programs.filter((item) => item.program_id !== "try-ageless");
  assert.equal(live.length, eligible.length,
    "the money-page link map went link-dark or lost a program");
  assert.deepEqual(new Set(live.map((item) => item.program_id)), new Set(eligible.map((item) => item.program_id)));
  for (const program of eligible) {
    const record = links[program.program_id];
    assert.ok(record, `missing link-map record for ${program.program_id}`);
    assert.equal(record.live, true, `${program.program_id} is link-dark`);
    assert.equal(new URL(record.affiliate_href).hostname, program.tracking_host);
  }
});

test("the direct-affiliate program is deliberately absent from the money selection", () => {
  // The fastpath review lane does not route through the link map. If a future
  // wave adds a direct-affiliate program to the money selection it must also
  // teach TRACKING_HOST_BY_NETWORK about it, and this assertion is the tripwire.
  assert.ok(!selection.programs.some((item) => item.network === "Direct affiliate"));
});

// --- G6-R1a iteration 05: the path-referral-code direct lane (GobyMeds) ------
//
// GobyMeds issues a referral SHORT LINK whose last path segment is the code,
// with no query string at all. That is a second declared shape on the same
// lane, so it needs its own host pin: the renderer allowlist is keyed by the
// Sheet's network label, and this program's label is its own.

test("the path-referral-code program renders its CTA on the provider's issued host", () => {
  assert.ok(goby, "gobymeds review spec missing");
  assert.equal(goby.row.affiliate_network, "Direct website-publisher application / manual review");
  assert.equal(goby.row.affiliate_link_mode, "transparent_direct");
  const html = renderProviderReviewPage(goby, identity);
  assert.match(html, /href="\/go\/gobymeds\?s=reviews.rv2&amp;v=a"[^>]*data-link-mode="server-redirect"/);
  const selected = loadGoSelection().programs.gobymeds;
  assert.equal(selected.status, "VERIFIED");
  const runtime = GO_RUNTIME_MANIFEST.programs.gobymeds;
  assert.equal(runtime.tracking.base_url, selected.issued_link);
  const url = new URL(runtime.tracking.base_url);
  assert.equal(url.hostname, "my.gobymeds.com");
  // The issued code IS the publisher identity and it lives in the path, not a query.
  assert.equal(url.pathname.split("/").pop(), "vuMPMv");
  assert.equal(url.search, "");
  assert.match(html, /rel="sponsored nofollow noopener"/);
});

test("an unlisted host on the path-referral-code lane is refused", () => {
  const rogue = { ...goby, row: { ...goby.row, affiliate_href: "https://my.gobymeds.example.com/s/vuMPMv" } };
  assertCurrentDestinationRefused(goby, rogue.row.affiliate_href);
});

test("a non-https path-referral-code href is refused", () => {
  assertCurrentDestinationRefused(goby, loadGoSelection().programs.gobymeds.issued_link.replace('https:', 'http:'));
});

test("the path-referral-code program is compared and selectable in blank manual calculator mode", () => {
  const entry = registry.programs.find((item) => item.program_id === "gobymeds");
  const profile = entry.profiles["glp-clinic-scout"];
  assert.equal(profile.surfaces.compare, true);
  assert.equal(profile.surfaces.quiz, true);
  assert.equal(profile.surfaces.review, true);
  assert.equal(profile.surfaces.calculator, true);
  assert.equal(profile.exceptions.calculator, undefined);
  const adjudication = registry.provider_dynamic_profiles.profiles.gobymeds.calculator;
  assert.equal(adjudication.mode, "manual");
  assert.equal(adjudication.first_month_base_usd, null);
  assert.equal(adjudication.recurring_month_base_usd, null);
  assert.match(adjudication.evidence_gap_copy, /enter the current/i);
  assert.ok(!selection.programs.some((item) => item.program_id === "gobymeds"));
});

test("every fastpath review carries at least two distinct dated sources", () => {
  // The renderer throws fastpath_review_contract_invalid below two sources. A
  // single-source research pass therefore takes the whole build down, which is
  // exactly what happened to GobyMeds before its second capture pass. Pin it
  // for every fastpath program, not just the one that broke.
  for (const spec of specs.filter((item) => item.fastpath_contract)) {
    assert.ok(spec.sources.length >= 2,
      `${spec.program_id} has ${spec.sources.length} source(s); the fastpath contract needs 2+`);
    for (const source of spec.sources) {
      assert.match(source.url, /^https:\/\//, `${spec.program_id} source is not https`);
      assert.match(source.verified_as_of, /^\d{4}-\d{2}-\d{2}$/,
        `${spec.program_id} source ${source.url} is undated`);
    }
    assert.equal(new Set(spec.sources.map((source) => source.url)).size, spec.sources.length,
      `${spec.program_id} lists a duplicate source URL`);
  }
});
