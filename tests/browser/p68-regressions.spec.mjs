import { test, expect } from "@playwright/test";
import { governedBulkCohorts } from "./governed-cohort.mjs";

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort("blockedbyclient"));
});

async function openPage(page, route) {
  const response = await page.goto(route, { waitUntil: "load" });
  expect(response?.status(), route).toBe(200);
  await expect(page.locator("main")).toBeVisible();
}

test("P68 cross-route controls preserve molecule and canonical state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [brand, molecule] of [["wegovy", "SEMAGLUTIDE"], ["mounjaro", "TIRZEPATIDE"]]) {
    await openPage(page, `/${brand}/?state=OR&sort=cheapest`);
    await page.locator('[data-provider-filters] [data-filter="type"][data-value="compounded"]').click();
    const destination = `/lp/best-providers/compounded-${molecule.toLowerCase()}/`;
    await expect(page).toHaveURL((url) => url.pathname === destination
      && url.searchParams.get("state") === "OR" && url.searchParams.get("drug") === molecule
      && url.searchParams.get("form") === "COMPOUNDED" && url.searchParams.get("sort") === "cheapest");
    const current = page.locator('a[data-filter-route][data-route-family="compounded-category"][aria-current="page"]');
    await expect(current).toHaveCount(1);
    const target = new URL(await current.getAttribute("href"), page.url());
    expect(target.pathname).toBe(destination);
    expect(target.searchParams.get("state")).toBe("OR");
    expect(target.searchParams.get("drug")).toBe(molecule);
  }
});

test("P68 pharmacy pagination has one truthful counter owner", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPage(page, "/pharmacies/");
  const result = page.locator("[data-pharmacy-result]");
  await expect(page.locator("[data-pharmacy-card]")).toHaveCount(75);
  await expect(result).toHaveText("Showing 18 of 75 evidence records");
  await page.locator("[data-pharmacy-load-more]").click();
  await expect(result).toHaveText("Showing 36 of 75 evidence records");
  await expect(page.locator("[data-pharmacy-card]:visible")).toHaveCount(36);
  const additive = page.locator("[data-pharmacy-additive]");
  const value = await additive.locator('option:not([value="all"])').first().getAttribute("value");
  expect(value).toBeTruthy();
  const total = await page.locator("[data-pharmacy-card]").evaluateAll((cards, selected) => cards
    .filter((card) => String(card.dataset.additives || "").split(/\s+/).includes(selected)).length, value);
  expect(total).toBeGreaterThan(0);
  await additive.selectOption(value);
  await expect(page.locator("[data-pharmacy-card]:visible")).toHaveCount(Math.min(18, total));
  await expect(result).toHaveText(total > 18 ? `Showing 18 of ${total} evidence records`
    : `Showing ${total} evidence record${total === 1 ? "" : "s"}`);
  await additive.selectOption("all");
  await expect(result).toHaveText("Showing 18 of 75 evidence records");
});

test("P68 pharmacy mobile sheet remains operable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "/pharmacies/");
  const trigger = page.getByRole("button", { name: /^Pharmacy filters/ });
  const filters = page.locator("[data-pharmacy-filters]");
  await trigger.click();
  await expect(filters).toHaveAttribute("role", "dialog");
  await expect(filters).toHaveAttribute("aria-modal", "true");
  await filters.locator('[data-filter="data-pharmacy-class"][data-value="503b"]').click();
  await expect(filters.locator('[data-filter="data-pharmacy-class"][data-value="503b"]')).toHaveAttribute("aria-selected", "true");
  await filters.getByRole("button", { name: "Show results", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(filters).toBeHidden();
});

test("P68 pharmacy reverse documents remain discoverable", async ({ page }) => {
  await openPage(page, "/pharmacies/");
  const links = page.locator('[data-pharmacy-reverse-index] a[href$="/compare-providers/"]');
  const destinations = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(destinations.length).toBeGreaterThan(0);
  expect(new Set(destinations).size).toBe(destinations.length);
  for (const route of destinations) {
    expect(route).toMatch(/^\/pharmacies\/[a-z0-9-]+\/compare-providers\/$/);
    await openPage(page, route);
    await expect(page.getByRole("heading", { level: 1, name: /Verified programs associated with/i })).toBeVisible();
    await expect(page.locator('a[href^="/providers/"]')).not.toHaveCount(0);
  }
});

test("P68 bulk status announces the selected molecule", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const duration of ["3-month", "6-month"]) {
    for (const drug of ["SEMAGLUTIDE", "TIRZEPATIDE"]) {
      await openPage(page, `/${duration}/?drug=${drug}`);
      const treatment = page.locator(`[data-provider-filters] [data-filter="treatment"][data-value="${drug}"]`);
      await expect(treatment).toHaveAttribute("aria-selected", "true");
      // KAEL-DECISION-20260923-optionc-governing-mappings.md A2.2–A2.3.
      const expected = governedBulkCohorts(drug, duration === "3-month" ? 3 : 6);
      const numeric = page.locator('#provider-results [data-phase3-provider-grid] > [data-phase3-provider]');
      expect(await numeric.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expected.numeric].sort());
      await expect(page.locator("[data-filter-result]")).toContainText(`${expected.numeric.length} comparable price results`);
      await expect(page.locator("[data-filter-result]")).toContainText(`Treatment: ${drug[0]}${drug.slice(1).toLowerCase()}.`);
      const unpriced = page.locator('[data-unpublished-provider-section] [data-phase3-provider]');
      expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expected.unpriced].sort());
      if (expected.unpriced.length) await expect(page.locator('[data-unpublished-provider-section]')).toBeVisible();
      else await expect(unpriced).toHaveCount(0);
      // A contrary plan/dose tuple must empty only the numeric cohort; source-
      // backed non-priced records remain separate, and reset restores selection.
      const plan = page.locator('[data-provider-filters] [data-filter="plan"][data-value="1"]');
      // Bulk controls are emitted with the route's semaglutide default dose set;
      // the molecule URL changes the cohort, not the static available controls.
      const adverseDose = '2.4';
      const dose = page.locator(`[data-provider-filters] [data-filter="dose"][data-value="${adverseDose}"]`);
      await plan.click();
      await dose.click();
      const empty = page.locator('[data-filter-empty]');
      await expect(numeric.locator(':visible')).toHaveCount(0);
      await expect(page.locator('[data-filter-result]')).toContainText('0 comparable price results');
      await expect(empty).toBeVisible();
      await expect(empty.locator('p').first()).toHaveText(expected.unpriced.length
        ? 'No comparable price matches those filters. Records without a comparable price are listed separately below. This is not a medical or availability conclusion.'
        : 'No source-backed record matches those filters. An empty result is not a medical or availability conclusion.');
      await expect(empty.locator('[data-active-filter-label]')).toContainText('Plan: 1 month');
      await expect(empty.locator('[data-active-filter-label]')).toContainText(`Dose: ${adverseDose} mg/week`);
      await expect(plan).toHaveAttribute('aria-selected', 'true');
      await expect(dose).toHaveAttribute('aria-selected', 'true');
      expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expected.unpriced].sort());
      await empty.locator('[data-filter-reset]').click();
      await expect(empty.locator('[data-active-filter-label]')).toHaveText('Active filters: none.');
      await expect(plan).toHaveAttribute('aria-selected', 'false');
      await expect(dose).toHaveAttribute('aria-selected', 'false');
      const resetCohort = governedBulkCohorts('SEMAGLUTIDE', duration === '3-month' ? 3 : 6);
      if (resetCohort.numeric.length === 0) await expect(empty).toBeVisible();
      else await expect(empty).toBeHidden();
      await expect(page.locator('[data-filter-result]')).toContainText(`${resetCohort.numeric.length} comparable price results`);
      await expect(page.locator('[data-provider-filters] [data-filter="treatment"][data-value="SEMAGLUTIDE"]')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-provider-filters] [data-filter="treatment"][data-value="TIRZEPATIDE"]')).toHaveAttribute('aria-selected', 'false');
      expect(await numeric.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...resetCohort.numeric].sort());
      expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...resetCohort.unpriced].sort());
    }
  }
});
