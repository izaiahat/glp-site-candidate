import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

async function open(page, route) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), route).toBe(200);
}

test.describe("OPUS final must-fix served output", () => {
  test("desktop and mobile home links use live Phase 3 routes", async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await open(page, "/");
      await expect(page.locator('a[href*="/best/online-glp-1-providers/"]')).toHaveCount(0);
      const quickRoutes = [
        "/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest",
        "/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest",
        "/ozempic/?drug=OZEMPIC&form=BRAND_NAME&sort=cheapest",
        "/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest",
        "/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest",
        "/mounjaro/?drug=MOUNJARO&form=BRAND_NAME&sort=cheapest",
        "/zepbound/?drug=ZEPBOUND&form=BRAND_NAME&sort=cheapest",
      ];
      for (const route of quickRoutes) {
        await expect(page.locator(`.cs-home-quick[href="${route}"]`), route).toBeVisible();
      }
      await expect(page.locator(".cs-home-quick")).toHaveCount(quickRoutes.length);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });

  test("brand product pages load the generated image and honest price unit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/wegovy-pill/");
    const product = page.locator(".p3-product-visual img").first();
    await expect(product).toBeVisible();
    const loaded = await product.evaluate((image) => ({ complete: image.complete, width: image.naturalWidth }));
    expect(loaded.complete).toBe(true);
    expect(loaded.width).toBeGreaterThan(0);
    await expect(page.getByText("Open the official manufacturer resource")).toHaveAttribute("href", /wegovy\.com/);
    await expect(page.getByText("How does it work?")).toBeVisible();

    await open(page, "/");
    const pricing = JSON.parse(readFileSync(new URL("../../data/medication-direct-pricing.json", import.meta.url), "utf8"));
    expect(pricing.schema).toBe("glp-medication-direct-pricing-v1");
    const offer = pricing.medications["wegovy-pill"];
    expect(Number.isFinite(offer.monthly_price_usd)).toBe(true);
    expect(offer.monthly_price_usd).toBeGreaterThan(0);
    expect(offer.price_label).toBe("Official self-pay starting price");
    const wegovyPill = page.locator('[data-price-choice][data-price-label="Wegovy pill"]');
    await expect(wegovyPill).toHaveCount(1);
    await expect(wegovyPill).toHaveAttribute("data-price-value", String(offer.monthly_price_usd));
    await wegovyPill.click();
    const card = wegovyPill.locator("xpath=ancestor::*[@data-price-card]");
    await expect(card.locator('[data-price-roll]')).toHaveText(`$${offer.monthly_price_usd.toLocaleString("en-US")}`);
    await expect(card.locator('.cs-home2-price__number small')).toHaveText("/month starting price");
    await expect(card.locator('[data-price-destination]')).toHaveAttribute("href", "/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest");
    await expect(card.locator('[role="tooltip"]')).toContainText("official manufacturer self-pay offer");
  });

  test("mobile provider sticky CTA hides down and returns up", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/providers/");
    const href = await page.locator('a[href^="/providers/"]:not([href="/providers/"])').first().getAttribute("href");
    expect(href).toBeTruthy();
    await open(page, href);
    const sticky = page.locator('[data-provider-sticky]');
    await expect(sticky).toBeVisible();

    // Keep this registered case; the current producer stays fixed in both
    // directions and releases only when the footer boundary enters view.
    const assertFixed = async () => {
      await expect(sticky).toHaveCSS("position", "fixed");
      await expect(sticky).not.toHaveClass(/is-released/);
      await expect(sticky).toBeVisible();
      expect(await sticky.evaluate((element) => Math.abs(innerHeight - element.getBoundingClientRect().bottom))).toBeLessThanOrEqual(1);
      expect(await page.locator(".cs-prefooter, .gcs-footer").first().evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(844);
    };
    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForTimeout(450);
    const downScroll = await page.evaluate(() => scrollY);
    expect(downScroll).toBeGreaterThan(0);
    await assertFixed();

    await page.evaluate(() => window.scrollTo(0, 350));
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => scrollY)).toBeLessThan(downScroll);
    await assertFixed();
  });

  test("insurance slider paints its actual value and mobile pages do not overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const routes = ["/wegovy/", "/lp/best-providers/compounded-semaglutide/", "/bulk/", "/insights/", "/pharmacies/", "/quiz/provider-fit/"];
    for (const route of routes) {
      await open(page, route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, route).toBeLessThanOrEqual(1);
    }
    await open(page, "/wegovy/");
    const slider = page.locator('[data-insurance-wizard] input[name="progress"]');
    await slider.fill("87.5");
    await expect(page.locator('[data-plan-progress]')).toHaveText("87.5%");
    expect(await slider.evaluate((element) => element.style.getPropertyValue("--p3-progress"))).toBe("87.5%");
    await expect(page.locator('.p3-progress-labels .is-active')).toHaveText("Met");
  });
});
