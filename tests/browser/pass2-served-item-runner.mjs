#!/usr/bin/env node
/**
 * Fail-closed, item-granular PASS 2 served-output runner.
 *
 * This runner observes only the already-served candidate at 127.0.0.1:4500,
 * browser/API readbacks, and existing API receipts. It does not build, deploy,
 * start a server, or use candidate source assertions as acceptance evidence.
 */
import { chromium, request as playwrightRequest } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "http://127.0.0.1:4500";
const BUSINESS_ROOT = "/home/ubuntu/business";
const REPORT_DIR = path.join(BUSINESS_ROOT, "reports/glp-clinic-scout/rebuild");
const OUTPUT_PATH = path.join(REPORT_DIR, "pass2-served-item-tests.json");
const EVIDENCE_PATH = path.join(REPORT_DIR, "pass2-served-item-runner-evidence.json");
const REL_EVIDENCE_PATH = path.relative(BUSINESS_ROOT, EVIDENCE_PATH);
const CANDIDATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTICLE_MANIFEST_PATH = path.join(CANDIDATE_ROOT, "artifacts/ultracode/article-image-manifest.json");
const PASS2_IMAGE_MANIFEST_PATH = path.join(CANDIDATE_ROOT, "artifacts/ultracode/pass2-image-derivative-manifest.json");
const PRODUCT_IMAGE_MANIFEST_PATH = path.join(CANDIDATE_ROOT, "artifacts/ultracode/pass2-product-comparison-image-manifest.json");
const PROVIDER_LOGO_MANIFEST_PATH = path.join(CANDIDATE_ROOT, "assets/provider-logos/manifest.json");
const PROVIDER_ATLAS_MANIFEST_PATH = path.join(CANDIDATE_ROOT, "assets/provider-logos/pass2-lp-atlas.json");
const PROVIDER_SCENE_MANIFEST_PATH = path.join(CANDIDATE_ROOT, "artifacts/ultracode/pass2-provider-review-image-manifest.json");
const PROVIDER_SCENE_STATE_PATH = path.join(REPORT_DIR, "pass2-provider-review-image-generation/state.json");
const VISUAL_QA_PATH = path.join(REPORT_DIR, "pass2-image-generation/VISUAL-QA-20260825.json");
const CONTACT_SHEET_MANIFEST_PATH = path.join(REPORT_DIR, "pass2-image-generation/contact-sheets/manifest.json");
const TECHNICAL_REVIEW_PATH = path.join(BUSINESS_ROOT, "reports/ops/glp41-image-review-20260925/RESULT.json");
const EDITORIAL_DISPOSITION_PATH = path.join(BUSINESS_ROOT, "reports/ops/glp41-image-review-20260925/ORCHESTRATOR-DISPOSITION.json");
const FIRST_IMAGE_ROUTE = "/guides/best-company-to-get-glp-1/";
const FIRST_IMAGE_ALT = "Editorial illustration of paperwork and a magnifying glass on a dark desk.";
const ARTICLE_SOURCE_PATHS = [
  "data/blog/content-batch.json",
  "data/blog/content-national-wow-additions.json",
];
const CONSOLIDATED_ARTICLE_ROUTES = new Set([
  "/guides/cheapest-glp1/",
  "/guides/compare-online-glp-1-provider-fees/",
  "/guides/glp-1-program-total-cost-comparison/",
  "/guides/healthrx-vs-agelessrx/",
  "/guides/wellorithm-vs-enhance-md/",
]);
const PRODUCT_SLUGS = ["wegovy-pill", "wegovy", "ozempic", "mounjaro", "zepbound"];
const PRODUCT_DISPLAY_NAMES = new Map([
  ["wegovy-pill", "Wegovy pill"],
  ["wegovy", "Wegovy"],
  ["ozempic", "Ozempic"],
  ["mounjaro", "Mounjaro"],
  ["zepbound", "Zepbound"],
]);
const MIN_ARTICLE_DHASH_DISTANCE = 64; // 64/256 bits: fail any pair sharing >75% of dHash comparisons.
const EXPECTED_IDS = [
  ...Array.from({ length: 38 }, (_, index) => `O-${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `G-${index + 1}`),
];
const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;
const CONSENT_SELECTORS = [
  "#cs-subscribe-consent",
  ".cs-subscribe-consent",
  "#capture-consent",
  ".capture-consent",
  'input[type="checkbox"][name="subscribe_consent" i]',
  'input[type="checkbox"][name="email_consent" i]',
  'input[type="checkbox"][name="marketing_consent" i]',
].join(",");
const QUIZ_INTENTS = [
  "Semaglutide", "Tirzepatide", "Ozempic", "Mounjaro",
  "Wegovy", "Zepbound", "Wegovy Pill", "Not sure",
];

function nowUtc() {
  return new Date().toISOString();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function atomicJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  const fd = openSync(temporary, "w", 0o644);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, filePath);
}

function removeIfPresent(filePath) {
  try { unlinkSync(filePath); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

function compactError(error) {
  return String(error?.stack || error?.message || error).split("\n").slice(0, 6).join("\n");
}

function rgb(value) {
  const match = String(value).match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(left, right) {
  if (!left || !right) return 0;
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function translateX(transform) {
  if (!transform || transform === "none") return 0;
  const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
  if (matrix3d) return Number(matrix3d[1].split(",")[12]);
  const matrix = transform.match(/^matrix\((.+)\)$/);
  return matrix ? Number(matrix[1].split(",")[4]) : Number.NaN;
}

async function openServed(page, route) {
  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(120);
  return response?.status() ?? 0;
}

async function makePage(browser, viewport = { width: 1440, height: 900 }, touch = false) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "no-preference",
    isMobile: touch,
    hasTouch: touch,
  });
  await context.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "pass2-served-item-runner",
      saved_at: "2026-08-25T00:00:00.000Z",
    }));
  });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4500" || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
    } else if (ANALYTICS.test(url.href)) {
      await route.fulfill({ status: 204, body: "" });
    } else {
      await route.abort("blockedbyclient");
    }
  });
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
  return { context, page };
}

function assertionCollector() {
  const assertions = [];
  return {
    assertions,
    check(condition, name, observed, expected, evidenceType = "served_dom") {
      assertions.push({
        name,
        status: condition ? "PASS" : "FAIL",
        evidence_type: evidenceType,
        observed,
        expected,
      });
      return condition;
    },
  };
}

async function centeredDelta(page, sectionSelector, controlText) {
  return page.evaluate(({ sectionSelector, controlText }) => {
    const section = document.querySelector(sectionSelector);
    const control = [...section?.querySelectorAll("a,button") || []]
      .find((node) => node.textContent.trim().toLowerCase().includes(controlText.toLowerCase()));
    if (!section || !control) return null;
    section.scrollIntoView({ block: "center" });
    const owner = section.getBoundingClientRect();
    const box = control.getBoundingClientRect();
    return {
      delta: Math.abs((box.left + box.width / 2) - (owner.left + owner.width / 2)),
      section: owner.toJSON(),
      control: box.toJSON(),
      text: control.textContent.trim(),
    };
  }, { sectionSelector, controlText });
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fileHash(filePath) {
  return sha256(readFileSync(filePath));
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function decodeHtml(value = "") {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|#39|lt|gt);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "quot") return '"';
    if (normalized === "apos" || normalized === "#39") return "'";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    const code = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function tagAttributes(tag = "") {
  const attributes = {};
  for (const match of tag.matchAll(/\b([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function documentAttribute(html, tagName, attribute) {
  const tag = html.match(new RegExp(`<${tagName}\\b[^>]*>`, "i"))?.[0] || "";
  return tagAttributes(tag)[attribute.toLowerCase()] || "";
}

function metaContent(html, key, value) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if ((attributes[key] || "").toLowerCase() === value.toLowerCase()) return attributes.content || "";
  }
  return "";
}

function canonicalHref(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if ((attributes.rel || "").split(/\s+/).includes("canonical")) return attributes.href || "";
  }
  return "";
}

function parseSrcset(value = "") {
  const parsed = {};
  for (const candidate of value.split(",")) {
    const match = candidate.trim().match(/^(\S+)\s+(\d+)w$/);
    if (match) parsed[match[2]] = match[1];
  }
  return parsed;
}

function extractBoundPicture(html, fallbackUrl, expectedByType) {
  const candidates = [];
  for (const match of html.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi)) {
    const pictureHtml = match[0];
    const imageTags = [...pictureHtml.matchAll(/<img\b[^>]*>/gi)].map((row) => tagAttributes(row[0]));
    if (imageTags.some((attributes) => attributes.src === fallbackUrl)) candidates.push({ pictureHtml, imageTags });
  }
  if (candidates.length !== 1) return { complete: false, problem: `bound_picture_count:${candidates.length}` };
  const { pictureHtml, imageTags } = candidates[0];
  const image = imageTags.find((attributes) => attributes.src === fallbackUrl) || {};
  const sources = {};
  for (const match of pictureHtml.matchAll(/<source\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if (attributes.type) sources[attributes.type] = attributes;
  }
  const observedByType = {
    "image/avif": parseSrcset(sources["image/avif"]?.srcset),
    "image/webp": parseSrcset(sources["image/webp"]?.srcset),
    "image/jpeg": parseSrcset(image.srcset),
  };
  const sizes = [sources["image/avif"]?.sizes || "", sources["image/webp"]?.sizes || "", image.sizes || ""];
  const complete = Object.entries(expectedByType).every(([type, expected]) => (
    JSON.stringify(observedByType[type] || {}) === JSON.stringify(expected)
  )) && sizes.every(Boolean) && new Set(sizes).size === 1;
  return {
    complete,
    problem: complete ? "" : "responsive_family_or_sizes_mismatch",
    image,
    sources,
    observedByType,
    sizes,
  };
}

function expectedArticleOutputs(stem) {
  return new Map([
    [`${stem}-800.avif`, { width: 800, height: 450, contentType: "image/avif" }],
    [`${stem}-800.webp`, { width: 800, height: 450, contentType: "image/webp" }],
    [`${stem}-800.jpg`, { width: 800, height: 450, contentType: "image/jpeg" }],
    [`${stem}-1600.avif`, { width: 1600, height: 900, contentType: "image/avif" }],
    [`${stem}-1600.webp`, { width: 1600, height: 900, contentType: "image/webp" }],
    [`${stem}-1600.jpg`, { width: 1600, height: 900, contentType: "image/jpeg" }],
    [`${stem}-og.jpg`, { width: 1200, height: 630, contentType: "image/jpeg" }],
  ]);
}

function hammingDistanceHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || "") || !/^[a-f0-9]{64}$/i.test(right || "")) return -1;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (value) { distance += value & 1; value >>>= 1; }
  }
  return distance;
}

function closestPerceptualPair(records) {
  let closest = { distance: Number.POSITIVE_INFINITY, routes: [] };
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const distance = hammingDistanceHex(records[left].perceptualHash, records[right].perceptualHash);
      if (distance >= 0 && distance < closest.distance) {
        closest = { distance, routes: [records[left].route, records[right].route] };
      }
    }
  }
  return closest;
}

let corpusCache;
async function servedArticleCorpus(api, browser) {
  if (corpusCache) return corpusCache;
  const manifest = readJsonFile(ARTICLE_MANIFEST_PATH);
  const pass2Manifest = readJsonFile(PASS2_IMAGE_MANIFEST_PATH);
  const sourceArticles = ARTICLE_SOURCE_PATHS.flatMap((relative) => readJsonFile(path.join(CANDIDATE_ROOT, relative)).articles);
  const articleByRoute = new Map(sourceArticles.map((article) => [article.canonical_path, article]));
  const sourceRoutes = sourceArticles.map((article) => article.canonical_path).sort();
  const contracts = [...manifest.records].sort((left, right) => left.route.localeCompare(right.route));
  const routes = contracts.map((contract) => contract.route);
  const manifestProblems = [];
  const redirectRows = new Map(readFileSync(path.join(CANDIDATE_ROOT, "public/_redirects"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row.length >= 3)
    .map(([from, to, status]) => [from, { to, status: Number(status) }]));
  for (const route of CONSOLIDATED_ARTICLE_ROUTES) {
    const redirect = redirectRows.get(route);
    if (!redirect || redirect.to !== "/providers/" || redirect.status !== 301) manifestProblems.push(`redirect_source_contract:${route}`);
  }

  if (manifest.schema !== "glp-article-image-system-v3") manifestProblems.push(`schema:${manifest.schema}`);
  if (manifest.status !== "PASS") manifestProblems.push(`status:${manifest.status}`);
  if (manifest.article_count !== sourceArticles.length || manifest.route_master_count !== sourceArticles.length || manifest.output_count !== sourceArticles.length * 7) manifestProblems.push("manifest_counts");
  if (manifest.generation_model !== "gpt_image_2" || manifest.external_generation_services_used !== sourceArticles.length || manifest.competitor_assets_used !== 0) manifestProblems.push("generation_contract");
  if (sourceArticles.length !== 77 || new Set(sourceRoutes).size !== sourceArticles.length || !sameStringSet(routes, sourceRoutes)) manifestProblems.push("source_route_set");
  const sourceManifestRows = new Map((manifest.source_files || []).map((row) => [row.path, row]));
  for (const relative of ARTICLE_SOURCE_PATHS) {
    const row = sourceManifestRows.get(relative);
    if (!row || row.sha256 !== fileHash(path.join(CANDIDATE_ROOT, relative))) manifestProblems.push(`source_hash:${relative}`);
  }

  const statePath = manifest.route_master_state?.path || "";
  let state = {};
  if (!statePath || !existsSync(statePath) || fileHash(statePath) !== manifest.route_master_state.sha256) {
    manifestProblems.push("route_master_state_hash");
  } else {
    state = readJsonFile(statePath);
    if (state.schema !== "glp-pass2-route-image-generation-v1" || state.job_set_type !== "gpt_image_2" || !sameStringSet(Object.keys(state.records || {}), routes)) manifestProblems.push("route_master_state_contract");
  }

  const routeSetFields = {
    routes,
    stems: contracts.map((record) => record.stem),
    subjects: contracts.map((record) => record.subject?.trim()),
    masterHashes: contracts.map((record) => record.master_sha256),
  };
  for (const [field, values] of Object.entries(routeSetFields)) {
    if (values.length !== sourceArticles.length || values.some((value) => !value) || new Set(values).size !== sourceArticles.length) manifestProblems.push(`unique_${field}`);
  }

  const outputProblems = [];
  for (const record of contracts) {
    const expectedStem = `guide-${record.route.split("/").filter(Boolean).at(-1)}`;
    const stateRecord = state.records?.[record.route];
    if (stateRecord?.generation_lane === "article_release_pipeline"
      && (!stateRecord.release_pipeline_receipt?.path
        || !existsSync(path.join(CANDIDATE_ROOT, stateRecord.release_pipeline_receipt.path))
        || fileHash(path.join(CANDIDATE_ROOT, stateRecord.release_pipeline_receipt.path)) !== stateRecord.release_pipeline_receipt.sha256)) {
      manifestProblems.push(`release_receipt_hash:${record.route}`);
    }
    if (record.stem !== expectedStem
      || record.disposition !== "generated_from_gpt_image_2_route_master"
      || record.generation_model !== "gpt_image_2"
      || !stateRecord
      || stateRecord.status !== "PASS"
      || stateRecord.stem !== record.stem
      || stateRecord.subject !== record.subject
      || stateRecord.output_sha256 !== record.master_sha256
      || stateRecord.prompt_sha256 !== record.prompt_sha256) {
      manifestProblems.push(`route_lineage:${record.route}`);
    }
    const masterPath = path.join(CANDIDATE_ROOT, record.master_path || "");
    if (!existsSync(masterPath) || fileHash(masterPath) !== record.master_sha256) manifestProblems.push(`master_hash:${record.route}`);
    const expected = expectedArticleOutputs(record.stem);
    if (record.outputs?.length !== 7 || record.outputs.some((row) => !expected.has(row.name))) outputProblems.push(`${record.route}:output_set`);
    for (const output of record.outputs || []) {
      const contract = expected.get(output.name);
      if (!contract || output.width !== contract.width || output.height !== contract.height || !/^[a-f0-9]{64}$/.test(output.sha256 || "")) {
        outputProblems.push(`${record.route}:manifest_output:${output.name}`);
        continue;
      }
      for (const prefix of ["assets/derivatives", "public/assets/images"]) {
        const local = path.join(CANDIDATE_ROOT, prefix, output.name);
        if (!existsSync(local) || fileHash(local) !== output.sha256) outputProblems.push(`${record.route}:local_hash:${prefix}/${output.name}`);
      }
    }
  }

  const visualQa = readJsonFile(VISUAL_QA_PATH);
  const contactSheets = readJsonFile(CONTACT_SHEET_MANIFEST_PATH);
  const visualQaProblems = [];
  const requiredCriteria = [
    "route relevance",
    "obvious generation defects",
    "accidental legible text or brand imitation",
    "near-duplicate composition",
    "malformed medical objects or hands",
    "professional editorial quality",
  ];
  if (visualQa.schema !== "glp-pass2-route-image-visual-qa-v1" || visualQa.status !== "PASS" || visualQa.route_master_count !== 73 || visualQa.sheet_count !== 9 || visualQa.deploy_count !== 0) visualQaProblems.push("historical_visual_qa_contract");
  if (!sameStringSet(visualQa.criteria || [], requiredCriteria) || (visualQa.regeneration_required || []).length !== 0) visualQaProblems.push("visual_qa_criteria_or_regeneration");
  if (path.resolve(visualQa.contact_sheet_manifest || "") !== path.resolve(CONTACT_SHEET_MANIFEST_PATH)) visualQaProblems.push("visual_qa_manifest_binding");
  if ((visualQa.sheets || []).length !== 9 || visualQa.sheets.some((row, index) => row.sheet !== index + 1 || row.status !== "PASS" || !row.note?.trim())) visualQaProblems.push("visual_qa_sheet_receipts");
  if (contactSheets.schema !== "glp-pass2-route-image-contact-sheets-v1" || contactSheets.status !== "PASS" || contactSheets.route_master_count !== 73 || contactSheets.unique_route_master_hashes !== 73 || contactSheets.sheets?.length !== 9) visualQaProblems.push("contact_sheet_contract");
  const contactRoutes = (contactSheets.sheets || []).flatMap((sheet) => sheet.routes || []);
  const releaseRoutes = routes.filter((route) => state.records?.[route]?.generation_lane === "article_release_pipeline");
  const technicalReview = readJsonFile(TECHNICAL_REVIEW_PATH);
  const editorialDisposition = readJsonFile(EDITORIAL_DISPOSITION_PATH);
  if (technicalReview.status !== "TECHNICAL_REVIEW_COMPLETE_NOT_RELEASE_ACCEPTANCE"
    || editorialDisposition.status !== "ORCHESTRATOR_EDITORIAL_DISPOSITION_NOT_RELEASE_ACCEPTANCE") visualQaProblems.push("release_review_acceptance_boundary");
  const expectedReleaseRoutes = JSON.stringify([...releaseRoutes].sort());
  if (JSON.stringify((technicalReview.images?.map(row => row.route) || []).sort()) !== expectedReleaseRoutes
    || JSON.stringify((editorialDisposition.images?.map(row => row.route) || []).sort()) !== expectedReleaseRoutes) visualQaProblems.push("release_review_route_identity");
  for (const route of releaseRoutes) {
    const reviewed = technicalReview.images?.find((row) => row.route === route);
    const disposition = editorialDisposition.images?.find((row) => row.route === route);
    const master = contracts.find((row) => row.route === route);
    if (!reviewed || !disposition || reviewed.sha256 !== master?.master_sha256 || disposition.sha256 !== reviewed.sha256
      || !existsSync(path.join(CANDIDATE_ROOT, reviewed.release_receipt || ""))
      || fileHash(path.join(CANDIDATE_ROOT, reviewed.release_receipt)) !== reviewed.release_receipt_sha256) {
      visualQaProblems.push(`release_review_master_or_receipt_hash:${route}`);
    }
  }
  if (contactRoutes.length !== 73 || new Set(contactRoutes).size !== 73 || releaseRoutes.length !== 4
    || releaseRoutes.some((route) => contactRoutes.includes(route))
    || !sameStringSet([...contactRoutes, ...releaseRoutes], routes)) visualQaProblems.push("historical_qa_and_release_route_partition");
  for (const sheet of contactSheets.sheets || []) {
    if (!existsSync(sheet.path) || fileHash(sheet.path) !== sheet.sha256) visualQaProblems.push(`contact_sheet_hash:${sheet.path}`);
  }

  const sitemapResponse = await api.get("/sitemap.xml", { maxRedirects: 0 });
  const sitemapText = await sitemapResponse.text();
  const sitemapUrls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => decodeHtml(match[1].trim()));
  const sitemapPaths = sitemapUrls.map((value) => {
    try {
      const parsed = new URL(value);
      return parsed.origin === "https://glpclinicscout.com" ? parsed.pathname : `INVALID_ORIGIN:${value}`;
    } catch { return `INVALID_URL:${value}`; }
  });
  const sitemapSet = new Set(sitemapPaths);

  const records = [];
  for (const contract of contracts) {
    const { route, stem } = contract;
    const initialResponse = await api.get(route, { maxRedirects: 0 });
    const initialStatus = initialResponse.status();
    const location = initialResponse.headers().location || "";
    const expectedLocation = new URL("/providers/", initialResponse.url()).href;
    const redirected = initialStatus >= 300 && initialStatus < 400;
    let html = "";
    let finalStatus = initialStatus;
    let finalPath = new URL(initialResponse.url()).pathname;
    let redirectHopCount = 0;
    if (redirected) {
      const target = await api.get(location, { maxRedirects: 0 });
      finalStatus = target.status();
      finalPath = new URL(target.url()).pathname;
      redirectHopCount = 1;
    } else {
      html = await initialResponse.text();
    }

    const fallbackUrl = `/assets/images/${stem}-1600.jpg`;
    const expectedByType = {
      "image/avif": { "800": `/assets/images/${stem}-800.avif`, "1600": `/assets/images/${stem}-1600.avif` },
      "image/webp": { "800": `/assets/images/${stem}-800.webp`, "1600": `/assets/images/${stem}-1600.webp` },
      "image/jpeg": { "800": `/assets/images/${stem}-800.jpg`, "1600": fallbackUrl },
    };
    const picture = redirected ? { complete: false, problem: "redirected_route_has_no_bound_picture" } : extractBoundPicture(html, fallbackUrl, expectedByType);
    const expectedAlt = (() => {
      const article = articleByRoute.get(route) || {};
      const explicit = article.images?.[0]?.alt?.trim();
      return route === FIRST_IMAGE_ROUTE ? FIRST_IMAGE_ALT : explicit || `Guide overview for ${article.h1 || ""}`;
    })();
    const assets = [];
    for (const output of contract.outputs || []) {
      const assetUrl = `/assets/images/${output.name}`;
      const assetResponse = await api.get(assetUrl, { maxRedirects: 0 });
      const body = await assetResponse.body();
      assets.push({
        url: assetUrl,
        status: assetResponse.status(),
        location: assetResponse.headers().location || "",
        contentType: (assetResponse.headers()["content-type"] || "").split(";")[0].toLowerCase(),
        sha256: sha256(body),
        expectedSha256: output.sha256,
        width: output.width,
        height: output.height,
        bytes: body.length,
      });
    }
    records.push({
      route,
      stem,
      subject: contract.subject,
      masterSha256: contract.master_sha256,
      initialStatus,
      finalStatus,
      finalPath,
      redirected,
      location,
      expectedLocation,
      redirectHopCount,
      expectedConsolidatedRedirect: CONSOLIDATED_ARTICLE_ROUTES.has(route),
      imageUrl: fallbackUrl,
      imageStatus: assets.find((row) => row.url === fallbackUrl)?.status || 0,
      imageSha256: assets.find((row) => row.url === fallbackUrl)?.sha256 || "",
      assets,
      picture,
      alt: picture.image?.alt || "",
      expectedAlt,
      width: picture.image?.width || "",
      height: picture.image?.height || "",
      releaseDisposition: documentAttribute(html, "html", "data-release"),
      robots: metaContent(html, "name", "robots"),
      canonical: canonicalHref(html),
      ogImage: metaContent(html, "property", "og:image"),
      twitterImage: metaContent(html, "name", "twitter:image"),
      inSitemap: sitemapSet.has(route),
      pass2ReferenceCount: (html.match(/\/assets\/images\/pass2\//g) || []).length,
    });
  }

  const { context, page } = await makePage(browser, { width: 800, height: 600 });
  try {
    await openServed(page, "/");
    const perceptual = await page.evaluate(async (urls) => {
      const output = [];
      for (const url of urls) {
        if (!url) { output.push(""); continue; }
        try {
          const response = await fetch(url, { cache: "no-store" });
          const bitmap = await createImageBitmap(await response.blob());
          const canvas = document.createElement("canvas");
          canvas.width = 17;
          canvas.height = 16;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(bitmap, 0, 0, 17, 16);
          bitmap.close();
          const pixels = context.getImageData(0, 0, 17, 16).data;
          let bits = "";
          for (let y = 0; y < 16; y += 1) {
            for (let x = 0; x < 16; x += 1) {
              const left = (y * 17 + x) * 4;
              const right = left + 4;
              const lumaLeft = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
              const lumaRight = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
              bits += lumaLeft > lumaRight ? "1" : "0";
            }
          }
          output.push(Array.from({ length: 64 }, (_, index) => Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16)).join(""));
        } catch { output.push(""); }
      }
      return output;
    }, records.map((record) => record.imageUrl));
    perceptual.forEach((digest, index) => { records[index].perceptualHash = digest; });
  } finally {
    await context.close();
  }

  const activeRecords = records.filter((record) => !record.redirected);
  const consolidatedRecords = records.filter((record) => record.redirected);
  const releaseReadyRecords = activeRecords.filter((record) => record.releaseDisposition === "release-ready");
  const heldRecords = activeRecords.filter((record) => record.releaseDisposition === "held");
  corpusCache = {
    manifest,
    pass2Manifest,
    manifestProblems,
    outputProblems,
    visualQaProblems,
    visualQa,
    contactSheets,
    historicalQaRoutes: contactRoutes,
    releaseTechnicalRoutes: releaseRoutes,
    sitemapStatus: sitemapResponse.status(),
    sitemapContentType: (sitemapResponse.headers()["content-type"] || "").split(";")[0].toLowerCase(),
    sitemapUrls,
    sitemapPaths,
    sitemapUniquePathCount: sitemapSet.size,
    routes,
    records,
    activeRecords,
    consolidatedRecords,
    releaseReadyRecords,
    heldRecords,
    closestPerceptualPair: closestPerceptualPair(records),
  };
  return corpusCache;
}

async function scrollMetrics(page) {
  return page.evaluate(async () => {
    const longTasks = [];
    let observer;
    try {
      observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)));
      observer.observe({ type: "longtask", buffered: true });
    } catch { /* unsupported is reported as zero */ }
    const deltas = [];
    const duration = 3000;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const started = performance.now();
    let prior = started;
    await new Promise((resolve) => {
      const step = (now) => {
        deltas.push(now - prior);
        prior = now;
        const progress = Math.min(1, (now - started) / duration);
        scrollTo(0, maxScroll * progress);
        if (progress < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    observer?.disconnect();
    const sorted = deltas.slice(2).sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
    return {
      frameCount: sorted.length,
      frameDeltaP95Ms: Number(p95.toFixed(1)),
      severeFramesOver50: sorted.filter((value) => value > 50).length,
      longTaskTotalMs: Number(longTasks.reduce((sum, value) => sum + value, 0).toFixed(1)),
      documentHeight: document.documentElement.scrollHeight,
    };
  });
}

async function activeRevealMotion(page) {
  return page.locator("[data-pass2-results]").evaluate((root) => {
    const nodes = [root, ...root.querySelectorAll(".qz-card")];
    const hasDuration = (value) => String(value || "0s")
      .split(",")
      .some((part) => Number.parseFloat(part) > 0.05);
    return nodes.some((node) => {
      const style = getComputedStyle(node);
      if (hasDuration(style.animationDuration) || hasDuration(style.transitionDuration)) return true;
      return node.getAnimations().some((animation) => {
        const duration = Number(animation.effect?.getTiming?.().duration || 0);
        return duration >= 100 && animation.playState !== "finished";
      });
    });
  });
}

const ITEMS = [
  { id: "O-1", route: "/", name: "wordmark-only header", run: async ({ page, check }) => {
    const observed = await page.locator(".gcs-nav .gcs-brand").evaluate((brand) => ({ text: brand.textContent.trim(), media: brand.querySelectorAll("img,svg,picture").length }));
    check(/Clinic\s+Scout/i.test(observed.text) && observed.media === 0, "header serves text-only Clinic Scout wordmark", observed, { media: 0 });
  } },
  { id: "O-2", route: "/", name: "tightened home hero", run: async ({ page, check }) => {
    const observed = await page.locator(".cs-home2-hero").evaluate((hero) => { const box = hero.getBoundingClientRect(); const heading = hero.querySelector("h1").getBoundingClientRect(); return { top: box.top, height: box.height, headingTop: heading.top, paddingTop: parseFloat(getComputedStyle(hero).paddingTop) }; });
    check(observed.headingTop < 300 && observed.paddingTop <= 92.5 && observed.height <= 830, "hero begins high enough above the fold", observed, { headingTopMax: 299.9, paddingTopMax: 92.5, heightMax: 830 });
  } },
  { id: "O-3", route: "/", name: "hero crop has no bilateral white bars", run: async ({ page, check }) => {
    const observed = await page.locator(".cs-home2-cluster__hand img").evaluate(async (image) => {
      await image.decode(); const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data; const band = Math.max(1, Math.floor(canvas.width * 0.1));
      const ratio = (start, end) => { let white = 0; let total = 0; for (let y = 0; y < canvas.height; y += 4) for (let x = start; x < end; x += 2) { const i = (y * canvas.width + x) * 4; if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) white += 1; total += 1; } return white / total; };
      return { objectFit: getComputedStyle(image).objectFit, leftNearWhite: ratio(0, band), rightNearWhite: ratio(canvas.width - band, canvas.width), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    });
    check(observed.objectFit === "cover" && !(observed.leftNearWhite > 0.7 && observed.rightNearWhite > 0.7), "served hero crop does not retain white bars on both sides", observed, { objectFit: "cover", bilateralNearWhiteMax: 0.7 }, "browser_capture");
  } },
  { id: "O-4", route: "/", name: "visible animated aurora", run: async ({ page, check }) => {
    const observed = await page.locator(".cs-home2-flow").evaluate((flow) => ({ opacity: Number(getComputedStyle(flow).opacity), filter: getComputedStyle(flow).filter, animations: [...flow.children].map((node) => ({ name: getComputedStyle(node).animationName, duration: getComputedStyle(node).animationDuration, background: getComputedStyle(node).backgroundImage, filter: getComputedStyle(node).filter, blend: getComputedStyle(node).mixBlendMode })) }));
    check(observed.opacity >= 0.9 && observed.filter === "none" && observed.animations.every((row) => row.name !== "none" && parseFloat(row.duration) >= 8 && /radial-gradient/.test(row.background) && row.filter === "none" && row.blend === "normal"), "aurora uses three saturated gradient layers with continuous compositor-only motion", observed, { opacityMin: 0.9, animatedChildren: true, filteredSurfaceCount: 0 });
  } },
  { id: "O-5", route: "/", name: "plain-language rotating hero line", run: async ({ page, check }) => {
    const locator = page.locator("[data-home-value]"); const seen = new Set(); for (let index = 0; index < 4; index += 1) { seen.add((await locator.textContent())?.trim()); await page.waitForTimeout(3700); }
    const observed = [...seen]; check(observed.length >= 3 && !observed.some((text) => /prior authorization/i.test(text)) && observed.includes("Know what you may pay before signup."), "rotator keeps motion while removing prior-authorization jargon", observed, { minimumDistinct: 3, forbidden: "prior authorization" });
  } },
  { id: "O-6", route: "/", name: "two-full-plus-peek medication rail", run: async ({ page, check }) => {
    const section = page.locator(".cs-home2-meds"); await section.scrollIntoViewIfNeeded(); const sectionBox = await section.boundingBox(); if (sectionBox) await page.mouse.move(sectionBox.x + sectionBox.width / 2, Math.max(1, Math.min(899, sectionBox.y + 40))); await page.waitForTimeout(800); const observed = await section.evaluate((root) => { const viewport = root.querySelector("[data-med-viewport]").getBoundingClientRect(); const boxes = [...root.querySelectorAll("[data-med-card]")].map((node) => node.getBoundingClientRect()); return { full: boxes.filter((box) => box.left >= viewport.left - 1 && box.right <= viewport.right + 1).length, partial: boxes.filter((box) => box.right > viewport.left && box.left < viewport.right && !(box.left >= viewport.left - 1 && box.right <= viewport.right + 1)).length, widths: boxes.map((box) => box.width), leftFade: getComputedStyle(root.querySelector("[data-med-viewport]"), "::before").backgroundImage, rightFade: getComputedStyle(root.querySelector("[data-med-viewport]"), "::after").backgroundImage }; });
    check(observed.full >= 2 && observed.partial >= 1 && observed.widths.every((width) => width >= 329) && /gradient/.test(observed.leftFade) && /gradient/.test(observed.rightFade), "rail serves two full cards plus peeks and edge fades", observed, { fullMin: 2, partialMin: 1 });
  } },
  { id: "O-7", route: "/", name: "unique medication product imagery", run: async ({ page, check }) => {
    const images = page.locator("[data-med-card] img"); await images.evaluateAll(async (nodes) => { nodes.forEach((node) => { node.loading = "eager"; }); await Promise.all(nodes.map((node) => node.decode().catch(() => {}))); }); const observed = await images.evaluateAll((nodes) => nodes.map((node) => ({ src: node.currentSrc, alt: node.alt, width: node.naturalWidth, height: node.naturalHeight })));
    check(observed.length === 7 && new Set(observed.map((row) => new URL(row.src).pathname)).size === 7 && observed.every((row) => row.width > 0 && row.height > 0 && row.alt.length > 24), "all seven medication cards serve distinct decoded product/device art", observed, { count: 7, unique: 7 });
  } },
  { id: "O-8", route: "/", name: "automatic looping medication rail", run: async ({ page, check }) => {
    const track = page.locator("[data-med-track]"); const before = translateX(await track.evaluate((node) => getComputedStyle(node).transform)); await page.waitForTimeout(3200); const after = translateX(await track.evaluate((node) => getComputedStyle(node).transform)); const dots = await page.locator("[data-med-dots] button").count(); check(Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) > 2 && dots === 7, "rail advances automatically with a complete seven-position loop model", { before, after, dots }, { transformChangeMin: 2, dots: 7 }, "browser_interaction");
  } },
  { id: "O-9", route: "/", name: "medication card text contrast", run: async ({ page, check }) => {
    // 2026-08-26 med-rail overlay redesign: the title/qualifier now sit ON the
    // art over a dark scrim; contrast is asserted against the scrim's dark base.
    const observed = await page.locator("[data-med-card]").evaluateAll((cards) => cards.map((card) => { const title = card.querySelector(".cs-home-med__overlay h3"); const scrim = card.querySelector(".cs-home-med__scrim"); return { color: getComputedStyle(title).color, scrim: scrim ? getComputedStyle(scrim).backgroundImage : "" }; })); const ratios = observed.map((row) => (/gradient/.test(row.scrim) ? contrast(rgb(row.color), [4, 16, 12]) : 0)); check(ratios.length === 7 && ratios.every((value) => value >= 4.5), "medication titles read against the scrim's dark base at AA or better", ratios, { minimum: 4.5 });
  } },
  { id: "O-10", route: "/", name: "palette cards with hover aurora", run: async ({ page, check }) => {
    // 2026-08-26 overlay redesign: hover state = aurora veil brighten + lift.
    const section = page.locator(".cs-home2-meds"); await section.scrollIntoViewIfNeeded(); await page.waitForTimeout(1_000); const index = await section.evaluate((root) => { const viewport = root.querySelector("[data-med-viewport]").getBoundingClientRect(); return [...root.querySelectorAll("[data-med-card]")].findIndex((node) => { const box = node.getBoundingClientRect(); return box.left >= viewport.left && box.right <= viewport.right; }); }); const card = page.locator("[data-med-card]").nth(Math.max(0, index)); const veil = card.locator(".cs-home-med__veil"); const before = await veil.evaluate((node) => ({ opacity: Number(getComputedStyle(node).opacity), background: getComputedStyle(node).backgroundImage })); const box = await card.boundingBox(); if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(500); const after = await veil.evaluate((node) => ({ opacity: Number(getComputedStyle(node).opacity), hovered: node.closest("[data-med-card]").matches(":hover") })); check(index >= 0 && Boolean(box) && after.hovered && /gradient/.test(before.background) && after.opacity > before.opacity, "card carries the Clinic Scout aurora veil and brightens it on hover", { index, box, before, after }, { fullyVisibleCard: true, gradient: true, hovered: true, hoverChange: true }, "browser_interaction");
  } },
  { id: "O-11", route: "/", name: "medication card button treatment", run: async ({ page, check }) => {
    // 2026-08-26 overlay redesign: the affordance is the bottom-right white
    // pill on each whole-card link (their h36 pill; tap target = the card).
    const observed = await page.locator(".cs-home-med__pill").evaluateAll((nodes) => nodes.map((node) => ({ display: getComputedStyle(node).display, color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor, height: node.getBoundingClientRect().height, cardIsLink: node.closest("a[href][data-med-card]") !== null }))); const ratios = observed.map((row) => contrast(rgb(row.color), rgb(row.background))); check(observed.length === 7 && observed.every((row) => row.background === "rgb(255, 255, 255)" && row.height >= 36 && row.cardIsLink) && ratios.every((value) => value >= 7), "every card carries a white high-contrast price/CTA pill on a whole-card link", { observed, ratios }, { count: 7, background: "white", minContrast: 7 });
  } },
  { id: "O-12", route: "/", name: "compounded cost-card contrast", run: async ({ page, check }) => {
    const observed = await page.locator("[data-price-card]").first().evaluate((card) => { const paragraph = card.querySelector("h3 + p"); return { text: paragraph.textContent.trim(), color: getComputedStyle(paragraph).color, background: getComputedStyle(card).backgroundColor, backgroundImage: getComputedStyle(card).backgroundImage }; }); const ratio = contrast(rgb(observed.color), rgb(observed.background)); check(ratio >= 4.5 || (/gradient/.test(observed.backgroundImage) && rgb(observed.color)?.every((value) => value < 80)), "compounded lower-price copy is readable on its served card", { ...observed, ratio }, { minimumContrast: 4.5 });
  } },
  { id: "O-13", route: "/", name: "paired cost cards share readable formatting", run: async ({ page, check }) => {
    const observed = await page.locator("[data-price-card]").evaluateAll((cards) => cards.map((card) => { const h3 = card.querySelector("h3"); const action = card.querySelector("a"); return { heading: h3.textContent.trim(), headingColor: getComputedStyle(h3).color, actionBackground: getComputedStyle(action).backgroundColor, actionColor: getComputedStyle(action).color, actionHeight: action.getBoundingClientRect().height }; })); check(observed.length === 2 && observed.every((row) => rgb(row.headingColor)?.every((value) => value < 80) && row.actionHeight >= 44 && contrast(rgb(row.actionColor), rgb(row.actionBackground)) >= 4.5), "compounded and brand cards use matching readable black-copy/button treatment", observed, { cards: 2, readable: true });
  } },
  { id: "O-14", route: "/self-pay/", name: "compare-both-paths spacing and identities", run: async ({ page, check }) => {
    const observed = await page.evaluate(() => { const nav = document.querySelector(".gcs-nav")?.getBoundingClientRect(); const heading = document.querySelector("h1")?.getBoundingClientRect(); return { gap: nav && heading ? heading.top - nav.bottom : null, identities: document.querySelectorAll(".provider-logo img,.provider-wordmark").length }; }); check(observed.gap !== null && observed.gap <= 200 && observed.identities > 0, "compare-both-paths begins near the nav and serves provider identities", observed, { gapMax: 200, identitiesMin: 1 });
  } },
  { id: "O-15", route: "/providers/mademed/", name: "exact source-reported dose rows", run: async ({ page, check }) => {
    const observed = await page.locator(".p3-dose-grid[data-dose-model]").evaluateAll((nodes) => nodes.map((node) => ({ model: node.dataset.doseModel, rows: node.querySelectorAll("[data-dose-row]").length, placeholder: /Not published|UNKNOWN_NO_SOURCE/.test(node.textContent), dated: Boolean(node.querySelector("time[datetime]")), sourced: Boolean(node.querySelector('a[href^="https://"]')) }))); const valid = observed.length === 2 && observed.reduce((sum, row) => sum + row.rows, 0) === 11 && observed.every((row) => row.model === "source-reported-per-dose" && row.rows > 0 && !row.placeholder && row.dated && row.sourced); check(valid, "dose UI renders only the two exact source-reported detail grids and eleven bound rows", observed, { grids: 2, rows: 11, model: "source-reported-per-dose", placeholders: 0 });
  } },
  { id: "O-16", route: "/", name: "large trust-care cards", run: async ({ page, check }) => {
    await page.locator(".cs-home2-carecard").first().scrollIntoViewIfNeeded(); const observed = await page.locator(".cs-home2-carecard").evaluateAll((nodes) => nodes.map((node) => ({ cardHeight: node.getBoundingClientRect().height, mediaHeight: node.querySelector(".cs-home2-carecard__art")?.getBoundingClientRect().height || 0 }))); check(observed.length === 3 && observed.every((row) => row.cardHeight >= 429 && row.mediaHeight >= 199), "trust trio uses substantial card geometry at the current desktop contract", observed, { count: 3, cardHeightMin: 429, mediaHeightMin: 199 });
  } },
  { id: "O-17", route: "/", name: "provider identity restored across surfaces", run: async ({ page, check }) => {
    const surfaces = []; for (const route of ["/", "/providers/", "/self-pay/"]) { await openServed(page, route); const identities = await page.locator(".provider-logo img,.provider-wordmark,.review-logo img").evaluateAll((nodes) => nodes.filter((node) => { const style = getComputedStyle(node); return style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().width > 0; }).length); surfaces.push({ route, identities }); } await openServed(page, "/reviews/coivas/"); const coivas = await page.locator('.ready6-provider-mark img[src="/assets/provider-logos/coivas.svg"][alt="Coivas logo"]').evaluate((node) => ({ visible: node.getBoundingClientRect().width > 0, naturalWidth: node.naturalWidth, currentSrc: node.currentSrc })); check(surfaces.every((row) => row.identities > 0) && coivas.visible && coivas.naturalWidth > 0 && /\/assets\/provider-logos\/coivas\.svg$/.test(new URL(coivas.currentSrc).pathname), "provider/company identities are visible and READY6 network IDs resolve available canonical logos", { surfaces, coivas }, { eachSurfaceMin: 1, coivasCanonicalLogo: true });
  } },
  { id: "O-18", route: "/", name: "risk cards hover out without visible latch label", run: async ({ page, check }) => {
    const risk = page.locator("[data-risk-card]").first(); await risk.scrollIntoViewIfNeeded(); await page.waitForTimeout(1_000); const visibleLabelCount = await page.getByText(/Tap to check/i).count(); const back = risk.locator(".cs-riskcard__back"); await risk.hover(); let hoverOpacity = 0; for (let attempt = 0; attempt < 8 && hoverOpacity <= 0.9; attempt += 1) { await page.waitForTimeout(150); hoverOpacity = Number(await back.evaluate((node) => getComputedStyle(node).opacity)); } await page.mouse.move(1, 1); let outOpacity = hoverOpacity; for (let attempt = 0; attempt < 8 && outOpacity >= 0.1; attempt += 1) { await page.waitForTimeout(150); outOpacity = Number(await back.evaluate((node) => getComputedStyle(node).opacity)); } check(visibleLabelCount === 0 && hoverOpacity > 0.9 && outOpacity < 0.1 && await risk.getAttribute("aria-pressed") === "false", "risk card reveals on hover, restores on mouseout, and omits Tap to check", { visibleLabelCount, hoverOpacity, outOpacity, ariaPressed: await risk.getAttribute("aria-pressed") }, { labelCount: 0, hoverOpacityMin: 0.9, outOpacityMax: 0.1 }, "browser_interaction");
  } },
  { id: "O-19", route: "/", name: "verdict cards readable with provider identities", run: async ({ page, check }) => {
    await page.locator(".cs-home2-verdict").first().scrollIntoViewIfNeeded(); const observed = await page.locator(".cs-home2-verdict").evaluateAll((nodes) => nodes.map((node) => { const name = node.querySelector("h3,.provider-wordmark"); const identity = node.querySelector(".provider-logo img,.provider-wordmark"); return { identity: Boolean(identity), text: name?.textContent.trim() || "", color: name ? getComputedStyle(name).color : "", background: getComputedStyle(node).backgroundColor }; })); observed.forEach((row) => { row.ratio = contrast(rgb(row.color), rgb(row.background)); }); check(observed.length >= 3 && observed.every((row) => row.identity && row.text && row.ratio >= 4.5), "verdict cards serve provider identity and readable names", observed, { countMin: 3, contrastMin: 4.5 });
  } },
  { id: "O-20", route: "/", name: "all-programs CTA centered under strongest section", run: async ({ page, check }) => {
    const liveLabel = ((await page.locator(".cs-home2-strongest").getByText(/See all \d+ programs/i).first().textContent()) || "").trim(); const observed = await centeredDelta(page, ".cs-home2-strongest", liveLabel); check(/^See all \d+ programs$/i.test(liveLabel) && observed && observed.delta <= 2, "the live all-programs CTA is centered beneath the full section", { liveLabel, ...observed }, { dynamicCountLabel: true, deltaMaxPx: 2 });
  } },
  { id: "O-21", route: "/", name: "weekly-price-watch CTA centered", run: async ({ page, check }) => {
    // 2026-08-26 editorial merge: the price-watch pill lives in the editorial
    // panel's centered head (the news band folded into that panel).
    const observed = await centeredDelta(page, ".cs-home2-editorial__head", "Get the weekly price watch"); check(observed && observed.delta <= 2, "Get the weekly price watch is centered in the editorial panel head", observed, { deltaMaxPx: 2 });
  } },
  { id: "O-22", route: "/", name: "review capture heading contrast", run: async ({ page, check }) => {
    // 2026-08-26: the capture band grew into the review wall on the bare page
    // ground; the heading reads against the page background.
    const observed = await page.locator(".cs-home2-wall h2").first().evaluate((heading) => ({ color: getComputedStyle(heading).color, background: getComputedStyle(document.body).backgroundColor })); observed.ratio = contrast(rgb(observed.color), rgb(observed.background)); check(observed.ratio >= 4.5, "share-experience heading is readable against its ground", observed, { minimumContrast: 4.5 });
  } },
  { id: "O-23", route: "/", name: "review form fields and submit reachable", run: async ({ page, check }) => {
    // Home uses the compact moderation form; the standalone review route keeps
    // the full two-step evidence/counterpart workflow.
    await page.locator("[data-review-open]").first().click(); await page.waitForTimeout(500); const sheet = page.locator("[data-review-sheet]"); const panel = sheet.locator(".cs-review-sheet__panel"); const observed = await panel.evaluate((node) => { const form = node.querySelector("form"); const primaryStep = form.querySelector('[data-review-step="primary"]'); const fields = ["public_display_name", "verification_email"].map((name) => form.querySelector(`[name="${name}"]`).closest("label")); return { panel: node.getBoundingClientRect().toJSON(), overflowY: getComputedStyle(node).overflowY, columns: getComputedStyle(form).gridTemplateColumns.split(" ").filter(Boolean).length, primaryWidth: primaryStep.getBoundingClientRect().width, fieldTops: fields.map((field) => field.getBoundingClientRect().top), compact: form.hasAttribute("data-review-compact"), hasCounterpart: Boolean(form.querySelector('[data-review-step="counterpart"]')), hasEvidenceUpload: Boolean(form.querySelector('input[type="file"]')) }; }); observed.firstRowDelta = Math.max(...observed.fieldTops) - Math.min(...observed.fieldTops); const primaryAction = sheet.getByRole("button", { name: "Submit for review", exact: true }); observed.actionInViewport = await primaryAction.isVisible() && await primaryAction.evaluate((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }); check(observed.panel.height <= 900 && /auto|scroll/.test(observed.overflowY) && observed.columns === 1 && observed.primaryWidth > 600 && observed.firstRowDelta < 2 && observed.compact && !observed.hasCounterpart && !observed.hasEvidenceUpload && observed.actionInViewport, "review panel is bounded, compact, and keeps its moderation submit action in the desktop viewport", observed, { viewportHeightMax: 900, outerColumns: 1, primaryWidthMin: 600, overflowY: "auto|scroll", firstRowDeltaMax: 2, compact: true, actionInViewport: true }, "browser_interaction");
  } },
  { id: "O-24", route: "/", name: "review sheet current open and close semantics", run: async ({ page, check }) => {
    const trigger = page.locator("[data-review-open]").first(); const initial = await page.evaluate(() => { document.querySelector("[data-review-open]").click(); const panel = document.querySelector("[data-review-sheet] .cs-review-sheet__panel"); return { transform: getComputedStyle(panel).transform, width: panel.getBoundingClientRect().width }; }); const sheet = page.locator("[data-review-sheet]"); const panel = sheet.locator(".cs-review-sheet__panel"); await page.waitForTimeout(350); const open = translateX(await panel.evaluate((node) => getComputedStyle(node).transform)); await page.keyboard.press("Escape"); await sheet.waitFor({ state: "hidden", timeout: 250 }); const keyboardFocusReturned = await trigger.evaluate((node) => document.activeElement === node); await trigger.click(); await sheet.locator(".cs-review-sheet__backdrop").click({ position: { x: 4, y: 4 } }); await sheet.waitFor({ state: "hidden", timeout: 1_000 }); const observed = { initial: translateX(initial.transform), width: initial.width, open, keyboardHidden: await sheet.isHidden(), keyboardFocusReturned, pointerHidden: await sheet.isHidden(), pointerFocusReturned: await trigger.evaluate((node) => document.activeElement === node) }; check(observed.initial > observed.width * 0.9 && Math.abs(open) < 2 && observed.keyboardHidden && observed.keyboardFocusReturned && observed.pointerHidden && observed.pointerFocusReturned, "review sheet begins off-canvas, opens, closes instantly from Escape, and closes from the pointer backdrop with focus return", observed, { offCanvasInitial: true, open: true, keyboardHidden: true, pointerHidden: true, focusReturned: true }, "browser_interaction");
  } },
  { id: "O-25", route: "/", name: "review capture handler and durable moderation readbacks", run: async ({ api, check }) => {
    const invalid = await api.post("/api/review-capture", { data: {} }); let invalidBody = {}; try { invalidBody = await invalid.json(); } catch { invalidBody = { text: (await invalid.text()).slice(0, 300) }; }
    const load = (name) => JSON.parse(readFileSync(path.join(REPORT_DIR, name), "utf8")); const readonly = load("PASS2-O25-CLOUDFLARE-READONLY-20260824.json"); const schema = load("PASS2-O25-D1-SCHEMA-APPLY-20260824.json"); const mode = load("PASS2-O25-CLOUDFLARE-MODE-20260824.json"); const e2e = load("PASS2-O25-D1-E2E-20260824.json"); const live = load("PASS2-O25-LIVE-ROUTE-READBACK-20260824.json"); const observed = { candidateInvalidStatus: invalid.status(), candidateInvalidBody: invalidBody, binding: readonly.d1?.binding, tableExists: schema.readback?.table_exists, columnCount: schema.readback?.columns?.length, mode: mode.readback?.mode, e2eStatus: e2e.http_status, landed: e2e.landed_readback, moderated: e2e.moderation_readback, liveUndeployedStatus: live.http_status, deployCounts: [readonly.deployments, schema.deployments, mode.deployments, e2e.deployments, live.deployments] }; const valid = [400, 422].includes(observed.candidateInvalidStatus) && observed.binding === "GLP_DB" && observed.tableExists === true && observed.columnCount === 19 && observed.mode === "enabled" && observed.e2eStatus === 202 && observed.landed?.moderation_status === "held_manual_review" && observed.moderated?.moderation_status === "rejected" && observed.liveUndeployedStatus === 404 && observed.deployCounts.every((value) => value === 0); check(valid, "served candidate handler plus D1 landed/moderated API readbacks prove the durable store without deployment", observed, { candidateInvalidStatus: [400, 422], binding: "GLP_DB", tableExists: true, e2eStatus: 202, deployCounts: [0, 0, 0, 0, 0] }, "api_readback");
  } },
  { id: "O-26", route: "/tools/glp-1-cost-calculator/", name: "direct viewport-fit calculator", run: async ({ page, check }) => {
    // 2026-08-26 calculator-tools design pass: the H1 is VISIBLE now (split
    // hero-workspace, headline + price anchor left / form card right), so the
    // invariant is one visible semantic heading, a live estimate column at
    // first paint, and the form still starting under the nav inside one
    // laptop viewport.
    const observed = await page.evaluate(() => { const nav = document.querySelector(".gcs-nav")?.getBoundingClientRect(); const form = document.querySelector("#cost-form")?.getBoundingClientRect(); const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 1 && rect.height > 1; }; const visibleH1Count = [...document.querySelectorAll("h1")].filter(visible).length; const idle = document.querySelector("#cost-idle"); return { visibleH1Count, semanticH1Count: document.querySelectorAll("h1").length, idleVisible: Boolean(idle && visible(idle)), gap: nav && form ? form.top - nav.bottom : null, bottom: form?.bottom ?? null, viewportHeight: innerHeight }; }); check(observed.visibleH1Count === 1 && observed.semanticH1Count === 1 && observed.idleVisible && observed.gap >= 0 && observed.gap <= 200 && observed.bottom <= observed.viewportHeight + 1, "calculator route lands directly on the split viewport-fit tool with one visible heading and a live estimate column", observed, { visibleH1Count: 1, semanticH1Count: 1, idleVisible: true, gapMax: 200 });
  } },
  { id: "O-27", route: "/tools/glp-1-cost-calculator/", name: "price-updates action retained", run: async ({ page, check }) => {
    const locator = page.getByRole("button", { name: "Get price updates", exact: true }); const observed = { count: await locator.count(), visible: await locator.first().isVisible().catch(() => false), height: await locator.first().evaluate((node) => node.getBoundingClientRect().height).catch(() => 0) }; check(observed.count === 1 && observed.visible && observed.height >= 44, "Get price updates remains a visible reachable control", observed, { count: 1, minHeight: 44 });
  } },
  { id: "O-28", route: "/tools/glp-1-cost-calculator/", name: "email capture has no checkbox gate", run: async ({ page, check }) => {
    const surfaces = []; for (const route of ["/tools/glp-1-cost-calculator/", "/", "/insights/", "/guides/trimi-vs-yourera/", "/guides/mounjaro-coupon/"]) { await openServed(page, route); surfaces.push({ route, consentCheckboxes: await page.locator(CONSENT_SELECTORS).count() }); } await openServed(page, "/tools/glp-1-cost-calculator/"); await page.getByRole("button", { name: "Get price updates", exact: true }).click(); const sheet = page.locator("[data-subscribe-layer],.cs-subscribe-sheet").filter({ visible: true }).first(); const observed = { surfaces, sheetEmail: await sheet.locator('input[type="email"]').count(), sheetConsent: await sheet.locator(CONSENT_SELECTORS).count(), privacyLinks: await sheet.locator('a[href="/privacy/"]').count() }; check(surfaces.every((row) => row.consentCheckboxes === 0) && observed.sheetEmail === 1 && observed.sheetConsent === 0 && observed.privacyLinks > 0, "every sampled subscribe surface uses email submission without a checkbox gate", observed, { allConsentCheckboxes: 0, email: 1 }, "browser_interaction");
  } },
  { id: "O-29", route: "/", name: "search pre-navigation choreography", run: async ({ page, check }) => {
    await page.locator(".cs-search-toggle").click(); const panel = page.locator(".cs-search-panel"); const input = panel.locator('input[type="search"]'); await input.fill("wegovy"); await page.waitForTimeout(80); const loading = { searching: /is-searching/.test(await panel.getAttribute("class") || ""), visible: await panel.locator(".cs-search-loading").isVisible().catch(() => false) }; await page.waitForTimeout(1000); const hits = panel.locator(".cs-search-hit"); const hitCount = await hits.count(); let transition = { classSignal: false, markerSignal: false, animationSignal: false }; if (hitCount > 0) { const target = new URL(await hits.first().getAttribute("href"), page.url()).href; await page.route(target, async (route) => { await new Promise((resolve) => setTimeout(resolve, 450)); await route.continue(); }); await hits.first().click({ noWaitAfter: true }); await page.waitForTimeout(80); transition = await page.evaluate(() => { const candidates = [document.documentElement, document.body, document.querySelector(".cs-search-panel"), ...document.querySelectorAll("[data-search-transition],.cs-search-transition,.cs-page-transition")].filter(Boolean); return { classSignal: candidates.some((node) => /(navigat|depart|transition|leav|launch)/i.test(node.className || "")), markerSignal: document.querySelectorAll("[data-search-transition],.cs-search-transition,.cs-page-transition").length > 0, animationSignal: candidates.some((node) => node.getAnimations().some((animation) => Number(animation.effect?.getTiming?.().duration || 0) >= 100 && animation.playState !== "finished")) }; }); } const observed = { loading, hitCount, transition }; check(loading.searching && loading.visible && hitCount > 0 && Object.values(transition).some(Boolean), "search serves loading, results, and an observable pre-navigation transition", observed, { loading: true, hitCountMin: 1, transition: true }, "browser_interaction");
  } },
  { id: "O-30", route: "/providers/", name: "site-wide top-spacing audit", run: async ({ page, check }) => {
    const routes = [["/providers/", "h1"], ["/reviews/coivas/", "h1"], ["/lp/best-providers/compounded-semaglutide/", "h1"], ["/wegovy/", "h1"], ["/3-month/", "h1"], ["/insights/", "h1"], ["/guides/trimi-vs-yourera/", "h1"], ["/pharmacies/", "h1"], ["/pharmacies/red-rock/", "h1"], ["/quiz/provider-fit/", "h1"], ["/tools/glp-1-cost-calculator/", "#cost-form"]]; const observed = []; for (const viewport of [{ name: "desktop", width: 1440, height: 900, maxGap: 200 }, { name: "mobile", width: 390, height: 844, maxGap: 160 }]) { await page.setViewportSize({ width: viewport.width, height: viewport.height }); for (const [route, selector] of routes) { const status = await openServed(page, route); const geometry = await page.evaluate((selector) => { const nav = document.querySelector(".gcs-nav")?.getBoundingClientRect(); const target = document.querySelector(selector)?.getBoundingClientRect(); return { gap: nav && target ? target.top - nav.bottom : null, top: target?.top ?? null, viewportHeight: innerHeight }; }, selector); observed.push({ viewport: viewport.name, route, status, maxGap: viewport.maxGap, ...geometry }); } } check(observed.every((row) => row.status === 200 && row.gap !== null && row.gap <= row.maxGap && row.top < row.viewportHeight * 0.5), "all representative templates begin close to the shared nav and above the fold", observed, { allStatus: 200, desktopGapMax: 200, mobileGapMax: 160 });
  } },
  { id: "O-31", route: "/", name: "measured smooth scrolling", run: async ({ page, check }) => {
    const observed = []; for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) { await page.setViewportSize({ width: viewport.width, height: viewport.height }); const trials = []; for (let trial = 0; trial < 3; trial += 1) { await openServed(page, "/"); trials.push(await scrollMetrics(page)); } const ranked = [...trials].sort((left, right) => left.frameDeltaP95Ms - right.frameDeltaP95Ms); observed.push({ viewport: viewport.name, trials, selectedMedian: ranked[1] }); } check(observed.every((row) => row.selectedMedian.frameDeltaP95Ms <= 35 && row.selectedMedian.severeFramesOver50 <= 3 && row.selectedMedian.longTaskTotalMs <= 200), "median of three home scroll trials stays within explicit desktop/mobile frame and long-task budgets", observed, { trialsPerViewport: 3, p95MaxMs: 35, severeFramesMax: 3, longTaskTotalMaxMs: 200 }, "browser_interaction");
  } },
  { id: "O-32", route: "/", name: "GSAP and Lenis active runtime", run: async ({ page, check }) => {
    const observed = await page.evaluate(() => ({ gsap: Boolean(window.gsap), scrollTrigger: Boolean(window.ScrollTrigger), triggerCount: window.ScrollTrigger?.getAll?.().length || 0, lenis: Boolean(window.lenis || window.__lenis || window.__gcsLenis || document.documentElement.classList.contains("lenis")), animatedElements: [...document.querySelectorAll("*")].filter((node) => node.getAnimations().length > 0).length })); check(observed.gsap && observed.scrollTrigger && observed.triggerCount > 0 && observed.lenis && observed.animatedElements > 0, "GSAP/ScrollTrigger and Lenis are present and doing observable runtime work", observed, { gsap: true, scrollTrigger: true, triggerCountMin: 1, lenis: true, animatedElementsMin: 1 });
  } },
  { id: "O-33", route: "/", name: "served house-style hero image family", run: async ({ page, api, check }) => {
    const observed = await page.locator(".cs-home2-cluster picture").evaluateAll((nodes) => nodes.map((picture) => { const image = picture.querySelector("img"); return { src: image.currentSrc, alt: image.alt, width: image.naturalWidth, height: image.naturalHeight, avif: picture.querySelector('source[type="image/avif"]')?.srcset || "", webp: picture.querySelector('source[type="image/webp"]')?.srcset || "" }; })); const hashes = []; for (const row of observed) { const response = await api.get(new URL(row.src).pathname); hashes.push(sha256(await response.body())); } check(observed.length === 3 && new Set(hashes).size === 3 && observed.every((row) => row.width > 0 && row.height > 0 && row.alt && row.avif && row.webp), "home serves three distinct decoded responsive images defining the local house style", { observed, hashes }, { count: 3, uniqueHashes: 3 });
  } },
  { id: "O-34", route: "/sitemap.xml", name: "unique relevant art for every served article", run: async ({ api, browser, check }) => {
    const corpus = await servedArticleCorpus(api, browser);
    const redirectProblems = corpus.consolidatedRecords.filter((row) => !row.expectedConsolidatedRedirect
      || row.initialStatus !== 301
      || row.location !== row.expectedLocation
      || row.redirectHopCount !== 1
      || row.finalStatus !== 200
      || row.finalPath !== "/providers/");
    const altAuthorityProblems = corpus.activeRecords.filter((row) => !row.alt.trim() || row.alt !== row.expectedAlt)
      .map((row) => ({ route: row.route, observed: row.alt, expected: row.expectedAlt }));
    const servedMasterHashProblems = corpus.records.filter((row) => {
      const expected = corpus.manifest.records.find((record) => record.route === row.route)?.outputs
        ?.find((output) => output.name === `${row.stem}-1600.jpg`)?.sha256;
      return !expected || row.imageStatus !== 200 || row.imageSha256 !== expected;
    }).map((row) => row.route);
    const observed = {
      manifestSchema: corpus.manifest.schema,
      manifestStatus: corpus.manifest.status,
      contractRoutes: corpus.records.length,
      activeArticlePages: corpus.activeRecords.length,
      consolidatedRedirects: corpus.consolidatedRecords.length,
      uniqueRoutes: new Set(corpus.records.map((row) => row.route)).size,
      uniqueStems: new Set(corpus.records.map((row) => row.stem)).size,
      uniqueSubjects: new Set(corpus.records.map((row) => row.subject)).size,
      uniqueMasterHashes: new Set(corpus.records.map((row) => row.masterSha256)).size,
      manifestProblems: corpus.manifestProblems,
      outputProblems: corpus.outputProblems,
      visualQa: {
        schema: corpus.visualQa.schema,
        status: corpus.visualQa.status,
        reviewer: corpus.visualQa.reviewer,
        routeMasterCount: corpus.visualQa.route_master_count,
        sheetCount: corpus.visualQa.sheet_count,
        regenerationRequired: corpus.visualQa.regeneration_required,
        problems: corpus.visualQaProblems,
      },
      releaseTechnicalRoutes: corpus.releaseTechnicalRoutes,
      historicalQaRouteCount: corpus.historicalQaRoutes.length,
      perceptual: {
        algorithm: "256-bit horizontal luminance dHash",
        minimumHammingDistance: MIN_ARTICLE_DHASH_DISTANCE,
        closestPairDistance: corpus.closestPerceptualPair.distance,
        closestPairRoutes: corpus.closestPerceptualPair.routes,
        validHashCount: corpus.records.filter((row) => /^[a-f0-9]{64}$/.test(row.perceptualHash || "")).length,
      },
      servedMasterHashProblems,
      altAuthorityProblems,
      redirectProblems,
    };
    check(
      observed.manifestSchema === "glp-article-image-system-v3"
        && observed.manifestStatus === "PASS"
        && observed.contractRoutes === 77
        && observed.activeArticlePages === 72
        && observed.consolidatedRedirects === 5
        && observed.uniqueRoutes === 77
        && observed.uniqueStems === 77
        && observed.uniqueSubjects === 77
        && observed.uniqueMasterHashes === 77
        && observed.manifestProblems.length === 0
        && observed.outputProblems.length === 0
        && observed.visualQa.status === "PASS"
        && observed.visualQa.routeMasterCount === 73
        && observed.visualQa.sheetCount === 9
        && observed.historicalQaRouteCount === 73
        && observed.releaseTechnicalRoutes.length === 4
        && observed.visualQa.regenerationRequired.length === 0
        && observed.visualQa.problems.length === 0
        && observed.perceptual.validHashCount === 77
        && observed.perceptual.closestPairDistance >= MIN_ARTICLE_DHASH_DISTANCE
        && observed.servedMasterHashProblems.length === 0
        && observed.altAuthorityProblems.length === 0
        && observed.redirectProblems.length === 0,
      "O-34 exact v3 route/subject/master lineage, 73 historical QA plus 4 technical release records (not visual acceptance), canonical alts, and perceptual threshold",
      observed,
      { routes: 77, schema: "glp-article-image-system-v3", historicalVisualQaRoutes: 73, releaseTechnicalRoutes: 4, visualQaSheets: 9, minimumHammingDistance: MIN_ARTICLE_DHASH_DISTANCE, canonicalActiveAlts: 72 },
      "browser_capture",
    );
  } },
  { id: "O-35", route: "/sitemap.xml", name: "complete served article image backfill", run: async ({ api, browser, check }) => {
    const corpus = await servedArticleCorpus(api, browser);
    const incomplete = corpus.activeRecords.filter((row) => {
      const expected = expectedArticleOutputs(row.stem);
      const assetsComplete = row.assets.length === 7 && row.assets.every((asset) => {
        const contract = expected.get(path.basename(asset.url));
        return contract
          && asset.status === 200
          && asset.location === ""
          && asset.bytes > 0
          && asset.sha256 === asset.expectedSha256
          && asset.contentType === contract.contentType
          && asset.width === contract.width
          && asset.height === contract.height;
      });
      return row.initialStatus !== 200
        || row.finalStatus !== 200
        || row.finalPath !== row.route
        || !row.picture.complete
        || row.picture.image?.src !== row.imageUrl
        || row.alt !== row.expectedAlt
        || row.width !== "1600"
        || row.height !== "900"
        || !assetsComplete;
    }).map((row) => ({
      route: row.route,
      initialStatus: row.initialStatus,
      finalStatus: row.finalStatus,
      finalPath: row.finalPath,
      picture: row.picture,
      alt: row.alt,
      expectedAlt: row.expectedAlt,
      width: row.width,
      height: row.height,
      assets: row.assets,
    }));
    const redirected = corpus.consolidatedRecords.filter((row) => {
      const expected = expectedArticleOutputs(row.stem);
      return !row.expectedConsolidatedRedirect
        || row.initialStatus !== 301
        || row.location !== row.expectedLocation
        || row.redirectHopCount !== 1
        || row.finalStatus !== 200
        || row.finalPath !== "/providers/"
        || row.assets.length !== 7
        || row.assets.some((asset) => {
          const contract = expected.get(path.basename(asset.url));
          return !contract || asset.status !== 200 || asset.location || asset.sha256 !== asset.expectedSha256 || asset.contentType !== contract.contentType;
        });
    }).map((row) => ({ route: row.route, initialStatus: row.initialStatus, location: row.location, redirectHopCount: row.redirectHopCount, finalStatus: row.finalStatus, finalPath: row.finalPath, assets: row.assets }));
    const observed = {
      contractRoutes: corpus.records.length,
      activeArticlePages: corpus.activeRecords.length,
      consolidatedRedirects: corpus.consolidatedRecords.length,
      outputsPerContract: 7,
      servedAssetCount: corpus.records.reduce((sum, row) => sum + row.assets.length, 0),
      localOutputProblems: corpus.outputProblems,
      incomplete,
      redirected,
    };
    check(
      observed.contractRoutes === 77
        && observed.activeArticlePages === 72
        && observed.consolidatedRedirects === 5
        && observed.servedAssetCount === 539
        && observed.localOutputProblems.length === 0
        && observed.incomplete.length === 0
        && observed.redirected.length === 0,
      "O-35 exact bound picture plus all seven hash/MIME outputs and one-hop redirects",
      observed,
      { contractRoutes: 77, activeArticlePages: 72, consolidatedRedirects: 5, servedAssets: 539, incomplete: [], redirected: [] },
      "served_http",
    );
  } },
  { id: "O-36", route: "/providers/orderlymeds/", name: "specific local provider/review imagery", run: async ({ page, api, check }) => {
    const providerManifest = readJsonFile(PROVIDER_LOGO_MANIFEST_PATH);
    const atlasManifest = readJsonFile(PROVIDER_ATLAS_MANIFEST_PATH);
    const sceneManifest = readJsonFile(PROVIDER_SCENE_MANIFEST_PATH);
    const sceneState = readJsonFile(PROVIDER_SCENE_STATE_PATH);
    const orderly = providerManifest.logos?.find((logo) => logo.program_id === "orderlymeds");
    const atlasEntry = atlasManifest.entries?.find((entry) => entry.program_id === "orderlymeds");
    const orderlyScene = sceneManifest.records?.find((record) => record.program_id === "orderlymeds");
    const orderlySceneState = sceneState.records?.orderlymeds;
    const manifestProblems = [];
    if (providerManifest.status !== "PASS" || providerManifest.runtime_remote_assets !== 0 || providerManifest.count !== 57 || providerManifest.logos?.length !== providerManifest.count) manifestProblems.push("provider_manifest_contract");
    if (!orderly
      || orderly.provider !== "OrderlyMeds"
      || orderly.logo_treatment !== "light-chip"
      || orderly.output_file !== "orderlymeds.webp"
      || orderly.public_path !== "/assets/provider-logos/orderlymeds.webp"
      || orderly.output_sha256 !== "eab41bf3122ef6f46aaa6a034e37a8bd4fe20a2bd25f5de6ec2dc0e7ca05b0d3"
      || orderly.width !== 345
      || orderly.height !== 63
      || orderly.runtime_remote_load !== false) manifestProblems.push("orderly_provider_manifest_lineage");
    if (atlasManifest.schema !== "glp-provider-logo-lp-atlas-v1"
      || atlasManifest.status !== "PASS"
      || atlasManifest.public_path !== "/assets/provider-logos/pass2-lp-atlas.webp"
      || atlasManifest.source_manifest_sha256 !== fileHash(PROVIDER_LOGO_MANIFEST_PATH)
      || atlasManifest.atlas_sha256 !== fileHash(path.join(CANDIDATE_ROOT, "assets/provider-logos/pass2-lp-atlas.webp"))
      || atlasManifest.atlas_sha256 !== fileHash(path.join(CANDIDATE_ROOT, "public/assets/provider-logos/pass2-lp-atlas.webp"))
      || atlasManifest.display_atlas_width !== 768
      || atlasManifest.display_atlas_height !== 368
      || atlasManifest.entry_count !== providerManifest.count) manifestProblems.push("atlas_manifest_lineage");
    if (!atlasEntry
      || atlasEntry.source_path !== "/assets/provider-logos/orderlymeds.webp"
      || atlasEntry.source_sha256 !== orderly?.output_sha256
      || atlasEntry.display_x !== 192
      || atlasEntry.display_y !== 184
      || atlasEntry.logo_treatment !== orderly?.logo_treatment) manifestProblems.push("orderly_atlas_entry_lineage");
    if (sceneManifest.schema !== "glp-pass2-provider-review-image-manifest-v1"
      || sceneManifest.status !== "PASS"
      || sceneManifest.provider_count !== 35
      || sceneManifest.passed_count !== 35
      || sceneManifest.derivative_count !== 210
      || sceneManifest.unique_master_hashes !== 35
      || sceneManifest.unique_derivative_hashes !== 210
      || sceneManifest.provider_calls_during_build !== 0) manifestProblems.push("provider_scene_manifest_contract");
    if (sceneState.schema !== "glp-pass2-provider-review-image-generation-v1"
      || sceneState.job_set_type !== "gpt_image_2"
      || sceneState.model !== "GPT Image 2"
      || sceneState.quality !== "high"
      || sceneState.resolution !== "4k"
      || Object.keys(sceneState.records || {}).length !== 35) manifestProblems.push("provider_scene_state_contract");
    if (!orderlyScene
      || !orderlySceneState
      || JSON.stringify(orderlyScene) !== JSON.stringify(orderlySceneState)
      || orderlyScene.status !== "PASS"
      || orderlyScene.display_name !== "OrderlyMeds"
      || orderlyScene.review_path !== "/reviews/orderlymeds/"
      || orderlyScene.subject !== "Provider-specific editorial evidence scene for the governed Clinic Scout identity OrderlyMeds."
      || orderlyScene.width !== 3840
      || orderlyScene.height !== 2160
      || orderlyScene.derivatives?.length !== 6
      || fileHash(path.join(CANDIDATE_ROOT, orderlyScene.output_relative_path || "")) !== orderlyScene.output_sha256) manifestProblems.push("orderly_scene_master_lineage");
    const expectedSceneByUrl = new Map();
    for (const derivative of orderlyScene?.derivatives || []) {
      const sourceFile = path.join(CANDIDATE_ROOT, derivative.path || "");
      const publicUrl = `/${(derivative.path || "").replace(/^assets\/derivatives\//, "assets/images/")}`;
      const publicFile = path.join(CANDIDATE_ROOT, "public", publicUrl);
      if (!existsSync(sourceFile)
        || !existsSync(publicFile)
        || fileHash(sourceFile) !== derivative.sha256
        || fileHash(publicFile) !== derivative.sha256) manifestProblems.push(`orderly_scene_derivative_lineage:${derivative.path}`);
      expectedSceneByUrl.set(publicUrl, derivative);
    }
    const sceneAssets = [];
    for (const [url, derivative] of expectedSceneByUrl) {
      const response = await api.get(url, { maxRedirects: 0 });
      const body = await response.body();
      const contentType = (response.headers()["content-type"] || "").split(";")[0].toLowerCase();
      const expectedContentType = url.endsWith(".avif") ? "image/avif" : url.endsWith(".webp") ? "image/webp" : "image/jpeg";
      sceneAssets.push({ url, status: response.status(), location: response.headers().location || "", contentType, expectedContentType, sha256: sha256(body), expectedSha256: derivative.sha256, bytes: body.length });
    }
    if (sceneAssets.length !== 6 || sceneAssets.some((asset) => asset.status !== 200 || asset.location || asset.contentType !== asset.expectedContentType || asset.sha256 !== asset.expectedSha256 || asset.bytes === 0)) manifestProblems.push("orderly_scene_served_derivative_lineage");

    const observed = { manifestProblems, sceneManifestSha256: fileHash(PROVIDER_SCENE_MANIFEST_PATH), sceneStateSha256: fileHash(PROVIDER_SCENE_STATE_PATH), sceneMasterSha256: orderlyScene?.output_sha256 || "", sceneAssets, provider: null, review: null, sceneProblems: [] };
    for (const route of ["/providers/orderlymeds/", "/reviews/orderlymeds/"]) {
      const status = await openServed(page, route);
      const finalPath = new URL(page.url()).pathname;
      const sceneCandidates = await page.locator('picture img:not([src*="/provider-logos/"])').evaluateAll(async (nodes) => Promise.all(nodes.map(async (image) => {
        await image.decode().catch(() => {});
        const picture = image.closest("picture");
        return {
          currentSrc: new URL(image.currentSrc || image.src, location.href).pathname,
          src: image.getAttribute("src") || "",
          jpgSrcset: image.getAttribute("srcset") || "",
          sizes: image.getAttribute("sizes") || "",
          alt: image.alt,
          width: image.getAttribute("width") || "",
          height: image.getAttribute("height") || "",
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          avif: picture?.querySelector('source[type="image/avif"]')?.getAttribute("srcset") || "",
          avifSizes: picture?.querySelector('source[type="image/avif"]')?.getAttribute("sizes") || "",
          webp: picture?.querySelector('source[type="image/webp"]')?.getAttribute("srcset") || "",
          webpSizes: picture?.querySelector('source[type="image/webp"]')?.getAttribute("sizes") || "",
        };
      })));
      const scenePrefix = "/assets/images/provider-review-pass2/orderlymeds";
      const surface = route.startsWith("/providers/")
        ? {
          sizes: "(max-width:760px) calc(100vw - 32px), 720px",
          alt: "Original editorial evidence scene for the OrderlyMeds provider profile",
        }
        : {
          sizes: "(max-width:760px) calc(100vw - 32px), 920px",
          alt: "Editorial evidence desk for the OrderlyMeds review with a blank research dossier and comparison materials",
        };
      const specificScenes = sceneCandidates.filter((scene) => scene.src === `${scenePrefix}-1280.jpg`
        && scene.avif === `${scenePrefix}-640.avif 640w, ${scenePrefix}-1280.avif 1280w`
        && scene.webp === `${scenePrefix}-640.webp 640w, ${scenePrefix}-1280.webp 1280w`
        && scene.jpgSrcset === `${scenePrefix}-640.jpg 640w, ${scenePrefix}-1280.jpg 1280w`
        && scene.sizes === surface.sizes
        && scene.avifSizes === surface.sizes
        && scene.webpSizes === surface.sizes
        && scene.alt === surface.alt
        && scene.width === "1280"
        && scene.height === "720"
        && scene.naturalWidth > 0
        && scene.naturalHeight > 0);
      if (specificScenes.length !== 1) observed.sceneProblems.push({ route, problem: "missing_or_nonexact_responsive_orderly_specific_on_theme_scene", expectedSceneMasterSha256: orderlyScene?.output_sha256 || "", candidates: sceneCandidates });
      if (route.startsWith("/providers/")) {
        const selector = page.locator('.provider-logo[role="img"]');
        const count = await selector.count();
        const identities = count >= 1 ? await selector.evaluateAll((nodes) => nodes.map((node) => {
          const style = getComputedStyle(node);
          const backgroundUrl = style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1] || "";
          return {
            classes: [...node.classList].sort(),
            role: node.getAttribute("role"),
            ariaLabel: node.getAttribute("aria-label"),
            src: new URL(backgroundUrl, location.href).pathname,
            backgroundPositionX: style.backgroundPositionX,
            backgroundPositionY: style.backgroundPositionY,
            backgroundSize: style.backgroundSize,
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
          };
        })) : [];
        const data = identities[0] || {};
        const identityProblems = identities.filter((identity) => JSON.stringify(identity.classes) !== JSON.stringify(["provider-logo", "provider-logo--light", "provider-logo--sprite"])
          || identity.role !== "img"
          || identity.ariaLabel !== "OrderlyMeds logo"
          || identity.src !== "/assets/provider-logos/pass2-lp-atlas.webp"
          || identity.backgroundPositionX !== `-${atlasEntry.display_x}px`
          || identity.backgroundPositionY !== `-${atlasEntry.display_y}px`
          || identity.backgroundSize !== `${atlasManifest.display_atlas_width}px ${atlasManifest.display_atlas_height}px`
          || !(identity.width > 0)
          || !(identity.height > 0));
        const asset = data.src ? await api.get(data.src, { maxRedirects: 0 }) : null;
        observed.provider = {
          route, status, finalPath, count, identities, identityProblems, ...data,
          assetStatus: asset?.status() || 0,
          assetSha256: asset ? sha256(await asset.body()) : "",
          expectedAtlasSha256: atlasManifest.atlas_sha256,
          sceneCount: specificScenes.length,
        };
      } else {
        const wrapper = page.locator(".review-logo--light");
        const selector = page.locator(".review-logo--light > img");
        const count = await selector.count();
        const data = count === 1 ? await selector.evaluate(async (image) => {
          await image.decode().catch(() => {});
          return {
            src: new URL(image.currentSrc || image.src, location.href).pathname,
            alt: image.alt,
            widthAttribute: image.getAttribute("width"),
            heightAttribute: image.getAttribute("height"),
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          };
        }) : {};
        const asset = data.src ? await api.get(data.src, { maxRedirects: 0 }) : null;
        observed.review = {
          route, status, finalPath, wrapperCount: await wrapper.count(), count, ...data,
          assetStatus: asset?.status() || 0,
          assetSha256: asset ? sha256(await asset.body()) : "",
          expectedLogoSha256: orderly?.output_sha256 || "",
          sceneCount: specificScenes.length,
        };
      }
    }
    const provider = observed.provider || {};
    const review = observed.review || {};
    const providerValid = provider.status === 200
      && provider.finalPath === "/providers/orderlymeds/"
      && provider.count >= 1
      && provider.identityProblems?.length === 0
      && JSON.stringify(provider.classes) === JSON.stringify(["provider-logo", "provider-logo--light", "provider-logo--sprite"])
      && provider.role === "img"
      && provider.ariaLabel === "OrderlyMeds logo"
      && provider.src === "/assets/provider-logos/pass2-lp-atlas.webp"
      && provider.backgroundPositionX === `-${atlasEntry.display_x}px`
      && provider.backgroundPositionY === `-${atlasEntry.display_y}px`
      && provider.backgroundSize === `${atlasManifest.display_atlas_width}px ${atlasManifest.display_atlas_height}px`
      && provider.width > 0
      && provider.height > 0
      && provider.assetStatus === 200
      && provider.assetSha256 === provider.expectedAtlasSha256;
    const reviewValid = review.status === 200
      && review.finalPath === "/reviews/orderlymeds/"
      && review.wrapperCount === 1
      && review.count === 1
      && review.src === "/assets/provider-logos/orderlymeds.webp"
      && review.alt === "OrderlyMeds logo"
      && review.widthAttribute === "345"
      && review.heightAttribute === "63"
      && review.naturalWidth === 345
      && review.naturalHeight === 63
      && review.assetStatus === 200
      && review.assetSha256 === review.expectedLogoSha256;
    check(
      observed.manifestProblems.length === 0 && providerValid && reviewValid && observed.sceneProblems.length === 0,
      "O-36 exact Orderly provider sprite/review logo lineage plus responsive surface-specific scene art",
      observed,
      { manifestProblems: [], providerIdentity: "exact atlas crop", reviewIdentity: "exact 345x63 asset", specificResponsiveScenePerSurface: true },
      "browser_capture",
    );
  } },
  { id: "O-37", route: "/wegovy/", name: "unique real product imagery", run: async ({ page, api, check }) => {
    const manifest = readJsonFile(PRODUCT_IMAGE_MANIFEST_PATH);
    const manifestProblems = [];
    if (manifest.schema !== "glp-pass2-product-comparison-image-manifest-v1"
      || manifest.status !== "PASS"
      || manifest.expected !== 9
      || manifest.records?.length !== 9
      || manifest.records.some((record) => record.status !== "PASS" || record.model !== "gpt_image_2")
      || new Set(manifest.records.map((record) => record.master_sha256)).size !== 9) manifestProblems.push("product_manifest_contract");
    const recordById = new Map((manifest.records || []).map((record) => [record.id, record]));
    for (const record of manifest.records || []) {
      if (!existsSync(path.join(CANDIDATE_ROOT, record.master_path || ""))
        || fileHash(path.join(CANDIDATE_ROOT, record.master_path || "")) !== record.master_sha256
        || record.outputs?.length !== 6) manifestProblems.push(`product_master_or_output_set:${record.id}`);
      for (const output of record.outputs || []) {
        const sourceFile = path.join(CANDIDATE_ROOT, output.path || "");
        const publicFile = path.join(CANDIDATE_ROOT, output.path.replace(/^assets\/derivatives\//, "public/assets/images/"));
        if (!existsSync(sourceFile)
          || !existsSync(publicFile)
          || fileHash(sourceFile) !== output.sha256
          || fileHash(publicFile) !== output.sha256) manifestProblems.push(`product_output_hash:${output.path}`);
      }
    }

    const routes = [];
    const servedFallbackHashes = [];
    for (const slug of PRODUCT_SLUGS) {
      const route = `/${slug}/`;
      const stem = `brand-${slug}`;
      const record = recordById.get(stem);
      const status = await openServed(page, route);
      const finalPath = new URL(page.url()).pathname;
      const pictures = page.locator(`picture[data-product-visual="${stem}"]`);
      const pictureCount = await pictures.count();
      const picture = pictureCount === 1 ? await pictures.evaluate((node) => {
        const image = node.querySelector("img");
        const source = (type) => node.querySelector(`source[type="${type}"]`);
        return {
          avifSrcset: source("image/avif")?.getAttribute("srcset") || "",
          avifSizes: source("image/avif")?.getAttribute("sizes") || "",
          webpSrcset: source("image/webp")?.getAttribute("srcset") || "",
          webpSizes: source("image/webp")?.getAttribute("sizes") || "",
          jpgSrcset: image?.getAttribute("srcset") || "",
          jpgSizes: image?.getAttribute("sizes") || "",
          src: image?.getAttribute("src") || "",
          alt: image?.getAttribute("alt") || "",
          width: image?.getAttribute("width") || "",
          height: image?.getAttribute("height") || "",
        };
      }) : {};
      const image = pictures.locator("img");
      const decoded = pictureCount === 1 ? await image.evaluate(async (node) => { await node.decode().catch(() => {}); return node.complete && node.naturalWidth > 0 && node.naturalHeight > 0; }) : false;
      const assets = [];
      for (const width of [640, 1280]) {
        for (const extension of ["avif", "webp", "jpg"]) {
          const assetPath = `/assets/images/product-comparison-pass2/${stem}-${width}.${extension}`;
          const response = await api.get(assetPath, { maxRedirects: 0 });
          const body = await response.body();
          const expected = record?.outputs?.find((output) => output.path.endsWith(`${stem}-${width}.${extension}`));
          assets.push({
            path: assetPath,
            status: response.status(),
            location: response.headers().location || "",
            contentType: (response.headers()["content-type"] || "").split(";")[0].toLowerCase(),
            sha256: sha256(body),
            expectedSha256: expected?.sha256 || "",
            expectedWidth: expected?.width || 0,
            expectedHeight: expected?.height || 0,
            bytes: body.length,
          });
        }
      }
      const row = { slug, stem, route, status, finalPath, record, pictureCount, picture, decoded, assets };
      routes.push(row);
      servedFallbackHashes.push(assets.find((asset) => asset.path.endsWith("-1280.jpg"))?.sha256 || "");
    }
    const routeProblems = routes.filter((row) => {
      const { slug, stem, picture } = row;
      const prefix = `/assets/images/product-comparison-pass2/${stem}`;
      const sizes = "(max-width:760px) calc(100vw - 32px), 720px";
      const expectedAlt = `Original editorial comparison scene for the ${PRODUCT_DISPLAY_NAMES.get(slug)} evidence route`;
      return row.status !== 200
        || row.finalPath !== row.route
        || !row.record
        || row.record.kind !== "brand"
        || row.record.route !== row.route
        || row.record.status !== "PASS"
        || row.record.model !== "gpt_image_2"
        || row.pictureCount !== 1
        || picture.avifSrcset !== `${prefix}-640.avif 640w, ${prefix}-1280.avif 1280w`
        || picture.webpSrcset !== `${prefix}-640.webp 640w, ${prefix}-1280.webp 1280w`
        || picture.jpgSrcset !== `${prefix}-640.jpg 640w, ${prefix}-1280.jpg 1280w`
        || picture.avifSizes !== sizes
        || picture.webpSizes !== sizes
        || picture.jpgSizes !== sizes
        || picture.src !== `${prefix}-1280.jpg`
        || picture.alt !== expectedAlt
        || picture.width !== "1280"
        || picture.height !== "720"
        || !row.decoded
        || row.assets.length !== 6
        || row.assets.some((asset) => asset.status !== 200
          || asset.location
          || asset.bytes === 0
          || asset.sha256 !== asset.expectedSha256
          || !((asset.expectedWidth === 640 && asset.expectedHeight === 360) || (asset.expectedWidth === 1280 && asset.expectedHeight === 720))
          || asset.contentType !== (asset.path.endsWith(".jpg") ? "image/jpeg" : asset.path.endsWith(".webp") ? "image/webp" : "image/avif"));
    });
    const observed = {
      manifestSchema: manifest.schema,
      manifestStatus: manifest.status,
      manifestProblems,
      uniqueOriginalSourceHashes: new Set((manifest.records || []).map((row) => row.master_sha256)).size,
      servedOutputCount: routes.reduce((sum, row) => sum + row.assets.length, 0),
      uniqueServedFallbackHashes: new Set(servedFallbackHashes).size,
      routes,
      routeProblems,
    };
    check(
      observed.manifestProblems.length === 0
        && observed.uniqueOriginalSourceHashes === 9
        && observed.servedOutputCount === 30
        && observed.uniqueServedFallbackHashes === 5
        && observed.routeProblems.length === 0,
      "O-37 exact GPT Image 2 original-source and six-output responsive product lineage for five medication routes",
      observed,
      { originalSources: 9, servedOutputs: 30, responsiveFamilies: 5, routeProblems: [] },
      "served_http",
    );
  } },
  { id: "O-38", route: "/sitemap.xml", name: "served SEO imagery pipeline outcome", run: async ({ api, browser, check }) => {
    const corpus = await servedArticleCorpus(api, browser);
    const seoProblems = [];
    for (const row of corpus.releaseReadyRecords) {
      const canonical = `https://glpclinicscout.com${row.route}`;
      const social = `https://glpclinicscout.com/assets/images/${row.stem}-og.jpg`;
      const ogAsset = row.assets.find((asset) => asset.url === `/assets/images/${row.stem}-og.jpg`);
      if (row.initialStatus !== 200
        || row.finalPath !== row.route
        || row.robots !== "index,follow,max-image-preview:large"
        || row.canonical !== canonical
        || row.ogImage !== social
        || row.twitterImage !== social
        || !row.inSitemap
        || !ogAsset
        || ogAsset.status !== 200
        || ogAsset.sha256 !== ogAsset.expectedSha256) seoProblems.push({ route: row.route, disposition: "release-ready", robots: row.robots, canonical: row.canonical, ogImage: row.ogImage, twitterImage: row.twitterImage, inSitemap: row.inSitemap, ogAsset });
    }
    for (const row of corpus.heldRecords) {
      if (row.initialStatus !== 200
        || row.finalPath !== row.route
        || row.robots !== "noindex,nofollow,noarchive,nosnippet,max-image-preview:large"
        || row.inSitemap) seoProblems.push({ route: row.route, disposition: "held", robots: row.robots, inSitemap: row.inSitemap });
    }
    for (const row of corpus.consolidatedRecords) {
      if (!row.expectedConsolidatedRedirect
        || row.initialStatus !== 301
        || row.location !== row.expectedLocation
        || row.redirectHopCount !== 1
        || row.finalStatus !== 200
        || row.finalPath !== "/providers/"
        || row.inSitemap) seoProblems.push({ route: row.route, disposition: "redirect", initialStatus: row.initialStatus, location: row.location, redirectHopCount: row.redirectHopCount, finalStatus: row.finalStatus, finalPath: row.finalPath, inSitemap: row.inSitemap });
    }

    const pass2 = corpus.pass2Manifest;
    const pass2Problems = [];
    if (pass2.schema !== "gcs.pass2.image-derivative-audit.v1" || pass2.audit_status !== "PASS" || pass2.release_readiness !== "PASS") pass2Problems.push("pass2_manifest_status");
    const summary = pass2.derivative_summary || {};
    if (summary.article_output_count !== articleManifest.records.length * 9 || summary.product_output_count !== 30 || summary.total_output_count !== 723 || summary.public_mirror_count !== 723 || summary.public_mirror_mismatch_count !== 0) pass2Problems.push("pass2_derivative_counts");
    const releaseBlockers = (pass2.gaps || []).filter((gap) => gap.severity === "release_blocker");
    const productOmissions = (pass2.gaps || []).filter((gap) => gap.reason === "omitted_no_upscale_source_master_is_1024px" && gap.requested_width === 1600 && gap.source_width === 1024);
    if (releaseBlockers.length !== 0 || productOmissions.length !== 5 || (pass2.gaps || []).length !== 5) pass2Problems.push("pass2_gap_disposition");
    for (const source of pass2.source_manifests || []) {
      const sourcePath = path.join(CANDIDATE_ROOT, source.path || "");
      if (!existsSync(sourcePath) || fileHash(sourcePath) !== source.sha256) pass2Problems.push(`pass2_source_hash:${source.path}`);
    }
    const auditArticleRows = pass2.inventory?.article?.records || [];
    if (!sameStringSet(auditArticleRows.map((row) => row.route), articleManifest.records.map((row) => row.route))) pass2Problems.push("pass2_article_route_identity");
    const sourceByRoute = new Map(articleManifest.records.map((row) => [row.route, row]));
    for (const row of auditArticleRows) {
      const source = sourceByRoute.get(row.route);
      const routeOutput = source?.outputs?.find((output) => output.name === `${source.stem}-1600.jpg`);
      if (!source || row.stem !== source.stem || row.underlying_original_sha256 !== source.master_sha256
        || !existsSync(path.join(CANDIDATE_ROOT, row.underlying_original_path || ""))
        || fileHash(path.join(CANDIDATE_ROOT, row.underlying_original_path)) !== source.master_sha256
        || row.route_source?.sha256 !== routeOutput?.sha256
        || !existsSync(path.join(CANDIDATE_ROOT, row.route_source?.path || ""))
        || fileHash(path.join(CANDIDATE_ROOT, row.route_source.path)) !== routeOutput?.sha256
        || row.derivatives?.length !== 9) {
        pass2Problems.push(`pass2_article_master_identity:${row.route}`);
        continue;
      }
      for (const derivative of row.derivatives) {
        const local = path.join(CANDIDATE_ROOT, derivative.path || "");
        const mirror = path.join(CANDIDATE_ROOT, derivative.public_path || "");
        if (derivative.route !== row.route || derivative.source_sha256 !== row.route_source.sha256
          || !existsSync(local) || !existsSync(mirror)
          || fileHash(local) !== derivative.sha256 || fileHash(mirror) !== derivative.sha256) {
          pass2Problems.push(`pass2_article_derivative_hash:${derivative.path}`);
        }
      }
    }
    const productDerivatives = (pass2.inventory?.product?.records || []).flatMap((row) => row.derivatives || []);
    if (productDerivatives.length !== 30) pass2Problems.push("pass2_product_derivative_inventory");
    for (const derivative of productDerivatives) {
      const source = path.join(CANDIDATE_ROOT, derivative.source_path || "");
      const local = path.join(CANDIDATE_ROOT, derivative.path || "");
      const mirror = path.join(CANDIDATE_ROOT, derivative.public_path || "");
      if (!existsSync(source) || !existsSync(local) || !existsSync(mirror)
        || fileHash(source) !== derivative.source_sha256
        || fileHash(local) !== derivative.sha256 || fileHash(mirror) !== derivative.sha256) {
        pass2Problems.push(`pass2_product_derivative_hash:${derivative.path}`);
      }
    }

    const productMarkup = [];
    for (const slug of PRODUCT_SLUGS) {
      const response = await api.get(`/${slug}/`, { maxRedirects: 0 });
      productMarkup.push(await response.text());
    }
    const pass2References = [
      ...corpus.records.flatMap((row) => Array.from({ length: row.pass2ReferenceCount }, () => row.route)),
      ...productMarkup.flatMap((html, index) => Array.from({ length: (html.match(/\/assets\/images\/pass2\//g) || []).length }, () => `/${PRODUCT_SLUGS[index]}/`)),
    ];
    const pass2UsageDisposition = pass2References.length === 0
      ? "audit_only_unreferenced_by_served_article_and_product_markup"
      : "served_or_partially_served_requires_complete_usage_audit";
    if (pass2References.length !== 0) pass2Problems.push("pass2_derivatives_partially_or_unproven_served");

    const pkg = readJsonFile(path.join(CANDIDATE_ROOT, "package.json"));
    const pipelineProblems = [];
    if (pkg.scripts?.["generate:article-route-masters"] !== "python3 scripts/pass2-generate-route-images.py --workers 3") pipelineProblems.push("route_master_command");
    if (pkg.scripts?.["generate:article-imagery"] !== "python3 scripts/generate-article-imagery.py") pipelineProblems.push("article_derivative_command");
    if (pkg.scripts?.["publish:article-imagery"] !== "npm run generate:article-route-masters && npm run generate:article-imagery && python3 scripts/pass2-image-derivative-audit.py") pipelineProblems.push("publish_pipeline_command");
    if (pkg.scripts?.["validate:article-imagery"] !== "python3 scripts/generate-article-imagery.py --check") pipelineProblems.push("check_command");
    if (/generate:article-route-masters|publish:article-imagery/.test(pkg.scripts?.build || "")) pipelineProblems.push("ordinary_build_provider_call_risk");

    const observed = {
      sitemapStatus: corpus.sitemapStatus,
      sitemapContentType: corpus.sitemapContentType,
      sitemapUrlCount: corpus.sitemapUrls.length,
      sitemapUniquePathCount: corpus.sitemapUniquePathCount,
      sitemapHasInvalidUrls: corpus.sitemapPaths.some((value) => value.startsWith("INVALID_")),
      imageContracts: corpus.records.length,
      releaseReadyIndexablePages: corpus.releaseReadyRecords.length,
      heldNoindexPages: corpus.heldRecords.length,
      consolidatedRedirects: corpus.consolidatedRecords.length,
      seoProblems,
      pass2Audit: {
        schema: pass2.schema,
        auditStatus: pass2.audit_status,
        releaseReadiness: pass2.release_readiness,
        derivativeCount: summary.total_output_count,
        releaseBlockerCount: releaseBlockers.length,
        product1600OmissionCount: productOmissions.length,
        servedReferenceCount: pass2References.length,
        usageDisposition: pass2UsageDisposition,
        problems: pass2Problems,
      },
      pipelineProblems,
    };
    check(
      observed.sitemapStatus === 200
        && /xml/.test(observed.sitemapContentType)
        && observed.sitemapUrlCount === 295
        && observed.sitemapUniquePathCount === 295
        && !observed.sitemapHasInvalidUrls
        && observed.imageContracts === 77
        && observed.releaseReadyIndexablePages === 52
        && observed.heldNoindexPages === 20
        && observed.consolidatedRedirects === 5
        && observed.seoProblems.length === 0
        && observed.pass2Audit.problems.length === 0
        && observed.pass2Audit.usageDisposition === "audit_only_unreferenced_by_served_article_and_product_markup"
        && observed.pipelineProblems.length === 0,
      "O-38 exact sitemap/disposition/canonical/social coverage and honest audit-only Pass-2 derivative lineage",
      observed,
      { sitemapUrls: 295, releaseReady: 52, held: 20, redirects: 5, pass2UsageDisposition: "audit_only_unreferenced_by_served_article_and_product_markup" },
      "served_http",
    );
  } },
  { id: "G-1", route: "/reviews/coivas/", name: "four legacy reviews migrated to current static-safe shell", run: async ({ page, check }) => {
    const observed = []; for (const slug of ["coivas", "direct-meds", "mangorx", "sprout-health"]) { const route = `/reviews/${slug}/`; const status = await openServed(page, route); observed.push({ route, status, reviewBody: await page.locator('body[data-cs-template="review"]').count(), nav: await page.locator(".gcs-nav").count(), search: await page.locator(".cs-search-toggle").count(), drawer: await page.locator(".cs-drawer").count(), breadcrumbs: await page.locator(".breadcrumbs").count(), providerIdentity: await page.locator(".ready6-provider-mark img,.ready6-provider-mark .provider-wordmark").count(), jump: await page.locator(".ready6-jump-nav").count(), sections: await page.locator("#bottom-line, #pricing, #score-rubric").count(), footer: await page.locator("footer.gcs-footer").count(), motionRuntime: await page.locator('script[src^="/assets/motion.js"]').count(), siteRuntime: await page.locator('script[src^="/assets/site.js"]').count(), oldTopbar: await page.locator(".topbar").count() }); } check(observed.every((row) => row.status === 200 && row.reviewBody === 1 && row.nav === 1 && row.search === 1 && row.drawer === 1 && row.breadcrumbs === 1 && row.providerIdentity === 1 && row.jump === 1 && row.sections === 3 && row.footer === 1 && row.motionRuntime === 1 && row.siteRuntime === 1 && row.oldTopbar === 0), "all four formerly old-shell reviews serve the governed shared interactive review anatomy", observed, { eachSharedInteractiveShell: true });
  } },
  { id: "G-2", route: "/providers/", name: "35 evidence-qualified provider cards", run: async ({ page, check }) => {
    const observed = await page.locator("[data-phase3-provider]").evaluateAll((cards) => cards.map((card) => ({ program: card.dataset.program, contract: Boolean(card.querySelector('[data-provider-card-contract="option-c"]')), facts: card.querySelectorAll("dt").length, doseGrids: card.querySelectorAll(".p3-dose-grid").length, detail: card.querySelector('.p3-card-actions a[href^="/providers/"]')?.getAttribute("href") || "" }))); const programs = observed.map((row) => row.program); const excluded = ["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review"].filter((program) => programs.includes(program)); check(observed.length === 35 && new Set(programs).size === 35 && excluded.length === 0 && observed.every((row) => row.contract && row.facts === 3 && row.doseGrids === 0 && /^\/providers\/[a-z0-9-]+\/$/.test(row.detail)), "provider hub serves exactly 35 unique evidence-qualified Option C cards", { count: observed.length, unique: new Set(programs).size, excluded, observed }, { count: 35, contracts: 35, factRowsEach: 3, cardDoseGrids: 0 });
  } },
  { id: "G-3", route: "/wegovy/", name: "complete product detail anatomy", run: async ({ page, check }) => {
    const paired = page.locator("[data-with-without-insurance],.p3-price-pair,.p3-product-pricing").first(); const related = page.locator(".p3-related,[data-related-products]").first(); const observed = { pairedCount: await paired.count(), withInsurance: false, withoutInsurance: false, finalWizardActions: await page.locator("[data-insurance-wizard] [data-insurance-complete]").count(), relatedCount: await related.count(), relatedLinks: await related.locator("a").count().catch(() => 0), relatedImageLinks: await related.locator("a:has(img)").count().catch(() => 0) }; if (observed.pairedCount) { const text = await paired.textContent(); observed.withInsurance = /with insurance/i.test(text); observed.withoutInsurance = /without insurance/i.test(text); } check(observed.pairedCount === 1 && observed.withInsurance && observed.withoutInsurance && observed.finalWizardActions === 1 && observed.relatedCount === 1 && observed.relatedLinks >= 3 && observed.relatedImageLinks >= 3, "product serves paired insurance pricing, the marked final wizard action, and image-card related shelf", observed, { pairedCount: 1, finalWizardActions: 1, relatedImageLinksMin: 3 });
  } },
  { id: "G-4", route: "/lp/best-providers/compounded-semaglutide/", name: "nonempty robust listing filters", run: async ({ page, check }) => {
    const filters = page.locator("[data-provider-filters]"); const cards = page.locator("[data-phase3-provider]"); const brand = filters.locator('[data-filter="type"][data-value="brand"]'); const microdose = filters.locator('[data-filter="type"][data-value="microdose"]'); const observed = { initialCards: await cards.count(), brandEnabled: await brand.isEnabled(), microdoseEnabled: await microdose.isEnabled(), microdoseAriaDisabled: await microdose.getAttribute("aria-disabled") }; await brand.click(); observed.noMatchVisible = await page.locator("[data-filter-empty]").isVisible(); observed.noMatchResult = ((await page.locator("[data-filter-result]").textContent()) || "").trim(); await page.locator("[data-filter-reset]").click(); observed.resetCleared = await page.locator("[data-filter-empty]").isHidden(); await filters.locator('[data-filter="plan"][data-value="3"]').click(); observed.visibleAfterPlan = await page.locator("[data-phase3-provider]:visible").count(); const more = filters.locator(".p3-more-filters"); if (!(await more.getAttribute("open"))) await more.locator("summary").click(); const dose = filters.locator('[data-filter="dose"][data-value="0.25"]'); await dose.click(); const visibleCards = page.locator("[data-phase3-provider]:visible"); observed.dosePressed = await dose.getAttribute("aria-pressed"); observed.visibleAfterDose = await visibleCards.count(); observed.contracts = await visibleCards.locator("[data-provider-card-contract='option-c']").count(); observed.doseGrids = await visibleCards.locator(".p3-dose-grid").count(); observed.legacyChips = await visibleCards.locator(".p3-feature-chips").count(); const state = page.locator("[data-state-select]"); observed.stateOptions = await state.locator("option").count(); await state.selectOption("TX"); observed.texasHeading = (await page.locator("h1[data-state-heading]").textContent())?.trim(); check(observed.initialCards > 0 && observed.brandEnabled && !observed.microdoseEnabled && observed.microdoseAriaDisabled === "true" && observed.noMatchVisible && /Showing 0 source-backed provider rows/i.test(observed.noMatchResult) && observed.resetCleared && observed.visibleAfterPlan > 0 && observed.dosePressed === "true" && observed.visibleAfterDose > 0 && observed.contracts === observed.visibleAfterDose && observed.doseGrids === 0 && observed.legacyChips === 0 && observed.stateOptions === 52 && /Texas/.test(observed.texasHeading), "listing filters expose an honest no-match/reset path while every visible card keeps the Option C contract", observed, { noMatch: true, reset: true, microdoseFailClosed: true, cardDoseGrids: 0, cardLegacyChips: 0, stateOptions: 52 }, "browser_interaction");
  } },
  { id: "G-5", route: "/3-month/?drug=SEMAGLUTIDE", name: "bulk intents announce result state", run: async ({ page, check }) => {
    const observed = []; for (const [route, drug] of [["/3-month/?drug=SEMAGLUTIDE", "SEMAGLUTIDE"], ["/3-month/?drug=TIRZEPATIDE", "TIRZEPATIDE"], ["/6-month/?drug=SEMAGLUTIDE", "SEMAGLUTIDE"], ["/6-month/?drug=TIRZEPATIDE", "TIRZEPATIDE"]]) { const status = await openServed(page, route); observed.push({ route, status, active: await page.locator(`[data-bulk-drug-value="${drug}"]`).getAttribute("aria-pressed"), visibleCards: await page.locator("[data-phase3-provider]:visible").count(), feedback: ((await page.locator("[data-bulk-result]").textContent()) || "").trim(), drug }); } check(observed.every((row) => row.status === 200 && row.active === "true" && row.visibleCards === 3 && row.feedback && row.feedback.toUpperCase().includes(row.drug)), "all four bulk intents serve explicit treatment-scoped result feedback", observed, { eachCards: 3, feedback: true });
  } },
  { id: "G-6", route: "/guides/trimi-vs-yourera/", name: "article curator and FAQ blocks", run: async ({ page, check }) => {
    const author = page.locator(".guide-author,.p3-author,[data-author-block]").first(); const faq = page.locator(".guide-faq,[data-faq],.faq").first(); const observed = { authorCount: await author.count(), authorLinks: await author.locator('a[href^="/authors/"]').count().catch(() => 0), faqCount: await faq.count(), disclosures: await faq.locator("details").count().catch(() => 0) }; check(observed.authorCount === 1 && observed.authorLinks > 0 && observed.faqCount === 1 && observed.disclosures > 0, "article serves a linked curator block and interactive FAQ disclosures", observed, { authorCount: 1, faqCount: 1, disclosuresMin: 1 });
  } },
  { id: "G-7", route: "/pharmacies/", name: "complete pharmacy hub/detail interactions", run: async ({ page, check }) => {
    const observed = { hubStatus: await openServed(page, "/pharmacies/"), cards: await page.locator("[data-pharmacy-card]").count(), contracts: await page.locator("[data-pharmacy-card-contract='option-c']").count(), factRows: await page.locator("[data-pharmacy-card] .p3-pharmacy-facts > div").count(), evidenceLines: await page.locator("[data-pharmacy-card] .p3-card-evidence-line").count(), additiveFilters: await page.locator("[data-pharmacy-additive]").count(), additiveOptions: await page.locator("[data-pharmacy-additive] option").count(), chips: await page.locator("[data-pharmacy-card] [data-additive-chip],[data-pharmacy-card] .p3-additive-chip,[data-pharmacy-card] .p3-compounded-with-chip").count() }; observed.detailStatus = await openServed(page, "/pharmacies/red-rock/"); observed.relatedShelf = await page.locator(".p3-related,[data-related-pharmacies]").count(); observed.relatedLinks = await page.locator('.p3-related a[href^="/pharmacies/"],[data-related-pharmacies] a[href^="/pharmacies/"]').count(); check(observed.hubStatus === 200 && observed.cards === 75 && observed.contracts === 75 && observed.factRows === 150 && observed.evidenceLines === 75 && observed.additiveFilters === 1 && observed.additiveOptions > 1 && observed.chips === 0 && observed.detailStatus === 200 && observed.relatedShelf === 1 && observed.relatedLinks >= 3, "pharmacy hub serves the 75-card Option C contract while detail preserves the related evidence shelf", observed, { cards: 75, contracts: 75, factRows: 150, evidenceLines: 75, additiveFilter: 1, cardChips: 0, relatedLinksMin: 3 });
  } },
  { id: "G-8", route: "/", name: "unrepeated responsive home and insights art", run: async ({ page, api, check }) => {
    const observed = []; for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) { await page.setViewportSize({ width: viewport.width, height: viewport.height }); for (const surface of [{ name: "home", route: "/", selector: ".cs-home2-editorial .cs-home2-article:visible img" }, { name: "insights", route: "/insights/", selector: ".p3-insight-cycle img" }]) { await openServed(page, surface.route); const records = await page.locator(surface.selector).evaluateAll((images) => images.map((image) => { const picture = image.closest("picture"); return { src: image.currentSrc || image.src, alt: image.alt, width: image.getAttribute("width"), height: image.getAttribute("height"), avif: Boolean(picture?.querySelector('source[type="image/avif"]')), webp: Boolean(picture?.querySelector('source[type="image/webp"]')) }; })); const hashes = []; for (const row of records) { const response = await api.get(new URL(row.src).pathname); hashes.push(sha256(await response.body())); } observed.push({ viewport: viewport.name, surface: surface.name, count: records.length, uniqueUrls: new Set(records.map((row) => row.src)).size, uniqueHashes: new Set(hashes).size, complete: records.filter((row) => row.alt?.trim() && /^\d+$/.test(row.width || "") && /^\d+$/.test(row.height || "") && row.avif && row.webp).length }); } } check(observed.every((row) => row.count > 0 && row.uniqueUrls === row.count && row.uniqueHashes === row.count && row.complete === row.count), "home and insights serve unrepeated responsive accessible primary art at both viewports", observed, { eachUniqueAndComplete: true });
  } },
  { id: "G-9", route: "/data/coupon-offers.json", name: "coupon surface fails closed on empty feed", run: async ({ page, api, check }) => {
    const feedResponse = await api.get("/data/coupon-offers.json"); const feed = await feedResponse.json(); const observed = { feedStatus: feedResponse.status(), schema: feed.schema, offers: feed.offers, surfaces: [] }; for (const route of ["/lp/best-providers/compounded-semaglutide/", "/providers/orderlymeds/", "/reviews/orderlymeds/", "/wegovy/"]) { await openServed(page, route); observed.surfaces.push({ route, couponNodes: await page.locator("[data-coupon-copy],[data-coupon-code],.cs-coupon-chip,.cs-coupon-toast").count(), codeCopy: /Use code [A-Z0-9_-]+ for/i.test(await page.locator("body").textContent()) }); } check(observed.feedStatus === 200 && observed.schema === "glp-coupon-offers-v1" && Array.isArray(observed.offers) && observed.offers.length === 0 && observed.surfaces.every((row) => row.couponNodes === 0 && !row.codeCopy), "empty source-bounded coupon feed renders no fabricated coupon chip/toast", observed, { offers: [], allCouponNodes: 0 });
  } },
  { id: "G-10", route: "/quiz/provider-fit/", name: "all quiz intents complete with reveal choreography", run: async ({ page, check }) => {
    const observed = [];
    for (let intentIndex = 0; intentIndex < QUIZ_INTENTS.length; intentIndex += 1) {
      const intent = QUIZ_INTENTS[intentIndex];
      await openServed(page, "/quiz/provider-fit/");
      const gateCount = await page.locator("#health-consent, #health-consent-gate").count();
      // No start control: the quiz auto-initializes — position 0 must be shown
      // on load without any click, and no #begin-quiz button may remain.
      const autoShown = (await page.locator("#begin-quiz").count()) === 0
        && await page.locator('[data-quiz-position="0"]:not([hidden])').isVisible();
      if (!autoShown) {
        observed.push({ intent, gateCount, autoShown, complete: false });
        continue;
      }
      const firstOptions = page.locator('[data-pass2-question="intent"] [data-value]');
      const labels = (await firstOptions.allTextContents()).map((label) => label.trim());
      await firstOptions.nth(intentIndex).click();
      await page.locator('[data-pass2-question="intent"] [data-pass2-next]').click();
      await page.getByRole("button", { name: "No", exact: true }).click();
      await page.locator('[data-pass2-question="current-use"] [data-pass2-next]').click();
      await page.getByRole("button", { name: "Weight loss", exact: true }).click();
      await page.locator('[data-pass2-question="reason"] [data-pass2-next]').click();
      await page.locator('[data-pass2-select="state"]').selectOption("OR");
      await page.locator('[data-pass2-question="state"] [data-pass2-next]').click();
      await page.getByRole("button", { name: "Cost", exact: true }).click();
      await page.locator('[data-pass2-question="priorities"] [data-pass2-next]').click();
      await page.locator('[data-pass2-question="features"] [data-pass2-next]').click();
      await page.locator('[data-pass2-select="budget"]').selectOption("250");
      await page.locator('[data-pass2-question="budget"] [data-pass2-next]').click();
      await page.locator('[data-pass2-question="contact"] [data-pass2-next]').click();
      const revealMotion = await activeRevealMotion(page);
      const results = page.locator("[data-pass2-results]");
      const exploreHref = await page.locator("[data-explore-providers]").getAttribute("href");
      const explore = new URL(exploreHref, page.url());
      observed.push({
        intent,
        gateCount,
        autoShown,
        labels,
        complete: await results.isVisible(),
        questionsHidden: await page.locator("[data-pass2-questions]").isHidden(),
        cards: await page.locator("[data-result-cards] .qz-card").count(),
        topCards: await page.locator("[data-result-cards] .qz-card--top").count(),
        progress: await page.locator("[data-pass2-questions] [role=progressbar]").getAttribute("aria-valuenow"),
        progressMax: await page.locator("[data-pass2-questions] [role=progressbar]").getAttribute("aria-valuemax"),
        resultTop: await results.evaluate((node) => node.getBoundingClientRect().top),
        explorePath: explore.pathname,
        state: explore.searchParams.get("state"),
        sort: explore.searchParams.get("sort"),
        drug: explore.searchParams.get("drug"),
        revealMotion,
      });
    }
    check(observed.length === 8 && observed.every((row) => row.gateCount === 0 && row.autoShown && row.labels.join("|") === QUIZ_INTENTS.join("|") && row.complete && row.questionsHidden && row.cards === 3 && row.topCards === 1 && row.progress === "8" && row.progressMax === "8" && row.resultTop < 900 && row.explorePath === "/providers/" && row.state === "OR" && row.sort === "cheapest" && (row.intent === "Not sure" || Boolean(row.drug)) && row.revealMotion), "all eight ungated quiz intents reach three scoped cards with observable reveal motion", observed, { completed: 8, cardsEach: 3, topCardsEach: 1, completedNoUseBranchSteps: 8, revealMotionEach: true }, "browser_interaction");
  } },
];

async function runItem(item, browser, api) {
  const startedAt = nowUtc();
  const collector = assertionCollector();
  let http = { method: "GET", url: `${BASE_URL}${item.route}`, status: 0, body_bytes: 0 };
  try {
    const response = await api.get(item.route, { timeout: 45_000 });
    const body = await response.body();
    http = { method: "GET", url: `${BASE_URL}${item.route}`, status: response.status(), body_bytes: body.length };
    collector.check(response.status() === 200 && body.length > 0, "served route returns nonempty HTTP 200", { status: response.status(), bodyBytes: body.length }, { status: 200, bodyBytesMin: 1 }, "served_http");
  } catch (error) {
    collector.check(false, "served route returns nonempty HTTP 200", compactError(error), { status: 200, bodyBytesMin: 1 }, "served_http");
  }

  const { context, page } = await makePage(browser);
  try {
    const navigationStatus = await openServed(page, item.route);
    collector.check(navigationStatus === 200, "Chromium navigates the exact served route", navigationStatus, 200, "served_dom");
    await item.run({ page, api, browser, check: collector.check });
  } catch (error) {
    collector.check(false, `${item.id} browser/API assertion completed without harness error`, compactError(error), "no harness error", "browser_interaction");
  } finally {
    await context.close();
  }
  const status = collector.assertions.every((assertion) => assertion.status === "PASS") ? "PASS" : "FAIL";
  return {
    id: item.id,
    status,
    evidence_mode: "served_output",
    test_name: `${item.id} ${item.name}`,
    route: item.route,
    http,
    assertions: collector.assertions,
    deploy_count: 0,
    started_at_utc: startedAt,
    finished_at_utc: nowUtc(),
  };
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  removeIfPresent(OUTPUT_PATH);
  removeIfPresent(EVIDENCE_PATH);

  if (ITEMS.length !== 48 || ITEMS.map((item) => item.id).join("|") !== EXPECTED_IDS.join("|")) {
    throw new Error(`runner_item_set_invalid: count=${ITEMS.length}`);
  }
  if (!existsSync(CANDIDATE_ROOT)) throw new Error(`candidate_missing:${CANDIDATE_ROOT}`);

  const startedAt = nowUtc();
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { "cache-control": "no-cache" } });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const item of ITEMS) {
      process.stdout.write(`[RUN] ${item.id} ${item.name}\n`);
      const result = await runItem(item, browser, api);
      results.push(result);
      process.stdout.write(`[${result.status}] ${item.id}\n`);
    }
  } finally {
    await browser.close();
    await api.dispose();
  }

  const finishedAt = nowUtc();
  const passedIds = results.filter((row) => row.status === "PASS").map((row) => row.id);
  const failedIds = results.filter((row) => row.status === "FAIL").map((row) => row.id);
  const evidence = {
    schema: "glp-pass2-served-item-runner-evidence-v1",
    status: failedIds.length ? "FAIL" : "PASS",
    base_url: BASE_URL,
    deploy_count: 0,
    started_at_utc: startedAt,
    finished_at_utc: finishedAt,
    runner: path.relative(BUSINESS_ROOT, fileURLToPath(import.meta.url)),
    item_count: results.length,
    passed_ids: passedIds,
    failed_ids: failedIds,
    results,
  };
  atomicJson(EVIDENCE_PATH, evidence);
  const evidenceBytes = readFileSync(EVIDENCE_PATH);
  const evidenceArtifact = { path: REL_EVIDENCE_PATH, sha256: sha256(evidenceBytes), kind: "test_receipt" };
  const manifestResults = results.map((row) => ({ ...row, artifacts: [evidenceArtifact] }));
  const manifest = {
    schema: "glp-pass2-served-item-tests-v1",
    status: failedIds.length ? "FAIL" : "PASS",
    base_url: BASE_URL,
    deploy_count: 0,
    started_at_utc: startedAt,
    finished_at_utc: finishedAt,
    item_count: manifestResults.length,
    passed_ids: passedIds,
    failed_ids: failedIds,
    results: manifestResults,
  };
  atomicJson(OUTPUT_PATH, manifest);
  process.stdout.write(`${JSON.stringify({ status: manifest.status, item_count: 48, passed: passedIds.length, failed: failedIds.length, failed_ids: failedIds, output: OUTPUT_PATH })}\n`);
  process.exitCode = failedIds.length ? 1 : 0;
}

main().catch((error) => {
  removeIfPresent(OUTPUT_PATH);
  process.stderr.write(`${JSON.stringify({ status: "FAIL_CLOSED", error: compactError(error), output_removed: OUTPUT_PATH })}\n`);
  process.exitCode = 2;
});
