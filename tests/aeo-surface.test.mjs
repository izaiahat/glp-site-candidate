// Regression tests for the P0 answer-engine surface (B-04, B-06, B-07, B-08).
//
// The robots matrix test is the one SPEC-SEO §3 and SPEC-AEO P1-K call for by
// name: it fails the build forever if a future edit blocks any AI crawler token
// or re-introduces the `/directory/` `/clinics/` trap that would make the
// pharmacy layer invisible at birth.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRobotsTxt, CRAWLER_TOKENS, isAllowed } from "../src/robots.mjs";
import { renderLlmsTxt } from "../src/llms-txt.mjs";
import { newState, remediatePage, stampDateline } from "../scripts/codemod-aeo-citation-schema.mjs";

const ROOT = new URL("../", import.meta.url);
const readPublic = (relative) => readFile(new URL(`public/${relative}`, ROOT), "utf8");

const PUBLIC_TREES = [
  "/", "/best/online-glp-1-providers/", "/cost/online-glp-1-programs/", "/glp-1-price-index/",
  "/guides/mounjaro-cost-without-insurance/", "/reviews/orderlymeds/", "/compare/",
  "/quiz/provider-fit/", "/tools/glp-1-cost-calculator/", "/llms.txt", "/sitemap.xml",
  // Not built yet — asserted now so the Wave-3 pharmacy layer cannot be born blocked.
  "/pharmacies/", "/pharmacies/strive/",
];

test("robots: every audited AI token, plus an unknown one, may fetch every public tree", async () => {
  const robots = await readPublic("robots.txt");
  assert.equal(robots, buildRobotsTxt(), "shipped robots.txt is not the generated one");
  for (const token of [...CRAWLER_TOKENS, "SomeFutureUnknownBot/1.0", "Grok"]) {
    for (const target of PUBLIC_TREES) {
      assert.equal(isAllowed(robots, token, target), true, `${token} blocked on ${target}`);
    }
  }
});

test("robots: dead traps stay gone and public legal pages remain fetchable for platform review", async () => {
  const robots = await readPublic("robots.txt");
  assert.match(robots, /^User-agent: \*$/m);
  assert.equal(/Disallow:\s*\/clinics\//.test(robots), false);
  assert.equal(/Disallow:\s*\/directory\//.test(robots), false);
  for (const publicPolicy of ["/privacy/", "/terms/"]) {
    assert.equal(isAllowed(robots, "Googlebot", publicPolicy), true, `${publicPolicy} should be crawlable`);
  }
  assert.equal(isAllowed(robots, "Googlebot", "/google-ads-api/"), false, "/google-ads-api/ should stay disallowed");
});

test("robots: AdsBot-Google keeps its own allow group for the paid landing tree", async () => {
  const robots = await readPublic("robots.txt");
  assert.match(robots, /User-agent: AdsBot-Google/);
  assert.equal(isAllowed(robots, "AdsBot-Google", "/lp/r/orderlymeds/"), true);
});

test("robots: faceted param tails are disallowed without touching content routes", async () => {
  const robots = await readPublic("robots.txt");
  assert.equal(isAllowed(robots, "Googlebot", "/best/online-glp-1-providers/?sort=cheapest"), false);
  assert.equal(isAllowed(robots, "Googlebot", "/best/online-glp-1-providers/?therapeutic=semaglutide"), false);
  assert.equal(isAllowed(robots, "Googlebot", "/best/online-glp-1-providers/"), true);
  assert.equal(isAllowed(robots, "Googlebot", "/quiz/provider-fit/?source=hero&provider=orderlymeds"), true);
});

test("sitemap: 100% lastmod coverage and no duplicate locs", async () => {
  const sitemap = await readPublic("sitemap.xml");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const lastmods = [...sitemap.matchAll(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)];
  assert.ok(locs.length > 90, `sitemap unexpectedly small: ${locs.length}`);
  assert.equal(lastmods.length, locs.length, "a sitemap URL is missing lastmod");
  assert.equal(new Set(locs).size, locs.length, "duplicate sitemap loc");
});

test("lastmod provenance: every sitemap route is hash-recorded, and dates are not bulk-stamped", async () => {
  const provenance = JSON.parse(await readFile(new URL("data/page-content-provenance.json", ROOT), "utf8"));
  const sitemap = await readPublic("sitemap.xml");
  const routes = [...sitemap.matchAll(/<loc>https:\/\/glpclinicscout\.com([^<]*)<\/loc>/g)].map((match) => match[1]);
  for (const route of routes) {
    const record = provenance.pages[route];
    assert.ok(record, `no content-hash provenance for ${route}`);
    assert.match(record.content_sha256, /^[a-f0-9]{64}$/);
    assert.match(record.lastmod, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(sitemap.includes(`<loc>https://glpclinicscout.com${route}</loc><lastmod>${record.lastmod}</lastmod>`), true, `sitemap lastmod for ${route} does not match its provenance record`);
  }
});

test("llms.txt: published, and every listed URL is indexable and crawlable", async () => {
  const llms = await readPublic("llms.txt");
  const robots = await readPublic("robots.txt");
  const sitemap = await readPublic("sitemap.xml");
  assert.match(llms, /^# GLP Clinic Scout\n/);
  assert.match(llms, /not medical advice/);
  assert.match(llms, /Operated by Tilton Group LLC/);
  const urls = [...llms.matchAll(/https:\/\/glpclinicscout\.com(\/[^\s)]*)/g)].map((match) => match[1]);
  assert.ok(urls.length >= 20);
  for (const target of urls) {
    assert.equal(isAllowed(robots, "GPTBot", target), true, `llms.txt lists a disallowed URL: ${target}`);
    if (target.endsWith("/")) {
      assert.equal(sitemap.includes(`<loc>https://glpclinicscout.com${target}</loc>`), true, `llms.txt lists a non-indexable URL: ${target}`);
    }
  }
  // These crawlable policy pages remain noindex and outside the answer-engine
  // priority list until a separate indexing decision changes that contract.
  assert.equal(llms.includes("glpclinicscout.com/privacy/"), false);
  assert.equal(llms.includes("glpclinicscout.com/terms/"), false);
});

test("llms.txt generator hard-fails rather than shipping a dangling URL", () => {
  const config = {
    schema: "glp-llms-priority-v1",
    title: "GLP Clinic Scout",
    summary: ["x"],
    key_facts: ["y"],
    sections: [{ heading: "H", links: [{ route: "/nope/", label: "Nope" }] }],
    machine_readable: [],
  };
  assert.throws(() => renderLlmsTxt(config, {
    indexableRoutes: new Set(["/"]),
    isDisallowed: () => false,
    hasFile: () => true,
  }), /llms_txt_route_not_indexable:\/nope\//);
});

test("codemod: a seeded regression is repaired, not merely detected", () => {
  const seeded = '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"A","dateModified":"2026-07-01","publisher":{"@type":"Organization","name":"GLP Clinic Scout"}}</script>'
    + '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article","@id":"https://glpclinicscout.com/x/#article","headline":"A","dateModified":"2026-07-01","citation":["https://fda.gov/a.pdf"]},{"@type":"Organization","@id":"https://glpclinicscout.com/authors/clinic-scout-editorial-team/#organization","name":"Clinic Scout Editorial Team","sameAs":[]}]}</script></head>'
    + '<body><p class="guide-byline">By <a href="/authors/">the team</a> · Updated 2026-07-01</p>'
    + '<p class="guide-evidence-band">Sources checked 2026-07-01 · Prices checked <time datetime="" data-prices-checked-date></time> · Prices and terms can change.</p>'
    + '<ol><li id="guide-source-1"><strong>U.S. Food and Drug Administration</strong><span>Supports: x</span>'
    + '<a href="https://fda.gov/a.pdf" rel="noopener" data-citation="guide_source_ledger">Open source</a><small>Checked 2026-07-01</small></li></ol></body></html>';
  const state = newState();
  const fixed = stampDateline(remediatePage(seeded, state), "2026-08-19", state);
  assert.equal((fixed.match(/"@type":"Article"/g) || []).length, 1, "duplicate Article survived");
  assert.equal(fixed.includes(">Open source<"), false, "empty citation label survived");
  assert.match(fixed, />U\.S\. Food and Drug Administration — PDF document, 2026-07</);
  assert.equal(fixed.includes('datetime=""'), false, "empty time element survived");
  assert.equal(fixed.includes("Prices checked"), false, "a price stamp was kept with no price date");
  assert.equal(fixed.includes('"sameAs":[]'), false, "empty sameAs survived");
  assert.match(fixed, /"@id":"https:\/\/glpclinicscout\.com\/#organization","name":"GLP Clinic Scout","alternateName":"Clinic Scout","legalName":"Tilton Group LLC"/);
  assert.match(fixed, /"publisher":\{"@id":"https:\/\/glpclinicscout\.com\/#organization"\}/);
  assert.match(fixed, /<time datetime="2026-08-19">August 19, 2026<\/time>/);
  assert.equal(fixed.includes('"dateModified":"2026-07-01"'), false, "stale dateModified survived");
  // Evidence dates are claims about verification and must NOT be rewritten.
  assert.match(fixed, /Sources checked 2026-07-01/);
  assert.match(fixed, /Checked 2026-07-01<\/small>/);
});

test("price index: dataset bundle is complete, licensed, and still commerce-free", async () => {
  const html = await readPublic("glp-1-price-index/index.html");
  const csv = await readPublic("glp-1-price-index/data/latest.csv");
  const json = JSON.parse(await readPublic("glp-1-price-index/data/latest.json"));
  const dataset = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]))
    .flatMap((data) => (Array.isArray(data["@graph"]) ? data["@graph"] : [data]))
    .find((node) => node["@type"] === "Dataset");
  assert.ok(dataset, "Dataset node missing");
  assert.equal(dataset.license, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(dataset.distribution.length, 2);
  assert.ok(dataset.variableMeasured.length >= 5);
  assert.equal(dataset.creator["@id"], "https://glpclinicscout.com/#organization");
  const renderedRows = (html.match(/data-index-record-id=/g) || []).length;
  assert.equal(csv.trim().split("\n").length - 1, renderedRows, "CSV row count != rendered table rows");
  assert.equal(json.rows.length, renderedRows, "JSON row count != rendered table rows");
  // ED §3.8: the printed promise is byte-exact and the page never monetizes.
  assert.match(html, /The source links on this page go directly to provider websites, not affiliate redirectors\./);
  assert.equal(/rel="[^"]*sponsored/.test(html), false, "affiliate rel on the price index");
  assert.equal(html.includes("track.revoffers.com"), false);
  assert.match(html, /Clinic Scout review →/);
});
