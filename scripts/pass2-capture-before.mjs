import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = "http://127.0.0.1:4500";
const phaseArg = process.argv.find((argument) => argument.startsWith("--phase="));
const phase = phaseArg?.split("=", 2)[1] || "before";
if (!new Set(["before", "after"]).has(phase)) throw new Error("phase must be before or after");
const outputRoot = `/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-browser/${phase}`;
const routes = [
  ["home", "/"],
  ["listing", "/lp/best-providers/compounded-semaglutide/?region=OR&dose=0.25&sort=cheapest&drug=SEMAGLUTIDE&form=COMPOUNDED"],
  ["quiz", "/quiz/provider-fit/"],
  ["calculator", "/tools/glp-1-cost-calculator/"],
  ["review-coivas", "/reviews/coivas/"],
  ["insights", "/insights/"],
  ["pharmacies", "/pharmacies/"],
];
const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [viewportName, viewport] of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: "no-preference" });
    for (const [routeName, route] of routes) {
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
      });
      page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 500)));
      const startedAt = Date.now();
      let response;
      let navigationError = null;
      try {
        response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(1_000);
      } catch (error) {
        navigationError = String(error);
      }
      const screenshot = path.join(outputRoot, `${routeName}-${viewportName}.png`);
      let dom = {};
      if (!navigationError) {
        dom = await page.evaluate(() => ({
          title: document.title,
          bodyTextLength: document.body?.innerText?.length || 0,
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          h1: document.querySelector("h1")?.textContent?.trim() || null,
          h1Y: document.querySelector("h1")?.getBoundingClientRect().y ?? null,
          images: [...document.images].map((image) => ({
            src: image.currentSrc || image.src,
            alt: image.alt,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          })),
        }));
        await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
      }
      const screenshotBytes = navigationError ? null : await readFile(screenshot);
      results.push({
        routeName,
        route,
        viewportName,
        viewport,
        status: response?.status() ?? 0,
        finalUrl: page.url(),
        elapsedMs: Date.now() - startedAt,
        navigationError,
        consoleErrors,
        pageErrors,
        dom,
        screenshot: navigationError ? null : screenshot,
        screenshotBytes: screenshotBytes?.length ?? 0,
        screenshotSha256: screenshotBytes ? createHash("sha256").update(screenshotBytes).digest("hex") : null,
      });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const manifest = {
  schema: "glp-pass2-browser-capture-v1",
  phase,
  capturedAtUtc: new Date().toISOString(),
  baseUrl,
  deployCount: 0,
  status: results.every((entry) => entry.status === 200 && !entry.navigationError) ? "PASS" : "FAIL",
  results,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  status: manifest.status,
  captures: results.length,
  http200: results.filter((entry) => entry.status === 200).length,
  navigationErrors: results.filter((entry) => entry.navigationError).length,
  manifest: path.join(outputRoot, "manifest.json"),
}));
