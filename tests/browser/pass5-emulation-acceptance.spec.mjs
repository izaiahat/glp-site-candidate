import { test, expect } from "@playwright/test";
import { governedProviderIds, governedReviewDirectoryCount, hydrateAllProviderCards } from "./governed-cohort.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isTypedPrice } from "../../src/typed-price-labels.mjs";

const PROOF = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass5-screenshots-20260829";
mkdirSync(PROOF, { recursive: true });

test.setTimeout(240_000);
test.describe.configure({ mode: "serial" });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1050 },
  { name: "mobile", width: 390, height: 844 },
];

const MEDICATION_LINKS = [
  "/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest",
  "/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest",
  "/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest",
  "/ozempic/?drug=OZEMPIC&form=BRAND_NAME&sort=cheapest",
  "/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest",
  "/mounjaro/?drug=MOUNJARO&form=BRAND_NAME&sort=cheapest",
  "/zepbound/?drug=ZEPBOUND&form=BRAND_NAME&sort=cheapest",
];

function record(name, payload) {
  writeFileSync(path.join(PROOF, name), JSON.stringify(payload, null, 2) + "\n");
}

async function prepare(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.route(/https?:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) =>
    route.fulfill({ status: 204, contentType: "application/javascript", body: "" }),
  );
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
}

async function open(page, route) {
  const runtimeErrors = [];
  const failedRequests = [];
  const onError = (error) => runtimeErrors.push(`pageerror:${error.message}`);
  const onConsole = (message) => { if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`); };
  const onFailed = (request) => {
    const failure = request.failure()?.errorText || "failed";
    const browserCancelledImage = request.resourceType() === "image"
      && /Load request cancelled|NS_BINDING_ABORTED|ERR_ABORTED/i.test(failure);
    if (!browserCancelledImage) failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  page.on("requestfailed", onFailed);
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), route).toBe(200);
  await expect(page.locator("main")).toBeVisible();
  const consent = page.getByRole("button", { name: "OK", exact: true });
  if (await consent.count() && await consent.first().isVisible()) await consent.first().click();
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(1);
  const dark = await page.evaluate(() => {
    const rgb = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
    return { rgb, luminance: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] };
  });
  expect(dark.luminance, `${route} must use the dark site ground`).toBeLessThan(70);
  return {
    overflow,
    dark,
    close() {
      page.off("pageerror", onError);
      page.off("console", onConsole);
      page.off("requestfailed", onFailed);
      expect(runtimeErrors, `${route} runtime errors`).toEqual([]);
      expect(failedRequests, `${route} failed requests`).toEqual([]);
      return { runtimeErrors, failedRequests };
    },
  };
}

async function screenshot(page, name, locator = null) {
  const box = locator ? await locator.boundingBox() : null;
  const target = box && box.width < 32_000 && box.height < 32_000 ? locator : page;
  await target.screenshot({ path: path.join(PROOF, name), animations: "disabled" });
}

async function expectTouchTargets(locator) {
  const boxes = await locator.evaluateAll((nodes) => nodes.filter((node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  }).map((node) => {
    const rect = node.getBoundingClientRect();
    return { text: node.textContent.trim().slice(0, 80), width: rect.width, height: rect.height };
  }));
  for (const box of boxes) {
    expect(box.height, `short target: ${box.text}`).toBeGreaterThanOrEqual(43);
    expect(box.width, `narrow target: ${box.text}`).toBeGreaterThanOrEqual(43);
  }
  return boxes;
}

for (const viewport of VIEWPORTS) {
  test(`Pass 5 changed surfaces are dark, contained, and reviewable — ${viewport.name}`, async ({ page }) => {
    await prepare(page, viewport);
    const evidence = { viewport, surfaces: [] };

    let check = await open(page, "/compare/");
    const paths = page.locator(".p5-compare-path");
    await expect(paths).toHaveCount(2);
    const medicationHrefs = await page.locator(".p5-compare-medications a").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    expect(medicationHrefs).toEqual(MEDICATION_LINKS);
    const pathColumns = await page.locator(".p5-compare-paths").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(pathColumns).toBe(viewport.name === "desktop" ? 2 : 1);
    await expectTouchTargets(page.locator(".p5-compare-medications a, .p5-compare-provider-actions a"));
    await screenshot(page, `compare-${viewport.name}.png`);
    evidence.surfaces.push({ route: "/compare/", pathColumns, medicationHrefs, ...check.close() });

    check = await open(page, "/providers/");
    // KAEL-DECISION-20260923-optionc-governing-mappings.md A2.3/A3.1:
    // the status owns the full cohort count, while rendering batches remain 12.
    const eligibleIds = governedProviderIds();
    const renderedIds = (await page.locator('[data-canonical-provider-ids]').getAttribute('data-canonical-provider-ids')).split(',');
    expect(new Set(renderedIds)).toEqual(new Set(eligibleIds));
    expect(eligibleIds.length).toBeGreaterThan(12);
    await expect(page.locator('[data-filter-result]')).toHaveText(`Showing ${eligibleIds.length} program cards`);
    const itemLists = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => {
      const documents = nodes.map((node) => { try { return JSON.parse(node.textContent); } catch { return null; } }).filter(Boolean);
      const flattened = documents.flatMap((document) => Array.isArray(document?.["@graph"]) ? document["@graph"] : [document]);
      return flattened.filter((node) => node?.["@type"] === "ItemList");
    });
    expect(itemLists).toHaveLength(1);
    const itemList = itemLists[0];
    const itemListCount = itemList.itemListElement.length;
    expect(itemListCount).toBe(eligibleIds.length);
    expect(itemList.name).toBe('GLP-1 provider comparison');
    expect(itemList.numberOfItems).toBe(eligibleIds.length);
    // Source-derived name and full canonical URL, one-based ordered position:
    // never validate a lossy URL slug against a card's self-reported ID alone.
    const facts = JSON.parse(readFileSync(new URL('../../data/provider-facts-backfill-20260830.json', import.meta.url), 'utf8')).programs;
    const registry = JSON.parse(readFileSync(new URL('../../data/program-registry.json', import.meta.url), 'utf8')).programs;
    const byId = new Map(facts.map((row) => [row.program_id, row]));
    const matrix = JSON.parse(readFileSync(new URL('../../data/provider-pricing-matrix.json', import.meta.url), 'utf8')).providers;
    const sourcePrice = (id) => {
      const record = registry.find((row) => row.program_id === id || row.review_slug === id);
      const prices = (matrix[id]?.medications || matrix[record?.program_id]?.medications || [])
        .filter((row) => isTypedPrice(row) || Number.isFinite(row.ongoing_usd))
        .filter((row) => !isTypedPrice(row)).map((row) => row.ongoing_usd).filter(Number.isFinite);
      return prices.length ? Math.min(...prices) : Infinity;
    };
    const orderedIds = [...eligibleIds].sort((left, right) => sourcePrice(left) - sourcePrice(right)
      || left.localeCompare(right) || byId.get(left).display_name.localeCompare(byId.get(right).display_name));
    const expectedItems = orderedIds.map((id, index) => {
      const research = byId.get(id);
      const record = registry.find((row) => row.program_id === id || row.review_slug === id);
      expect(research, `research identity ${id}`).toBeTruthy();
      expect(record, `registry identity ${id}`).toBeTruthy();
      const identity = record.profiles?.['glp-clinic-scout']?.canonical_identity;
      const canonical = identity?.role === 'alias' ? registry.find((row) => row.program_id === identity.canonical_program_id) : record;
      expect(canonical?.review_path, `canonical review ${id}`).toMatch(/^\/reviews\/[a-z0-9-]+\/$/);
      return { position: index + 1, item: { '@type': 'Thing', name: research.display_name, url: `https://glpclinicscout.com${canonical.review_path}` } };
    });
    expect(itemList.itemListElement).toEqual(expectedItems.map((row) => ({ '@type': 'ListItem', ...row })));
    expect(orderedIds).toEqual(await page.locator('#provider-results [data-phase3-provider]').evaluateAll((nodes) => nodes.map((node) => node.dataset.program)));
    const nextBatch = Math.min(12, eligibleIds.length - 12);
    const loadMore = page.getByRole("button", { name: `Show ${nextBatch} more providers` });
    await expect(loadMore).toBeVisible();
    await expectTouchTargets(loadMore);
    await screenshot(page, `providers-${viewport.name}.png`);
    const cards = await hydrateAllProviderCards(page);
    await expect(cards.locator('[data-provider-card-contract="option-c"]')).toHaveCount(eligibleIds.length);
    evidence.surfaces.push({ route: "/providers/", itemListCount, ...check.close() });

    check = await open(page, "/guides/trimi-vs-yourera/");
    await expect(page.locator("main.guide-shell")).toBeVisible();
    await expect(page.getByRole("link", { name: "X", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me the source-checked guide" }).first()).toBeVisible();
    const tableMetrics = await page.locator("table").first().evaluate((table) => {
      const wrapper = table.parentElement;
      return {
        tableWidth: table.getBoundingClientRect().width,
        wrapperWidth: wrapper.getBoundingClientRect().width,
        wrapperScrollWidth: wrapper.scrollWidth,
        wrapperClientWidth: wrapper.clientWidth,
      };
    });
    if (viewport.name === "desktop") {
      expect(tableMetrics.wrapperWidth).toBeGreaterThan(900);
      expect(tableMetrics.wrapperScrollWidth - tableMetrics.wrapperClientWidth).toBeLessThanOrEqual(1);
    }
    await page.locator("table").first().scrollIntoViewIfNeeded();
    await screenshot(page, `guide-${viewport.name}-table.png`);
    evidence.surfaces.push({ route: "/guides/trimi-vs-yourera/", tableMetrics, ...check.close() });

    check = await open(page, "/reviews/");
    await expect(page.locator(".cs-revhub-card")).toHaveCount(governedReviewDirectoryCount());
    const reviewOrder = await page.evaluate(() => ({
      directory: document.querySelector(".cs-revhub-directory")?.offsetTop,
      submissionBand: document.querySelector(".cs-revhub-band")?.offsetTop,
    }));
    expect(reviewOrder.directory).toBeLessThan(reviewOrder.submissionBand);
    await expect(page.locator("body")).not.toContainText(/held for manual moderation/i);
    await screenshot(page, `reviews-${viewport.name}.png`);
    evidence.surfaces.push({ route: "/reviews/", reviewOrder, ...check.close() });

    check = await open(page, "/reviews/submit/");
    const honeypot = page.locator('input[name="company"]');
    expect(await honeypot.count()).toBeGreaterThan(0);
    const honeypotGeometry = await honeypot.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, width: rect.width, height: rect.height, ariaHidden: node.getAttribute("aria-hidden") };
    }));
    for (const field of honeypotGeometry) expect(field.left < -1000 || (field.width <= 1 && field.height <= 1)).toBe(true);
    await expect(page.locator("body")).not.toContainText(/held for manual moderation|continue to optional counterpart/i);
    const combobox = page.locator('[data-review-entity="primary"]');
    await expect(combobox).toHaveAttribute("role", "combobox");
    await combobox.fill("");
    await combobox.focus();
    const listbox = page.locator('[data-review-combobox="primary"] [data-review-combobox-list]');
    await expect(listbox).toBeVisible();
    const listMetrics = await listbox.evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowY: getComputedStyle(node).overflowY }));
    expect(listMetrics.scrollHeight).toBeGreaterThanOrEqual(listMetrics.clientHeight);
    expect(["auto", "scroll"]).toContain(listMetrics.overflowY);
    await screenshot(page, `review-submit-${viewport.name}.png`);
    evidence.surfaces.push({ route: "/reviews/submit/", honeypotGeometry, listMetrics, ...check.close() });

    check = await open(page, "/tools/glp-1-cost-calculator/");
    const numericProvider = page.locator('#provider option[value]:not([value=""]):not([disabled])').first();
    await expect(numericProvider).toHaveCount(1);
    await page.locator("#provider").selectOption(await numericProvider.getAttribute("value"));
    await expect(page.locator("#medication")).toBeVisible();
    const selectStyles = await page.locator("#cost-form select:visible").evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { appearance: style.appearance, backgroundImage: style.backgroundImage, cursor: style.cursor, height: node.getBoundingClientRect().height };
    }));
    expect(selectStyles).toHaveLength(2);
    for (const style of selectStyles) {
      expect(style.appearance).toBe("none");
      expect(style.backgroundImage).not.toBe("none");
      expect(style.cursor).toBe("pointer");
      expect(style.height).toBeGreaterThanOrEqual(43);
    }
    await screenshot(page, `calculator-${viewport.name}.png`);
    evidence.surfaces.push({ route: "/tools/glp-1-cost-calculator/", selectStyles, ...check.close() });

    check = await open(page, MEDICATION_LINKS[0]);
    await expect(page.locator("body")).toContainText(/Compounded semaglutide/i);
    await expect(page.locator("body")).not.toContainText(/dose context was not provided|published plan context/i);
    await screenshot(page, `medication-${viewport.name}.png`);
    evidence.surfaces.push({ route: MEDICATION_LINKS[0], ...check.close() });

    record(`surface-matrix-${viewport.name}.json`, evidence);
  });
}

test("home Pass 5 layout, mobile sheet, and carousel behavior", async ({ page }) => {
  await prepare(page, VIEWPORTS[0]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let check = await open(page, "/");
  const logistics = await page.locator(".cs-home2-logistics__card").evaluateAll((nodes) => nodes.map((node) => {
    const children = [...node.children].slice(0, 2).map((child) => child.getBoundingClientRect().width);
    return { width: node.getBoundingClientRect().width, children };
  }));
  expect(logistics.length).toBe(2);
  for (const row of logistics) {
    expect(Math.abs(row.children[0] - row.children[1])).toBeLessThanOrEqual(4);
    expect(row.width).toBeGreaterThan(1100);
  }
  const rail = page.locator(".cs-home2-meds");
  await rail.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await expect(rail).toHaveAttribute("data-med-rail-state", "playing");
  const before = await page.locator("[data-med-track]").getAttribute("data-med-active-index");
  await page.waitForTimeout(3300);
  const after = await page.locator("[data-med-track]").getAttribute("data-med-active-index");
  expect(after).not.toBe(before);
  await rail.hover();
  await expect(rail).toHaveAttribute("data-med-rail-state", "paused");
  await screenshot(page, "home-desktop-medication-rail.png", rail);
  await page.locator(".cs-home2-logistics").scrollIntoViewIfNeeded();
  await screenshot(page, "home-desktop-logistics.png");
  check.close();

  await prepare(page, VIEWPORTS[1]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  check = await open(page, "/");
  await page.locator(".cs-home2-lifestyle").scrollIntoViewIfNeeded();
  const lifestyleImage = page.locator(".cs-home2-lifestyle img");
  await expect.poll(() => lifestyleImage.evaluate((image) => image.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  const lifestyle = await lifestyleImage.evaluate((image) => ({
    width: image.getBoundingClientRect().width,
    height: image.getBoundingClientRect().height,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    objectFit: getComputedStyle(image).objectFit,
  }));
  expect(lifestyle.width).toBeGreaterThan(300);
  expect(lifestyle.height).toBeGreaterThan(180);
  expect(lifestyle.naturalWidth).toBeGreaterThan(0);
  await screenshot(page, "home-mobile-lifestyle.png");
  const mobileRail = page.locator(".cs-home2-meds");
  await mobileRail.scrollIntoViewIfNeeded();
  await expect(mobileRail).toHaveAttribute("data-med-rail-state", "paused");
  const reducedBefore = await page.locator("[data-med-track]").getAttribute("data-med-active-index");
  await page.waitForTimeout(3300);
  const reducedAfter = await page.locator("[data-med-track]").getAttribute("data-med-active-index");
  expect(reducedAfter).toBe(reducedBefore);
  await page.getByRole("button", { name: "Get price updates" }).click();
  const sheet = page.locator(".cs-subscribe-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('input[type="email"]')).not.toBeFocused();
  await expect(sheet.getByRole("button", { name: /close/i })).toBeFocused();
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox.y).toBeGreaterThanOrEqual(0);
  expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(VIEWPORTS[1].height + 1);
  await screenshot(page, "home-mobile-subscribe-sheet.png");
  record("home-interactions.json", { logistics, carousel: { before, after, reducedBefore, reducedAfter }, lifestyle, sheetBox });
  check.close();
});

test("all operator-mapped medication URLs preserve distinct query intent", async ({ page }) => {
  await prepare(page, VIEWPORTS[0]);
  const results = [];
  for (const route of MEDICATION_LINKS) {
    const check = await open(page, route);
    const url = new URL(page.url());
    const expected = new URL(route, "https://glpclinicscout.com");
    expect(url.pathname).toBe(expected.pathname);
    expect(url.searchParams.get("drug")).toBe(expected.searchParams.get("drug"));
    expect(url.searchParams.get("form")).toBe(expected.searchParams.get("form"));
    expect(url.searchParams.get("sort")).toBe("cheapest");
    const h1 = await page.locator("h1").first().innerText();
    results.push({ route, finalPath: url.pathname, query: Object.fromEntries(url.searchParams), h1 });
    check.close();
  }
  expect(new Set(results.map((result) => `${result.finalPath}?${new URLSearchParams(result.query)}`)).size).toBe(7);
  record("medication-route-matrix.json", results);
});

test("quiz results remove machine copy and center the all-provider action", async ({ page }) => {
  await prepare(page, VIEWPORTS[1]);
  const check = await open(page, "/quiz/provider-fit/");
  await page.locator('[data-multi="intents"][data-value="TIRZEPATIDE"]').click();
  await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
  await page.locator('[data-single="current_use"][data-value="no"]').click();
  await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
  await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
  await page.locator('[data-quiz-select="state"]').selectOption("OR");
  await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
  await page.locator("[data-quiz-finish]").click();
  const cards = page.locator("[data-result-cards] .qz-card");
  await expect(cards).toHaveCount(3);
  const cardCopy = (await cards.allInnerTexts()).join("\n");
  expect(cardCopy).not.toMatch(/dose context was not provided|published plan context/i);
  const explore = page.locator("[data-explore-providers]");
  await expect(explore).toBeVisible();
  const alignment = await explore.evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    right: window.innerWidth - node.getBoundingClientRect().right,
  }));
  expect(Math.abs(alignment.left - alignment.right)).toBeLessThanOrEqual(3);
  const fragment = await page.evaluate(() => {
    const point = document.elementFromPoint(2, 2);
    return { tag: point?.tagName || null, className: point?.className || null, text: point?.textContent?.trim().slice(0, 80) || "" };
  });
  expect(fragment.text).not.toMatch(/mint/i);
  await screenshot(page, "quiz-results-mobile.png");
  record("quiz-results-mobile.json", { alignment, fragment, cardCount: await cards.count() });
  check.close();
});
