// The paid landing pages are fast, or they do not ship.
//
// WHY THIS EXISTS
// ---------------
// SPEC-ADS §3.3 sets a hard budget for the `/lp/` family: **≤15 requests,
// ≤300 KB transfer, LCP < 1.0s on mid-tier mobile**. It is not a nice-to-have.
// A paid landing page is bought traffic: every 100ms of load is money already
// spent and thrown away, and Google's own landing-page-experience signal prices
// slow destinations into a higher CPC. The organic site can afford a 440 KB
// comparison page because the click was free; the LP cannot.
//
// The budget is also the thing a rebuild silently breaks. Somebody adds the
// sitewide stylesheet "for consistency", or a font, or a chat widget, and the
// page is over budget with nothing failing. So this measures the built page:
//
//   1. REQUESTS — every subresource the document references (scripts, styles,
//      images, preloads, fonts, iframes), plus the document itself.
//   2. TRANSFER — the document's own compressed size plus the compressed size
//      of every same-origin subresource it pulls, since that is what the reader
//      actually downloads over the wire.
//   3. LCP — measured for real in headless Chromium against the built tree with
//      CPU throttling, because a static byte count cannot tell you when the
//      largest element painted.
//
// Exit 0 = PASS, 1 = a landing page over budget.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureTransfer } from "../src/lp-subresources.mjs";
export { referencedUrls } from "../src/lp-subresources.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, "public");
const BUDGET = { requests: 15, transferBytes: 300 * 1024, lcpMs: 1000 };
// Mid-tier mobile: the LCP number in the spec is a phone number, not a laptop
// number, so the probe throttles the CPU rather than measuring a desktop lie.
const CPU_THROTTLE = 4;


async function walk(directory, out = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}


const findings = [];
const results = [];
const pages = (await walk(path.join(PUBLIC, "lp"))).sort();

if (!pages.length) {
  console.log(JSON.stringify({ schema: "glp-lp-speed-budget-v1", status: "PASS", pages: 0, note: "no /lp/ pages in this build" }, null, 2));
  process.exit(0);
}

const measured = [];
for (const file of pages) {
  const route = `/${path.relative(PUBLIC, file).replace(/index\.html$/, "")}`;
  const html = await readFile(file, "utf8");
  const { bytes, requests, missing } = await measureTransfer(html, PUBLIC);
  if (requests > BUDGET.requests) findings.push({ route, code: "lp_request_budget_exceeded", requests, budget: BUDGET.requests });
  if (bytes > BUDGET.transferBytes) findings.push({ route, code: "lp_transfer_budget_exceeded", bytes, budget: BUDGET.transferBytes });
  for (const item of missing) findings.push({ route, code: "lp_subresource_unresolvable", detail: item });
  // Contract checks that belong to the same surface (SPEC-ADS §3.3 / R9).
  if (!/<meta name="robots" content="noindex/i.test(html)) findings.push({ route, code: "lp_not_noindex" });
  if (/AggregateRating/i.test(html)) findings.push({ route, code: "lp_carries_aggregate_rating" });
  if (/type="email"|name="email"/i.test(html)) findings.push({ route, code: "lp_carries_email_capture" });
  measured.push({ route, requests, bytes });
}

// LCP: real browser, built tree, throttled CPU.
let lcpResults = [];
try {
  const { chromium } = await import("playwright");
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
    ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".jpg": "image/jpeg",
    ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml" };
  // Virtual origin only: every response below is fulfilled from PUBLIC.
  // No listener or INET socket is needed, even under strict offline QA.
  const base = "http://127.0.0.1";
  const browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP * ~NOTFOUND", "--dns-prefetch-disable"] });
  try {
    for (const page of measured) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      // Local validation must never execute a third-party or affiliate effect.
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== base || request.method() !== "GET" || /^\/(?:go|api|ingest)(?:\/|$)/.test(url.pathname)) return route.abort();
        // Render exact local candidate bytes without browser TCP passthrough.
        // This is CPU-throttled local paint QA, not production network LCP.
        // All scripts/styles are retained; remote/provider paths stay aborted.
        const relative = decodeURIComponent(url.pathname) + (url.pathname.endsWith("/") ? "index.html" : "");
        const file = path.resolve(PUBLIC, "." + relative);
        if (!file.startsWith(PUBLIC + path.sep)) return route.abort();
        try {
          return route.fulfill({ status: 200, body: await readFile(file), contentType: MIME[path.extname(file)] || "application/octet-stream" });
        } catch {
          return route.fulfill({ status: 404, body: "missing candidate file" });
        }
      });
      const tab = await context.newPage();
      const session = await context.newCDPSession(tab);
      await session.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
      await tab.goto(`${base}${page.route}`, { waitUntil: "load", timeout: 60000 });
      const lcp = await tab.evaluate(() => new Promise((resolve) => {
        let value = 0;
        new PerformanceObserver((list) => { for (const entry of list.getEntries()) value = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => resolve(Math.round(value)), 900);
      }));
      lcpResults.push({ route: page.route, lcp_ms: lcp, cpu_throttle: CPU_THROTTLE });
      if (lcp > BUDGET.lcpMs) findings.push({ route: page.route, code: "lp_lcp_budget_exceeded", lcp_ms: lcp, budget_ms: BUDGET.lcpMs });
      await context.close();
    }
  } finally {
    await browser.close();

  }
} catch (error) {
  findings.push({ code: "lp_lcp_unmeasured", detail: String(error && error.message ? error.message : error),
    why: "the budget includes a paint deadline; an unmeasured paint is not a passing paint" });
}

for (const page of measured) results.push({ ...page, ...(lcpResults.find((item) => item.route === page.route) || {}) });

const status = findings.length ? "FAIL" : "PASS";
console.log(JSON.stringify({ schema: "glp-lp-speed-budget-v1", status, transport: "exact_candidate_file_interception_no_browser_tcp", production_network_lcp_proven: false, budget: BUDGET, pages: results, findings }, null, 2));
if (status === "FAIL") {
  console.error(`FAIL — LP speed budget: ${findings.length} finding(s)`);
  process.exit(1);
}
console.log(`PASS — LP speed budget: ${results.length} landing page(s) within ${BUDGET.requests} requests / ${Math.round(BUDGET.transferBytes / 1024)} KB / ${BUDGET.lcpMs}ms LCP`);
