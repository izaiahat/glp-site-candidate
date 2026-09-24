import { test, expect } from "@playwright/test";

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
    analytics: "denied",
    version: "gcs-cookie-v2-default-on-20260730",
    saved_at: "2026-08-28T00:00:00.000Z",
  })));
  await page.route(ANALYTICS, (route) => route.fulfill({ status: 204, contentType: "application/javascript", body: "" }));
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
});

test("fixed-duration cards keep money evidence above one conversion lane", async ({ page }) => {
  await page.goto("/3-month/?drug=SEMAGLUTIDE", { waitUntil: "networkidle" });
  // Current bulk producer is comparison-first; art stays on product pages.
  await expect(page.locator('[data-product-visual="bulk-3-month"]')).toHaveCount(0);
  const listing = page.locator('main[data-listing-archetype="A"][data-phase3-route="/3-month/"]');
  await expect(listing).toHaveCount(1);
  await expect(listing.locator(".listing__intro h1")).toBeVisible();
  await expect(listing.locator("[data-phase3-provider-grid]")).toHaveCount(1);
  const cards = page.locator('[data-phase3-provider]:visible');
  expect(await cards.count()).toBeGreaterThan(0);
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    await expect(card.locator('[data-bulk-comparison-ledger]')).toBeVisible();
    await expect(card.locator('[data-wrap-actions] > :is(a,button,[data-affiliate-unavailable])')).toHaveCount(1);
    await expect(card.locator('.p3-card-evidence-links')).toBeVisible();
  }
});

test("Wegovy Pill defaults to an honest non-empty any-duration state", async ({ page }) => {
  await page.goto("/wegovy-pill/", { waitUntil: "networkidle" });
  const any = page.locator('[data-filter="duration"][data-value="all"]');
  await expect(any).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-phase3-provider]:visible').first()).toBeVisible();
  await expect(page.locator('[data-filter-empty]')).toBeHidden();
});

test("brand card insurance hook preserves provider and published-price context", async ({ page }) => {
  await page.goto("/wegovy/", { waitUntil: "networkidle" });
  const hook = page.locator('[data-insurance-provider]').first();
  const provider = await hook.getAttribute("data-provider-name");
  await hook.click();
  const wizard = page.locator('[data-insurance-wizard]');
  await expect(wizard).toHaveAttribute("data-insurance-provider-name", provider || "");
  await wizard.locator('input[name="oop_max"]').fill("3000");
  await wizard.locator('input[name="oop_spent"]').fill("900");
  await wizard.locator('[data-copay="75"]').click();
  const result = wizard.locator('[data-insurance-result]');
  await expect(result).toContainText(provider || "");
  await expect(result).toContainText("source-published self-pay");
  await expect(result).toContainText("not a coverage quote");
});

test("compounded cards never present state-unknown rows as selected-state matches", async ({ page }) => {
  await page.goto("/lp/best-providers/compounded-semaglutide/?state=OR", { waitUntil: "networkidle" });
  const mainModes = await page.locator('[data-phase3-provider-grid] [data-phase3-provider]').evaluateAll((cards) => cards.map((card) => card.dataset.stateMode));
  expect(mainModes.length).toBeGreaterThan(0);
  expect(mainModes).not.toContain("unknown");
  const remainder = page.locator('[data-state-unverified-remainder]');
  await expect(remainder).toHaveCount(1);
  await expect(remainder).not.toHaveAttribute("open", "");
  expect(await remainder.locator('[data-state-mode="unknown"]').count()).toBeGreaterThan(0);
});

test("provider comparison contains only the 35 evidence-qualified card records", async ({ page }) => {
  await page.goto("/providers/", { waitUntil: "networkidle" });
  const sets = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('[data-phase3-provider]')].map((node) => node.dataset.program),
    contracts: document.querySelectorAll('[data-provider-card-contract="option-c"]').length,
  }));
  expect(sets.cards).toHaveLength(35);
  expect(new Set(sets.cards).size).toBe(35);
  expect(sets.contracts).toBe(35);
  expect(sets.cards).not.toEqual(expect.arrayContaining(["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review"]));
});

test("Insights honeypot is non-visible without depending on another page bundle", async ({ page }) => {
  await page.goto("/insights/", { waitUntil: "networkidle" });
  const trap = page.locator('.capture-honeypot').first();
  await expect(trap).toHaveCount(1);
  const box = await trap.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeLessThan(-9000);
  expect(box.width).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(1);
});
