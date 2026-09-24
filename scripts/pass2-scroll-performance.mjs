import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const phaseArg = process.argv.find((argument) => argument.startsWith("--phase="));
const phase = phaseArg?.split("=", 2)[1];
if (!new Set(["before", "after"]).has(phase)) throw new Error("usage: node scripts/pass2-scroll-performance.mjs --phase=before|after");

const baseUrl = "http://127.0.0.1:4500";
const outputRoot = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-performance";
const routes = [
  ["home", "/"],
  ["listing", "/lp/best-providers/compounded-semaglutide/?region=OR&dose=0.25&sort=cheapest&drug=SEMAGLUTIDE&form=COMPOUNDED"],
  ["quiz", "/quiz/provider-fit/"],
  ["calculator", "/tools/glp-1-cost-calculator/"],
];
const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];
const trials = 3;

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const median = (values) => percentile(values.filter(Number.isFinite), 0.5);
const round = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : value;

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [viewportName, viewport] of viewports) {
    for (const [routeName, route] of routes) {
      for (let trial = 1; trial <= trials; trial += 1) {
        const context = await browser.newContext({ viewport, reducedMotion: "no-preference", serviceWorkers: "block" });
        await context.route("**/*", async (requestRoute) => {
          const url = requestRoute.request().url();
          if (url.startsWith(baseUrl) || url.startsWith("data:") || url.startsWith("blob:")) await requestRoute.continue();
          else await requestRoute.abort("blockedbyclient");
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
        await page.addInitScript(() => {
          window.__pass2LongTasks = [];
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) window.__pass2LongTasks.push({ startTime: entry.startTime, duration: entry.duration });
            }).observe({ type: "longtask", buffered: true });
          } catch {}
        });
        const started = Date.now();
        let response;
        let error = null;
        let metrics = null;
        try {
          response = await page.goto(`${baseUrl}${route}`, { waitUntil: "load", timeout: 45_000 });
          await page.waitForTimeout(700);
          metrics = await page.evaluate(async () => {
            // Exclude navigation/decode work from the scroll-only Long Tasks
            // metric. The observer starts before navigation so it can be
            // installed reliably, then is reset at the measurement boundary.
            window.__pass2LongTasks = [];
            const frameDeltas = [];
            let last = performance.now();
            let rafId = 0;
            const collect = (now) => {
              frameDeltas.push(now - last);
              last = now;
              rafId = requestAnimationFrame(collect);
            };
            rafId = requestAnimationFrame(collect);
            const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
            const start = performance.now();
            const duration = 3_000;
            await new Promise((resolve) => {
              const advance = (now) => {
                const progress = Math.min(1, (now - start) / duration);
                window.scrollTo(0, maxScroll * progress);
                if (progress < 1) requestAnimationFrame(advance);
                else resolve();
              };
              requestAnimationFrame(advance);
            });
            await new Promise((resolve) => setTimeout(resolve, 350));
            cancelAnimationFrame(rafId);
            const longTasks = window.__pass2LongTasks || [];
            return {
              documentHeight: document.documentElement.scrollHeight,
              maxScroll,
              frameDeltas,
              longTasks,
              gsapPresent: typeof window.gsap === "object",
              scrollTriggerPresent: typeof window.ScrollTrigger === "object" || typeof window.ScrollTrigger === "function",
              lenisPresent: Boolean(window.__lenis || window.lenis || window.Lenis),
              animatedElementCount: document.querySelectorAll("[data-motion],[data-motion-group],.cs-palette-action").length,
            };
          });
        } catch (caught) {
          error = String(caught);
        }
        const deltas = metrics?.frameDeltas || [];
        const longTasks = metrics?.longTasks || [];
        results.push({
          phase,
          viewportName,
          viewport,
          routeName,
          route,
          trial,
          httpStatus: response?.status() ?? 0,
          elapsedMs: Date.now() - started,
          error,
          pageErrors: errors,
          documentHeight: metrics?.documentHeight ?? null,
          maxScroll: metrics?.maxScroll ?? null,
          frameCount: deltas.length,
          frameDeltaMedianMs: round(median(deltas)),
          frameDeltaP95Ms: round(percentile(deltas, 0.95)),
          frameDeltaMaxMs: round(deltas.length ? Math.max(...deltas) : null),
          droppedFrameCountOver25Ms: deltas.filter((value) => value > 25).length,
          severeFrameCountOver50Ms: deltas.filter((value) => value > 50).length,
          longTaskCount: longTasks.length,
          longTaskTotalMs: round(longTasks.reduce((sum, entry) => sum + entry.duration, 0)),
          longTaskMaxMs: round(longTasks.length ? Math.max(...longTasks.map((entry) => entry.duration)) : 0),
          gsapPresent: metrics?.gsapPresent ?? false,
          scrollTriggerPresent: metrics?.scrollTriggerPresent ?? false,
          lenisPresent: metrics?.lenisPresent ?? false,
          animatedElementCount: metrics?.animatedElementCount ?? 0,
        });
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

const groups = [];
for (const [viewportName] of viewports) {
  for (const [routeName, route] of routes) {
    const rows = results.filter((entry) => entry.viewportName === viewportName && entry.routeName === routeName);
    groups.push({
      viewportName,
      routeName,
      route,
      trials: rows.length,
      http200: rows.every((entry) => entry.httpStatus === 200),
      errorFree: rows.every((entry) => !entry.error && entry.pageErrors.length === 0),
      frameDeltaP95MedianMs: round(median(rows.map((entry) => entry.frameDeltaP95Ms))),
      frameDeltaMaxMedianMs: round(median(rows.map((entry) => entry.frameDeltaMaxMs))),
      droppedFramesOver25Median: round(median(rows.map((entry) => entry.droppedFrameCountOver25Ms))),
      severeFramesOver50Median: round(median(rows.map((entry) => entry.severeFrameCountOver50Ms))),
      longTaskCountMedian: round(median(rows.map((entry) => entry.longTaskCount))),
      longTaskTotalMedianMs: round(median(rows.map((entry) => entry.longTaskTotalMs))),
      gsapPresent: rows.every((entry) => entry.gsapPresent),
      scrollTriggerPresent: rows.every((entry) => entry.scrollTriggerPresent),
      lenisPresent: rows.every((entry) => entry.lenisPresent),
      animatedElementCountMedian: round(median(rows.map((entry) => entry.animatedElementCount))),
    });
  }
}
const report = {
  schema: "glp-pass2-scroll-performance-v1",
  phase,
  capturedAtUtc: new Date().toISOString(),
  baseUrl,
  method: {
    browser: "Playwright Chromium",
    trialsPerRouteViewport: trials,
    scrollDurationMs: 3_000,
    externalNetwork: "blocked",
    reducedMotion: "no-preference",
    frameThresholdsMs: { dropped: 25, severe: 50 },
  },
  deployCount: 0,
  status: groups.every((group) => group.http200 && group.errorFree) ? "PASS_CAPTURE" : "FAIL_CAPTURE",
  groups,
  raw: results,
};
const output = path.join(outputRoot, `${phase}.json`);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, phase, groups: groups.length, output }));
