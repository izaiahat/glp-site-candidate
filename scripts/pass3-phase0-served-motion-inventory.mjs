import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.PASS3_BASE_URL || "http://127.0.0.1:4500";
const output = process.env.PASS3_PHASE0_OUTPUT || path.resolve(
  "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass3/phase0-served-motion-baseline.json",
);

function familyFor(pathname) {
  const part = pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  return part || "home";
}

const sitemapResponse = await fetch(`${base}/sitemap.xml`);
if (!sitemapResponse.ok) {
  throw new Error(`sitemap fetch failed: ${sitemapResponse.status}`);
}
const sitemap = await sitemapResponse.text();
const paths = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)]
  .map((match) => match[1] || "/");
if (!paths.length) throw new Error("sitemap contained no routes");

const browser = await chromium.launch({ headless: true });
const results = new Array(paths.length);
let cursor = 0;

async function worker() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  while (true) {
    const index = cursor++;
    if (index >= paths.length) break;
    const pathname = paths[index];
    const consoleErrors = [];
    const onConsole = (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
    };
    page.on("console", onConsole);
    let status = null;
    let failure = null;
    let metrics = null;
    try {
      const response = await page.goto(`${base}${pathname}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      status = response?.status() ?? null;
      await page.waitForTimeout(80);
      metrics = await page.evaluate(() => {
        const count = (selector) => document.querySelectorAll(selector).length;
        const root = document.documentElement;
        return {
          title: document.title,
          bodyClass: document.body.className,
          motionNodes: count("[data-motion]"),
          motionGroups: count("[data-motion-group]"),
          repeatMotionOwners: count('[data-motion-once="false"]'),
          splitNodes: count("[data-split]"),
          counters: count("[data-counter]"),
          loopOwners: count("[data-motion-loop]"),
          links: count("a[href]"),
          buttons: count("button"),
          forms: count("form"),
          submitControls: count('button[type="submit"],input[type="submit"]'),
          inputs: count("input,select,textarea"),
          tooltips: count('[role="tooltip"],[data-tooltip],.tooltip'),
          liveRegions: count('[aria-live], [role="status"], [role="alert"]'),
          dialogs: count('dialog,[role="dialog"]'),
          carousels: count('[class*="carousel"],[class*="rail"],[data-carousel]'),
          searchControls: count('[type="search"],[data-search],.cs-search-toggle'),
          horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
          scrollWidth: root.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });
    } catch (error) {
      failure = String(error?.message || error).slice(0, 1000);
    } finally {
      page.off("console", onConsole);
    }
    results[index] = {
      pathname,
      family: familyFor(new URL(`${base}${pathname}`).pathname),
      status,
      failure,
      consoleErrors,
      metrics,
    };
  }
  await context.close();
}

await Promise.all(Array.from({ length: 4 }, () => worker()));
await browser.close();

const totals = {
  routes: results.length,
  httpFailures: results.filter((row) => row.status !== 200).length,
  navigationFailures: results.filter((row) => row.failure).length,
  consoleErrorRoutes: results.filter((row) => row.consoleErrors.length).length,
  horizontalOverflowRoutes: results.filter((row) => row.metrics?.horizontalOverflow).length,
  motionNodes: results.reduce((sum, row) => sum + (row.metrics?.motionNodes || 0), 0),
  motionGroups: results.reduce((sum, row) => sum + (row.metrics?.motionGroups || 0), 0),
  repeatMotionOwners: results.reduce((sum, row) => sum + (row.metrics?.repeatMotionOwners || 0), 0),
  forms: results.reduce((sum, row) => sum + (row.metrics?.forms || 0), 0),
  buttons: results.reduce((sum, row) => sum + (row.metrics?.buttons || 0), 0),
  carousels: results.reduce((sum, row) => sum + (row.metrics?.carousels || 0), 0),
  tooltips: results.reduce((sum, row) => sum + (row.metrics?.tooltips || 0), 0),
};

const families = {};
for (const row of results) {
  const entry = families[row.family] ||= {
    routes: 0,
    motionNodes: 0,
    forms: 0,
    buttons: 0,
    carousels: 0,
    tooltips: 0,
    overflowRoutes: 0,
  };
  entry.routes += 1;
  entry.motionNodes += row.metrics?.motionNodes || 0;
  entry.forms += row.metrics?.forms || 0;
  entry.buttons += row.metrics?.buttons || 0;
  entry.carousels += row.metrics?.carousels || 0;
  entry.tooltips += row.metrics?.tooltips || 0;
  entry.overflowRoutes += row.metrics?.horizontalOverflow ? 1 : 0;
}

const receipt = {
  schema: "pass3-phase0-served-motion-inventory-v1",
  observedAtUtc: new Date().toISOString(),
  baseUrl: base,
  viewport: { width: 1440, height: 900 },
  source: "served HTTP/DOM via Playwright Chromium",
  totals,
  families,
  results,
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ output, totals, families }, null, 2));
