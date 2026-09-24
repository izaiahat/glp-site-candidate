// Build gate — answer-engine surface (SPEC-AEO-20260819 §5 acceptance 1-5, 7).
//
// Judges the RENDERED tree, so it cannot be satisfied by a renderer that means
// well. It is the same shape as the deploy sensor's check #17, which makes an
// AEO regression un-deployable rather than merely un-liked.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORGANIZATION_ID, ORGANIZATION_LEGAL_NAME, ORGANIZATION_NAME } from "../src/aeo-entity.mjs";
import { CRAWLER_TOKENS, isAllowed } from "../src/robots.mjs";
import { DISTRIBUTION_FILES, PRICE_INDEX_ROUTE } from "../src/price-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
// A Dataset's `dateModified` describes when the DATA was observed, not when the
// page changed; it is deliberately outside the dateline invariant.
const DATELINE_TYPES = new Set(["Article", "NewsArticle", "BlogPosting", "Review", "WebPage", "MedicalWebPage"]);

async function walk(directory, prefix = "") {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(directory, entry.name), relative));
    else out.push(relative);
  }
  return out;
}

function jsonLdNodes(html) {
  const nodes = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const list = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
    for (const node of list) if (node && typeof node === "object") nodes.push(node);
  }
  return nodes;
}

const typesOf = (node) => (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).filter(Boolean);

function walkValues(value, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) walkValues(item, visit); return; }
  visit(value);
  for (const item of Object.values(value)) walkValues(item, visit);
}

async function main() {
  const findings = [];
  const files = await walk(PUBLIC);
  const treeFiles = new Set(files);
  const htmlFiles = files.filter((relative) => relative.endsWith(".html"));

  const robots = await readFile(path.join(PUBLIC, "robots.txt"), "utf8");
  if (/Disallow:\s*\/(clinics|directory)\//.test(robots)) findings.push("robots_dead_disallow_reintroduced");
  const crawlPaths = ["/", "/best/online-glp-1-providers/", "/glp-1-price-index/", "/guides/mounjaro-cost-without-insurance/", "/reviews/orderlymeds/", "/llms.txt", "/pharmacies/", "/sitemap.xml"];
  for (const token of [...CRAWLER_TOKENS, "SomeFutureUnknownBot/1.0"]) {
    for (const target of crawlPaths) {
      if (!isAllowed(robots, token, target)) findings.push(`robots_token_blocked:${token}:${target}`);
    }
  }
  if (!isAllowed(robots, "AdsBot-Google", "/lp/r/orderlymeds/")) findings.push("robots_adsbot_blocked_on_lp");

  const sitemap = await readFile(path.join(PUBLIC, "sitemap.xml"), "utf8");
  const urlBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
  if (urlBlocks.length === 0) findings.push("sitemap_empty");
  const lastmodByRoute = new Map();
  for (const block of urlBlocks) {
    const route = block.match(/<loc>https:\/\/glpclinicscout\.com([^<]*)<\/loc>/)?.[1];
    const lastmod = block.match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/)?.[1];
    if (!route) { findings.push("sitemap_loc_invalid"); continue; }
    if (!lastmod) { findings.push(`sitemap_lastmod_missing:${route}`); continue; }
    lastmodByRoute.set(route, lastmod);
  }

  if (!treeFiles.has("llms.txt")) findings.push("llms_txt_absent");
  else {
    const llms = await readFile(path.join(PUBLIC, "llms.txt"), "utf8");
    if (!llms.startsWith("# GLP Clinic Scout")) findings.push("llms_txt_header_invalid");
    for (const match of llms.matchAll(/https:\/\/glpclinicscout\.com(\/[^\s)]*)/g)) {
      const target = match[1];
      if (!isAllowed(robots, "GPTBot", target)) findings.push(`llms_txt_url_disallowed:${target}`);
      if (target.endsWith("/")) {
        if (!lastmodByRoute.has(target)) findings.push(`llms_txt_url_not_indexable:${target}`);
      } else if (!treeFiles.has(target.replace(/^\//, ""))) findings.push(`llms_txt_url_absent:${target}`);
    }
  }

  // Scoped to indexable pages: the held/noindex routes are frozen byte-for-byte
  // against their own renderers and are invisible to answer engines.
  let organizationDefinitions = 0;
  const indexableFiles = [...lastmodByRoute.keys()].map((route) => `${route.replace(/^\//, "")}index.html`);
  for (const relative of indexableFiles) {
    const html = await readFile(path.join(PUBLIC, relative), "utf8");
    const route = `/${relative.replace(/index\.html$/, "")}`;
    if (html.includes(">Open source<") || html.includes(">Open source ↗<")) findings.push(`citation_anchor_open_source:${route}`);
    if (html.includes('datetime=""')) findings.push(`empty_time_element:${route}`);
    const nodes = jsonLdNodes(html);
    const articles = nodes.filter((node) => typesOf(node).includes("Article"));
    if (articles.length > 1) findings.push(`duplicate_article_node:${route}`);
    for (const node of nodes) {
      if (node["@id"] === ORGANIZATION_ID) {
        organizationDefinitions += 1;
        if (node.name !== ORGANIZATION_NAME || node.legalName !== ORGANIZATION_LEGAL_NAME) findings.push(`organization_identity_invalid:${route}`);
      }
    }
    walkValues(nodes, (node) => {
      if (Array.isArray(node.sameAs) && node.sameAs.length === 0) findings.push(`empty_same_as:${route}`);
      for (const key of ["publisher", "creator"]) {
        const value = node[key];
        if (value && typeof value === "object" && !Array.isArray(value) && !value["@id"]) findings.push(`unresolved_${key}_node:${route}`);
      }
    });
    // AEO P0-D, stated exactly: a page's VISIBLE dateline must equal the date its
    // schema publishes. A page with no visible dateline cannot contradict itself,
    // and is not made honest by inventing one. Separately, a page that DOES carry
    // the canonical `data-page-updated` dateline must agree with its sitemap
    // lastmod - that is the three-way invariant.
    const visibleDates = new Set([...html.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})"/g)].map((match) => match[1]));
    const schemaDates = new Set(nodes
      .filter((node) => typesOf(node).some((type) => DATELINE_TYPES.has(type)))
      .map((node) => node.dateModified)
      .filter((value) => typeof value === "string"));
    if (visibleDates.size && schemaDates.size && ![...schemaDates].some((date) => visibleDates.has(date))) {
      findings.push(`dateline_ne_datemodified:${route}:${[...schemaDates].join(",")} vs ${[...visibleDates].join(",")}`);
    }
    const canonicalDateline = html.match(/<time datetime="(\d{4}-\d{2}-\d{2})"[^>]*data-page-updated/)?.[1];
    const lastmod = lastmodByRoute.get(route);
    if (canonicalDateline && lastmod && canonicalDateline !== lastmod) {
      findings.push(`dateline_not_lastmod:${route}:${canonicalDateline}!=${lastmod}`);
    }
  }
  if (organizationDefinitions < indexableFiles.length) findings.push(`organization_node_missing_on_pages:${indexableFiles.length - organizationDefinitions}`);

  // Price Index dataset bundle (AEO P1-G / ED §3.8).
  const priceIndexHtml = await readFile(path.join(PUBLIC, "glp-1-price-index", "index.html"), "utf8");
  const dataset = jsonLdNodes(priceIndexHtml).find((node) => typesOf(node).includes("Dataset"));
  if (!dataset) findings.push("price_index_dataset_missing");
  else {
    if (!Array.isArray(dataset.distribution) || dataset.distribution.length !== DISTRIBUTION_FILES.length) findings.push("price_index_distribution_invalid");
    if (!Array.isArray(dataset.variableMeasured) || dataset.variableMeasured.length === 0) findings.push("price_index_variable_measured_missing");
    if (dataset.license !== "https://creativecommons.org/licenses/by/4.0/") findings.push("price_index_license_missing");
    if (dataset.creator?.["@id"] !== ORGANIZATION_ID) findings.push("price_index_creator_not_canonical");
  }
  const renderedRows = (priceIndexHtml.match(/data-index-record-id=/g) || []).length;
  for (const file of DISTRIBUTION_FILES) {
    const relative = `glp-1-price-index/data/${file.name}`;
    if (!treeFiles.has(relative)) { findings.push(`price_index_distribution_file_absent:${file.name}`); continue; }
    const body = await readFile(path.join(PUBLIC, relative), "utf8");
    const rows = file.name.endsWith(".csv")
      ? body.trim().split("\n").length - 1
      : JSON.parse(body).rows.length;
    if (rows !== renderedRows) findings.push(`price_index_distribution_row_count_mismatch:${file.name}:${rows}!=${renderedRows}`);
  }
  // ED §6.2 / §3.8: the index never monetizes, and its printed promise is exact.
  if (/rel="[^"]*sponsored/.test(priceIndexHtml)) findings.push("price_index_sponsored_anchor_present");
  if (!priceIndexHtml.includes("The source links on this page go directly to provider websites, not affiliate redirectors.")) {
    findings.push("price_index_promise_paragraph_altered");
  }
  if (!lastmodByRoute.has(PRICE_INDEX_ROUTE)) findings.push("price_index_missing_from_sitemap");

  if (findings.length) {
    console.error(`FAIL — AEO surface: ${findings.length} finding(s)`);
    for (const finding of findings.slice(0, 40)) console.error(`  - ${finding}`);
    process.exit(1);
  }
  console.log(`PASS — AEO surface: ${indexableFiles.length} indexable pages · ${lastmodByRoute.size}/${urlBlocks.length} sitemap lastmod · llms.txt live · Dataset distribution ${renderedRows} rows · robots allows ${CRAWLER_TOKENS.length} tokens + unknown`);
}

await main();
