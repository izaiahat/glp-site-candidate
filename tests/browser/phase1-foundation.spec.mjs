import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROOF = path.join(ROOT, "artifacts", "ultracode", "phase1-foundation");
mkdirSync(PROOF, { recursive: true });

async function blockAnalytics(page) {
  await page.route(/https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) => route.fulfill({ status: 204, contentType: "application/javascript", body: "" }));
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await blockAnalytics(page);
});

test("W2 desktop search expands in place, searches locally, empties honestly, and clears", async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expectNoOverflow(page);

  const toggle = page.getByRole("button", { name: "Search providers" });
  await expect(toggle).toBeVisible();
  await toggle.click();

  const panel = page.locator(".cs-search-panel");
  const input = panel.locator('input[type="search"]');
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute("aria-modal", "true");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", "Search providers or pharmacies");

  await input.fill("cost");
  await expect(page.getByText("Searching Clinic Scout")).toBeVisible();
  await expect(page.locator(".cs-search-hit").first()).toBeVisible();
  expect(await page.locator(".cs-search-type").count()).toBeGreaterThan(0);
  if (browserName === "chromium") {
    await page.screenshot({ path: path.join(PROOF, "w2-search-desktop-1440.png"), animations: "disabled" });
  }

  await input.fill("zzzz-no-real-match-zzzz");
  await expect(page.getByText("No match yet")).toBeVisible();
  await expect(page.getByText(/Try a provider, pharmacy, medication/)).toBeVisible();

  await page.getByRole("button", { name: "Close search and clear" }).click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveValue("");
  await expectNoOverflow(page);
});

test("W3 desktop nav is hover-first, glass, complete, and keyboard closable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1366, height: 768 });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  const navigation = page.locator('.gcs-nav[aria-label="Primary"]');
  const providers = navigation.getByRole("button", { name: "Telehealth Providers", exact: true });
  await expect(providers).toHaveCount(1);
  await providers.hover();
  await expect(providers).toHaveAttribute("aria-expanded", "true");
  const providerMenu = providers.locator("+ .cs-navmenu");
  await expect(providerMenu).toBeVisible();
  await expect(providerMenu.locator("a")).toHaveCount(7);
  const glass = await providerMenu.evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    blur: getComputedStyle(node).backdropFilter || getComputedStyle(node).webkitBackdropFilter,
  }));
  expect(glass.background).toMatch(/rgba/);
  expect(glass.blur).toMatch(/blur/);
  await page.screenshot({ path: path.join(PROOF, "w3-nav-providers-desktop-1366.png"), animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(providers).toHaveAttribute("aria-expanded", "false");
  const bulk = navigation.getByRole("button", { name: "Bulk", exact: true });
  await bulk.hover();
  await expect(bulk).toHaveAttribute("aria-expanded", "true");
  await expect(bulk.locator("+ .cs-navmenu a")).toHaveCount(4);
  await expect(navigation.getByRole("link", { name: "Compounding Pharmacies", exact: true })).toHaveAttribute("href", "/pharmacies/");
  await expectNoOverflow(page);
});

test("W18 mobile foundation matches measured header, search sheet, and 280px drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  const header = page.locator(".gcs-nav");
  const headerBox = await header.boundingBox();
  expect(headerBox?.width).toBeCloseTo(390, 0);
  expect(headerBox?.height).toBeGreaterThanOrEqual(70);
  expect(headerBox?.height).toBeLessThanOrEqual(74);

  await page.locator(".cs-search-toggle").click();
  const panel = page.locator(".cs-search-panel");
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await panel.boundingBox())?.width || 0).toBeCloseTo(390, 0);
  const panelBox = await panel.boundingBox();
  expect(panelBox?.width).toBeCloseTo(390, 0);
  expect(panelBox?.height).toBeCloseTo(844, 0);
  await expect(panel).toHaveAttribute("aria-modal", "true");
  const overflowState = await page.evaluate(() => getComputedStyle(document.body).overflowY);
  expect(overflowState).toBe("hidden");

  const input = panel.locator('input[type="search"]');
  await input.fill("cost");
  await expect(page.locator(".cs-search-hit").first()).toBeVisible();
  await page.screenshot({ path: path.join(PROOF, "w2-search-mobile-390.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Close search and clear" }).click();
  await expect(panel).toBeHidden();

  const menu = page.locator("[data-menu-toggle]");
  await menu.click();
  const drawer = page.locator("[data-menu]");
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.x || 0).toBeCloseTo(110, 0);
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox?.width).toBeCloseTo(280, 0);
  expect(drawerBox?.x).toBeCloseTo(110, 0);
  await expect(page.locator("body")).toHaveClass(/cs-drawer-open/);
  await page.screenshot({ path: path.join(PROOF, "w3-drawer-mobile-390.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expectNoOverflow(page);
});

test("W4 respects reduced motion while preserving palette treatment", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator("script[data-motion-dependency]")).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(window.CS_MOTION))).toBe(false);

  const cta = page.locator(".cs-btn--orbit");
  await expect(cta).toBeVisible();
  const treatment = await cta.evaluate((node) => ({
    backgroundImage: getComputedStyle(node).backgroundImage,
    orbit: Boolean(node.querySelector(".cs-btn__orbit-track")),
  }));
  expect(treatment.backgroundImage).toMatch(/gradient/i);
  expect(treatment.orbit).toBe(true);
  const orbitDash = await cta.locator(".cs-btn__orbit-track").evaluate((node) => getComputedStyle(node).strokeDasharray);
  expect(orbitDash).toMatch(/^100(?:px)?(?:,|\s)/);

  const arrow = cta.locator(".cs-btn__arrow");
  const first = await arrow.boundingBox();
  await page.waitForTimeout(350);
  const second = await arrow.boundingBox();
  expect(second?.x).toBeCloseTo(first?.x || 0, 2);
  await page.screenshot({ path: path.join(PROOF, "w4-reduced-motion-desktop-1440.png"), animations: "disabled" });
});
