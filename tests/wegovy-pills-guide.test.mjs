import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { reviewBrief } from "../src/blog-system.mjs";
import { assertGuideResourceCapture } from "./helpers/guide-resource-capture.mjs";

const ROOT = new URL("../", import.meta.url);
const ROUTE = "/guides/wegovy-pills-oral-semaglutide-cost/";
const FILE = new URL("../public/guides/wegovy-pills-oral-semaglutide-cost/index.html", import.meta.url);
const TITLE = "Wegovy Pills Cost in 2026: Oral Semaglutide Prices, Doses & Savings";
const SOURCE_URLS = new Set([
  "https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/215256s029lbl.pdf",
  "https://www.wegovy.com/obesity/what-to-pay-for-wegovy.html",
  "https://www.wegovy.com/obesity/is-wegovy-right-for-me/wegovy-pill-results.html",
]);
const WAVE4_ROUTES = [
  "/tools/glp-1-price-tracker/",
  "/research/public-funnel-evidence/",
  "/tools/glp-1-savings-offer-monitor/",
  "/research/original-data/public-glp-1-program-pricing-sample/",
];
const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, ROOT), "utf8"));
const sectionWordCount = (article) => article.sections.flatMap((section) => section.paragraphs).join(" ").match(/\b[\w’'-]+\b/g)?.length || 0;
const schemaNodes = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((match) => {
  const value = JSON.parse(match[1]);
  return value["@graph"] || [value];
});

test("source record preserves the Bridge-PASS authority, all C01-C12 IDs, and an honest site word count", async () => {
  const batch = await readJson("data/blog/content-batch.json");
  const map = await readJson("data/blog/keyword-ownership-map.json");
  const article = batch.articles.find((item) => item.canonical_path === ROUTE);
  assert.ok(article);
  assert.equal(article.title, TITLE);
  assert.equal(article.h1, TITLE);
  assert.equal(article.word_count, 1698); // 2026-08-27: R2 refresh updated the article on live
  assert.equal(sectionWordCount(article), article.word_count);
  assert.equal(article.has_affiliate_cta, false);
  assert.equal(article.comparison_required, false);
  assert.equal(article.operator_release_receipt, null);
  assert.equal(article.suppress_cta, true);
  assert.deepEqual(article.source_packet.claim_ids, Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`));
  assert.equal(article.source_packet.draft_sha256, "c80c76a2cbdefd6d81ed740a0edfe44da712b43aea9416825f558efb51046d0d");
  assert.equal(article.source_packet.claim_map_sha256, "e957ecae06773f6c80b096f9c2507402a4d80bf8104ec7341d8f190f77215d92");
  assert.equal(article.source_packet.evidence_ledger_sha256, "53c79883be06ee5afd3109806b2899fbb5496a3ef263b9e87ff8767022ce71b9");
  assert.equal(article.source_packet.review_manifest_sha256, "21e0d0939ecbdbadcc1aa0dba28cd20176069c944ddac4886bbabeb99d5cbfd0");
  assert.equal(article.source_packet.bridge_verdict_sha256, "a90d3420daa5b216e591fb0ccd7fcaa12602aeee981731bbc124efd3ec42a21c");
  assert.equal(article.seo_evidence.claim_id, "C11");
  assert.equal(article.seo_evidence.public_editorial_claim, false);
  assert.equal(article.claims.some((claim) => claim.claim_id === "C11"), false);
  assert.deepEqual(new Set(article.claims.map((claim) => claim.claim_id)), new Set(["C01","C02","C03","C04","C05","C06","C07","C08","C09","C10","C12"]));
  assert.deepEqual(new Set(article.sources.map((source) => source.url)), SOURCE_URLS);
  assert.equal(article.internal_links.length, 3);
  assert.equal(reviewBrief(article, { status: "verified_organization", clinical_credentials_claimed: false }).status, "PASS");
  assert.equal(map.entries.filter((entry) => entry.url === ROUTE && entry.primary_keyword === "wegovy pills cost").length, 1);
});

test("built guide is indexable, self-canonical, source-only externally, affiliate-CTA-free, capture-enabled, and contextually linked inbound", async () => {
  const html = await readFile(FILE, "utf8");
  assert.match(html, /<title>Wegovy Pills Cost in 2026: Oral Semaglutide Prices, Doses &amp; Savings<\/title>/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1);
  assert.match(html, new RegExp(`<link rel="canonical" href="https://glpclinicscout\\.com${ROUTE}">`));
  assert.match(html, /Clinic Scout Editorial Team/);
  assert.doesNotMatch(html, /Medically reviewed by|MedicalReview|hasCredential|AggregateRating/);
  const main = html.match(/<main\b[\s\S]*?<\/main>/)?.[0] || "";
  assert.doesNotMatch(main, /class="[^"]*(?:guide-next-card|guide-next-step)/i);
  assert.doesNotMatch(main, /href="\/(?:go|best|quiz|tools\/glp-1-cost-calculator)\//);
  assert.equal((main.match(/<form\b[^>]*action="\/api\/content-upgrade"/g) || []).length, 1);
  assert.match(main, /data-p1-capture-surface/);
  assert.doesNotMatch(main, /<input\b[^>]*\bname="email_consent"/);
  assertGuideResourceCapture(main, ROUTE);
  assert.match(html, /referrerPolicy:'no-referrer'/);
  assert.doesNotMatch(html, /<a\b[^>]*href="[^"]*(?:checkout|contact)|\bour pick\b/i);
  const externalAnchors = [...html.matchAll(/<a\b[^>]*href="(https:\/\/[^"#]+)"/g)].map((match) => match[1]);
  const shareIntents = externalAnchors.filter((href) => href.startsWith("https://x.com/intent/post?"));
  assert.ok(shareIntents.length >= 1, "at least one X share action remains available");
  assert.ok(shareIntents.every((href) => href.includes("glpclinicscout.com%2Fguides%2Fwegovy-pills-oral-semaglutide-cost%2F")));
  assert.deepEqual(new Set(externalAnchors.filter((href) => !href.startsWith("https://x.com/intent/post?"))), SOURCE_URLS);
  assert.equal([...html.matchAll(/href="\/guides\//g)].length >= 5, true);
  const inboundBatch = await readJson("data/blog/content-batch.json");
  const inbound = inboundBatch.articles.find((item) => item.canonical_path === "/guides/zepbound-wegovy-cost-without-insurance/");
  assert.equal(inbound.internal_links.filter((link) => link.path === ROUTE).length, 1);
  const inboundHtml = await readFile(new URL("../public/guides/zepbound-wegovy-cost-without-insurance/index.html", import.meta.url), "utf8");
  assert.match(inboundHtml, /href="\/guides\/wegovy-pills-oral-semaglutide-cost\/"/);
});

test("built guide emits valid Article, BreadcrumbList, and FAQPage schema without fabricated clinical authority", async () => {
  const html = await readFile(FILE, "utf8");
  const nodes = schemaNodes(html);
  const types = new Set(nodes.map((node) => node["@type"]));
  assert.ok(types.has("Article"));
  assert.ok(types.has("BreadcrumbList"));
  assert.ok(types.has("FAQPage"));
  assert.ok(types.has("Organization"));
  assert.equal(types.has("MedicalWebPage"), false);
  const faq = nodes.find((node) => node["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, 6);
  const breadcrumbs = nodes.find((node) => node["@type"] === "BreadcrumbList");
  assert.deepEqual(breadcrumbs.itemListElement.map((item) => item.position), [1, 2, 3]);
});

test("sitemap contains the SEO route exactly once and omits all four Wave 4 routes", async () => {
  const sitemap = await readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  assert.equal((sitemap.match(new RegExp(`https://glpclinicscout\\.com${ROUTE}`, "g")) || []).length, 1);
  for (const route of WAVE4_ROUTES) assert.equal(sitemap.includes(route), false, route);
});

test("Pass 2 gives the Wegovy-pill and comparison routes distinct manifest-backed families", async () => {
  const suffixes = ["-800.avif", "-800.webp", "-800.jpg", "-1600.avif", "-1600.webp", "-1600.jpg", "-og.jpg"];
  const manifest = await readJson("artifacts/ultracode/article-image-manifest.json");
  const canonicalRecord = manifest.records.find((record) => record.route === ROUTE);
  const comparisonRoute = "/guides/zepbound-wegovy-cost-without-insurance/";
  const comparisonRecord = manifest.records.find((record) => record.route === comparisonRoute);
  assert.ok(canonicalRecord, "Wegovy-pill image manifest record missing");
  assert.ok(comparisonRecord, "Wegovy/Zepbound comparison image manifest record missing");
  assert.equal(manifest.schema, "glp-article-image-system-v3");
  assert.equal(canonicalRecord.disposition, "generated_from_gpt_image_2_route_master");
  assert.equal(comparisonRecord.disposition, "generated_from_gpt_image_2_route_master");
  assert.equal(canonicalRecord.generation_model, "gpt_image_2");
  assert.equal(comparisonRecord.generation_model, "gpt_image_2");
  assert.notEqual(canonicalRecord.master_path, comparisonRecord.master_path);
  assert.notEqual(canonicalRecord.master_sha256, comparisonRecord.master_sha256);
  assert.equal(createHash("sha256").update(await readFile(new URL(canonicalRecord.master_path, ROOT))).digest("hex"), canonicalRecord.master_sha256);
  assert.equal(createHash("sha256").update(await readFile(new URL(comparisonRecord.master_path, ROOT))).digest("hex"), comparisonRecord.master_sha256);
  const canonicalOutputs = new Map(canonicalRecord.outputs.map((output) => [output.name, output]));
  const comparisonOutputs = new Map(comparisonRecord.outputs.map((output) => [output.name, output]));
  for (const suffix of suffixes) {
    const canonicalName = `guide-wegovy-pills-oral-semaglutide-cost${suffix}`;
    const comparisonName = `guide-zepbound-wegovy-cost-without-insurance${suffix}`;
    const canonical = await readFile(new URL(`assets/derivatives/${canonicalName}`, ROOT));
    const comparison = await readFile(new URL(`assets/derivatives/${comparisonName}`, ROOT));
    const canonicalDeployed = await readFile(new URL(`public/assets/images/${canonicalName}`, ROOT));
    const comparisonDeployed = await readFile(new URL(`public/assets/images/${comparisonName}`, ROOT));
    const canonicalHash = createHash("sha256").update(canonical).digest("hex");
    const comparisonHash = createHash("sha256").update(comparison).digest("hex");
    assert.equal(canonicalOutputs.get(canonicalName)?.sha256, canonicalHash, canonicalName);
    assert.equal(comparisonOutputs.get(comparisonName)?.sha256, comparisonHash, comparisonName);
    assert.notEqual(comparisonHash, canonicalHash, `route clone survived: ${suffix}`);
    assert.equal(createHash("sha256").update(canonicalDeployed).digest("hex"), canonicalHash, canonicalName);
    assert.equal(createHash("sha256").update(comparisonDeployed).digest("hex"), comparisonHash, comparisonName);
  }
});
