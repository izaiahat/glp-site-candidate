import { expect, test } from "@playwright/test";
import { directoryProviderIds } from "./round3-source-expectations.mjs";

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;
const TARGETS = [
  { route: "/providers/", expectedTotal: directoryProviderIds.length, loadMore: true },
  { route: "/wegovy/?drug=wegovy&form=brand_name", expectedTotal: 7, loadMore: false },
];

function watchRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  return errors;
}

async function expectNoHorizontalOverflow(page, route) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.html, `${route} html overflow`).toBeLessThanOrEqual(1);
  expect(overflow.body, `${route} body overflow`).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "gcs-cookie-v2-default-on-20260730",
      saved_at: "2026-08-30T00:00:00.000Z",
    }));
  });
  await page.route(ANALYTICS, (route) => route.fulfill({ status: 204, contentType: "application/javascript", body: "" }));
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
});

test("performance-target routes keep server-rendered filters inline and preserve provider pagination", async ({ page }) => {
  const errors = watchRuntimeErrors(page);

  for (const target of TARGETS) {
    const response = await page.goto(target.route, { waitUntil: "networkidle" });
    expect(response?.status(), target.route).toBe(200);

    const filters = page.locator("[data-provider-filters]");
    await expect(filters).toBeVisible();
    await expect(filters).toHaveAttribute("data-mobile-filter-ready", "inline");
    await expect(filters).not.toHaveAttribute("role", "dialog");
    await expect(page.locator(".cs-mobile-filter-trigger")).toHaveCount(0);
    expect(await filters.locator("button:not([disabled]), select, a[href]").count()).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page, target.route);

    if (target.route.startsWith("/wegovy/")) {
      await expect(filters).toHaveAttribute("data-phase3-route-ready", "deferred");
      await expect(page.locator("[data-provider-lazy-index]")).toHaveCount(7);
      await filters.locator('[data-filter="sort"][data-value="cheapest"]').click();
      await expect(filters).toHaveAttribute("data-phase3-route-ready", "true");
      const section = page.locator(".p3-provider-section");
      await section.scrollIntoViewIfNeeded();
      await expect(section.locator("[data-provider-lazy-index]")).toHaveCount(0);
      await expect(section.locator("[data-phase3-provider]").first()).toBeVisible();
    }

    const cards = page.locator("[data-phase3-provider]");
    await expect(cards).toHaveCount(target.expectedTotal);
    if (target.loadMore) {
      expect((await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).sort()).toEqual(directoryProviderIds);
    }
    if (!target.loadMore) {
      await expect(cards.filter({ visible: true })).toHaveCount(target.expectedTotal);
      continue;
    }

    const section = page.locator(".p3-provider-section");
    const initialVisible = Number(await section.getAttribute("data-initial-visible"));
    expect(initialVisible).toBeGreaterThan(0);
    await expect(cards.filter({ visible: true })).toHaveCount(initialVisible);

    const loadMore = page.locator("[data-provider-load-more]");
    let previousVisible = initialVisible;
    while (await loadMore.isVisible()) {
      await loadMore.click();
      let visible = previousVisible;
      await expect.poll(async () => {
        visible = await cards.filter({ visible: true }).count();
        return visible;
      }).toBeGreaterThan(previousVisible);
      expect(visible).toBeLessThanOrEqual(target.expectedTotal);
      previousVisible = visible;
    }
    expect(previousVisible).toBe(target.expectedTotal);
  }

  expect(errors).toEqual([]);
});

test("performance-target filters and server-visible cards survive with JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    for (const target of TARGETS) {
      const response = await page.goto(new URL(target.route, baseURL).href, { waitUntil: "domcontentloaded" });
      expect(response?.status(), target.route).toBe(200);
      await expect(page.locator("[data-provider-filters]")).toBeVisible();
      await expect(page.locator(".cs-mobile-filter-trigger")).toHaveCount(0);
      await expectNoHorizontalOverflow(page, target.route);

      const cards = page.locator("[data-phase3-provider]:not([data-provider-lazy-index])");
      await expect(cards).toHaveCount(target.expectedTotal);
      await expect(cards.filter({ visible: true })).toHaveCount(target.expectedTotal);
      if (target.loadMore) {
        expect((await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).sort()).toEqual(directoryProviderIds);
      }
      await expect(page.locator("[data-provider-lazy-index]:visible")).toHaveCount(0);
      if (target.route.startsWith("/wegovy/")) {
        await expect(cards.locator(".p3-card-actions")).toHaveCount(target.expectedTotal);
      }
      expect(await page.locator("main a[href]").count()).toBeGreaterThan(0);
    }
  } finally {
    await context.close();
  }
});
