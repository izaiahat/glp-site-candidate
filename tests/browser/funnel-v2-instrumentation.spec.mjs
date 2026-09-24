import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const PAID_ROUTES = [
  "/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest",
  "/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest",
];
const ORGANIC_ROUTES = [
  "/providers/?sort=cheapest",
  "/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest",
  "/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest",
];
const ECONOMICS = JSON.parse(readFileSync(new URL("../../data/funnel-v2-economics.json", import.meta.url), "utf8"));
const ECONOMIC_ORDER = [...ECONOMICS.paid_search_provider_order].sort((left, right) =>
  right.network_epc_usd - left.network_epc_usd || left.program_id.localeCompare(right.program_id),
);
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function suppressThirdParty(page) {
  await page.addInitScript(() => localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
    analytics: "denied",
    advertising: "denied",
    record_type: "preference_only",
    version: "gcs-cookie-v4-distinct-purposes",
    saved_at: "2026-08-29T00:00:00.000Z",
  })));
  await page.route(/https?:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) =>
    route.fulfill({ status: 204, contentType: "application/javascript", body: "" }),
  );
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
}

async function canonicalCard(page, program) {
  const grid = page.locator("#provider-results > [data-phase3-provider-grid]");
  await expect(grid).toBeVisible();
  const card = grid.locator(`[data-phase3-provider][data-program="${program}"]`);
  const more = page.locator("[data-provider-load-more]");
  while (!(await card.isVisible()) && await more.isVisible()) {
    const before = await grid.locator("[data-phase3-provider]:visible").count();
    await more.click();
    await expect.poll(() => grid.locator("[data-phase3-provider]:visible").count()).toBeGreaterThan(before);
  }
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  return card;
}

test.beforeEach(async ({ page }) => suppressThirdParty(page));

for (const route of ORGANIC_ROUTES) {
  test(`organic route excludes paid economic ordering on ${route}`, async ({ page }) => {
    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const listing = page.locator("main.listing");
    await expect(listing).toBeVisible();
    await expect(listing.locator("[data-phase3-provider]:visible").first()).toBeVisible();
    await expect(listing.locator("[data-funnel-v2], [data-economic-rank], [data-economic-epc]")).toHaveCount(0);
  });
}

for (const route of PAID_ROUTES) {
  test(`Funnel V2 preserves economics order and disclosure on ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1050 });
    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);

    const funnel = page.locator("[data-funnel-v2]").first();
    await expect(funnel).toBeVisible();
    await expect(funnel.locator("[data-funnel-v2-disclosure]")).toHaveCount(1);
    await expect(funnel.locator("[data-funnel-v2-disclosure]")).toBeVisible();
    await expect(funnel.locator("[data-funnel-v2-disclosure]")).toHaveText(ECONOMICS.public_disclosure);
    const readback = await funnel.evaluate((root) => {
      const visible = (node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return !node.hidden && style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      };
      const rows = [...root.querySelectorAll(".fv2-table-shell [data-funnel-v2-provider]")].filter(visible);
      const ranks = rows.map((row) => Number(row.dataset.economicRank));
      const disclosure = root.querySelector("[data-funnel-v2-disclosure]");
      return {
        ranks,
        programs: rows.map((row) => row.dataset.program),
        epcs: rows.map((row) => Number(row.dataset.economicEpc)),
        disclosureAfterRows: Boolean(disclosure && rows.length && rows.every((row) => row.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING)),
        inventedRatingText: /best provider|#1 provider|★/i.test(root.textContent || ""),
      };
    });

    expect(readback.ranks.length).toBeGreaterThan(0);
    expect(readback.ranks).toEqual([...readback.ranks].sort((left, right) => left - right));
    expect(new Set(readback.programs).size).toBe(readback.programs.length);
    for (const [index, program] of readback.programs.entries()) {
      const rank = ECONOMIC_ORDER.findIndex((row) => row.program_id === program);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(ECONOMIC_ORDER[rank]).toMatchObject({ paid_search_allowed: true, tracking_ready: true, wired_live: true });
      expect(Number.isFinite(ECONOMIC_ORDER[rank].network_epc_usd)).toBe(true);
      expect(readback.ranks[index]).toBe(rank + 1);
      expect(readback.epcs[index]).toBe(ECONOMIC_ORDER[rank].network_epc_usd);
    }
    expect(readback.disclosureAfterRows).toBe(true);
    expect(readback.inventedRatingText).toBe(false);
  });
}

test("Funnel V2 /go click appends a UUIDv7 cs_click_id without leaving the candidate", async ({ page }) => {
  await page.goto("/providers/?sort=cheapest", { waitUntil: "networkidle" });
  const card = await canonicalCard(page, "wellmedr-review");
  const anchor = card.locator("[data-funnel-v2-go]");
  await expect(anchor).toHaveCount(1);
  await expect(anchor).toBeVisible();
  const rank = Number(await anchor.getAttribute("data-rank-position"));
  expect(Number.isSafeInteger(rank) && rank > 0).toBe(true);
  const slot = `providers.pc${rank}`;
  await expect(anchor).toHaveAttribute("data-subid", slot);
  await expect(anchor).toHaveAttribute("href", `/go/wellmedr-review?s=${slot}&v=a`);

  await page.evaluate(() => {
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-funnel-v2-go]")) event.preventDefault();
    }, true);
  });
  await anchor.click();

  const decorated = new URL(await anchor.getAttribute("href"), page.url());
  expect(decorated.pathname).toBe("/go/wellmedr-review");
  expect(decorated.searchParams.get("s")).toBe(slot);
  expect(decorated.searchParams.get("v")).toBe("a");
  expect(decorated.searchParams.get("cs_click_id")).toMatch(UUID_V7);
  expect(new URL(page.url()).pathname).toBe("/providers/");

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cs_click_id:last:wellmedr-review") || "null"));
  expect(stored?.clickId).toBe(decorated.searchParams.get("cs_click_id"));
});

test("transparent-direct terms exception stays explicit and never emits a dead /go route", async ({ page }) => {
  await page.goto("/providers/?sort=cheapest", { waitUntil: "networkidle" });
  const card = await canonicalCard(page, "sprout-health");
  const sprout = card.locator('[data-transparent-direct-terms="true"]');
  await expect(sprout).toHaveCount(1);
  await expect(sprout).toBeVisible();
  await expect(sprout).toHaveAttribute("data-link-mode", "transparent-direct");
  await expect(sprout).toHaveAttribute("rel", /(?:^|\s)sponsored(?:\s|$)/);
  await expect(sprout).not.toHaveAttribute("href", /\/go\/sprout-health/);
  await expect(page.locator('a[href*="/go/sprout-health"]')).toHaveCount(0);
});

test("editorial paid routes load one responsive Funnel V2 presentation with accessible paper-card colors", async ({ page }) => {
  const { acceptPresentationRetirement } = await import("./p19-acceptance-support.mjs");
  await acceptPresentationRetirement(page, test.info());
});

test("responsive duplicate markup counts each matching provider once and keeps both CTA presentations on the same visible rank", async ({ page }) => {
  await page.goto("/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest", { waitUntil: "networkidle" });
  const funnel = page.locator("[data-funnel-v2]").first();
  await expect(funnel.locator("[data-funnel-v2-count]")).toHaveText("5 commercially ordered providers match this treatment evidence.");
  await expect(funnel.locator('.fv2-table-shell [data-program="wellmedr-review"] [data-funnel-v2-go]')).toHaveAttribute("data-rank-position", "1");
  await expect(funnel.locator('.fv2-mobile-list [data-program="wellmedr-review"] [data-funnel-v2-go]')).toHaveAttribute("data-rank-position", "1");

  await page.goto("/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest", { waitUntil: "networkidle" });
  const filtered = page.locator("[data-funnel-v2]").first();
  await expect(filtered.locator("[data-funnel-v2-count]")).toHaveText("1 commercially ordered provider match this treatment evidence.");
  await expect(filtered.locator('.fv2-table-shell [data-program="bodybuilding-com-glp-1-longevity-review"] [data-funnel-v2-go]')).toHaveAttribute("data-rank-position", "1");
  await expect(filtered.locator('.fv2-mobile-list [data-program="bodybuilding-com-glp-1-longevity-review"] [data-funnel-v2-go]')).toHaveAttribute("data-rank-position", "1");
});
