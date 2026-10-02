import { test, expect } from "@playwright/test";

const ROUTES = [
  "/providers/",
  "/lp/best-providers/compounded-semaglutide/",
  "/lp/best-providers/compounded-tirzepatide/",
];

for (const route of ROUTES) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`replacement ATF preview is sourced and usable: ${route} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route);
      const preview = page.locator("[data-atf-result]");
      const firstCard = page.locator("#provider-results [data-phase3-provider]").first();
      const disclosure = page.locator(".listing__intro .affiliate-note").first();
      await expect(preview).toBeVisible();
      await expect(firstCard).toBeAttached();
      await expect(disclosure).toBeVisible();
      await expect(disclosure).toContainText(/commission from sponsored links/i);

      const name = (await firstCard.locator("h3").textContent()).trim();
      await expect(preview.locator("strong")).toHaveText(name);
      const cost = firstCard.locator(".p3-card-ledger > div").filter({ has: page.locator("dt", { hasText: "Total monthly cost" }) });
      await expect(cost).toHaveCount(1);
      await expect(preview.locator("[data-atf-price]")).toHaveText((await cost.locator("dd > span").first().textContent()).trim());
      await expect(preview.locator("[data-atf-price]")).toContainText(/\$\d/);
      if (route.includes("compounded-semaglutide")) await expect(preview.locator("[data-atf-price]")).toContainText(/semaglutide/i);
      if (route.includes("compounded-tirzepatide")) await expect(preview.locator("[data-atf-price]")).toContainText(/tirzepatide/i);
      expect(await preview.locator("time").getAttribute("datetime")).toBe(await cost.locator("[data-source-checked]").getAttribute("data-source-checked"));
      if (route === "/providers/") await expect(cost.locator("small[data-source-checked] time")).toBeVisible();
      expect(await preview.locator('small a[data-citation="inline_fact_source"]').getAttribute("href")).toBe(await cost.locator("dd small a").getAttribute("href"));

      const previewCta = preview.locator('a[data-analytics-event="affiliate_click"]');
      const cardCta = firstCard.locator('a[data-analytics-event="affiliate_click"]');
      await expect(previewCta).toBeVisible();
      await expect(cardCta).toBeAttached();
      expect(await previewCta.getAttribute("href")).toBe(await cardCta.getAttribute("href"));
      expect(await previewCta.getAttribute("data-program")).toBe(await cardCta.getAttribute("data-program"));
      expect(await previewCta.getAttribute("rel")).toMatch(/sponsored/);
      const [disclosureBox, priceBox, previewBox, ctaBox] = await Promise.all([
        disclosure.boundingBox(), preview.locator("[data-atf-price]").boundingBox(),
        preview.boundingBox(), previewCta.boundingBox(),
      ]);
      expect(disclosureBox && priceBox && previewBox && ctaBox).toBeTruthy();
      expect(disclosureBox.y + disclosureBox.height).toBeLessThan(priceBox.y);
      expect(disclosureBox.y + disclosureBox.height).toBeLessThan(ctaBox.y);
      const fold = viewport.height * (viewport.width < 600 ? 1.5 : 1);
      expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(fold);
      expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(fold);
      expect(ctaBox.width).toBeGreaterThan(40);
      expect(ctaBox.height).toBeGreaterThan(30);

      const capture = page.locator("[data-content-upgrade-form-inline],.inline-capture");
      if (route === "/providers/") {
        await expect(capture.first()).toBeVisible();
        const [cardBox, captureBox] = await Promise.all([firstCard.boundingBox(), capture.first().boundingBox()]);
        expect(captureBox.y).toBeGreaterThan(cardBox.y + cardBox.height);
      } else {
        await expect(capture).toHaveCount(0);
      }
    });
  }
}
