import { expect } from "@playwright/test";
import { expectedQuizIds } from "./round3-source-expectations.mjs";

// Ruling (e): the survey finishes on a same-origin result document. Observe
// navigation requests without intercepting them or evaluating a paused page.
export async function expectSurveyHandoff(page, finish, state) {
  const origin = new URL(page.url()).origin;
  const ids = expectedQuizIds("SEMAGLUTIDE", state, "medication-form");
  const navigations = [];
  const record = (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      navigations.push({ url: request.url(), method: request.method(), body: request.postData() });
    }
  };
  page.on("request", record);
  try {
    await finish();
    expect(navigations.every((navigation) => new URL(navigation.url).origin === origin), "quiz_answers_left_origin").toBe(true);
    await expect.poll(() => {
      const url = new URL(page.url());
      return { origin: url.origin, path: url.pathname };
    }).toEqual({ origin, path: "/matches/customized/" });
    const url = new URL(page.url());
    expect(url.hash).toBe("");
    expect([...url.searchParams.entries()].sort()).toEqual([
      ["drug", "SEMAGLUTIDE"], ["form", "COMPOUNDED"],
      ["goal", "medication-form"], ["source", "survey"], ["state", state],
    ].sort());
    const result = page.locator("[data-matches-results]");
    const cards = result.locator("[data-result-cards] .qz-card");
    await expect(result).toBeVisible();
    await expect(page.locator("[data-matches-form]")).toBeHidden();
    await expect(page.locator("[data-phase4-questions], #health-consent-gate")).toHaveCount(0);
    await expect(cards).toHaveCount(ids.length);
    expect(await quizAudit(() => cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program)))).toEqual(ids);
    await expect(result.locator('[name="match_program_ids"]')).toHaveValue(ids.slice(0, 3).join(","));
    await expect(result.locator("#qm-results-title")).toHaveText(`${ids.length} provider record${ids.length === 1 ? "" : "s"} to compare`);
    const saved = await quizAudit(() => page.evaluate(() => [localStorage, sessionStorage].map((store) => ({
      progress: store.getItem("gcs.quiz.provider-fit.progress.v1"),
      preferences: store.getItem("gcs.quiz.provider-fit.preferences.v1"),
    }))));
    expect(saved).toEqual([{ progress: null, preferences: null }, { progress: null, preferences: null }]);
    expect(navigations.length).toBeGreaterThan(0);
    for (const navigation of navigations) {
      expect(new URL(navigation.url).origin, "quiz_answers_left_origin").toBe(origin);
      expect(navigation.method).toBe("GET");
      expect(navigation.body).toBeNull();
    }
    return { result, cards, ids };
  } finally {
    page.off("request", record);
  }
}

export async function retakeSurvey(page) {
  const origin = new URL(page.url()).origin;
  const retake = page.locator("[data-matches-results] [data-full-quiz-link]");
  await expect(retake).toBeVisible();
  await expect(retake).toHaveAttribute("href", "/quiz/provider-fit/");
  await retake.click();
  await expect.poll(() => page.url()).toBe(`${origin}/quiz/provider-fit/`);
  await expect(page.locator('[data-phase4-quiz] [data-quiz-position="0"]')).toBeVisible();
  await expect(page.locator('[data-multi="intents"][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator("[data-phase4-results]")).toBeHidden();
  await expect(page.locator("#health-consent-gate")).toHaveCount(0);
}

// Ruling (e) bounds an audit read at 10 s; this is not a larger assertion timeout.
export async function quizAudit(read) {
  let timer;
  try {
    return await Promise.race([
      read(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("quiz_privacy_audit_failed")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
