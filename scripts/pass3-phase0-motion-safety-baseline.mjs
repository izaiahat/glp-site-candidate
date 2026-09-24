import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.PASS3_BASE_URL || "http://127.0.0.1:4500";
const output = process.env.PASS3_PHASE0_SAFETY_OUTPUT ||
  "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass3/phase0-motion-safety-baseline.json";
const routes = [
  "/",
  "/lp/best-providers/compounded-semaglutide/",
  "/ozempic/",
  "/providers/",
  "/reviews/strut-health/",
  "/reviews/submit/",
  "/insights/",
  "/guides/verify-online-glp-1-pharmacy/",
  "/quiz/provider-fit/",
  "/tools/glp-1-cost-calculator/",
];

const browser = await chromium.launch({ headless: true });

async function inspect({ javaScriptEnabled, reducedMotion }) {
  const context = await browser.newContext({
    javaScriptEnabled,
    reducedMotion,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const rows = [];
  for (const route of routes) {
    let status = null;
    let failure = null;
    let state = null;
    try {
      const response = await page.goto(`${base}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      status = response?.status() ?? null;
      await page.waitForTimeout(javaScriptEnabled ? 120 : 20);
      state = await page.evaluate(() => {
        const main = document.querySelector("main");
        const h1 = document.querySelector("h1");
        const hiddenMotion = [...document.querySelectorAll("[data-motion],[data-motion-group]")]
          .filter((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display === "none" || style.visibility === "hidden" ||
              Number(style.opacity) < 0.01 || rect.width < 1 || rect.height < 1;
          }).length;
        return {
          title: document.title,
          h1: h1?.textContent?.trim() || "",
          mainTextLength: main?.innerText?.trim().length || 0,
          mainDisplay: main ? getComputedStyle(main).display : null,
          mainVisibility: main ? getComputedStyle(main).visibility : null,
          hiddenMotion,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          lenisInstances: window.__gcsLenis ? 1 : 0,
          externalScripts: [...document.scripts]
            .map((script) => script.src)
            .filter(Boolean)
            .filter((src) => new URL(src).origin !== location.origin),
        };
      });
    } catch (error) {
      failure = String(error?.message || error).slice(0, 1000);
    }
    rows.push({ route, status, failure, state });
  }
  await context.close();
  return rows;
}

const jsOff = await inspect({ javaScriptEnabled: false, reducedMotion: "reduce" });
const reduced = await inspect({ javaScriptEnabled: true, reducedMotion: "reduce" });
const normal = await inspect({ javaScriptEnabled: true, reducedMotion: "no-preference" });
await browser.close();

function summarize(rows, mode) {
  return {
    mode,
    routes: rows.length,
    httpFailures: rows.filter((row) => row.status !== 200).length,
    navigationFailures: rows.filter((row) => row.failure).length,
    emptyMainRoutes: rows.filter((row) => !row.state || row.state.mainTextLength < 100).map((row) => row.route),
    emptyH1Routes: rows.filter((row) => !row.state?.h1).map((row) => row.route),
    hiddenMotionRoutes: rows.filter((row) => row.state?.hiddenMotion).map((row) => ({ route: row.route, count: row.state.hiddenMotion })),
    overflowRoutes: rows.filter((row) => row.state?.horizontalOverflow).map((row) => row.route),
    lenisRoutes: rows.filter((row) => row.state?.lenisInstances).map((row) => row.route),
    externalScriptRoutes: rows.filter((row) => row.state?.externalScripts.length).map((row) => ({ route: row.route, scripts: row.state.externalScripts })),
  };
}

const receipt = {
  schema: "pass3-phase0-motion-safety-baseline-v1",
  observedAtUtc: new Date().toISOString(),
  baseUrl: base,
  viewport: { width: 1440, height: 900 },
  summaries: [
    summarize(jsOff, "javascript-disabled+reduced"),
    summarize(reduced, "javascript-enabled+reduced"),
    summarize(normal, "javascript-enabled+normal-motion"),
  ],
  jsOff,
  reduced,
  normal,
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ output, summaries: receipt.summaries }, null, 2));
