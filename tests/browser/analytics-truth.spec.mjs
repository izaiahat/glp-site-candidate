// ANALYTICS-TRUTH build gate — the two defects Cogny's 2026-08-20 audit exposed.
//
// DEFECT 1  GA4 property 541440529 was 98.4% localhost: 20,617 of 20,958 sessions and
//           103,013 of 104,807 events arrived from hostName 127.0.0.1, so every ratio
//           the business computed was wrong by ~60x. Cause: the guard sniffed
//           navigator.userAgent only, and BOTH configured Playwright projects defeat a
//           UA sniff — devices["Desktop Chrome"] OVERRIDES the UA to a real Windows
//           Chrome string, and headless WebKit never carried a headless marker at all.
//
// DEFECT 2  PostHog recorded ZERO events for glpclinicscout.com over the same 30 days
//           in which GA4 recorded 20 affiliate_click. Two causes, both fatal alone:
//           the deployed /assets/analytics.js had no PostHog code path whatsoever, and
//           the Content-Security-Policy named googletagmanager/google-analytics/clarity
//           but never posthog, so script-src refused array.js and connect-src refused
//           every capture.
//
// The tests below are the inverse of each defect: automation must send nothing, and a
// real visitor must reach BOTH sinks through the real CSP.

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(ROOT, "public");
const PRODUCTION_ORIGIN = "https://glpclinicscout.com";
const HIT_PATTERN = /\/g\/collect|\/j\/collect|\/collect\?/;

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg", ".ico": "image/x-icon" };

async function productionCsp() {
  const headers = await readFile(path.join(PUBLIC, "_headers"), "utf8");
  const line = headers.split("\n").find((row) => row.trim().startsWith("Content-Security-Policy:"));
  return line.trim().replace(/^Content-Security-Policy:\s*/, "");
}

// Serve the built tree AT THE PRODUCTION ORIGIN, under the production CSP. Serving
// from 127.0.0.1 would prove nothing here: localhost is precisely what the runtime is
// now required to refuse, and python's http.server sends no CSP at all, so a
// header-level block would stay invisible exactly the way it did in production.
async function serveProductionOrigin(context, csp) {
  await context.route(`${PRODUCTION_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (relative === "" || relative.endsWith("/")) relative += "index.html";
    let body;
    try {
      body = await readFile(path.join(PUBLIC, relative));
    } catch {
      try { body = await readFile(path.join(PUBLIC, relative, "index.html")); relative += "/index.html"; }
      catch { return route.fulfill({ status: 404, body: "not found" }); }
    }
    const type = MIME[path.extname(relative)] || "application/octet-stream";
    await route.fulfill({ status: 200, body, headers: { "content-type": type, "content-security-policy": csp } });
  });
}

test("automation and localhost send zero GA4 hits", async ({ page }) => {
  const hits = [];
  page.on("request", (request) => { if (HIT_PATTERN.test(request.url())) hits.push(request.url()); });
  await page.goto("/", { waitUntil: "networkidle" });

  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
  expect(await page.evaluate(() => window.GCS_ANALYTICS_SUPPRESSED)).toBe(true);
  // ga-disable-* is what stops the AUTOMATIC page_view, which was the bulk of the
  // 103,013 leaked events and which our own emit() never saw.
  expect(await page.evaluate(() => window["ga-disable-G-PY9P5CW2EM"] === true && window["ga-disable-G-2WQ42JY0WK"] === true)).toBe(true);
  expect(await page.evaluate(() => window.GCS_POSTHOG_LOADED)).toBeFalsy();
  expect(await page.evaluate(() => window.GCSAnalytics.event("scroll_75", { page_slug: "/" }))).toBe(false);
  expect(hits).toEqual([]);
});

test("a real visitor reaches BOTH sinks through the production CSP", async ({ page, context }) => {
  // navigator.webdriver is the one signal a page cannot forge — which is exactly why
  // the runtime now trusts it. To simulate a human we must override it before any
  // page script runs. Nothing here relaxes the runtime: the production code path is
  // unchanged, we are only presenting it a non-automated, non-local browser.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false, configurable: true });
    // posthog-js runs its own automation heuristic and an empty navigator.plugins is
    // one of its tells. (Worth knowing on its own: PostHog independently refuses to
    // record scripted browsers, which is a second line of defence for defect 1.)
    const plugins = [{ name: "PDF Viewer" }, { name: "Chrome PDF Viewer" }, { name: "Chromium PDF Viewer" }];
    plugins.item = (index) => plugins[index];
    plugins.namedItem = (name) => plugins.find((plugin) => plugin.name === name);
    plugins.refresh = () => {};
    Object.defineProperty(navigator, "plugins", { get: () => plugins, configurable: true });
    // Record the ingest calls themselves. posthog-js sends with fetch(keepalive) and
    // sendBeacon, neither of which reliably surfaces through Playwright's request
    // event, so the page is the only honest observer of its own egress.
    window.__ingest = [];
    const nativeFetch = window.fetch;
    window.fetch = (input, init) => { const url = String(input?.url || input); if (url.includes("posthog.com")) window.__ingest.push({ via: "fetch", url }); return nativeFetch.call(window, input, init); };
    const nativeBeacon = navigator.sendBeacon?.bind(navigator);
    if (nativeBeacon) navigator.sendBeacon = (url, data) => { if (String(url).includes("posthog.com")) window.__ingest.push({ via: "sendBeacon", url: String(url) }); return nativeBeacon(url, data); };
  });
  await serveProductionOrigin(context, await productionCsp());
  // Never let a proof run touch the real GA4 property or a real merchant.
  await context.route(/googletagmanager\.com|google-analytics\.com|doubleclick\.net|clarity\.ms/, (route) => route.abort());

  const cspViolations = [];
  page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) cspViolations.push(message.text()); });
  const postHogTraffic = [];
  page.on("request", (request) => { if (request.url().includes("posthog.com")) postHogTraffic.push({ url: request.url(), body: request.postData() }); });
  const postHogResponses = [];
  page.on("response", (response) => { if (response.url().includes("posthog.com")) postHogResponses.push({ url: response.url(), status: response.status() }); });

  await page.goto(`${PRODUCTION_ORIGIN}/best/online-glp-1-providers/`, { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => location.hostname)).toBe("glpclinicscout.com");
  expect(await page.evaluate(() => window.GCS_ANALYTICS_SUPPRESSED)).toBeFalsy();

  // array.js must actually execute — the CSP defect stopped it here for 30 days.
  await page.waitForFunction(() => typeof window.posthog?.capture === "function" && window.posthog.__loaded !== undefined, null, { timeout: 20000 });

  const captured = [];
  await page.evaluate(() => {
    // Harness-only, never production: posthog-js refuses to record a browser it
    // believes is scripted, and it is right to. This test IS a scripted browser
    // standing in for a human, so its heuristic is opted out of here — in the test,
    // after load, leaving data/posthog-config.json and the runtime untouched.
    window.posthog.set_config({ opt_out_useragent_filter: true });
    window.__captures = [];
    const original = window.posthog.capture.bind(window.posthog);
    window.posthog.capture = (name, properties, options) => { window.__captures.push({ name, properties, options }); return original(name, properties, options); };
  });

  // Let the real click handler run, then cancel only the default navigation. A
  // window-level bubble listener fires AFTER the document-level handler in
  // analytics.js, so the event is fully processed before the default action is
  // suppressed — and the document survives, which is what lets us read back what
  // was captured. (Aborting the outbound request instead replaces the document
  // with an error page and takes the evidence with it.)
  await page.evaluate(() => window.addEventListener("click", (event) => event.preventDefault(), false));
  const anchor = page.locator('a[data-analytics-event="affiliate_click"]').first();
  await anchor.scrollIntoViewIfNeeded();
  await anchor.click({ noWaitAfter: true });
  await page.waitForFunction(() => (window.__captures || []).some((entry) => entry.name === "affiliate_click"), null, { timeout: 10000 });
  captured.push(...await page.evaluate(() => window.__captures));

  const affiliate = captured.find((entry) => entry.name === "affiliate_click");
  expect(affiliate, "affiliate_click never reached posthog.capture").toBeTruthy();
  // Outbound clicks race the document unload; XHR started in the same tick is
  // cancelled by the navigation. sendBeacon survives it.
  expect(affiliate.options?.transport).toBe("sendBeacon");
  // The privacy contract, asserted on the payload rather than on the config: only
  // allow-listed properties travel, and no health datum has a property to travel in.
  expect(Object.keys(affiliate.properties)).not.toContain("quiz_answers");
  expect(Object.keys(affiliate.properties)).not.toContain("email");
  expect(affiliate.properties.provider_slug).toBeTruthy();
  expect(affiliate.properties.cs_click_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  // The receipt that matters: bytes on the wire to PostHog's ingest endpoint. The
  // library loading is not evidence of anything — it loaded fine for the 30 days
  // PostHog recorded zero events. What must be true is that /i/v0/e/ is called.
  await page.waitForFunction(() => (window.__ingest || []).some((entry) => /\/i\/v\d+\/e\/|\/e\/|\/batch\//.test(entry.url)), null, { timeout: 15000 });
  const ingest = await page.evaluate(() => window.__ingest);
  expect(ingest.some((entry) => /\/i\/v\d+\/e\/|\/e\/|\/batch\//.test(entry.url)), `no ingest call: ${JSON.stringify(ingest)}`).toBe(true);
  expect(postHogResponses.some((response) => response.status >= 200 && response.status < 300)).toBe(true);
  expect(cspViolations, `CSP refused PostHog: ${cspViolations.join(" | ")}`).toEqual([]);
  // Written to disk so the run's own cs_click_id can be matched against PostHog's
  // server-side record — a receipt from their side, not ours.
  console.log(`ANALYTICS-TRUTH-RECEIPT ${JSON.stringify({ cs_click_id: affiliate.properties.cs_click_id, provider_slug: affiliate.properties.provider_slug, ingest: ingest.map((entry) => `${entry.via} ${entry.url}`) })}`);
});
