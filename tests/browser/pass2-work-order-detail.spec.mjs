import { expect, test } from "@playwright/test";
import { approvedRetirement } from "./retirement-support.mjs";

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;
const LEGACY_REVIEWS = ["coivas", "direct-meds", "mangorx", "sprout-health"];
const QUIZ_INTENTS = [
  "Semaglutide",
  "Tirzepatide",
  "Ozempic",
  "Mounjaro",
  "Wegovy",
  "Zepbound",
  "Wegovy Pill",
  "Not sure",
];
const CONSENT_CHECKBOXES = [
  "#cs-subscribe-consent",
  ".cs-subscribe-consent",
  "#capture-consent",
  ".capture-consent",
  'input[type="checkbox"][name="subscribe_consent" i]',
  'input[type="checkbox"][name="email_consent" i]',
  'input[type="checkbox"][name="marketing_consent" i]',
].join(",");

test.setTimeout(240_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "pass2-served-acceptance",
      saved_at: "2026-08-25T00:00:00.000Z",
    }));
  });
  await page.route(ANALYTICS, (route) => route.fulfill({
    status: 204,
    contentType: "application/javascript",
    body: "",
  }));
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
});

async function gotoServed(page, route, expectedPath = route.split("?", 1)[0]) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (response?.status() === 200) break;
    await page.waitForTimeout(250);
  }
  expect(response?.status(), route).toBe(200);
  expect(new URL(page.url()).pathname, route).toBe(expectedPath);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(120);
}

async function visibleCount(locator) {
  return locator.evaluateAll((nodes) => nodes.filter((node) => {
    const style = getComputedStyle(node);
    return !node.hidden && style.display !== "none" && style.visibility !== "hidden";
  }).length);
}

test("O-15 dose UI appears only on the exact source-reported provider detail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoServed(page, "/providers/mademed/");

  const doseBlocks = page.locator(".p3-dose-grid[data-dose-model]");
  await expect(doseBlocks).toHaveCount(2);
  await expect(doseBlocks.locator("[data-dose-row]")).toHaveCount(11);
  const models = await doseBlocks.evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.doseModel))]);
  expect(models).toEqual(["source-reported-per-dose"]);

  for (let index = 0; index < await doseBlocks.count(); index += 1) {
    const block = doseBlocks.nth(index);
    await expect(block.locator(".p3-dose-definition")).not.toHaveText("");
    await expect(block.locator("time")).toHaveAttribute("datetime", /^2026-08-/);
    await expect(block.locator('a[href^="https://"]')).toHaveCount(1);

    const rows = block.locator("[data-dose-row]");
    expect(await rows.count()).toBeGreaterThan(0);
    for (let rowIndex = 0; rowIndex < await rows.count(); rowIndex += 1) {
      const row = rows.nth(rowIndex);
      expect((await row.getAttribute("data-dose-row")) || "").toMatch(/^\d+(?:\.\d+)?$/);
      expect((await row.textContent()) || "").toMatch(/mg\/week.*\$[\d,]+\/month/s);
    }
    await expect(block).not.toContainText(/Not published|UNKNOWN_NO_SOURCE/);
  }
});

test("O-26 O-27 calculator lands directly on the viewport-fit split workspace and keeps price updates", async ({ page }) => {
  // DESIGN PASS 2026-08-26 (calculator-tools spec fix #2/#3, supersedes the
  // O-26 "no visible hero" pin): the page now leads with a VISIBLE H1 and a
  // published-price anchor on the left, the form card on the right, and the
  // estimate column is alive at first paint. Retained invariants: one semantic
  // heading, form starts under the nav, whole tool fits one laptop viewport,
  // Get price updates stays reachable.
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoServed(page, "/tools/glp-1-cost-calculator/");

  await expect(page.locator("main.cost-calculator-page")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).not.toHaveClass(/visually-hidden/);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(".cost-intro")).toBeVisible();
  await expect(page.locator("#cost-idle")).toBeVisible();
  await expect(page.locator("#cost-result")).toBeHidden();
  const geometry = await page.evaluate(() => {
    const nav = document.querySelector(".gcs-nav").getBoundingClientRect();
    const form = document.querySelector("#cost-form").getBoundingClientRect();
    const intro = document.querySelector(".cost-intro").getBoundingClientRect();
    return {
      gap: form.top - nav.bottom,
      formTop: form.top,
      formBottom: form.bottom,
      introRight: intro.right,
      formLeft: form.left,
      navBottom: nav.bottom,
      viewportHeight: innerHeight,
    };
  });
  expect(geometry.formTop).toBeGreaterThanOrEqual(geometry.navBottom);
  expect(geometry.gap).toBeLessThanOrEqual(200);
  expect(geometry.formBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.formLeft).toBeGreaterThanOrEqual(geometry.introRight);
  await expect(page.getByRole("button", { name: "Get price updates", exact: true })).toBeVisible();
});

test("O-28 subscribe surfaces use email submission without a consent checkbox gate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoServed(page, "/tools/glp-1-cost-calculator/");
  const updates = page.getByRole("button", { name: "Get price updates", exact: true });
  await updates.click();
  const sheet = page.locator("[data-subscribe-layer], .cs-subscribe-sheet").filter({ visible: true }).first();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('input[type="email"]')).toBeVisible();
  await expect(sheet.locator(CONSENT_CHECKBOXES)).toHaveCount(0);
  await expect(sheet.locator('a[href="/privacy/"]')).not.toHaveCount(0);

  for (const route of ["/", "/insights/", "/guides/trimi-vs-yourera/", "/guides/mounjaro-coupon/", "/tools/glp-1-cost-calculator/"]) {
    await gotoServed(page, route);
    expect(await page.locator(CONSENT_CHECKBOXES).count(), route).toBe(0);
  }
});

test("O-29 search proves in-flight and result states, then navigates natively without delay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoServed(page, "/");
  await page.locator(".cs-search-toggle").click();
  const panel = page.locator(".cs-search-panel");
  const input = panel.locator('input[type="search"]');
  await expect(panel).toBeVisible();
  await input.fill("wegovy");
  await expect(panel).toHaveClass(/is-searching/);
  await expect(panel.locator(".cs-search-loading")).toBeVisible();
  await expect(panel.locator(".cs-search-loading")).toContainText("Searching Clinic Scout");

  await page.waitForTimeout(1_000);
  const hits = panel.locator(".cs-search-hit");
  const hitCount = await hits.count();
  expect.soft(hitCount, "served search index must yield a destination before choreography can run").toBeGreaterThan(0);
  if (hitCount === 0) return;

  const hit = hits.first();
  const target = new URL(await hit.getAttribute("href"), page.url()).href;
  expect(await page.locator("[data-search-transition], .cs-search-transition, .cs-page-transition").count()).toBe(0);
  await Promise.all([
    page.waitForURL(target, { timeout: 10_000 }),
    hit.click(),
  ]);
});

test("O-30 representative detail families keep first meaningful content close to the shared nav", async ({ page }) => {
  const routes = [
    ["provider hub", "/providers/", "h1"],
    ["review", "/reviews/coivas/", "h1"],
    ["category", "/lp/best-providers/compounded-semaglutide/", "h1"],
    ["product", "/wegovy/", "h1"],
    ["bulk", "/3-month/", "h1"],
    ["insights", "/insights/", "h1"],
    ["article", "/guides/trimi-vs-yourera/", "h1"],
    ["pharmacy hub", "/pharmacies/", "h1"],
    ["pharmacy detail", "/pharmacies/red-rock/", "h1"],
    ["quiz", "/quiz/provider-fit/", "h1"],
    ["calculator", "/tools/glp-1-cost-calculator/", "#cost-form"],
  ];
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900, maxGap: 200 },
    { name: "mobile", width: 390, height: 844, maxGap: 160 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const [family, route, selector] of routes) {
      await gotoServed(page, route);
      const geometry = await page.evaluate((targetSelector) => {
        const nav = document.querySelector(".gcs-nav").getBoundingClientRect();
        const target = document.querySelector(targetSelector).getBoundingClientRect();
        return { gap: target.top - nav.bottom, top: target.top, viewportHeight: innerHeight };
      }, selector);
      expect.soft(geometry.gap, `${viewport.name} ${family} ${route}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(viewport.maxGap);
      expect.soft(geometry.top, `${viewport.name} ${family} ${route} must begin above the fold`).toBeLessThan(geometry.viewportHeight * 0.5);
    }
  }
});

test("G-1 four migrated review routes carry the shared interactive review anatomy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const slug of LEGACY_REVIEWS) {
    const route = `/reviews/${slug}/`;
    await gotoServed(page, route);
    await expect(page.locator('body[data-cs-template="review"]'), route).toHaveCount(1);
    await expect(page.locator(".gcs-nav"), route).toHaveCount(1);
    await expect(page.locator(".cs-search-toggle"), route).toHaveCount(1);
    await expect(page.locator(".cs-drawer"), route).toHaveCount(1);
    await expect(page.locator(".breadcrumbs"), route).toHaveCount(1);
    await expect(page.locator(".ready6-provider-mark.provider-logo"), route).toHaveCount(1);
    if (route === "/reviews/coivas/") {
      await expect(page.locator('.ready6-provider-mark img[src="/assets/provider-logos/coivas.svg"]'), route).toHaveCount(1);
    } else {
      await expect(page.locator(".ready6-provider-mark.provider-logo--wordmark"), route).toHaveCount(1);
    }
    await expect(page.locator(".ready6-jump-nav"), route).toHaveCount(1);
    await expect(page.locator("#bottom-line, #pricing, #score-rubric"), route).toHaveCount(3);
    await expect(page.locator("footer.gcs-footer"), route).toHaveCount(1);
    await expect(page.locator('script[src^="/assets/motion-loader.js"]'), route).toHaveCount(1);
    await expect(page.locator('script[src^="/assets/site.js"]'), route).toHaveCount(1);
    await expect(page.locator(".topbar"), route).toHaveCount(0);
  }
});

test("G-2 provider hub exposes the complete 35-record ordered backlog shape", async ({ page }, testInfo) => {
  await approvedRetirement("RR-1", testInfo);
  await gotoServed(page, "/providers/");
  const backlog = page.locator('[data-phase3-provider] a[data-card-review][href^="/reviews/"]');
  await expect(backlog.first()).toBeVisible();
  const rows = await backlog.evaluateAll((links) => links.map((link) => ({
    href: link.getAttribute("href"),
    name: link.closest("[data-phase3-provider]").querySelector("h2, h3")?.textContent?.trim() || "",
  })));
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows.map((row) => row.href)).size).toBe(rows.length);
  expect(rows.every((row) => /^\/reviews\/[a-z0-9-]+\/$/.test(row.href) && row.name)).toBe(true);
});

test("G-3 product has paired insurance pricing, a final wizard action, and a real related shelf", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoServed(page, "/wegovy/");

  const paired = page.locator("[data-with-without-insurance], .p3-price-pair, .p3-product-pricing").first();
  const pairedCount = await paired.count();
  expect.soft(pairedCount, "combined with/without-insurance panel").toBe(1);
  if (pairedCount) {
    await expect.soft(paired).toContainText(/with insurance/i);
    await expect.soft(paired).toContainText(/without insurance/i);
  }

  const wizard = page.locator("[data-insurance-wizard]");
  await expect(wizard).toBeVisible();
  await expect.soft(wizard.locator("[data-insurance-complete]"), "final insurance wizard step").toHaveCount(1);

  const related = page.locator(".p3-related, [data-related-products]").first();
  await expect(related).toBeVisible();
  expect.soft(await related.locator("a").count(), "related shelf links").toBeGreaterThanOrEqual(3);
  expect.soft(await related.locator("a:has(img)").count(), "related shelf must be product cards, not bare links").toBeGreaterThanOrEqual(3);
});

test("G-4 listing filters expose honest no-match states and retain dose/state fallbacks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoServed(page, "/lp/best-providers/compounded-semaglutide/");
  const filters = page.locator("[data-provider-filters]");
  const cards = page.locator("[data-phase3-provider]");
  await expect(filters).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);

  const brand = filters.locator('[data-filter="type"][data-value="brand"]');
  const microdose = filters.locator('[data-filter="type"][data-value="microdose"]');
  await expect(brand).toBeEnabled();
  await expect(microdose).toBeDisabled();
  await expect(microdose).toHaveAttribute("aria-disabled", "true");
  await brand.click();
  await expect(page).toHaveURL((url) => url.pathname === "/wegovy/" && url.searchParams.get("form") === "BRAND_NAME");
  await gotoServed(page, "/lp/best-providers/compounded-semaglutide/");
  await filters.locator('[data-filter="dose"][data-value="2.4"]').click();
  await expect(page.locator("[data-filter-empty]")).toBeVisible();
  await expect(page.locator("[data-filter-result]")).toHaveText("0 comparable price results");
  await expect(page.locator("[data-phase3-provider-grid] > [data-phase3-provider]:visible")).toHaveCount(0);
  await page.locator("[data-filter-reset]").click();
  await expect(page.locator("[data-filter-empty]")).toBeHidden();
  await filters.locator('[data-filter="plan"][data-value="3"]').click();
  expect(await visibleCount(cards), "3-month filter may not create a known unsupported empty state").toBeGreaterThan(0);

  const more = filters.locator(".p3-more-filters");
  if (!(await more.getAttribute("open"))) await more.locator("summary").click();
  const dose = filters.locator('[data-filter="dose"][data-value="0.25"]');
  await expect(dose).toBeEnabled();
  await dose.click();
  await expect(dose).toHaveAttribute("role", "tab");
  await expect(dose).toHaveAttribute("aria-selected", "true");
  await expect(dose).toHaveAttribute("tabindex", "0");
  const visibleCards = page.locator("[data-phase3-provider]:visible");
  expect(await visibleCards.count()).toBeGreaterThan(0);
  await expect(visibleCards.locator("[data-provider-card-contract='option-c']")).toHaveCount(await visibleCards.count());
  await expect(visibleCards.locator(".p3-dose-grid, .p3-feature-chips")).toHaveCount(0);
  await expect(visibleCards.first().locator("dt")).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);

  const nativeState = page.locator("main.listing .listing__intro [data-state-native]");
  await expect(nativeState).toBeVisible();
  expect(await nativeState.locator("option").count()).toBe(52);
  await nativeState.selectOption("TX");
  await expect(page.locator("h1[data-state-heading]")).toContainText("Texas");
});

test("G-5 all four bulk intents announce explicit result-state feedback", async ({ page }) => {
  const intents = [
    ["/3-month/?drug=SEMAGLUTIDE", "SEMAGLUTIDE"],
    ["/3-month/?drug=TIRZEPATIDE", "TIRZEPATIDE"],
    ["/6-month/?drug=SEMAGLUTIDE", "SEMAGLUTIDE"],
    ["/6-month/?drug=TIRZEPATIDE", "TIRZEPATIDE"],
  ];
  for (const [route, drug] of intents) {
    await gotoServed(page, route);
    const treatment = page.locator(`[data-provider-filters] [data-filter="treatment"][data-value="${drug}"]`);
    await expect(treatment, route).toHaveAttribute("role", "tab");
    await expect(treatment, route).toHaveAttribute("aria-selected", "true");
    await expect(treatment, route).toHaveAttribute("tabindex", "0");
    await expect(page.locator("[data-phase3-provider]:visible"), route).toHaveCount(3);
    const feedback = ((await page.locator("[data-filter-result]").textContent()) || "").trim();
    expect.soft(feedback, `${route} result feedback`).not.toBe("");
    expect.soft(feedback.toUpperCase(), `${route} treatment feedback`).toContain(drug);
  }
});

test("G-6 article template includes a linked curator block and FAQ disclosure", async ({ page }) => {
  await gotoServed(page, "/guides/trimi-vs-yourera/");
  const author = page.locator(".guide-author, .p3-author, [data-author-block]").first();
  const authorCount = await author.count();
  expect.soft(authorCount, "article curator block").toBe(1);
  if (authorCount) await expect.soft(author.locator('a[href^="/authors/"]'), "curator destination").not.toHaveCount(0);

  const faq = page.locator(".guide-faq, [data-faq], .faq").first();
  const faqCount = await faq.count();
  expect.soft(faqCount, "article FAQ block").toBe(1);
  if (faqCount) {
    expect.soft(await faq.locator("details").count(), "FAQ disclosures").toBeGreaterThan(0);
    if (await faq.locator("details").count()) {
      await faq.locator("details").first().locator("summary").click();
      await expect(faq.locator("details").first()).toHaveAttribute("open", "");
    }
  }
});

test("G-7 pharmacy hub exposes 75 evidence-qualified Option C cards", async ({ page }) => {
  await gotoServed(page, "/pharmacies/");
  const cards = page.locator("[data-pharmacy-card]");
  await expect(cards).toHaveCount(75);
  const additive = page.locator("[data-pharmacy-additive]");
  const additiveCount = await additive.count();
  expect.soft(additiveCount, "additive filter").toBe(1);
  if (additiveCount) expect.soft(await additive.locator("option").count(), "additive filter inventory").toBeGreaterThan(1);
  await expect(cards.locator("[data-pharmacy-card-contract='option-c']")).toHaveCount(75);
  await expect(cards.locator(".p3-pharmacy-facts > div")).toHaveCount(150);
  await expect(cards.locator(".p3-card-evidence-line")).toHaveCount(75);
  await expect(cards.locator("[data-additive-chip], .p3-additive-chip, .p3-compounded-with-chip")).toHaveCount(0);
});

test("G-7 pharmacy detail includes a related shelf and at least one verified reverse document", async ({ page }) => {
  await gotoServed(page, "/pharmacies/red-rock/");
  const related = page.locator(".p3-related, [data-related-pharmacies]").first();
  const relatedCount = await related.count();
  expect.soft(relatedCount, "pharmacy related shelf").toBe(1);
  if (relatedCount) expect.soft(await related.locator('a[href^="/pharmacies/"]').count(), "related pharmacy links").toBeGreaterThanOrEqual(3);

  await gotoServed(page, "/pharmacies/");
  const reverseLinks = page.locator('a[href^="/pharmacies/"][href$="/compare-providers/"]');
  const reverseCount = await reverseLinks.count();
  expect.soft(reverseCount, "at least one evidence-backed reverse-comparison document must be discoverable").toBeGreaterThan(0);
  if (reverseCount === 0) return;
  const href = await reverseLinks.first().getAttribute("href");
  await gotoServed(page, href);
  await expect(page.getByRole("heading", { level: 1, name: /Verified programs associated with/i })).toBeVisible();
  await expect(page.locator('a[href^="/providers/"]')).not.toHaveCount(0);
});

test("G-9 empty coupon feed fails closed on every reader-facing detail surface", async ({ page, request }) => {
  const feedResponse = await request.get("/data/coupon-offers.json");
  expect(feedResponse.status()).toBe(200);
  const feed = await feedResponse.json();
  expect(feed.schema).toBe("glp-coupon-offers-v1");
  expect(feed.offers).toEqual([]);

  for (const route of [
    "/lp/best-providers/compounded-semaglutide/",
    "/providers/orderlymeds/",
    "/reviews/orderlymeds/",
    "/wegovy/",
  ]) {
    await gotoServed(page, route);
    await expect(page.locator("[data-coupon-copy], [data-coupon-code], .cs-coupon-chip, .cs-coupon-toast"), route).toHaveCount(0);
    await expect(page.locator("body"), route).not.toContainText(/Use code [A-Z0-9_-]+ for/i);
  }
});

test("G-10 every quiz intent reaches three cards, scoped exploration, and an animated reveal", async ({ page }, testInfo) => {
  await approvedRetirement("RR-3", testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  const completed = [];

  for (let intentIndex = 0; intentIndex < QUIZ_INTENTS.length; intentIndex += 1) {
    const intent = QUIZ_INTENTS[intentIndex];
    await gotoServed(page, "/quiz/provider-fit/");
    await expect(page.locator("#health-consent, #health-consent-gate"), intent).toHaveCount(0);
    // No start control: the quiz auto-initializes and position 0 is shown on load.
    await expect(page.locator("#begin-quiz"), intent).toHaveCount(0);
    await expect(page.locator('[data-quiz-position="0"]:not([hidden])'), intent).toBeVisible();

    const firstOptions = page.locator('[data-pass2-question="intent"] [data-value]');
    await expect(firstOptions, intent).toHaveText(QUIZ_INTENTS);
    await firstOptions.nth(intentIndex).click();
    await page.locator('[data-pass2-question="intent"] [data-pass2-next]').click();
    await page.getByRole("button", { name: "No", exact: true }).click();
    await page.locator('[data-pass2-question="current-use"] [data-pass2-next]').click();
    await page.getByRole("button", { name: "Weight loss", exact: true }).click();
    await page.locator('[data-pass2-question="reason"] [data-pass2-next]').click();
    await page.locator('[data-pass2-select="state"]').selectOption("OR");
    await page.locator('[data-pass2-question="state"] [data-pass2-next]').click();
    await page.getByRole("button", { name: "Cost", exact: true }).click();
    await page.locator('[data-pass2-question="priorities"] [data-pass2-next]').click();
    await page.locator('[data-pass2-question="features"] [data-pass2-next]').click();
    await page.locator('[data-pass2-select="budget"]').selectOption("250");
    await page.locator('[data-pass2-question="budget"] [data-pass2-next]').click();
    await page.locator('[data-pass2-question="contact"] [data-pass2-next]').click();
    // RR-3 retires only the old in-page fixed-three/reveal presentation.
    await expect(page, intent).toHaveURL((url) => url.pathname === "/quiz/matches/");
    const result = page.locator("[data-result-cards]");
    await expect(result, intent).toBeVisible();
    await expect(result.locator(".qz-card").first(), intent).toBeVisible();
    const resultTop = await result.evaluate((node) => node.getBoundingClientRect().top);
    expect(resultTop, `${intent}: reveal must land in the viewport`).toBeLessThan(900);
    const progress = page.locator("[role=progressbar]");
    await expect(progress, intent).toHaveAttribute("aria-valuenow", "8");
    await expect(progress, intent).toHaveAttribute("aria-valuemax", "8");

    const explore = new URL(await page.locator("[data-explore-providers]").getAttribute("href"), page.url());
    expect(explore.pathname, intent).toBe("/providers/");
    expect(explore.searchParams.get("state"), intent).toBe("OR");
    expect(explore.searchParams.get("sort"), intent).toBe("cheapest");
    if (intent !== "Not sure") expect(explore.searchParams.has("drug"), intent).toBe(true);
    completed.push(intent);
  }

  expect(completed).toEqual(QUIZ_INTENTS);
});
