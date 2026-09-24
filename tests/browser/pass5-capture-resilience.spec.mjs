import { test, expect } from "@playwright/test";

const email = "kael.builds.business+pass5-browser@example.com";
const formSelector = "[data-p1-capture-surface][data-capture-placement='quiz-results'] form[action='/api/content-upgrade']";

async function exposeQuizResults(page) {
  await page.goto("/quiz/provider-fit/", { waitUntil: "load" });
  await page.locator("[data-phase4-results]").evaluate((node) => {
    node.hidden = false;
    node.removeAttribute("hidden");
  });
  await expect(page.locator(formSelector)).toBeVisible();
}

test("quiz-results capture retries a temporary save failure and clears email only after confirmed delivery", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/content-upgrade", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ status: "STORAGE_FAILED" }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: "CAPTURED", send: "sent" }),
    });
  });

  await exposeQuizResults(page);
  const form = page.locator(formSelector);
  await form.locator("input[name='email']").fill(email);
  await form.getByRole("button", { name: "Email me my match checklist" }).click();

  await expect(form.locator(".capture-status")).toHaveText("Done — your checklist was emailed.");
  await expect(form.locator("input[name='email']")).toHaveValue("");
  expect(requests).toBe(2);
});

test("quiz-results capture retains email after three bounded save failures", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/content-upgrade", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ status: "STORAGE_FAILED" }),
    });
  });

  await exposeQuizResults(page);
  const form = page.locator(formSelector);
  await form.locator("input[name='email']").fill(email);
  await form.getByRole("button", { name: "Email me my match checklist" }).click();

  await expect(form.locator(".capture-status")).toHaveText("We could not confirm the save. Your email is still here; try again.");
  await expect(form.locator("input[name='email']")).toHaveValue(email);
  expect(requests).toBe(3);
});
