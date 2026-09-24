import { expect, test } from "@playwright/test";
import { expectedQuizIds } from "./round3-source-expectations.mjs";

const QUIZ = "/quiz/provider-fit/";
const MATCHES = "/matches/customized/";

async function expectNoSavedQuiz(page) {
  expect(await page.evaluate(() => ["localStorage", "sessionStorage"].flatMap((store) =>
    ["gcs.quiz.provider-fit.progress.v1", "gcs.quiz.provider-fit.preferences.v1"].map((key) => window[store].getItem(key))))).toEqual([null, null, null, null]);
}

async function choose(select, value) {
  await select.selectOption(value);
  await expect(select).toHaveValue(value);
}

async function completeNoBranch(page, { drug = "SEMAGLUTIDE", state = "OR", email = "" } = {}) {
  await page.locator(`[data-multi="intents"][data-value="${drug}"]`).click();
  await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
  await expect(page.locator('[data-quiz-position="2"]')).toBeVisible();
  await page.locator('[data-single="current_use"][data-value="no"]').click();
  await expect(page.locator('[data-quiz-position="1"]')).toBeVisible();
  await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
  await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
  await choose(page.locator('[data-quiz-select="state"]'), state);
  await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
  if (email) await page.locator('[data-quiz-input="email"]').fill(email);
  await page.locator("[data-quiz-finish]").click();
}

test.describe("Phase 4 full provider-fit quiz", () => {

  test("canonical No branch restores answers and hands off all governed matches on the same origin", async ({ page, baseURL }) => {
    const externalAttempts = [];
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== new URL(baseURL).origin) {
        externalAttempts.push({ url: url.href, method: route.request().method() });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await page.goto(QUIZ);
    await expect(page.locator("[data-quiz-position]")).toHaveCount(7);
    await expect(page.locator("[data-quiz-position]:visible")).toHaveCount(1);

    await page.locator('[data-multi="intents"][data-value="TIRZEPATIDE"]').click();
    await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
    await page.locator('[data-single="current_use"][data-value="no"]').click();
    await page.locator('[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]').click();
    await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
    await page.locator('[data-multi="features"][data-value="FSA_HSA"]').click();
    await page.locator('[data-quiz-position="4"] [data-quiz-back]').click();
    await expect(page.locator('[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
    await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
    await choose(page.locator('[data-quiz-select="state"]'), "OR");
    await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
    await page.locator("[data-quiz-finish]").click();

    await expect(page).toHaveURL((url) => url.origin === new URL(baseURL).origin && url.pathname === MATCHES
      && url.searchParams.get("state") === "OR" && url.searchParams.get("drug") === "TIRZEPATIDE"
      && url.searchParams.get("source") === "survey" && url.searchParams.get("goal") === "price"
      && url.searchParams.get("form") === "COMPOUNDED");
    await expect(page.locator("[data-matches-results]")).toBeVisible();
    const cards = page.locator("[data-result-cards] .qz-card");
    const expected = expectedQuizIds("TIRZEPATIDE", "OR", "price");
    await expect(cards).toHaveCount(expected.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(expected);
    await expect(cards.first().locator(".qz-card-status")).toContainText("Top rule-based match");
    await expect(cards.first().locator(".qz-card-identity")).toBeVisible();
    await expect(cards.first().locator(".qz-card-context")).toHaveText("Dose context was not provided for this comparison.");
    await expect(cards.first().locator(".qz-card-price")).toBeVisible();
    await expect(cards.first().locator(".qz-card-match")).toBeVisible();
    await expect(cards.first().locator(".qz-card-review")).toBeVisible();
    await expect(cards.first().getByRole("link", { name: "Learn more" })).toHaveAttribute("href", /^\//);
    const explore = page.locator("[data-explore-providers]");
    await expect(explore).toHaveAttribute("href", /state=OR/);
    await expect(explore).toHaveAttribute("href", /drug=TIRZEPATIDE/);
    await expect(page.locator("[data-result-empty]")).toBeHidden();
    expect([...new URL(page.url()).searchParams.keys()].sort()).toEqual(["drug", "form", "goal", "source", "state"]);
    await expectNoSavedQuiz(page);
    expect(externalAttempts, "a blocked external request is still an attempted export").toEqual([]);
  });

  test("Yes and Not sure branches remain exclusive and preserve dependent dose", async ({ page }) => {
    await page.goto(QUIZ);
    await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    await page.locator('[data-multi="intents"][data-value="NOT_SURE"]').click();
    await expect(page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-multi="intents"][aria-pressed="true"]')).toHaveCount(1);
    await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
    await page.locator('[data-single="current_use"][data-value="yes"]').click();
    await expect(page.locator('[data-branch="current-treatment"]')).toBeVisible();
    await expect(page.locator('[data-branch="situation"]')).toBeHidden();
    await choose(page.locator('[data-quiz-select="current_drug"]'), "SEMAGLUTIDE");
    await expect(page.locator('[data-quiz-select="current_dose"] option')).toHaveCount(8);
    await choose(page.locator('[data-quiz-select="current_dose"]'), "1.7");
    await page.locator('[data-quiz-position="3"] [data-quiz-next]').click();
    await page.locator('[data-quiz-position="4"] [data-quiz-back]').click();
    await expect(page.locator('[data-quiz-select="current_dose"]')).toHaveValue("1.7");
  });

  test("free-text reason and current monthly cost survive live Back but clear on reload", async ({ page }) => {
    await page.goto(QUIZ);
    await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
    await page.locator('[data-single="current_use"][data-value="no"]').click();
    await page.locator('[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]').click();
    await page.locator('[data-quiz-input="reason_other"]').fill("Insurance coverage changed");
    await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
    await page.locator('[data-quiz-position="4"] [data-quiz-back]').click();
    await expect(page.locator('[data-quiz-position="1"]')).toBeVisible();
    await expect(page.locator('[data-quiz-input="reason_other"]')).toHaveValue("Insurance coverage changed");
    await expect(page.locator("[data-reason-other]")).toBeVisible();
    await expectNoSavedQuiz(page);
    await page.reload();
    await expect(page.locator('[data-quiz-position="0"]')).toBeVisible();
    await expect(page.locator('[data-quiz-input="reason_other"]')).toHaveValue("");
    await expect(page.locator("[data-reason-other]")).toBeHidden();

    await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
    await page.locator('[data-single="current_use"][data-value="yes"]').click();
    await choose(page.locator('[data-quiz-select="current_drug"]'), "SEMAGLUTIDE");
    await choose(page.locator('[data-quiz-select="current_dose"]'), "1");
    await page.locator('[data-quiz-input="monthly_cost"]').fill("425");
    await page.locator('[data-quiz-position="3"] [data-quiz-next]').click();
    await page.locator('[data-quiz-position="4"] [data-quiz-back]').click();
    await expect(page.locator('[data-quiz-position="3"]')).toBeVisible();
    await expect(page.locator('[data-quiz-select="current_dose"]')).toHaveValue("1");
    await expect(page.locator('[data-quiz-input="monthly_cost"]')).toHaveValue("425");
    await expectNoSavedQuiz(page);
    await page.reload();
    await expect(page.locator('[data-quiz-position="0"]')).toBeVisible();
    await expect(page.locator('[data-quiz-position="0"] [data-quiz-next]')).toHaveAttribute("data-armed", "false");
    await expect(page.locator('[data-quiz-input="monthly_cost"]')).toHaveValue("");
    await expect(page.locator('[data-quiz-input="email"]')).toHaveValue("");
    await expect(page.locator('[data-quiz-input="first_name"]')).toHaveValue("");
    await expectNoSavedQuiz(page);
  });

  test("optional email posts only first-party newsletter contract fields", async ({ page }) => {
    let requestBody = null;
    await page.route("**/api/newsletter-subscribe", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await page.goto(QUIZ);
    await expect(page.locator("[data-quiz-position=\"6\"]")).toContainText("selected treatment interests, and state");
    await expect(page.locator("[data-quiz-position=\"6\"]")).not.toContainText("only the email address is sent");
    await completeNoBranch(page, { email: "reader@example.test" });
    await expect.poll(() => requestBody).not.toBeNull();
    expect(requestBody).toEqual({
      email: "reader@example.test",
      first_name: "",
      email_consent: true,
      company: "",
      consent_version: "glp-newsletter-v1-20260822",
      consent_source: "/subscribe-bottom-sheet/",
      source_surface: "quiz-provider-fit",
      provider_context: {
        medication_intents: ["SEMAGLUTIDE"],
        state: "OR",
      },
    });
    await expect(page).toHaveURL((url) => url.pathname === MATCHES && url.searchParams.get("source") === "survey");
    await expect(page.locator("[data-matches-results]")).toBeVisible();
    await expect(page.locator("[data-result-newsletter-status]")).toContainText("subscription was saved");
    expect(await page.evaluate(() => sessionStorage.getItem("gcs.quiz.newsletter-status.v1"))).toBeNull();
    expect(new URL(page.url()).searchParams.has("email")).toBe(false);
  });

  test("provider-detail return and results reload retain query context; full quiz starts fresh", async ({ page }) => {
    await page.goto(QUIZ);
    await completeNoBranch(page, { drug: "SEMAGLUTIDE", state: "OR" });
    await expect(page.locator("[data-matches-results]")).toBeVisible();
    const resultUrl = page.url();
    const expected = expectedQuizIds("SEMAGLUTIDE", "OR");
    const cards = page.locator("[data-result-cards] .qz-card");

    await cards.first().getByRole("link", { name: "Learn more" }).click();
    await expect(page).toHaveURL(/\/reviews\//);
    await page.goBack();
    await expect(page).toHaveURL(resultUrl);
    await expect(page.locator("[data-matches-results]")).toBeVisible();
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(expected);
    await page.reload();
    await expect(page).toHaveURL(resultUrl);
    await expect(cards).toHaveCount(expected.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(expected);
    await expect(page.locator("[data-explore-providers]")).toHaveAttribute("href", /state=OR/);
    await expectNoSavedQuiz(page);
    await expect(page.locator("[data-full-quiz-link]")).toBeVisible();
    await page.locator("[data-full-quiz-link]").click();
    await expect(page).toHaveURL((url) => url.pathname === QUIZ && url.search === "");
    await expect(page.locator("[data-phase4-results]")).toBeHidden();
    await expect(page.locator('[data-quiz-position="0"]')).toBeVisible();
    await expect(page.locator('[data-quiz-position="0"] [data-quiz-next]')).toHaveAttribute("data-armed", "false");
    await expect(page.locator('[data-quiz-select="state"]')).toHaveValue("");

    await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
    await page.locator('[data-single="current_use"][data-value="no"]').click();
    await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
    await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
    const state = page.locator('[data-quiz-select="state"]');
    const next = page.locator('[data-quiz-position="5"] [data-quiz-next]');
    await expect(next).toHaveAttribute("data-armed", "false");
    await choose(state, "OR");
    await expect(next).toHaveAttribute("data-armed", "true");
    await next.click();
    await expect(page.locator('[data-quiz-position="6"]')).toBeVisible();
    await expectNoSavedQuiz(page);
  });
});

test.describe("Phase 4 compact matches", () => {
  test("dependent dose resets and compounded shortlist preserves state", async ({ page }) => {
    await page.goto(MATCHES);
    await expect(page.locator("[data-matches-medication]")).toBeVisible();
    await expect(page.locator("[data-matches-state]")).toBeVisible();
    await expect(page.locator("[data-matches-dose]")).toBeDisabled();
    await choose(page.locator("[data-matches-medication]"), "SEMAGLUTIDE");
    await expect(page.locator("[data-matches-dose] option")).toHaveCount(8);
    await choose(page.locator("[data-matches-dose]"), "2.4");
    await choose(page.locator("[data-matches-medication]"), "TIRZEPATIDE");
    await expect(page.locator("[data-matches-dose]")).toHaveValue("");
    await expect(page.locator("[data-matches-dose] option")).toHaveCount(9);
    await choose(page.locator("[data-matches-medication]"), "SEMAGLUTIDE");
    await choose(page.locator("[data-matches-dose]"), "2.4");
    await choose(page.locator("[data-matches-state]"), "OR");
    await page.locator("[data-search-providers]").click();

    const cards = page.locator("[data-result-cards] .qz-card");
    const expected = expectedQuizIds("SEMAGLUTIDE", "OR");
    await expect(cards).toHaveCount(expected.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(expected);
    await expect(cards.first().locator(".qz-card-status")).toContainText("Top rule-based match");
    await expect(cards.first().locator(".qz-card-context")).toContainText("2.4 mg/week");
    await expect(cards.first().locator(".qz-card-review")).toBeVisible();
    await expect(page.locator("[data-explore-providers]")).toHaveAttribute("href", /state=OR/);
    await expect(page.locator("[data-explore-providers]")).toHaveAttribute("href", /dose=2.4/);
    await expect(page.locator("[data-full-quiz-link]")).toBeVisible();
    await expect(page.locator("[data-full-quiz-link]")).toHaveAttribute("href", "/quiz/provider-fit/");
  });

  test("brand selection resolves to an owned state-preserving product route", async ({ page }) => {
    await page.goto(MATCHES);
    await choose(page.locator("[data-matches-medication]"), "OZEMPIC_WEGOVY");
    await choose(page.locator("[data-matches-state]"), "OR");
    await page.locator("[data-search-providers]").click();
    await expect(page).toHaveURL(/\/ozempic\/\?state=OR&drug=OZEMPIC&form=BRAND_NAME&sort=cheapest$/);
  });
});

test("Phase 4 surfaces remain single-column and overflow-free at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [QUIZ, MATCHES]) {
    await page.goto(route);
    const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.goto(QUIZ);
  await completeNoBranch(page);
  await expect(page).toHaveURL((url) => url.pathname === MATCHES && url.searchParams.get("state") === "OR");
  await expect(page.locator("[data-matches-results]")).toBeVisible();
  expect(await page.locator("[data-result-cards] .qz-card").evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(expectedQuizIds("SEMAGLUTIDE", "OR"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectNoSavedQuiz(page);
});
