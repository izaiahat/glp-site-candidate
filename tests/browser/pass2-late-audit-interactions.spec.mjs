import { test, expect } from "@playwright/test";
import { expectedQuizIds } from "./round3-source-expectations.mjs";

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith("quiz starts without a consent gate")) return;
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

test("quiz starts without a consent gate, keeps choices reversible, follows the no-use branch, and returns exact result anatomy", async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const prohibitedRequests = [];
  const resultHandoffs = [];
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on("request", (request) => {
    const url = new URL(request.url());
    const resultHandoff = url.origin === origin && url.pathname === "/matches/customized/" && request.method() === "GET";
    const answerBearing = [...url.searchParams].some(([key, value]) =>
      /^(?:state|drug|form|goal|intent|reason|feature|dose|current_use)$/i.test(key)
      || /SEMAGLUTIDE|weight_loss/i.test(value))
      || /SEMAGLUTIDE|weight_loss|state=OR/i.test(request.postData() || "")
      || (request.resourceType() !== "image" && /SEMAGLUTIDE|weight_loss/i.test(url.pathname));
    if (resultHandoff) resultHandoffs.push("first-party result navigation");
    if (url.origin !== origin || (answerBearing && !resultHandoff)) prohibitedRequests.push("external or answer-bearing non-result request");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quiz/provider-fit/", { waitUntil: "networkidle" });
  const consent = await page.evaluate(() => JSON.parse(localStorage.getItem("gcs_tracking_consent_v1") || "null"));
  expect(consent?.analytics).toBe("denied");
  expect(consent?.advertising).toBe("denied");
  expect(consent?.analytics_basis).toBe("unset");
  await expect(page.locator('#health-consent-gate')).toHaveCount(0);
  // No start control: the quiz auto-initializes and position 0 is shown on load.
  await expect(page.locator('#begin-quiz')).toHaveCount(0);
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();

  const semaglutide = page.getByRole("button", { name: "Semaglutide", exact: true });
  await semaglutide.focus();
  await page.keyboard.press("Enter");
  await expect(semaglutide).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(semaglutide).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(semaglutide).toHaveAttribute("aria-pressed", "true");
  const nextZero = page.locator('[data-quiz-position="0"] [data-quiz-next]');
  await nextZero.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-quiz-position="2"]')).toBeVisible();

  const yes = page.getByRole("button", { name: "Yes", exact: true });
  await yes.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-quiz-position="3"]')).toBeVisible();
  const back = page.locator('[data-quiz-back]:visible');
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-quiz-position="2"]')).toBeVisible();
  const no = page.locator('[data-single="current_use"][data-value="no"]');
  await no.focus();
  await page.keyboard.press("Space");
  await expect(no).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-quiz-position="1"]')).toBeVisible();

  const weightLoss = page.getByRole("button", { name: "Weight loss", exact: true });
  await weightLoss.focus();
  await page.keyboard.press("Enter");
  await expect(weightLoss).toHaveAttribute("aria-pressed", "true");
  await next(page);
  await expect(page.locator('[data-quiz-position="4"]')).toBeVisible();
  await page.getByRole("button", { name: "FSA/HSA Payments Accepted", exact: true }).click();
  await next(page);
  await page.locator('[data-quiz-select="state"]').selectOption("OR");
  await next(page);
  const finish = page.locator('[data-quiz-position]:visible [data-quiz-finish]');
  await finish.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/matches\/customized\/\?/);
  expect(resultHandoffs).toEqual(["first-party result navigation"]);
  expect(prohibitedRequests).toEqual([]);
  const query = new URL(page.url()).searchParams;
  expect(query.get("state")).toBe("OR");
  expect(query.get("drug")).toBe("SEMAGLUTIDE");
  expect(query.get("form")).toBe("COMPOUNDED");
  expect(query.get("goal")).toBe("price");
  const cards = page.locator('[data-result-cards] .qz-card');
  const expectedIds = expectedQuizIds("SEMAGLUTIDE", "OR", "price");
  await expect(cards).toHaveCount(expectedIds.length);
  expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(expectedIds);
  await expect(page.locator('#qm-results-title')).toBeFocused();
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("Top rule-based match");
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("Published plan context:");
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("Published ongoing figure");
  await expect(page.locator('[data-result-cards] .qz-card').first()).toContainText("no patient rating or review count is used");
  const stored = await page.evaluate(() => [...Object.entries(localStorage), ...Object.entries(sessionStorage)]);
  expect(stored.some(([key, value]) => /quiz\.provider-fit|quiz.*answer|TIRZEPATIDE|SEMAGLUTIDE|weight_loss|FSA\/HSA/i.test(`${key} ${value}`))).toBe(false);
  const explore = new URL(await page.locator('[data-explore-providers]').getAttribute("href"), "http://example.test");
  expect(explore.pathname).toBe("/providers/");
  expect(explore.searchParams.get("state")).toBe("OR");
  expect(explore.searchParams.get("drug")).toBe("SEMAGLUTIDE");
  expect(explore.searchParams.get("form")).toBe("COMPOUNDED");
  expect(explore.searchParams.get("sort")).toBe("cheapest");
  const retake = page.locator('[data-full-quiz-link]');
  await retake.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/quiz\/provider-fit\/$/);
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();
  await expect(page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]')).toHaveAttribute("aria-pressed", "false");
  expect(prohibitedRequests).toEqual([]);
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
