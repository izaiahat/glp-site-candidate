import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { governedPaidPrimaryIds, governedWegovyIds } from "./governed-cohort.mjs";

const PROOF = path.join(process.env.PLAYWRIGHT_SCRATCH_ROOT || os.tmpdir(), "w18-mobile");
mkdirSync(PROOF, { recursive: true });

const ROUTES = [
  ["home", "/", ".cs-home2-hero"],
  ["brand-product", "/ozempic/", 'main.listing[data-listing-archetype="B"] > .listing__intro'],
  ["compounded-category", "/lp/best-providers/compounded-semaglutide/", 'main.listing[data-listing-archetype="C"] > .listing__intro'],
  ["bulk", "/3-month/", 'main.listing[data-listing-archetype="A"] > .listing__intro'],
  ["insights-index", "/insights/", ".p3-insights-hero"],
  ["insights-article", "/guides/how-to-get-ozempic-online/", "main.guide-shell"],
  ["pharmacies", "/pharmacies/", "[data-pharmacy-grid]"],
  ["pharmacy-detail", "/pharmacies/hallandale/", ".p3-pharmacy-hero"],
  ["provider-cards", "/lp/best-providers/compounded-semaglutide/", ".p3-provider-grid"],
  ["provider-detail", "/providers/found-health/", "[data-provider-sticky]"],
  ["quiz", "/quiz/provider-fit/", '[data-phase4-quiz] [data-quiz-position="0"]'],
];

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;

test.setTimeout(180_000);

test.beforeEach(async ({ page }, testInfo) => {
  if (!/W18 paid provider filters|W18 quiz remains/.test(testInfo.title)) {
    await page.addInitScript(() => {
      localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
        analytics: "denied",
        version: "gcs-cookie-v2-default-on-20260730",
        saved_at: "2026-08-22T00:00:00.000Z",
      }));
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(ANALYTICS, (route) => route.fulfill({ status: 204, contentType: "application/javascript", body: "" }));
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
});

function watchRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  return errors;
}

async function expectNoHorizontalOverflow(page, route) {
  const state = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(state.html, `${route} html overflow`).toBeLessThanOrEqual(1);
  expect(state.body, `${route} body overflow`).toBeLessThanOrEqual(1);
}

async function expectPrimaryTargets(page, route) {
  const undersized = await page.locator([
    ".cs-search-toggle",
    ".cs-menu-toggle",
    ".cs-btn",
    ".gcs-button",
    ".cta",
    ".p3-filter-chips button",
    "[data-bulk-drug-value]",
    "button.option",
    ".qz-continue",
    "[data-multi]",
    "[data-single]",
    "[data-quiz-next]",
  ].join(",")).evaluateAll((nodes) => nodes.flatMap((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
    return rect.width + 0.5 < 44 || rect.height + 0.5 < 44
      ? [{ tag: node.tagName, className: node.className, width: rect.width, height: rect.height }]
      : [];
  }));
  expect(undersized, `${route} undersized primary targets`).toEqual([]);
}

test("W18 served 390x844 matrix covers every standing template with fresh assets", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  for (const [family, route, marker] of ROUTES) {
    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status(), route).toBe(200);
    await expect(page.locator(marker).first(), `${family} marker`).toBeVisible();
    await expect(page.locator('script[src^="/assets/site.js"]')).toHaveCount(1);
    expect(await page.locator('link[rel="stylesheet"][href^="/assets/site"]').count()).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page, route);
    await expectPrimaryTargets(page, route);
  }
  expect(errors).toEqual([]);
});

test("W18 nav drawer and search sheet are focus-contained, full-height, and scroll-locked", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.goto("/", { waitUntil: "networkidle" });

  const menu = page.locator("[data-menu-toggle]");
  await menu.click();
  const drawer = page.locator("[data-menu]");
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBeCloseTo(110, 0);
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox?.width).toBeCloseTo(280, 0);
  await expect(page.locator("body")).toHaveClass(/cs-drawer-open/);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await page.locator(".cs-search-toggle").click();
  const sheet = page.locator(".cs-search-panel");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  const box = await sheet.boundingBox();
  expect(box?.width).toBeCloseTo(390, 0);
  expect(box?.height).toBeCloseTo(844, 0);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe("hidden");
  const input = sheet.locator('input[type="search"]');
  await expect(input).toBeFocused();
  await input.fill("cost");
  await expect(sheet.locator(".cs-search-hit").first()).toBeVisible();
  const searchRows = await sheet.locator(".cs-search-hit").evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight };
  }));
  expect(searchRows.every((row) => row.clientHeight + 1 >= row.scrollHeight)).toBe(true);
  expect(searchRows.slice(1).every((row, index) => row.top >= searchRows[index].bottom + 7)).toBe(true);
  await page.screenshot({ path: path.join(PROOF, "search-sheet-390x844.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.locator(".cs-search-toggle")).toBeFocused();
  expect(errors).toEqual([]);
});

test("W18 paid provider filters stay inline while pharmacy filters keep their sheet", async ({ page }, testInfo) => {
  const errors = watchRuntimeErrors(page);
  const thirdPartyAttempts = [];
  page.on("request", (request) => { if (ANALYTICS.test(request.url())) thirdPartyAttempts.push(request.url()); });
  // w18-semantic-independent-review.md F-01: the paid LP has inline filters.
  await page.goto("/lp/best-providers/compounded-semaglutide/", { waitUntil: "networkidle" });
  const filters = page.locator('[data-provider-filters]');
  await expect(filters).toBeVisible();
  for (const facet of ["treatment", "type", "plan", "sort"]) {
    await expect(filters.locator(`[data-filter="${facet}"]`).first()).toBeVisible();
  }
  await expect(page.locator('.p3-more-filters summary')).toContainText('More plans');
  await page.locator('.p3-more-filters summary').click();
  await expect(filters.locator('[data-filter="dose"]').first()).toBeVisible();
  await expect(page.locator('[data-state-open]')).toBeVisible();
  const primary = page.locator('#provider-results [data-phase3-provider]:visible');
  const initialIds = governedPaidPrimaryIds("SEMAGLUTIDE");
  expect(await primary.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(initialIds);
  await filters.locator('[data-filter="plan"][data-value="3"]').click();
  await expect(filters.locator('[data-filter="plan"][data-value="3"]')).toHaveAttribute('aria-selected', 'true');
  await expect(primary).toHaveCount(0);
  await filters.locator('[data-filter="plan"][data-value="both"]').click();
  await expect(primary).toHaveCount(initialIds.length);
  await filters.locator('[data-filter="dose"][data-value="2.4"]').click();
  await expect(filters.locator('[data-filter="dose"][data-value="2.4"]')).toHaveAttribute('aria-selected', 'true');
  await expect(primary).toHaveCount(0);
  await filters.locator('[data-filter="dose"][data-value="all"]').click();
  expect(await primary.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(initialIds);
  await expect(filters.locator('[data-filter="sort"][data-value="best"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(filters.locator('[data-filter="sort"][data-value="cheapest"]')).toHaveAttribute('aria-selected', 'true');
  expect(await primary.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(initialIds);
  await filters.locator('[data-filter="type"][data-value="brand"]').click();
  await expect(page).toHaveURL(/\/wegovy\/\?drug=WEGOVY&form=BRAND_NAME/);
  await expect(page.locator('[data-provider-filters] [data-filter="type"][data-value="brand"]')).toHaveAttribute('aria-selected', 'true');
  expect(await primary.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(governedWegovyIds());
  await expectNoHorizontalOverflow(page, "/lp/best-providers/compounded-semaglutide/");
  await page.goto("/pharmacies/", { waitUntil: "networkidle" });
  const trigger = page.getByRole("button", { name: /^Pharmacy filters/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Pharmacy filters" });
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  const focusables = sheet.locator('button:not([disabled]):not([tabindex="-1"]):visible,input:not([disabled]):not([type="hidden"]):visible,select:not([disabled]):visible,a[href]:visible');
  const first = focusables.first();
  const last = focusables.last();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  for (let step = 0; step < await focusables.count(); step++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((node) => node.contains(document.activeElement)), `Tab ${step} escaped pharmacy sheet`).toBe(true);
  }
  const box = await sheet.boundingBox();
  expect(box?.width).toBeCloseTo(390, 0);
  expect(box?.height || 0).toBeLessThanOrEqual(680);
  await expect(page.locator("body")).toHaveClass(/cs-mobile-filters-open/);
  expect(await page.locator("body").evaluate((body) => getComputedStyle(body).overflow)).toBe("hidden");
  const { beforeScroll, maxScroll } = await page.evaluate(() => ({
    beforeScroll: scrollY, maxScroll: document.documentElement.scrollHeight - innerHeight,
  }));
  expect(maxScroll).toBeGreaterThan(beforeScroll + 560);
  const sheetTop = (await sheet.boundingBox()).y;
  // A real wheel gesture on the backdrop, not a scripted scrollTo that bypasses the lock.
  expect(sheetTop).toBeGreaterThan(0);
  if (testInfo.project.name !== "webkit-mobile") {
    await page.mouse.move(195, Math.max(1, sheetTop / 2));
    await page.mouse.wheel(0, 560);
  }
  // Mobile WebKit does not implement Playwright's mouse.wheel; retain a
  // keyboard scroll attempt there rather than synthesizing a nontrusted event.
  await first.focus();
  await page.keyboard.press("PageDown");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(beforeScroll);
  await sheet.getByRole("button", { name: "Show results" }).click();
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectNoHorizontalOverflow(page, "/pharmacies/");
  expect(thirdPartyAttempts).toEqual([]);
  expect(errors).toEqual([]);
});

test("W18 pharmacy filter sheet keeps viewport geometry and returns focus", async ({ page }) => {
  await page.goto("/pharmacies/", { waitUntil: "networkidle" });
  const trigger = page.getByRole("button", { name: /^Pharmacy filters/ });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Pharmacy filters" });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box?.width).toBeCloseTo(390, 0);
  expect(box?.height || 0).toBeLessThanOrEqual(680);
  await expect(page.locator("body")).toHaveClass(/cs-mobile-filters-open/);
  await sheet.getByRole("button", { name: "Show results" }).click();
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectNoHorizontalOverflow(page, "/pharmacies/");
});

test("W18 comparison tables collapse into labelled cards", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.goto("/guides/how-to-get-ozempic-online/", { waitUntil: "networkidle" });
  const table = page.locator(".cs-mobile-card-table").first();
  await expect(table).toBeVisible();
  const state = await table.evaluate((node) => {
    const head = node.querySelector("thead");
    const row = node.querySelector("tbody tr");
    const cell = node.querySelector("tbody td, tbody th");
    const box = row?.getBoundingClientRect();
    return {
      headWidth: head?.getBoundingClientRect().width,
      rowWidth: box?.width,
      label: cell?.getAttribute("data-label"),
      before: cell ? getComputedStyle(cell, "::before").content : "",
    };
  });
  expect(state.headWidth).toBeLessThanOrEqual(1);
  expect(state.rowWidth || 0).toBeLessThanOrEqual(358);
  expect(state.label).toBeTruthy();
  expect(state.before).not.toBe("none");
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(PROOF, "comparison-table-cards-390x844.png"), animations: "disabled" });
  await expectNoHorizontalOverflow(page, "/guides/how-to-get-ozempic-online/");
  expect(errors).toEqual([]);
});

test("W18 provider sticky CTA persists through down and up scroll", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.goto("/providers/found-health/", { waitUntil: "networkidle" });
  const sticky = page.locator("[data-provider-sticky]");
  await expect(sticky).toBeVisible();
  const atBottom = async () => sticky.evaluate((node) => Math.abs(innerHeight - node.getBoundingClientRect().bottom));
  expect(await atBottom()).toBeLessThanOrEqual(1);
  const footer = page.locator(".cs-prefooter, .gcs-footer").first();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(sticky).toHaveClass(/is-released/);
  await expect(sticky).toHaveCSS("position", "absolute");
  await expect(sticky).toBeVisible();
  const footerTop = await footer.evaluate((node) => node.getBoundingClientRect().top);
  expect(footerTop).toBeLessThanOrEqual(844);
  const stickyBottom = await sticky.evaluate((node) => node.getBoundingClientRect().bottom);
  expect(Math.abs(stickyBottom - footerTop)).toBeLessThanOrEqual(1);
  const bottomScroll = await page.evaluate(() => scrollY);
  // Return above the actual footer boundary, not an arbitrary distance that
  // can leave that boundary in view on a tall footer.
  await footer.evaluate((node) => scrollTo(0, Math.max(0, scrollY + node.getBoundingClientRect().top - innerHeight - 260)));
  expect(await page.evaluate(() => scrollY)).toBeLessThan(bottomScroll);
  expect(await footer.evaluate((node) => node.getBoundingClientRect().top)).toBeGreaterThan(844);
  await expect(sticky).not.toHaveClass(/is-released/);
  await expect(sticky).toHaveCSS("position", "fixed");
  await expect(sticky).toBeVisible();
  expect(await atBottom()).toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(PROOF, "provider-sticky-up-390x844.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});

test("W18 home medication rail responds to a touch swipe", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const viewport = page.locator("[data-med-viewport]");
  await viewport.scrollIntoViewIfNeeded();
  const track = page.locator("[data-med-track]");
  const before = await track.evaluate((node) => getComputedStyle(node).transform);
  await viewport.evaluate((node) => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, pointerType: "touch", clientX: 320, clientY: 420 }));
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, pointerType: "touch", clientX: 130, clientY: 424 }));
  });
  await expect.poll(() => track.evaluate((node) => getComputedStyle(node).transform)).not.toBe(before);
  await expectNoHorizontalOverflow(page, "/");
  expect(errors).toEqual([]);
});

test("W18 quiz remains reachable and hands off to readable mobile result cards", async ({ page, baseURL }) => {
  const errors = watchRuntimeErrors(page);
  const egress = [];
  const origin = new URL(baseURL).origin;
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on("request", (request) => {
    const url = new URL(request.url());
    const resultsHandoff = url.origin === origin && url.pathname === "/matches/customized/" && request.method() === "GET";
    const answerBearing = [...url.searchParams].some(([key, value]) =>
      /^(?:state|drug|form|goal|intent|reason|feature|dose|current_use)$/i.test(key)
      || /TIRZEPATIDE|OTHER_HEALTH_CONCERNS/i.test(value))
      || /TIRZEPATIDE|OTHER_HEALTH_CONCERNS|state=OR/i.test(request.postData() || "")
      || (request.resourceType() !== "image" && /TIRZEPATIDE|OTHER_HEALTH_CONCERNS/i.test(url.pathname));
    if (url.origin !== origin) egress.push(`external ${request.method()} ${request.resourceType()}`);
    else if (answerBearing && !resultsHandoff) egress.push(`answer-bearing non-result ${request.method()} ${request.resourceType()}`);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quiz/provider-fit/?restart=1", { waitUntil: "networkidle" });
  const consent = await page.evaluate(() => JSON.parse(localStorage.getItem("gcs_tracking_consent_v1") || "null"));
  expect(consent?.analytics).toBe("denied");
  expect(consent?.advertising).toBe("denied");
  expect(consent?.analytics_basis).toBe("unset");
  // No consent gate and no start control: the quiz auto-initializes and
  // position 0 ([data-quiz-position="0"]) is shown on load without any click.
  await expect(page.locator("#begin-quiz")).toHaveCount(0);
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();

  // w18-semantic-independent-review.md C03: the survey resolves off-page.
  const tirzepatide = page.locator('[data-multi="intents"][data-value="TIRZEPATIDE"]');
  await tirzepatide.focus();
  await page.keyboard.press("Enter");
  await expect(tirzepatide).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-quiz-position="0"] [data-quiz-next]').focus();
  await page.keyboard.press("Enter");
  const noUse = page.locator('[data-single="current_use"][data-value="no"]');
  await noUse.focus();
  await page.keyboard.press("Space");
  await expect(noUse).toHaveAttribute("aria-pressed", "true");
  const reason = page.locator('[data-multi="reasons"][data-value="OTHER_HEALTH_CONCERNS"]');
  await reason.focus();
  await page.keyboard.press("Enter");
  await expect(reason).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
  await page.locator('[data-quiz-position="4"] [data-quiz-back]').click();
  await expect(page.locator('[data-quiz-position="1"]:not([hidden])')).toBeVisible();
  await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
  await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
  await page.locator('[data-quiz-select="state"]').selectOption('OR');
  await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
  await page.locator('[data-quiz-finish]').click();
  await expect(page).toHaveURL(/\/matches\/customized\/.*state=OR/);
  const result = page.locator('[data-matches-results]');
  await expect(result).toBeVisible();
  await expect(result.locator("#qm-results-title")).toBeFocused();
  const cards = result.locator('[data-result-cards] .qz-card');
  expect(await cards.count()).toBeGreaterThan(0);
  const cardBoxes = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
  expect(cardBoxes.every((box) => box.width <= 366 && box.width > 0)).toBe(true);
  expect(cardBoxes.slice(1).every((box, index) => box.top >= cardBoxes[index].bottom)).toBe(true);
  await expect(result.locator('[data-full-quiz-link]')).toHaveAttribute('href', /\/quiz\/provider-fit\//);
  const savedAnswers = await page.evaluate(() => [...Object.entries(localStorage), ...Object.entries(sessionStorage)].filter(([key, value]) =>
    /quiz.*(?:answer|health)/i.test(key) || /TIRZEPATIDE|OTHER_HEALTH_CONCERNS/.test(value)));
  expect(savedAnswers).toEqual([]);
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(PROOF, "quiz-results-390x844.png"), animations: "disabled" });
  await expectNoHorizontalOverflow(page, "/matches/customized/");
  await result.locator('[data-full-quiz-link]').click();
  await expect(page).toHaveURL(/\/quiz\/provider-fit\//);
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();
  expect(egress).toEqual([]);
  expect(errors).toEqual([]);
});