import { readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, "public");
const BASE_URL = (process.env.PASS3_BASE_URL || "http://127.0.0.1:4500").replace(/\/$/, "");
const REPORT = process.env.PASS3_PHASE6_ALL_ROUTES_REPORT || path.resolve(
  ROOT,
  "../../../../reports/glp-clinic-scout/rebuild/pass3/phase6-mobile-all-routes.json",
);
const viewport = { width: 390, height: 844 };

async function discoverIndexRoutes(directory = PUBLIC) {
  const routes = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    routes.push(...await discoverIndexRoutes(child));
  }
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "index.html")) {
      const relative = path.relative(PUBLIC, directory).split(path.sep).filter(Boolean);
      routes.push(relative.length ? `/${relative.join("/")}/` : "/");
    }
  } catch {
    // The recursive directory read above is authoritative; this is defensive only.
  }
  return routes;
}

const routes = [...new Set(await discoverIndexRoutes())].sort();
const violations = [];
const results = [];
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport,
  isMobile: true,
  hasTouch: true,
  reducedMotion: "reduce",
  colorScheme: "light",
  locale: "en-US",
  serviceWorkers: "block",
});
await context.addInitScript(() => {
  localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
    analytics: "denied",
    version: "gcs-cookie-v2-default-on-20260730",
    saved_at: "2026-08-26T00:00:00.000Z",
  }));
});
await context.route(/https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) => route.fulfill({
  status: 204,
  contentType: "application/javascript",
  body: "",
}));
await context.route("**/api/geo-state", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  headers: { "cache-control": "private, no-store" },
  body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
}));
const page = await context.newPage();

for (const route of routes) {
  const pageErrors = [];
  const requestFailures = [];
  const onPageError = (error) => pageErrors.push(String(error));
  const onRequestFailed = (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || "unknown" });
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);

  let status = null;
  let metrics = null;
  try {
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "load", timeout: 120_000 });
    status = response?.status() ?? null;
    metrics = await page.evaluate(() => {
      const visible = (node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && box.width > 0 && box.height > 0;
      };
      const describe = (node) => {
        const box = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          id: node.id || null,
          class: typeof node.className === "string" ? node.className.slice(0, 120) : null,
          text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
          left: Math.round(box.left * 10) / 10,
          right: Math.round(box.right * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        };
      };
      const boundedSelector = [
        "main > section",
        "main > article",
        "main > form",
        "main > fieldset",
        ".cs-card",
        "[data-wrap-card]",
        "[data-phase3-provider]",
        "[data-review-card]",
      ].join(",");
      const outOfBounds = [...document.querySelectorAll(boundedSelector)].flatMap((node) => {
        if (!visible(node)) return [];
        const box = node.getBoundingClientRect();
        return box.left < -1 || box.right > innerWidth + 1 ? [describe(node)] : [];
      });
      const controls = [...document.querySelectorAll("button, .cs-btn, .cta, .option, .submit, [role='button'], select, input[type='submit'], input[type='button'], a.inline-citation, .inline-citation a, .citation a, .ready6-jump-nav a, .cs-footer-grid a, .cs-footer-legal a, .p3-source-price > details summary, .p3-price-source summary, .p5-check")].flatMap((node) => {
        if (!visible(node) || node.matches(":disabled,[aria-disabled='true']")) return [];
        const box = node.getBoundingClientRect();
        return box.width < 44 || box.height < 44 ? [describe(node)] : [];
      });
      const fixed = [...document.querySelectorAll("body *")].flatMap((node) => {
        if (!visible(node)) return [];
        const style = getComputedStyle(node);
        if (style.position !== "fixed" && style.position !== "sticky") return [];
        const box = node.getBoundingClientRect();
        if (style.position === "sticky" && (box.bottom <= 0 || box.top >= innerHeight)) return [];
        return box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1
          ? [{ ...describe(node), position: style.position }]
          : [];
      });
      return {
        mainCount: document.querySelectorAll("main").length,
        h1Count: document.querySelectorAll("h1").length,
        documentOverflow: Math.round((document.documentElement.scrollWidth - document.documentElement.clientWidth) * 10) / 10,
        bodyOverflow: Math.round((document.body.scrollWidth - document.documentElement.clientWidth) * 10) / 10,
        documentHeight: document.documentElement.scrollHeight,
        outOfBounds,
        undersizedControls: controls,
        fixedOutOfBounds: fixed,
      };
    });
  } catch (error) {
    violations.push({ route, code: "navigation_exception", error: String(error) });
  }

  if (status !== 200) violations.push({ route, code: "route_not_200", status });
  if (metrics) {
    if (metrics.mainCount !== 1) violations.push({ route, code: "main_count_mismatch", actual: metrics.mainCount });
    if (metrics.h1Count !== 1) violations.push({ route, code: "h1_count_mismatch", actual: metrics.h1Count });
    if (metrics.documentOverflow > 1 || metrics.bodyOverflow > 1) {
      violations.push({ route, code: "horizontal_document_overflow", documentOverflow: metrics.documentOverflow, bodyOverflow: metrics.bodyOverflow });
    }
    if (metrics.outOfBounds.length) violations.push({ route, code: "bounded_surface_out_of_viewport", items: metrics.outOfBounds.slice(0, 12) });
    if (metrics.undersizedControls.length) violations.push({ route, code: "undersized_touch_target", items: metrics.undersizedControls.slice(0, 12) });
    if (metrics.fixedOutOfBounds.length) violations.push({ route, code: "fixed_or_sticky_surface_out_of_viewport", items: metrics.fixedOutOfBounds.slice(0, 12) });
  }
  if (pageErrors.length) violations.push({ route, code: "runtime_page_error", errors: pageErrors.slice(0, 5) });
  if (requestFailures.length) violations.push({ route, code: "failed_network_request", requests: requestFailures.slice(0, 5) });

  results.push({ route, status, metrics, pageErrors, requestFailures });
  page.off("pageerror", onPageError);
  page.off("requestfailed", onRequestFailed);
}

await context.close();
await browser.close();

const receipt = {
  schema: "glp-pass3-phase6-all-routes-mobile-v1",
  status: violations.length ? "FAIL" : "PASS",
  base_url: BASE_URL,
  generated_at: new Date().toISOString(),
  engine: "chromium",
  viewport,
  route_count: routes.length,
  routes,
  checks: [
    "every built index route returns HTTP 200",
    "exactly one main and one h1",
    "zero document/body horizontal overflow",
    "major sections/cards/forms stay inside viewport",
    "primary controls plus citation, jump-nav, footer, price-source, and review-attestation targets are at least 44x44",
    "fixed and sticky surfaces remain inside viewport",
    "zero browser page errors and failed requests",
  ],
  violations,
  results,
  deploys: 0,
};
await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(REPORT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  schema: receipt.schema,
  status: receipt.status,
  report: REPORT,
  route_count: receipt.route_count,
  violation_count: violations.length,
  violations: violations.slice(0, 30),
  deploys: 0,
}, null, 2));
if (violations.length) process.exitCode = 1;
