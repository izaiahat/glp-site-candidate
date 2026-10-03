import { test, expect } from "@playwright/test";
import { governedProviderIds, hydrateAllProviderCards } from "./governed-cohort.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROOF = path.join(ROOT, "artifacts", "ultracode", "template-completeness", "provider-review");
const VIEWPORTS = [
  { label: "desktop-1440x900", width: 1440, height: 900 },
  { label: "mobile-390x844", width: 390, height: 844 },
];

async function expectNoHorizontalOverflow(page) {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(geometry.document, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.body, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function screenshot(locator, filename) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: path.join(PROOF, filename), animations: "disabled" });
}

async function assertCanonicalReviewActions(page) {
  const eligibleIds = governedProviderIds();
  const allCards = await hydrateAllProviderCards(page);
  await expect(allCards.locator("[data-provider-card-contract='option-c']")).toHaveCount(eligibleIds.length);
  const registry = JSON.parse(readFileSync(new URL('../../data/program-registry.json', import.meta.url), 'utf8')).programs;
  const expected = new Map(eligibleIds.map((id) => {
    const record = registry.find((row) => row.program_id === id || row.review_slug === id);
    expect(record, `registry identity ${id}`).toBeTruthy();
    const alias = record.profiles?.['glp-clinic-scout']?.canonical_identity;
    const canonical = alias?.role === 'alias'
      ? registry.find((row) => row.program_id === alias.canonical_program_id) : record;
    expect(canonical?.review_path, `review path ${id}`).toMatch(/^\/reviews\/[a-z0-9-]+\/$/);
    return [id, canonical.review_path];
  }));
  const seen = new Set();
  for (const card of await allCards.all()) {
    const id = await card.getAttribute('data-program');
    expect(expected.has(id), `unexpected hydrated card ${id}`).toBe(true);
    expect(seen.has(id), `duplicate hydrated card ${id}`).toBe(false);
    seen.add(id);
    const actions = card.locator('.p3-card-actions a[data-provider-review-link]');
    await expect(actions, id).toHaveCount(1);
    await expect(actions, id).toHaveAttribute('href', expected.get(id));
    await expect(actions, id).not.toHaveAttribute('data-analytics-event', 'affiliate_click');
    await expect(actions, id).not.toHaveAttribute('rel', /sponsored/);
  }
  expect(seen).toEqual(new Set(eligibleIds));
}

test('every hydrated provider hub card has its source-bound canonical internal review action', async ({ page }) => {
  await page.goto('/providers/', { waitUntil: 'domcontentloaded' });
  await assertCanonicalReviewActions(page);
});

test("provider detail and editorial review expose the supported slots and honest gaps", async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await page.goto("/providers/orderlymeds/", { waitUntil: "domcontentloaded" });
    const providerCard = page.locator(".p3-provider-card[data-program='orderlymeds']");
    await expect(providerCard).toHaveCount(1);
    await expect(providerCard.locator(".p3-card-aurora")).toHaveCount(1);
    await expect(providerCard.locator(".p3-source-price time")).toHaveCount(4);
    const doseGrids = providerCard.locator(".p3-dose-grid");
    await expect(doseGrids).toHaveCount(0);
    await expect(providerCard).not.toContainText(/Not published|UNKNOWN_NO_SOURCE/);
    await expect(providerCard.getByRole("link", { name: "Read the evidence review" })).toHaveAttribute("href", "/reviews/orderlymeds/");
    await expect(providerCard.locator("[data-coupon-copy]")).toHaveCount(0);
    const providerAction = providerCard.locator("a[data-analytics-event='affiliate_click']");
    await expect(providerAction).toHaveCount(1);
    await expect(providerAction).toHaveAttribute("href", /^https:\/\/orderlymeds\.com\//);
    await expect(providerAction).toHaveAttribute("rel", "sponsored noopener nofollow");
    await expect(providerAction).toHaveAttribute("data-page-type", "provider-listing");
    await expect(providerAction).toHaveAttribute("data-provider-conversion-action", "external");
    await screenshot(providerCard, `provider-detail-card-${viewport.label}.png`);
    await expectNoHorizontalOverflow(page);

    await page.goto("/reviews/orderlymeds/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#bottom-line")).toBeVisible();
    await expect(page.locator("#bottom-line .score-lockup")).toContainText("9.2/10");
    await expect(page.locator("dl.facts").first().locator(":scope > div")).toHaveCount(4);
    await expect(page.locator("#pricing")).toBeVisible();

    const affiliate = page.locator("a[data-analytics-event='affiliate_click'][data-affiliate-state='active']");
    await expect(affiliate).toHaveCount(1);
    await expect(affiliate).toHaveAttribute("rel", "sponsored nofollow noopener");
    await expect(affiliate).toHaveAttribute("data-link-mode", "transparent-direct");
    await expect(affiliate).toHaveAttribute("data-page-type", "review");
    await expect(affiliate).toHaveAttribute("data-page-slug", "review-orderlymeds");
    await expect(affiliate).toHaveAttribute("data-link-position", "conclusion");
    // 2026-08-27 conversion-debug: data-network is now normalized to the
    // NETWORK_SUBID_PARAMS vocabulary (free-text sheet labels like "Direct
    // affiliate" broke per-network subid param selection at click time).
    await expect(affiliate).toHaveAttribute("data-network", "direct");
    await expect(affiliate).toHaveAttribute("data-sub1", "1R");
    await expect(affiliate).toHaveAttribute("data-sub2", "review-orderlymeds");
    await expect(affiliate).toHaveAttribute("data-subid", /^review-orderlymeds-conclusion-\d{6}$/);
    await expect(affiliate).toHaveAttribute("href", /^https:\/\/orderlymeds\.com\//);

    // Served truth: this live review has no verified coupon and no related-card shelf.
    await expect(page.locator("[data-coupon-copy], .cs-coupon-chip, .p3-related, [data-related]")).toHaveCount(0);
    await screenshot(page.locator("#bottom-line"), `editorial-review-bottom-line-${viewport.label}.png`);
    await expectNoHorizontalOverflow(page);

    // Python's static review server does not apply Cloudflare `_redirects`, so exercise
    // the canonical output here. Redirect behavior is verified separately against the
    // candidate review server.
    const shedResponse = await page.goto("/reviews/shedrx/", { waitUntil: "domcontentloaded" });
    expect(shedResponse?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/reviews/shedrx/");
    await expect(page).toHaveTitle("Shed Review 2026: Costs, Terms & Evidence");
    await expect(page.locator("#bottom-line")).toBeVisible();
  }
});

test("provider-card appearances follow the hub, home, category, and related-shelf contracts", async ({ page }) => {
  test.setTimeout(240_000);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await page.goto("/providers/", { waitUntil: "domcontentloaded" });
    const providerHubCards = page.locator(".p3-provider-card[data-phase3-provider]");
    // KAEL-DECISION-20260923-optionc-governing-mappings.md A3.1.
    const eligibleIds = governedProviderIds();
    const renderedIds = (await page.locator('[data-canonical-provider-ids]').getAttribute('data-canonical-provider-ids')).split(',');
    expect(eligibleIds.length).toBeGreaterThan(0);
    expect(new Set(renderedIds)).toEqual(new Set(eligibleIds));
    expect(await providerHubCards.evaluateAll((rows) => rows.map((row) => row.dataset.program).sort())).toEqual([...eligibleIds].sort());
    await expect(providerHubCards.locator("[data-provider-card-contract='option-c']")).toHaveCount(Math.min(12, eligibleIds.length));
    await expect(page.locator('[data-phase3-provider][data-provider-lazy-index]')).toHaveCount(Math.max(0, eligibleIds.length - 12));
    await screenshot(providerHubCards.first(), `provider-hub-option-c-card-${viewport.label}.png`);
    await assertCanonicalReviewActions(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const verdictRail = page.locator(".cs-home2-verdicts");
    await expect(verdictRail).toBeVisible();
    expect(await verdictRail.locator(".cs-home2-verdict").count()).toBeGreaterThan(0);
    await expect(verdictRail.locator(".p3-provider-card, [data-coupon-copy], [data-preference-match]")).toHaveCount(0);
    await screenshot(verdictRail, `home-verdict-cards-${viewport.label}.png`);

    await page.goto("/lp/best-providers/compounded-semaglutide/", { waitUntil: "domcontentloaded" });
    const cards = page.locator(".p3-provider-card");
    expect(await cards.count()).toBeGreaterThan(0);
    const firstCard = cards.first();
    const program = await firstCard.getAttribute("data-program");
    expect(program).toBeTruthy();
    await expect(firstCard.locator(".p3-card-aurora")).toHaveCount(1);
    await expect(firstCard.locator("[data-provider-card-contract='option-c']")).toHaveCount(1);
    await expect(firstCard.locator("dt")).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);
    await expect(firstCard.locator(".p3-dose-grid")).toHaveCount(0);
    await expect(cards.locator("[data-coupon-copy]")).toHaveCount(0);

    await page.evaluate(({ program }) => {
      localStorage.setItem("gcs.quiz.provider-fit.preferences.v1", JSON.stringify({
        version: "provider-fit-preferences-v1",
        matches: [program],
        answers: { goal: "weight_loss", insurance: "cash_pay", state: "CA" },
      }));
    }, { program });
    await page.reload({ waitUntil: "domcontentloaded" });
    const matched = page.locator(`.p3-provider-card[data-program='${program}']`);
    await expect(matched.locator("[data-preference-match]")).toBeVisible();
    await expect(matched.locator("[data-preference-popover]")).toBeHidden();
    await matched.locator("[data-preference-match]").focus();
    await matched.locator("[data-preference-match]").press("Enter");
    await expect(matched.locator("[data-preference-popover]")).toBeVisible();
    await screenshot(matched, `category-provider-card-${viewport.label}.png`);
    await expectNoHorizontalOverflow(page);

    await page.goto("/wegovy/", { waitUntil: "domcontentloaded" });
    const relatedProviders = page.locator("[data-related-provider-shelf]");
    await expect(relatedProviders).toBeVisible();
    await expect(relatedProviders.locator("a")).toHaveCount(3);
    await expect(relatedProviders.locator(".p3-provider-card, [data-coupon-copy], [data-preference-match]")).toHaveCount(0);
    const relatedInsights = page.locator("[data-related-insights-shelf]");
    await expect(relatedInsights).toBeVisible();
    await expect(relatedInsights.locator("a")).toHaveCount(4);
    await expect(relatedInsights.locator(".p3-provider-card, [data-coupon-copy], [data-preference-match]")).toHaveCount(0);
    await screenshot(relatedProviders, `related-shelf-links-${viewport.label}.png`);
    await expectNoHorizontalOverflow(page);
  }
});

test("comparison table serves desktop rows and collapses to labelled cards on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/guides/gala-vs-shed/", { waitUntil: "domcontentloaded" });
  const desktopTable = page.locator("table.cs-table--stack.cs-mobile-card-table");
  await expect(desktopTable).toHaveCount(1);
  const desktopState = await desktopTable.evaluate((table) => ({
    tableDisplay: getComputedStyle(table).display,
    headDisplay: getComputedStyle(table.tHead).display,
    rowDisplay: getComputedStyle(table.tBodies[0].rows[0]).display,
    cellDisplays: Array.from(table.tBodies[0].rows[0].cells).map((cell) => getComputedStyle(cell).display),
    labels: Array.from(table.tBodies[0].rows[0].cells).map((cell) => cell.dataset.label),
  }));
  expect(desktopState.tableDisplay).toBe("table");
  expect(desktopState.headDisplay).toBe("table-header-group");
  expect(desktopState.rowDisplay).toBe("table-row");
  expect(desktopState.cellDisplays.every((value) => value === "table-cell")).toBe(true);
  expect(desktopState.labels.every(Boolean)).toBe(true);
  await screenshot(desktopTable, "comparison-table-desktop-1440x900.png");
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const mobileTable = page.locator("table.cs-table--stack.cs-mobile-card-table");
  const mobileState = await mobileTable.evaluate((table) => {
    const row = table.tBodies[0].rows[0];
    const cells = Array.from(row.cells);
    const box = table.getBoundingClientRect();
    return {
      tableWidth: box.width,
      headPosition: getComputedStyle(table.tHead).position,
      headWidth: getComputedStyle(table.tHead).width,
      rowDisplay: getComputedStyle(row).display,
      cellDisplays: cells.map((cell) => getComputedStyle(cell).display),
      labels: cells.map((cell) => cell.dataset.label),
      beforeContent: cells.map((cell) => getComputedStyle(cell, "::before").content),
    };
  });
  expect(mobileState.tableWidth).toBeLessThanOrEqual(390);
  expect(mobileState.headPosition).toBe("absolute");
  expect(Number.parseFloat(mobileState.headWidth)).toBeLessThanOrEqual(1);
  expect(mobileState.rowDisplay).toBe("grid");
  expect(mobileState.cellDisplays[0]).toBe("block");
  expect(mobileState.cellDisplays.slice(1).every((value) => value === "grid")).toBe(true);
  expect(mobileState.labels.every(Boolean)).toBe(true);
  expect(mobileState.beforeContent.every((value) => value && value !== "none")).toBe(true);
  await screenshot(mobileTable, "comparison-table-mobile-390x844.png");
  await expectNoHorizontalOverflow(page);
});
