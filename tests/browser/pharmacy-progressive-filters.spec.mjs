import { test, expect } from "@playwright/test";

test("mobile pharmacy controls remain readable without the enhancement runtime", async ({ browser, baseURL }) => {
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, javaScriptEnabled });
    try {
      const page = await context.newPage();
      if (javaScriptEnabled) await page.route('**/assets/site.js*', route => route.abort('failed'));
      await page.goto('/pharmacies/', { waitUntil: 'load' });
      const shell = page.locator('[data-native-pharmacy-filters]');
      const controls = shell.locator('[data-pharmacy-filters]');
      if (javaScriptEnabled) {
        await expect(shell).not.toHaveAttribute('open', '');
        await expect(controls).toBeHidden();
        await shell.locator('summary').focus();
        await page.keyboard.press('Enter');
      }
      await expect(controls).toBeVisible();
      await expect(controls.locator('[data-pharmacy-search]')).toBeVisible();
      expect(await controls.evaluate(node => getComputedStyle(node).position)).not.toBe('fixed');
      await expect(page.locator('[data-pharmacy-card]').first()).toBeVisible();
    } finally {
      await context.close();
    }
  }
});
