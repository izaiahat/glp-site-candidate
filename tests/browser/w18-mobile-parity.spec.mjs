import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROOF = path.join(ROOT, "artifacts", "ultracode", "w18-mobile");
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "gcs-cookie-v2-default-on-20260730",
      saved_at: "2026-08-22T00:00:00.000Z",
    }));
  });
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

test("W18 provider and pharmacy filters use ergonomic bottom sheets", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  for (const [route, name] of [
    ["/lp/best-providers/compounded-semaglutide/", "Filters and sort"],
    ["/pharmacies/", "Pharmacy filters"],
  ]) {
    await page.goto(route, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const sheet = page.getByRole("dialog", { name });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.width).toBeCloseTo(390, 0);
    expect(box?.height || 0).toBeLessThanOrEqual(680);
    await expect(page.locator("body")).toHaveClass(/cs-mobile-filters-open/);
    await sheet.getByRole("button", { name: "Show results" }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    await expectNoHorizontalOverflow(page, route);
  }
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

test("W18 quiz steps remain reachable and results reveal into a 312px swipe rail", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/quiz/provider-fit/?restart=1", { waitUntil: "networkidle" });
  // No consent gate and no start control: the quiz auto-initializes and
  // position 0 ([data-quiz-position="0"]) is shown on load without any click.
  await expect(page.locator("#begin-quiz")).toHaveCount(0);
  await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();

  for (let guard = 0; guard < 10; guard += 1) {
    if (await page.locator("#result").isVisible()) break;
    const field = page.locator(".question:not([hidden])");
    await expect(field).toBeVisible();
    const option = field.locator("button.option:not([disabled])").first();
    if (await option.count()) {
      await option.click();
    } else {
      const select = field.locator("select[data-question]");
      const value = await select.locator("option:not([disabled])").evaluateAll((options) => options.map((item) => item.value).find(Boolean));
      expect(value).toBeTruthy();
      await select.selectOption(value);
      await field.locator("[data-role=state-continue]").click();
    }
  }

  const result = page.locator("#result");
  await expect(result).toBeVisible();
  await expect(page.locator(".cs-quiz-result-skeleton")).toHaveCount(0);
  await expect(page.locator(".cs-quiz-result-viewport")).toBeVisible();
  const cards = page.locator("#match-cards .qz-card");
  expect(await cards.count()).toBeGreaterThan(1);
  const firstBox = await cards.first().boundingBox();
  expect(firstBox?.width).toBeCloseTo(312, 0);
  await expect(page.locator(".cs-quiz-result-dots button")).toHaveCount(await cards.count());
  const track = page.locator("#match-cards");
  const before = await track.evaluate((node) => getComputedStyle(node).transform);
  await page.locator(".cs-quiz-result-dots button").nth(1).click();
  await expect.poll(() => track.evaluate((node) => getComputedStyle(node).transform)).not.toBe(before);
  const panelInk = await page.evaluate(() => ({
    about: getComputedStyle(document.querySelector('.quiz-about p')).color,
    capture: getComputedStyle(document.querySelector('#result .inline-capture p')).color,
  }));
  const darkestChannel = (color) => Math.max(...(color.match(/\d+/g) || []).slice(0, 3).map(Number));
  expect(darkestChannel(panelInk.about)).toBeLessThan(120);
  expect(darkestChannel(panelInk.capture)).toBeLessThan(120);
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(PROOF, "quiz-results-390x844.png"), animations: "disabled" });
  await expectNoHorizontalOverflow(page, "/quiz/provider-fit/");
  expect(errors).toEqual([]);
});
