import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const BASE_URL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4500";
const OUTPUT_ROOT = process.env.PAGE_SPECS_ROOT || "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/PAGE-SPECS-20260826";
const QUIZ_PROGRESS_KEY = "gcs.quiz.provider-fit.progress.v1";

const VIEWPORTS = [
  {
    name: "desktop-1440x900-normal-motion",
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    isMobile: false,
    reducedMotion: "no-preference",
    captureSections: true,
  },
  {
    name: "desktop-1440x900-reduced-motion",
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    isMobile: false,
    reducedMotion: "reduce",
    captureSections: false,
  },
  {
    name: "mobile-390x844-normal-motion",
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    isMobile: true,
    reducedMotion: "no-preference",
    captureSections: true,
  },
  {
    name: "mobile-390x844-reduced-motion",
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    isMobile: true,
    reducedMotion: "reduce",
    captureSections: false,
  },
];

const PAGES = [
  { family: "home", name: "home", route: "/" },
  { family: "insights", name: "insights-index", route: "/insights/" },
  { family: "insights", name: "guide-how-to-get-ozempic-online", route: "/guides/how-to-get-ozempic-online/" },
  { family: "reviews-capture", name: "reviews-index", route: "/reviews/" },
  { family: "reviews-capture", name: "reviews-submit", route: "/reviews/submit/" },
  { family: "category-compounded", name: "compounded-semaglutide", route: "/lp/best-providers/compounded-semaglutide/" },
  { family: "category-compounded", name: "compounded-tirzepatide", route: "/lp/best-providers/compounded-tirzepatide/" },
  { family: "brand-ozempic-wegovy", name: "ozempic", route: "/ozempic/" },
  { family: "brand-ozempic-wegovy", name: "wegovy", route: "/wegovy/" },
  { family: "brand-ozempic-wegovy", name: "wegovy-pill", route: "/wegovy-pill/" },
  { family: "brand-mounjaro-zepbound", name: "mounjaro", route: "/mounjaro/" },
  { family: "brand-mounjaro-zepbound", name: "zepbound", route: "/zepbound/" },
  { family: "packs-cost", name: "3-month", route: "/3-month/" },
  { family: "packs-cost", name: "6-month", route: "/6-month/" },
  { family: "packs-cost", name: "bulk-hub", route: "/bulk/" },
  { family: "provider-pharmacy", name: "provider-orderlymeds", route: "/providers/orderlymeds/" },
  { family: "provider-pharmacy", name: "review-orderlymeds", route: "/reviews/orderlymeds/" },
  { family: "provider-pharmacy", name: "pharmacies-index", route: "/pharmacies/" },
  { family: "provider-pharmacy", name: "pharmacy-empower", route: "/pharmacies/empower/" },
  { family: "calculator-tools", name: "cost-calculator", route: "/tools/glp-1-cost-calculator/" },
  { family: "compare-search", name: "providers-cheapest", route: "/providers/?sort=cheapest" },
  { family: "compare-search", name: "pharmacy-strive-compare", route: "/pharmacies/strive/compare-providers/" },
  { family: "compare-search", name: "compact-matches", route: "/matches/customized/" },
];

const manifest = {
  schema: "glp.design-pass-paired-rescreenshot.v1",
  generated_at_utc: new Date().toISOString(),
  base_url: BASE_URL,
  headless: true,
  external_requests_blocked: [],
  page_errors: [],
  captures: [],
  failures: [],
};

function outputDir(family) {
  return resolve(OUTPUT_ROOT, family, "ours-rebuilt");
}

function safeName(value) {
  return String(value || "section")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "section";
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function routeFile(route) {
  const pathname = new URL(route, "https://glpclinicscout.com").pathname;
  return resolve(ROOT, "public", pathname.replace(/^\/+|\/+$/g, ""), "index.html");
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    document.querySelectorAll("img[loading='lazy']").forEach((image) => { image.loading = "eager"; });
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    window.scrollTo(0, 0);
    await document.fonts?.ready;
    await Promise.race([
      Promise.all([...document.images].map((image) => image.decode?.().catch(() => undefined))),
      new Promise((done) => setTimeout(done, 1_200)),
    ]);
  });
  await page.waitForTimeout(120);
}

async function navigate(page, route) {
  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!response || response.status() >= 400) throw new Error(`navigation_${response?.status() || "no_response"}:${route}`);
  await settle(page);
  return response.status();
}

async function screenshot(page, path, options = {}) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  await page.screenshot({ path, animations: "disabled", caret: "hide", timeout: 45_000, ...options });
  manifest.captures.push(path);
}

async function captureSections(page, directory, stem, viewportName) {
  const sections = await page.evaluate(() => {
    const isVisibleEvidenceRegion = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (rect.width < 40 || rect.height < 60 || style.display === "none" || style.visibility === "hidden") return false;
        if (element.tagName === "ARTICLE" && element.querySelector(":scope section")) return false;
        return true;
    };
    const topLevelSections = [...document.querySelectorAll("main section")]
      .filter((element) => !element.parentElement?.closest("section"))
      .filter(isVisibleEvidenceRegion);
    const fallbackArticles = [...document.querySelectorAll("main article")]
      .filter((element) => !element.parentElement?.closest("article, section"))
      .filter(isVisibleEvidenceRegion)
      .slice(0, 4);
    const candidates = topLevelSections.length ? topLevelSections : fallbackArticles;
    // Full-page captures own whole-route proof. Keep one high-resolution crop
    // for local inspection so a 24-route matrix finishes inside the heavy-lane
    // budget instead of spending minutes screenshotting every section twice.
    return candidates.slice(0, 1).map((element, index) => {
      const marker = `design-evidence-${index + 1}`;
      element.setAttribute("data-design-evidence", marker);
      const heading = element.querySelector("h1,h2,h3")?.textContent?.trim().replace(/\s+/g, " ") || "";
      return { marker, index: index + 1, heading, className: String(element.className || "") };
    });
  });

  if (!sections.length) {
    const path = resolve(directory, `${stem}--${viewportName}--section-01-main.png`);
    await screenshot(page, path, { fullPage: false });
    return 1;
  }

  let count = 0;
  for (const section of sections) {
    const locator = page.locator(`[data-design-evidence="${section.marker}"]`);
    const label = safeName(section.heading || section.className || `section-${section.index}`);
    const path = resolve(directory, `${stem}--${viewportName}--section-${String(section.index).padStart(2, "0")}-${label}.png`);
    try {
      await locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(40);
      await locator.screenshot({ path, animations: "disabled", caret: "hide", timeout: 45_000 });
      manifest.captures.push(path);
      count += 1;
    } catch (error) {
      manifest.failures.push({ page: page.url(), kind: "section", selector: `[data-design-evidence="${section.marker}"]`, error: String(error) });
    }
  }
  return count;
}

async function captureStaticPage(page, entry, viewportName, includeSections) {
  const directory = outputDir(entry.family);
  const status = await navigate(page, entry.route);
  const fullPath = resolve(directory, `${entry.name}--${viewportName}--full.png`);
  await screenshot(page, fullPath, { fullPage: true });
  const sectionCount = includeSections ? await captureSections(page, directory, entry.name, viewportName) : 0;
  manifest.captures.push({ family: entry.family, route: entry.route, viewport: viewportName, status, full: fullPath, section_count: sectionCount });
}

async function captureQuizState(page, viewportName, stem, position = null) {
  const directory = outputDir("quiz");
  const fullPath = resolve(directory, `${stem}--${viewportName}--full.png`);
  await screenshot(page, fullPath, { fullPage: true });
  const selector = position === null ? "[data-phase4-results]" : `[data-quiz-position="${position}"]`;
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const sectionPath = resolve(directory, `${stem}--${viewportName}--section.png`);
  await locator.screenshot({ path: sectionPath, animations: "disabled", caret: "hide", timeout: 45_000 });
  manifest.captures.push(sectionPath);
}

async function waitForQuizResultsReady(page) {
  await page.waitForFunction(() => {
    const cards = document.querySelector("[data-result-cards]");
    if (!cards || cards.classList.contains("is-computing") || cards.classList.contains("is-entering")) return false;
    const results = [...cards.querySelectorAll(":scope > article")];
    return results.length === 3 && results.every((card) => card.textContent.trim().length > 50);
  }, null, { timeout: 8_000 });
}

async function captureQuiz(page, viewportName) {
  await page.evaluate((key) => localStorage.removeItem(key), QUIZ_PROGRESS_KEY);
  await navigate(page, "/quiz/provider-fit/");
  await captureQuizState(page, viewportName, "quiz-step-01-treatment", 0);
  await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
  await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
  await captureQuizState(page, viewportName, "quiz-step-02-current-use", 2);
  await page.locator('[data-single="current_use"][data-value="no"]').click();
  await captureQuizState(page, viewportName, "quiz-step-03-reasons-no-branch", 1);
  await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
  await captureQuizState(page, viewportName, "quiz-step-05-features", 4);
  await page.locator('[data-multi="features"]').first().click();
  await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
  await captureQuizState(page, viewportName, "quiz-step-06-state", 5);
  await page.locator('[data-quiz-select="state"]').selectOption("OR");
  await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
  await captureQuizState(page, viewportName, "quiz-step-07-contact-email-position", 6);
  await page.locator('[data-quiz-input="email"]').fill("evidence@example.test");
  await captureQuizState(page, viewportName, "quiz-email-capture-filled-not-submitted", 6);
  await page.locator('[data-quiz-input="email"]').fill("");
  await page.locator("[data-quiz-finish]").click();
  await page.locator("[data-phase4-results]").waitFor({ state: "visible" });
  await waitForQuizResultsReady(page);
  await captureQuizState(page, viewportName, "quiz-results-combo-01-semaglutide-no-or");

  await page.evaluate((key) => localStorage.removeItem(key), QUIZ_PROGRESS_KEY);
  await navigate(page, "/quiz/provider-fit/");
  await page.locator('[data-multi="intents"][data-value="TIRZEPATIDE"]').click();
  await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
  await page.locator('[data-single="current_use"][data-value="yes"]').click();
  await captureQuizState(page, viewportName, "quiz-step-04-current-treatment-yes-branch", 3);
  await page.locator('[data-quiz-select="current_drug"]').selectOption("TIRZEPATIDE");
  await page.locator('[data-quiz-select="current_dose"]').selectOption("5");
  await page.locator('[data-quiz-position="3"] [data-quiz-next]').click();
  await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
  await page.locator('[data-quiz-select="state"]').selectOption("CA");
  await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
  await page.locator("[data-quiz-finish]").click();
  await page.locator("[data-phase4-results]").waitFor({ state: "visible" });
  await waitForQuizResultsReady(page);
  await captureQuizState(page, viewportName, "quiz-results-combo-02-tirzepatide-yes-ca");
}

async function captureSearch(page, viewportName) {
  await navigate(page, "/");
  await page.locator(".cs-search-toggle").click();
  const input = page.locator('input[type="search"][aria-label="Search providers or pharmacies"]');
  await input.fill("semaglutide");
  await page.waitForTimeout(450);
  const directory = outputDir("compare-search");
  await screenshot(page, resolve(directory, `header-search-semaglutide--${viewportName}--full.png`), { fullPage: true });
  const panel = page.locator(".cs-search-panel");
  await panel.screenshot({ path: resolve(directory, `header-search-semaglutide--${viewportName}--section.png`), animations: "disabled", caret: "hide", timeout: 45_000 });
  manifest.captures.push(resolve(directory, `header-search-semaglutide--${viewportName}--section.png`));
}

for (const family of new Set([...PAGES.map((entry) => entry.family), "quiz"])) {
  rmSync(outputDir(family), { recursive: true, force: true });
  mkdirSync(outputDir(family), { recursive: true });
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: viewport.viewport,
      screen: viewport.viewport,
      userAgent: viewport.userAgent,
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: viewport.reducedMotion,
      locale: "en-US",
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(BASE_URL) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      manifest.external_requests_blocked.push({ viewport: viewport.name, url: url.slice(0, 500) });
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => manifest.page_errors.push({ viewport: viewport.name, page: page.url(), error: String(error) }));

    for (const entry of PAGES) {
      try {
        await captureStaticPage(page, entry, viewport.name, viewport.captureSections);
        console.log(`captured ${entry.family}/${entry.name} ${viewport.name}`);
      } catch (error) {
        manifest.failures.push({ family: entry.family, route: entry.route, viewport: viewport.name, kind: "page", error: String(error) });
        console.error(`FAILED ${entry.family}/${entry.name} ${viewport.name}: ${error}`);
      }
    }
    try {
      await captureQuiz(page, viewport.name);
      console.log(`captured quiz flow ${viewport.name}`);
    } catch (error) {
      manifest.failures.push({ family: "quiz", route: "/quiz/provider-fit/", viewport: viewport.name, kind: "flow", error: String(error) });
      console.error(`FAILED quiz ${viewport.name}: ${error}`);
    }
    try {
      await captureSearch(page, viewport.name);
      console.log(`captured search state ${viewport.name}`);
    } catch (error) {
      manifest.failures.push({ family: "compare-search", route: "/", viewport: viewport.name, kind: "search-state", error: String(error) });
      console.error(`FAILED search ${viewport.name}: ${error}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

manifest.generated_at_utc = new Date().toISOString();
manifest.capture_file_count = manifest.captures.filter((entry) => typeof entry === "string").length;
manifest.page_receipts = manifest.captures.filter((entry) => typeof entry === "object").length;
manifest.current_byte_hashes = Object.fromEntries([
  "src/phase3-page-graph.mjs",
  "src/pass2-page-visual-upgrades.mjs",
  "src/content-upgrade.mjs",
  "assets/site.js",
  "assets/css-src/11-phase3.css",
  "assets/css-src/40-editorial.css",
  "scripts/capture-design-pass-evidence.mjs",
  "scripts/serve-review.mjs",
  "public/assets/site.js",
  "public/assets/site-p3.css",
  "public/assets/site-editorial.css",
  ...PAGES.map((entry) => routeFile(entry.route).slice(ROOT.length + 1)),
].filter((path, index, paths) => paths.indexOf(path) === index).sort().map((path) => [path, sha256File(resolve(ROOT, path))]));
const manifestPath = resolve(OUTPUT_ROOT, "ours-rebuilt-capture-manifest.json");
const manifestTempPath = `${manifestPath}.tmp-${process.pid}`;
writeFileSync(manifestTempPath, `${JSON.stringify(manifest, null, 2)}\n`);
renameSync(manifestTempPath, manifestPath);
console.log(JSON.stringify({ status: manifest.failures.length ? "FAIL" : "PASS", manifest: manifestPath, screenshots: manifest.capture_file_count, page_receipts: manifest.page_receipts, failures: manifest.failures.length }));
if (manifest.failures.length) process.exitCode = 1;
