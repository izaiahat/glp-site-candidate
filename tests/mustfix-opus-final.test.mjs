import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { onRequestGet, resolveRetiredComparisonIntent } from "../functions/best/online-glp-1-providers/index.js";
import { GO_RUNTIME_MANIFEST } from "../functions/go/program-manifest.js";
import { parseGoQuery } from "../src/worker.mjs";
import { quizCopySurface, readQuizFragmentHashes } from "../src/quiz-copy-boundary.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = path.join(ROOT, "public");

async function walkHtml(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkHtml(child));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(child);
  }
  return files;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function routeFile(route) {
  const clean = route.replace(/^\//, "").replace(/\/$/, "");
  return clean ? path.join(PUBLIC, clean, "index.html") : path.join(PUBLIC, "index.html");
}

function redirects(raw) {
  return new Map(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [from, to, status] = line.split(/\s+/);
    return [from, { to, status }];
  }));
}

test("retired comparison intent is owned by a query-aware Pages Function", async () => {
  const origin = "https://glpclinicscout.com/best/online-glp-1-providers/";
  const mappings = new Map([
    ["compounded-semaglutide-injection", "/lp/best-providers/compounded-semaglutide/"],
    ["compounded-tirzepatide-injection", "/lp/best-providers/compounded-tirzepatide/"],
    ["brand-ozempic", "/ozempic/"],
    ["brand-wegovy", "/wegovy/"],
    ["brand-mounjaro", "/mounjaro/"],
    ["brand-zepbound", "/zepbound/"],
  ]);
  for (const [drug, destination] of mappings) {
    const requestUrl = `${origin}?drug=${drug}`;
    assert.equal(resolveRetiredComparisonIntent(requestUrl), destination, drug);
    const response = await onRequestGet({ request: new Request(requestUrl) });
    assert.equal(response.status, 301, drug);
    assert.equal(response.headers.get("location"), new URL(destination, origin).toString(), drug);
  }
  assert.equal(resolveRetiredComparisonIntent(origin), "/providers/");
});

test("served HTML removes retired links and unfinished D35/D54 copy globally", async () => {
  const files = await walkHtml(PUBLIC);
  const hashes = readQuizFragmentHashes(PUBLIC);
  assert.ok(files.length > 100);
  let retired = 0;
  let checked2026 = 0;
  let relatedCoverage = 0;
  let finePrint = 0;
  let deadMatchChips = 0;
  let monetizedWithoutNofollow = 0;
  for (const file of files) {
    const html = await readFile(file, "utf8");
    retired += (html.match(/\/best\/online-glp-1-providers\//g) || []).length;
    const prose = quizCopySurface(html, path.relative(PUBLIC, file), hashes);
    checked2026 += (prose.match(/\bchecked 2026/gi) || []).length;
    relatedCoverage += (prose.match(/Related coverage/gi) || []).length;
    finePrint += (prose.match(/the fine print/gi) || []).length;
    deadMatchChips += (html.match(/data-quiz-match-chip/g) || []).length;
    for (const tag of html.matchAll(/<a\b[^>]*>/gi)) {
      const anchor = tag[0];
      if (!/data-analytics-event="affiliate_click"/i.test(anchor) && !/\brel="[^"]*\bsponsored\b/i.test(anchor)) continue;
      if (!/\brel="[^"]*\bnofollow\b/i.test(anchor)) monetizedWithoutNofollow += 1;
    }
  }
  assert.equal(retired, 0);
  assert.equal(checked2026, 0);
  assert.equal(relatedCoverage, 0);
  assert.equal(finePrint, 0);
  assert.equal(deadMatchChips, 0);
  assert.equal(monetizedWithoutNofollow, 0);
});

test("every served internal anchor resolves and every /go link has an allowlisted assignment tuple", async () => {
  const files = await walkHtml(PUBLIC);
  const redirectMap = redirects(await readFile(path.join(PUBLIC, "_redirects"), "utf8"));
  const dynamicGoRoutes = new Map(Object.values(GO_RUNTIME_MANIFEST.programs).map((entry) => [entry.route.replace(/\/$/, ""), entry]));
  const missing = [];
  for (const file of files) {
    const html = await readFile(file, "utf8");
    for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi)) {
      const href = match[1];
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const pathname = new URL(href, "https://glpclinicscout.com").pathname;
      if (pathname === "/best/online-glp-1-providers/") continue;
      if (pathname.startsWith("/go/")) {
        const dynamicRoute = pathname.replace(/\/$/, "");
        const entry = dynamicGoRoutes.get(dynamicRoute);
        if (!entry) {
          missing.push(`${path.relative(PUBLIC, file)} -> ${href} (unknown /go route)`);
          continue;
        }
        try {
          const assignment = parseGoQuery(new URL(href.replaceAll("&amp;", "&"), "https://glpclinicscout.com"));
          if (!entry.allowed_page_roles?.includes(assignment.pageSlug)) missing.push(`${path.relative(PUBLIC, file)} -> ${href} (page role not allowlisted)`);
          if (!entry.allowed_positions?.includes(assignment.linkPosition)) missing.push(`${path.relative(PUBLIC, file)} -> ${href} (position not allowlisted)`);
          if (!entry.allowed_variants?.includes(assignment.variant)) missing.push(`${path.relative(PUBLIC, file)} -> ${href} (variant not allowlisted)`);
        } catch (error) {
          missing.push(`${path.relative(PUBLIC, file)} -> ${href} (invalid /go query: ${error.message})`);
        }
        continue;
      }
      if (redirectMap.has(pathname)) continue;
      const fileTarget = pathname.endsWith("/") ? routeFile(pathname) : path.join(PUBLIC, pathname.replace(/^\//, ""));
      if (!await exists(fileTarget)) missing.push(`${path.relative(PUBLIC, file)} -> ${href}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("provider aliases are exact direct 301s and the query-aware route has no static rule or shadow", async () => {
  const redirectMap = redirects(await readFile(path.join(PUBLIC, "_redirects"), "utf8"));
  const aliases = new Map([
    ["/providers/coivas/", "/reviews/coivas/"],
    ["/providers/sprout-health/", "/reviews/sprout-health/"],
    ["/providers/direct-meds/", "/reviews/direct-meds/"],
    ["/providers/mangorx/", "/reviews/mangorx/"],
  ]);
  for (const [from, to] of aliases) {
    assert.deepEqual(redirectMap.get(from), { to, status: "301" }, from);
    assert.equal(redirectMap.has(to), false, `${from} must redirect directly to a served target`);
    assert.equal(await exists(routeFile(from)), false, `${from} still shadows its redirect`);
  }
  const queryAwareRoute = "/best/online-glp-1-providers/";
  assert.equal(redirectMap.has(queryAwareRoute), false, "a static rule would discard query intent before the Function runs");
  assert.equal(await exists(routeFile(queryAwareRoute)), false, "a static file would shadow the query-aware Function");
});

test("redirect source index files cannot shadow Pages 301 rules", async () => {
  const routes = [
    "/guides/",
    "/guides/cheapest-glp1/",
    "/guides/healthrx-vs-agelessrx/",
    "/guides/wellorithm-vs-enhance-md/",
    "/guides/compare-online-glp-1-provider-fees/",
    "/guides/glp-1-program-total-cost-comparison/",
    "/reviews/shed/",
  ];
  for (const route of routes) assert.equal(await exists(routeFile(route)), false, `${route} still shadows its redirect`);
});

test("brand pages use generated product renders, official resources, and the required accordion contract", async () => {
  const brands = ["wegovy-pill", "wegovy", "ozempic", "mounjaro", "zepbound"];
  for (const slug of brands) {
    const html = await readFile(routeFile(`/${slug}/`), "utf8");
    assert.match(html, new RegExp(`<picture class="p3-product-visual" data-product-visual="brand-${slug}">[\\s\\S]*<img[^>]+src="[^"]*product-comparison-pass2/brand-${slug}-1280\\.jpg"[^>]+alt="Original editorial comparison scene`, "i"));
    assert.match(html, /Open the official manufacturer resource/);
    assert.match(html, /<summary>What is [^<]+\?<\/summary>/);
    assert.match(html, /<summary>How does it work\?<\/summary>/);
    assert.match(html, /<summary>Benefits<\/summary>/);
  }
  const lineage = JSON.parse(await readFile(path.join(ROOT, "artifacts/ultracode/phase3-product-renders/generated-image-lineage.json"), "utf8"));
  assert.equal(lineage.status, "PASS");
  assert.equal(lineage.original_model, "gpt-image-2-high");
  assert.equal(lineage.sources.length, 5);
  assert.equal(lineage.outputs.length, 30);
  for (const output of lineage.outputs) assert.equal(await exists(path.join(ROOT, output.path)), true, output.path);
});

test("served runtime contains bounded sticky availability, dynamic slider, and honest guide-unit behavior", async () => {
  const sourceJs = await readFile(path.join(ROOT, "assets/site.js"), "utf8");
  const publicJs = await readFile(path.join(PUBLIC, "assets/site.js"), "utf8");
  for (const marker of [
    "const providerSticky = document.querySelector('[data-provider-sticky]')",
    "providerSticky.classList.toggle('is-active', mobile.matches)",
    "footer.getBoundingClientRect().top <= window.innerHeight",
    "const coverage = form.elements.coverage;",
    "const coverageOutput = form.querySelector('[data-coverage-label]');",
    "const labels = Array.from(form.querySelectorAll('.p3-progress-labels span'));",
    "const state = coverage.valueAsNumber;",
    "if (!Number.isInteger(state) || state < 0 || state > 3)",
    "const likelihood = labels[state].textContent.trim();",
    "coverageOutput.textContent = likelihood;",
    "coverage.setAttribute('aria-valuetext', likelihood);",
    "coverage.style.setProperty('--p3-progress', `${state / 3 * 100}%`);",
    "labels.forEach((label, index) => label.classList.toggle('is-active', index === state));",
    "coverage.addEventListener('input', paint);",
    "coverage.addEventListener('change', paint);",
    "unit.textContent = hasPrice ? '/month starting price' : 'published guide'",
  ]) {
    assert.match(publicJs, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const retired of ["providerSticky.dataset.atTop", "providerSticky.dataset.nearEnd", "providerSticky.dataset.scrollDirection"]) {
    assert.equal(publicJs.includes(retired), false, `${retired} must remain retired`);
    assert.equal(sourceJs.includes(retired), false, `${retired} must remain retired in source`);
  }
});
