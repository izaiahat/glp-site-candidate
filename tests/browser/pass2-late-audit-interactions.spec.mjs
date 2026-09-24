import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      advertising: "denied",
      version: "gcs-cookie-v4-distinct-purposes",
      record_type: "preference_only",
      updated_at: new Date().toISOString(),
    }));
  });
});

async function next(page) {
  await page.locator('[data-quiz-position]:visible [data-quiz-next]').click();
}

test("listing URL state, keyboard picker, native fallback, and no-match reset remain real controls", async ({ page }) => {
  await page.goto("/providers/?state=OR&drug=ZEPBOUND&form=BRAND&duration=1&dose=2.5&sort=cheapest");

  await expect(page.locator("[data-state-heading]")).toContainText("Oregon");
  await expect(page.locator('[data-state-native]')).toHaveValue("OR");
  await expect(page.locator('[data-filter="treatment"][data-value="ZEPBOUND"]')).toHaveAttribute("role", "tab");
  await expect(page.locator('[data-filter="treatment"][data-value="ZEPBOUND"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-filter="treatment"][data-value="ZEPBOUND"]')).toHaveAttribute("tabindex", "0");
  await expect(page.locator('[data-filter="type"][data-value="brand"]')).toHaveAttribute("role", "tab");
  await expect(page.locator('[data-filter="type"][data-value="brand"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-filter="type"][data-value="brand"]')).toHaveAttribute("tabindex", "0");
  await expect(page.locator('[data-filter-empty]')).toBeVisible();
  await expect(page.locator('[data-filter-result]')).toHaveText("Showing 0 program cards for Oregon: 0 with explicit state evidence, 0 requiring direct state verification.");
  await expect(page.locator('[data-phase3-provider-grid] > [data-phase3-provider]:visible')).toHaveCount(0);

  const opener = page.locator('[data-state-open]');
  await opener.click();
  await page.locator('[data-state-search]').fill("New Mexico");
  await page.locator('[data-state-search]').press("ArrowDown");
  await expect(page.locator('[data-state="NM"]')).toBeFocused();
  await page.locator('[data-state="NM"]').press("Escape");
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");

  await page.locator('[data-state-native]').selectOption("WA");
  await expect.poll(() => new URL(page.url()).searchParams.get("state")).toBe("WA");
  await expect(page.locator("[data-state-heading]")).toContainText("Washington");

  await page.locator('[data-filter-reset]').click();
  await expect.poll(() => new URL(page.url()).searchParams.has("state")).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has("drug")).toBe(false);
  await expect(page.locator('[data-state-native]')).toHaveValue("");
  await expect(page.locator('[data-filter-empty]')).toBeHidden();
});

test("insurance Finish produces a live completion state and leaves the related shelf available", async ({ page }) => {
  await page.goto("/wegovy/");
  const wizard = page.locator('[data-insurance-wizard]');
  await wizard.locator('input[name="coverage"]').fill("3");
  await expect(wizard.locator('[data-coverage-label]')).toHaveText("Covered");
  await expect(wizard.locator('input[name="coverage"]')).toHaveAttribute("aria-valuetext", "Covered");
  await page.locator('[data-insurance-wizard] [data-copay="75"]').click();
  await expect(wizard.locator('input[name="monthly_oop"]')).toHaveValue("75");
  await expect(wizard.locator('[data-copay="75"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-insurance-result]')).toHaveAttribute("data-estimate-basis", "entered");
  await expect(page.locator('[data-insurance-result]')).toHaveAttribute("data-estimate-amount", "75");
  await page.locator('[data-insurance-complete]').click();
  await expect(page.locator('[data-insurance-result]')).toHaveAttribute("data-finished", "true");
  await expect(page.locator('[data-insurance-finish-status]')).toHaveAttribute("role", "status");
  await expect(page.locator('[data-insurance-finish-status]')).toHaveText("Estimate ready. Compare it with the published self-pay paths below. Coverage, eligibility and actual charges remain unverified.");
  await expect(page.locator('[data-insurance-result]')).toContainText("Estimated monthly out-of-pocket: $75.");
  await expect(page.locator('[data-related-provider-shelf]')).toBeVisible();
});

test("reverse pharmacy comparison fails closed when the source lacks selected dimensions", async ({ page }) => {
  await page.goto("/pharmacies/strive/compare-providers/");
  await expect(page.locator('[data-pharmacy-reverse-card]')).toHaveCount(1);
  await expect(page.locator('[data-pharmacy-reverse-card]')).toBeVisible();

  await page.locator('[data-pharmacy-reverse-filters] select[name="drug"]').selectOption("SEMAGLUTIDE");
  await expect(page.locator('[data-pharmacy-reverse-card]')).toBeHidden();
  await expect(page.locator('[data-pharmacy-reverse-empty]')).toBeVisible();
  await expect(page.locator('[data-pharmacy-reverse-result]')).toContainText("0 relationships establish every selected comparison control");
  await expect.poll(() => new URL(page.url()).searchParams.get("drug")).toBe("SEMAGLUTIDE");

  await page.locator('[data-pharmacy-reverse-empty] [data-pharmacy-reverse-reset]').click();
  await expect(page.locator('[data-pharmacy-reverse-card]')).toBeVisible();
  await expect(page.locator('[data-pharmacy-reverse-empty]')).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.has("drug")).toBe(false);
});

test("quiz starts without a consent gate, keeps choices reversible, follows the no-use branch, and returns exact result anatomy", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quiz/provider-fit/");
  await expect(page.locator('#health-consent-gate')).toHaveCount(0);
  // No start control: the quiz auto-initializes and position 0 is shown on load.
  await expect(page.locator('#begin-quiz')).toHaveCount(0);
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();

  const semaglutide = page.getByRole("button", { name: "Semaglutide", exact: true });
  await semaglutide.click();
  await expect(semaglutide).toHaveAttribute("aria-pressed", "true");
  await semaglutide.click();
  await expect(semaglutide).toHaveAttribute("aria-pressed", "false");
  await semaglutide.click();
  await next(page);

  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(page.locator('[data-quiz-position="3"]')).toBeVisible();
  await page.locator('[data-quiz-back]:visible').click();
  await expect(page.locator('[data-quiz-position="2"]')).toBeVisible();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.locator('[data-quiz-position="1"]')).toBeVisible();

  await page.getByRole("button", { name: "Weight loss", exact: true }).click();
  await next(page);
  await expect(page.locator('[data-quiz-position="4"]')).toBeVisible();
  await page.getByRole("button", { name: "FSA/HSA Payments Accepted", exact: true }).click();
  await next(page);
  await page.locator('[data-quiz-select="state"]').selectOption("OR");
  await next(page);
  await page.locator('[data-quiz-position]:visible [data-quiz-finish]').click();

  await expect(page.locator('[data-pass2-results]')).toBeVisible();
  await expect(page.locator('[data-result-cards] .qz-card')).toHaveCount(3);
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("Top rule-based match");
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("Published plan context:");
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("Published ongoing figure");
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("no patient rating or review count is used");
  const explore = new URL(await page.locator('[data-explore-providers]').getAttribute("href"), "http://example.test");
  expect(explore.pathname).toBe("/providers/");
  expect(explore.searchParams.get("state")).toBe("OR");
  expect(explore.searchParams.get("drug")).toBe("SEMAGLUTIDE");
  expect(explore.searchParams.get("form")).toBe("COMPOUNDED");
  expect(explore.searchParams.get("sort")).toBeNull();
});

test("yes-use quiz branch binds exact medication-specific dose controls", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quiz/provider-fit/");
  // No start control: the quiz auto-initializes and position 0 is shown on load.
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();
  await page.getByRole("button", { name: "Tirzepatide", exact: true }).click();
  await next(page);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator('[data-quiz-select="current_drug"]').selectOption("TIRZEPATIDE");
  await next(page);
  await expect(page.locator('[data-quiz-select="current_dose"]')).toBeVisible();
  await expect(page.locator('[data-quiz-select="current_dose"] option')).toHaveText([
    "Choose a dose", "Microdosing", "2.5 mg/week", "5 mg/week", "7.5 mg/week", "10 mg/week", "12.5 mg/week", "15 mg/week", "Other",
  ]);
});
