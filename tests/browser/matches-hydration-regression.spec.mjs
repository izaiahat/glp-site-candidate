import { test, expect } from "@playwright/test";

const RESULTS_URL = "/matches/customized/?state=OR&drug=TIRZEPATIDE&form=COMPOUNDED&goal=price&source=survey";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`direct matched results hydrate without displacement at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.__resultShifts = [];
      if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__resultShifts.push({ value: entry.value, recentInput: entry.hadRecentInput });
          }
        }).observe({ type: "layout-shift", buffered: true });
      }
    });
    await page.goto(RESULTS_URL);
    const result = page.locator("[data-matches-results]");
    const cards = result.locator("[data-result-cards] .qz-card");
    await expect(result).toBeVisible();
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toBeVisible();
    await expect(result.locator("#qm-results-title")).toBeFocused();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
    });
    const rects = () => cards.evaluateAll((items) => items.map((item) => {
      const box = item.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height];
    }));
    const before = await rects();
    await page.waitForTimeout(180);
    const after = await rects();
    expect(after).toHaveLength(3);
    for (let i = 0; i < before.length; i += 1) {
      for (let j = 0; j < 4; j += 1) expect(Math.abs(after[i][j] - before[i][j])).toBeLessThanOrEqual(1);
    }
    const observation = await page.evaluate(() => ({
      supported: PerformanceObserver.supportedEntryTypes.includes("layout-shift"),
      shifts: window.__resultShifts,
      stored: [...Object.entries(localStorage), ...Object.entries(sessionStorage)],
      animation: getComputedStyle(document.querySelector("[data-result-cards] .qz-card")).animationName,
    }));
    if (observation.supported) {
      expect(observation.shifts.filter((entry) => !entry.recentInput)).toEqual([]);
    }
    expect(observation.animation).toBe("none");
    expect(observation.stored.some(([key, value]) => /quiz_answers|bmi|medication_preference|treatment|drug|state/i.test(key) || /TIRZEPATIDE|COMPOUNDED/.test(value))).toBe(false);
  });
}
