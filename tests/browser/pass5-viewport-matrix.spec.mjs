import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROOF = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass5-screenshots-20260829/viewport-matrix";
mkdirSync(PROOF, { recursive: true });

test.setTimeout(240_000);
test.describe.configure({ mode: "serial" });

const VIEWPORTS = [
  { name: "mobile-375x812", width: 375, height: 812 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1366x768", width: 1366, height: 768 },
  { name: "desktop-1440x1050", width: 1440, height: 1050 },
];

const ROUTES = [
  { name: "home", route: "/" },
  { name: "compare", route: "/compare/" },
  { name: "providers", route: "/providers/" },
  { name: "guide", route: "/guides/trimi-vs-yourera/" },
  { name: "reviews", route: "/reviews/" },
  { name: "review-submit", route: "/reviews/submit/" },
  { name: "calculator", route: "/tools/glp-1-cost-calculator/" },
  { name: "quiz", route: "/quiz/provider-fit/" },
];

async function dismissConsent(page) {
  const consent = page.getByRole("button", { name: "OK", exact: true });
  if (await consent.count() && await consent.first().isVisible()) await consent.first().click();
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} preserves mapped surfaces without blanking or overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.route(/https?:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) =>
      route.fulfill({ status: 204, contentType: "application/javascript", body: "" }),
    );
    await page.route("**/api/geo-state", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
    }));
    const runtimeErrors = [];
    const failedRequests = [];
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror:${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`); });
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));

    const rows = [];
    for (const surface of ROUTES) {
      runtimeErrors.length = 0;
      failedRequests.length = 0;
      const response = await page.goto(surface.route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), surface.route).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
      await dismissConsent(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(120);
      await expect(page.locator("main")).toBeVisible();
      const metrics = await page.evaluate(() => {
        const bodyColor = getComputedStyle(document.body).backgroundColor;
        const rgb = bodyColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          bodyLuminance: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2],
          mainTextLength: document.querySelector("main")?.innerText.trim().length || 0,
        };
      });
      expect(metrics.overflow, `${surface.route} overflow at ${viewport.name}`).toBeLessThanOrEqual(1);
      expect(metrics.bodyLuminance, `${surface.route} dark ground at ${viewport.name}`).toBeLessThan(70);
      expect(metrics.mainTextLength, `${surface.route} readable content at ${viewport.name}`).toBeGreaterThan(120);
      expect(runtimeErrors, `${surface.route} runtime errors at ${viewport.name}`).toEqual([]);
      expect(failedRequests, `${surface.route} request failures at ${viewport.name}`).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(PROOF, `${viewport.name}-${surface.name}.png`), animations: "disabled" });
      rows.push({ ...surface, ...metrics, runtimeErrors: [...runtimeErrors], failedRequests: [...failedRequests] });
    }

    writeFileSync(path.join(PROOF, `${viewport.name}.json`), JSON.stringify({ viewport, rows }, null, 2) + "\n");
  });
}

test("mapped surfaces remain readable with JavaScript disabled", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const rows = [];
  try {
    for (const surface of ROUTES) {
      const response = await page.goto(surface.route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), surface.route).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mainTextLength: document.querySelector("main")?.innerText.trim().length || 0,
        hiddenMain: getComputedStyle(document.querySelector("main")).visibility,
      }));
      expect(metrics.overflow, `${surface.route} no-JS overflow`).toBeLessThanOrEqual(1);
      expect(metrics.mainTextLength, `${surface.route} no-JS readable content`).toBeGreaterThan(120);
      expect(metrics.hiddenMain).toBe("visible");
      rows.push({ ...surface, ...metrics });
    }
  } finally {
    await context.close();
  }
  writeFileSync(path.join(PROOF, "javascript-disabled.json"), JSON.stringify({ viewport: { width: 375, height: 812 }, rows }, null, 2) + "\n");
});
