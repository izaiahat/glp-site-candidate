import assert from "node:assert/strict";
import test from "node:test";
import { completeGoAuthority } from './fixtures/complete-go-authority.mjs';
import { readFileSync } from "node:fs";
import { affiliateOutboundMode } from "../src/affiliate-outbound-mode.mjs";
import { loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";
import { loadAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import { normalizeNetwork, subidAttributes } from "../src/affiliate-subid.mjs";
const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const registry = read("program-registry");
const promotions = loadGoPromotionAuthority().programs;
const links = loadAffiliateLinkMap("compare");
const ids = ["gobymeds", "orderlymeds", "nu-image-medical-review", "levelsrx-extra-cpa-home-page", "yucca-health-xentraffic-offer-3117"];
for (const id of ids) test(`selected ${id} follows current adoption or explicit hold`, () => {
  const program = registry.programs.find((p) => p.program_id === id || p.review_slug === id);
  const held = id === "nu-image-medical-review";
  assert.equal(promotions[id].status, held ? "WITHHELD" : "VERIFIED");
  assert.equal(links[id].live, !held);
  assert.equal(affiliateOutboundMode(program, links[id], promotions[id]), held ? "held" : "go");
  assert.equal(affiliateOutboundMode(program, {...links[id], live:false}, promotions[id]), "held");
});
const fixture = () => ({program_id:'fixture-routed',commercial_state:"live",go:{entry_state:"transparent_direct"},profiles:{"glp-clinic-scout":{vertical_fit:true,wired:true,surfaces:{compare:true,go:true}}}});
const link={live:true,affiliate_href:"https://example.invalid/issued",network:"Katalys"};
const verified=completeGoAuthority(fixture(),link);
test("every runtime authorization bit is mandatory; unknown only preserves an already authorized direct link", () => {
 assert.equal(affiliateOutboundMode(fixture(),link,verified),"go");
 for (const key of Object.keys(verified)) assert.equal(affiliateOutboundMode(fixture(),link,{...verified,[key]:null}),"transparent_direct");
 assert.equal(affiliateOutboundMode(fixture(),link,null),"transparent_direct");
});
test("commercial and surface holds cannot be cleared by runtime permissions", () => {
 for(const state of ['held','excluded','pending']) assert.equal(affiliateOutboundMode({...fixture(),commercial_state:state},link,verified),'held');
 for(const key of ['vertical_fit','wired']) {const p=fixture();p.profiles['glp-clinic-scout'][key]=false;assert.equal(affiliateOutboundMode(p,link,verified),'held');}
 for(const key of ['go','compare']) {const p=fixture();p.profiles['glp-clinic-scout'].surfaces[key]=false;assert.equal(affiliateOutboundMode(p,link,verified),'held');}
 const p=fixture();p.go.entry_state='held';assert.equal(affiliateOutboundMode(p,link,verified),'held');
 p.profiles['glp-clinic-scout'].exceptions={go:{enabled:true,surface_restriction_basis:'operator_terms_transparent_direct_only'}};
 assert.equal(affiliateOutboundMode(p,link,verified),'transparent_direct');
});
test("XenTraffic label remains its own network and unknown labels remain direct", () => {
 assert.equal(normalizeNetwork('XenTraffic'), 'XenTraffic');
 assert.equal(normalizeNetwork('unknown-network'), 'direct');
 assert.match(subidAttributes({network:'XenTraffic',position:'review-closing',rankPosition:1,pageSlug:'review-example',pageType:'review',providerSlug:'example'}),/data-network="XenTraffic"/);
});
