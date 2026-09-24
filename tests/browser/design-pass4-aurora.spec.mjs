import { expect, test } from "@playwright/test";
import { directoryProviderIds } from "./round3-source-expectations.mjs";

async function blockExternal(page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost", "::1"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
}

async function expectOrbit(locator, seconds) {
  await expect(locator).toBeVisible();
  const before = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      angle: style.getPropertyValue("--cs-button-aurora-angle").trim(),
      duration: style.animationDuration,
      name: style.animationName,
      playState: style.animationPlayState,
      background: style.backgroundImage,
    };
  });
  expect(before.name).toContain("cs-button-aurora-orbit");
  expect(before.duration).toBe(`${seconds}s`);
  expect(before.playState).toBe("running");
  expect(before.background).toContain("conic-gradient");
  await expect.poll(
    () => locator.evaluate((node) => getComputedStyle(node).getPropertyValue("--cs-button-aurora-angle").trim()),
    { timeout: 2_000, intervals: [80, 160, 320] },
  ).not.toBe(before.angle);
}

async function expectInteractionOrbit(locator, seconds) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCSS("animation-name", "none");
  await locator.hover();
  await expectOrbit(locator, seconds);
}

test.beforeEach(async ({ page }) => {
  await blockExternal(page);
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      advertising: "denied",
      record_type: "preference_only",
      version: "gcs-cookie-v4-distinct-purposes",
      saved_at: "2026-08-28T00:00:00.000Z",
    }));
  });
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({
      schema: "glp-geo-state-v1",
      available: false,
      state: null,
    }),
  }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("Pass 4 keeps only the hero border live and starts shared action auroras on interaction", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "load" });

  await expectOrbit(page.getByRole("link", { name: "See your matches" }), 5);
  await expectInteractionOrbit(page.getByRole("link", { name: /Compare all \d+ programs/ }).first(), 8);
  await expectInteractionOrbit(page.locator(".cs-home-quick").first(), 8);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "load" });
  await expect(page.getByRole("link", { name: "See your matches" })).toHaveCSS("animation-name", "none");
  const reducedQuickLink = page.locator(".cs-home-quick").first();
  await reducedQuickLink.hover();
  await expect(reducedQuickLink).toHaveCSS("animation-name", "none");
});

test("Pass 4 final action layer survives route-local CSS on Insights, calculator, reviews, and quiz", async ({ page }) => {
  const routes = [
    ["/insights/", page.getByRole("button", { name: /Email me the checklist/i })],
    ["/tools/glp-1-cost-calculator/", page.getByRole("button", { name: "Calculate estimate" })],
    ["/reviews/", page.getByRole("link", { name: /Start your review/i })],
    ["/quiz/provider-fit/", page.locator(".qz-next").first()],
  ];

  for (const [route, locator] of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    if (route === "/quiz/provider-fit/") {
      await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    }
    await expectInteractionOrbit(locator, 5);
  }
});

test("Pass 4 home cost choices roll to the final numeric value and respect reduced motion", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  const card = page.locator("[data-price-card]").first();
  const choices = card.locator("[data-price-choice]");
  await expect(choices).toHaveCount(2);
  const target = Number(await choices.nth(1).getAttribute("data-price-value"));
  const amount = card.locator("[data-price-roll]");
  await choices.nth(1).click();
  await page.waitForTimeout(120);
  const during = Number((await amount.textContent()).replace(/[^0-9]/g, ""));
  expect(during).not.toBe(target);
  await expect(amount).toHaveText(`$${target.toLocaleString("en-US")}`, { timeout: 1_000 });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await choices.first().click();
  const reducedTarget = Number(await choices.first().getAttribute("data-price-value"));
  await expect(amount).toHaveText(`$${reducedTarget.toLocaleString("en-US")}`);
});

test("Pass 4 category and pharmacy inventories disclose in bounded batches", async ({ page }) => {
  await page.goto("/lp/best-providers/compounded-semaglutide/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-phase3-provider-grid] [data-phase3-provider]:visible")).toHaveCount(9);
  await expect(page.locator("[data-state-unverified-remainder] [data-phase3-provider]")).toHaveCount(18);
  const interstitialIndex = await page.locator("[data-phase3-provider-grid]").evaluate((grid) => Array.from(grid.children).findIndex((node) => node.hasAttribute("data-quiz-interstitial")));
  expect(interstitialIndex).toBe(2);
  await expect(page.locator("[data-provider-load-more]")).toHaveCount(0);

  await page.goto("/pharmacies/", { waitUntil: "load" });
  await expect(page.locator("[data-pharmacy-card]:visible")).toHaveCount(18);
  await expect(page.locator("[data-pharmacy-result]")).toContainText("Showing 18 of");
  await page.locator("[data-pharmacy-load-more]").click();
  await expect(page.locator("[data-pharmacy-card]:visible")).toHaveCount(36);
});

test("Pass 4 provider hub serves only the evidence-qualified Option C card grid", async ({ page }) => {
  await page.goto("/providers/", { waitUntil: "networkidle" });
  const cards = page.locator("[data-phase3-provider]");
  await expect(cards).toHaveCount(directoryProviderIds.length);
  expect((await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).sort()).toEqual(directoryProviderIds);
  const loadMore = page.locator("[data-provider-load-more]");
  let visible = await cards.filter({ visible: true }).count();
  expect(visible).toBe(Math.min(12, directoryProviderIds.length));
  while (visible < directoryProviderIds.length) {
    await expect(loadMore).toBeVisible();
    const next = Math.min(visible + 12, directoryProviderIds.length);
    await loadMore.click();
    await expect(cards.filter({ visible: true })).toHaveCount(next);
    visible = next;
  }
  expect(visible).toBe(directoryProviderIds.length);
  await expect(loadMore).toBeHidden();
  await expect(page.locator("[data-provider-lazy-index]")).toHaveCount(0);
  await expect(cards.locator("[data-provider-card-contract='option-c']")).toHaveCount(directoryProviderIds.length);
  await expect(page.locator("[data-provider-record]")).toHaveCount(0);
  for (const program of ["mydrhank", "breeze-meds-review", "care-bare-rx-glp1-review"]) {
    await expect(page.locator(`[data-program='${program}']`)).toHaveCount(0);
  }
  await expect(page.locator("[data-related-insights-shelf]")).toBeVisible();
});

test("Pass 4 repaired directories and quiz capture stay bounded at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/lp/best-providers/compounded-semaglutide/",
    "/pharmacies/",
    "/providers/",
    "/3-month/",
  ]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }

  await page.goto("/quiz/provider-fit/", { waitUntil: "domcontentloaded" });
  const capture = page.locator(".qz-result-shell .inline-capture");
  await expect(capture).toHaveCount(1);
  const background = await capture.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(background).toContain("linear-gradient");
  const privacy = (await page.locator(".qz-footnote").innerText()).trim();
  expect(privacy.length).toBeLessThan(170);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
