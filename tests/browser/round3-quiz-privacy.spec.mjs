import { test, expect } from "@playwright/test";

const quizKeys = ["gcs.quiz.provider-fit.progress.v1", "gcs.quiz.provider-fit.preferences.v1"];
const writePrefix = "ROUND3_QUIZ_STORAGE_WRITE:";

test("R3 quiz answers never enter browser storage or leave the origin", async ({ page, context, baseURL }) => {
  expect(baseURL).toBeTruthy();
  const origin = new URL(baseURL).origin;
  const external = [];
  const submissions = [];
  const writes = [];
  page.on("console", (message) => {
    if (message.text().startsWith(writePrefix)) writes.push(JSON.parse(message.text().slice(writePrefix.length)));
  });
  // Never await page.evaluate in a route handler: it can deadlock navigation.
  await context.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) {
      external.push({ url: request.url(), method: request.method(), body: request.postData() });
      return route.abort();
    }
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      submissions.push({ url: request.url(), method: request.method(), body: request.postData() });
    }
    return route.continue();
  });
  await page.addInitScript(({ quizKeys, writePrefix }) => {
    // Isolate this privacy regression. The separate real-notice reachability test remains unchanged.
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied", advertising: "denied", version: "gcs-cookie-v4-distinct-purposes",
      record_type: "preference_only", updated_at: new Date().toISOString(),
    }));
    if (location.pathname === "/quiz/provider-fit/") {
      const legacy = { schema: "gcs-quiz-provider-fit-progress-v1", current: 5, completed: false,
        answers: { intents: ["TIRZEPATIDE"], current_use: "no", state: "NY", reasons: [], features: [] } };
      for (const store of [localStorage, sessionStorage]) {
        store.setItem(quizKeys[0], JSON.stringify(legacy));
        store.setItem(quizKeys[1], JSON.stringify({ schema: "gcs-quiz-provider-fit-preferences-v1", matches: [] }));
      }
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith("gcs.quiz.") || String(value).includes("ROUND3_STORAGE_SENTINEL")) {
        console.debug(writePrefix + JSON.stringify({ key: String(key), value: String(value) }));
      }
      return setItem.call(this, key, value);
    };
  }, { quizKeys, writePrefix });
  const assertNoQuizStorage = async () => {
    const saved = await page.evaluate((keys) => [localStorage, sessionStorage]
      .flatMap((store) => keys.map((key) => store.getItem(key))), quizKeys);
    expect(saved).toEqual([null, null, null, null]);
    expect(writes).toEqual([]);
  };
  const next = () => page.locator('[data-quiz-position]:visible [data-quiz-next]').click();
  await page.goto("/quiz/provider-fit/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-quiz-position="0"]')).toBeVisible();
  await expect(page.locator('#health-consent-gate, #begin-quiz')).toHaveCount(0);
  await expect(page.locator('[data-multi="intents"][aria-pressed="true"]')).toHaveCount(0);
  await assertNoQuizStorage();
  await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
  await next();
  await page.locator('[data-single="current_use"][data-value="no"]').click();
  await page.locator('[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]').click();
  await page.locator('[data-quiz-input="reason_other"]').fill("ROUND3_STORAGE_SENTINEL");
  await next();
  await next();
  await page.locator('[data-quiz-select="state"]').selectOption("CA");
  await next();
  await assertNoQuizStorage();
  await Promise.all([
    page.waitForURL((url) => url.origin === origin && url.pathname === "/matches/customized/"),
    page.locator('[data-quiz-finish]').click(),
  ]);
  expect(new URL(page.url()).searchParams.get("state")).toBe("CA");
  expect(new URL(page.url()).searchParams.get("drug")).toBe("SEMAGLUTIDE");
  await expect(page.locator('[data-matches-results]')).toBeVisible();
  await assertNoQuizStorage();
  expect(submissions, "blank optional email must not submit a newsletter or lead").toEqual([]);
  expect(external, "off-origin request attempts are recorded before being blocked").toEqual([]);
  await page.goto("/quiz/provider-fit/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-quiz-position="0"]')).toBeVisible();
  await expect(page.locator('[data-multi="intents"][aria-pressed="true"]')).toHaveCount(0);
  await assertNoQuizStorage();
  expect(submissions).toEqual([]);
  expect(external).toEqual([]);
});

for (const model of ["us-default-on", "prior-opt-in"]) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    test(`R3 untouched ${model} notice leaves quiz Next reachable at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.route("**/api/geo-state?purpose=consent", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schema: "glp-consent-region-v1", model }),
      }));
      await page.goto("/quiz/provider-fit/", { waitUntil: "domcontentloaded" });
      await expect.poll(() => page.evaluate(() => window.GCSConsent?.model())).toBe('global-default-on');
      await expect(page.locator('#gcs-consent button')).toHaveCount(1);
      await expect(page.locator('#gcs-consent [data-consent="acknowledge"]')).toHaveText('Got it');
      const notice = page.locator("#gcs-consent");
      await expect(notice).toBeVisible();
      await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
      await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
      await expect(page.locator('[data-quiz-position="2"]')).toBeVisible();
      await expect(notice).toBeVisible();
      await page.locator('[data-quiz-position="2"] [data-quiz-back]').click();
      await expect(page.locator('[data-quiz-position="0"]')).toBeVisible();
      await expect(notice).toBeVisible();
    });
  }
}
