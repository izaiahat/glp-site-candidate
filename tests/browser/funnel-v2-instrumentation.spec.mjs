import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadGoSelection } from "../../src/go-runtime-selection.mjs";
import { governedProviderIds } from "./governed-cohort.mjs";
import { startDenyProxy } from "../../artifacts/ultracode/tools/qa-common.mjs";

const PAID_ROUTES = [
  "/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest",
  "/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest",
];
const ORGANIC_ROUTES = [
  "/providers/?sort=cheapest",
  "/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest",
  "/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest",
];
const ECONOMICS_BYTES = readFileSync(new URL("../../data/funnel-v2-economics.json", import.meta.url));
const R11 = JSON.parse(readFileSync(new URL("../../../../../../reports/ops/glp38-20260915/p19-rulings/R11-RESTORE.json", import.meta.url), "utf8"));
const ECONOMICS = JSON.parse(ECONOMICS_BYTES);
const PRICING = JSON.parse(readFileSync(new URL("../../data/provider-pricing-matrix.json", import.meta.url), "utf8"));
const PRICE_BY_ID = new Map(Object.values(PRICING.providers).map(row => [row.program_id, row]));
const ECONOMIC_ORDER = [...ECONOMICS.paid_search_provider_order].sort((left, right) =>
  right.network_epc_usd - left.network_epc_usd || left.program_id.localeCompare(right.program_id),
);
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function paidCohort(medication) {
  expect(R11).toMatchObject({ family: "R11", branch: "RESTORE", status: "APPROVED", allow_commercial_order: true, scope: "paid /lp/ funnel routes only" });
  expect(createHash("sha1").update(`blob ${ECONOMICS_BYTES.length}\0`).update(ECONOMICS_BYTES).digest("hex")).toBe(R11.economics_git_blob);
  expect(createHash("sha256").update(readFileSync(ECONOMICS.source.path)).digest("hex")).toBe(ECONOMICS.source.sha256);
  expect(ECONOMIC_ORDER.every(row => row.paid_search_allowed && row.tracking_ready && row.wired_live && Number.isFinite(row.network_epc_usd))).toBe(true);
  return ECONOMIC_ORDER.filter(row => (PRICE_BY_ID.get(row.program_id)?.medications || [])
    .some(price => price.medication_id === medication && (Object.hasOwn(price, "price_kind") || Number.isFinite(price.ongoing_usd))))
    .map(row => ({ program: row.program_id, rank: ECONOMIC_ORDER.indexOf(row) + 1, epc: row.network_epc_usd }));
}

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
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => card.getAttribute("data-provider-lazy-index")).toBeNull();
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

test("Funnel V2 /go click appends a UUIDv7 cs_click_id without leaving the candidate", async ({ browser }) => {
  const selected = Object.values(loadGoSelection().programs).find(row => row.disposition === 'ADOPT' && governedProviderIds().includes(row.render_id));
  expect(selected, 'A receipt-authorized /go positive control must exist').toBeTruthy();
  // Only glpclinicscout.com is mapped to the candidate snapshot; every other
  // CONNECT is denied. No synthetic consent/export or suppression override.
  const proxy = await startDenyProxy({ snapshotDirectory: new URL("../../public/", import.meta.url) });
  const context = await browser.newContext({
    proxy: { server: proxy.url }, ignoreHTTPSErrors: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  // Click identity must work during a locally simulated analytics-SDK outage.
  // This is not a live-ingest test and does not alter source consent gates.
  let locallyBlockedSdkRequests = 0;
  await context.route('https://us.i.posthog.com/static/array.js', route => {
    locallyBlockedSdkRequests += 1;
    return route.abort('blockedbyclient');
  });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
      localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
        analytics: "granted", advertising: "denied", record_type: "preference_only",
        version: "gcs-cookie-v4-distinct-purposes", analytics_basis: "explicit",
        notice_acknowledged: true, saved_at: new Date().toISOString(),
      }));
    });
    const page = await context.newPage();
    await page.route("**/api/geo-state**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }) }));
    const response = await page.goto("https://glpclinicscout.com/providers/?sort=cheapest", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await page.waitForFunction(() => Boolean(window.GCSConsent && window.GCSAnalytics));
    expect(await page.evaluate(() => ({ host: location.hostname, consent: window.GCSConsent.allowsExports("analytics"), policy: window.GCS_EXPORT_POLICY?.stage, suppressed: window.GCS_ANALYTICS_SUPPRESSED === true }))).toEqual({
      host: "glpclinicscout.com", consent: true, policy: "production-seal", suppressed: false,
    });
    const card = await canonicalCard(page, selected.render_id);
    const anchor = card.locator("[data-funnel-v2-go]");
    await expect(anchor).toHaveCount(1);
    await expect(anchor).toBeVisible();
    const rank = Number(await anchor.getAttribute("data-rank-position"));
    expect(Number.isSafeInteger(rank) && rank > 0).toBe(true);
    const slot = `providers.pc${rank}`;
    await expect(anchor).toHaveAttribute("data-subid", slot);
    await expect(anchor).toHaveAttribute("href", `${selected.route}?s=${slot}&v=a`);
    await page.evaluate(() => document.addEventListener("click", event => {
      if (event.target.closest("[data-funnel-v2-go]")) event.preventDefault();
    }, true));
    await anchor.click();
    const decorated = new URL(await anchor.getAttribute("href"), page.url());
    expect(decorated.pathname).toBe(selected.route);
    expect(decorated.searchParams.get("s")).toBe(slot);
    expect(decorated.searchParams.get("v")).toBe("a");
    expect(decorated.searchParams.get("cs_click_id")).toMatch(UUID_V7);
    expect(new URL(page.url()).pathname).toBe("/providers/");
    const stored = await page.evaluate(id => JSON.parse(localStorage.getItem(`cs_click_id:last:${id}`) || "null"), selected.program_id);
    expect(stored?.clickId).toBe(decorated.searchParams.get("cs_click_id"));
    expect(stored?.providerSlug).toBe(selected.program_id);
    expect(locallyBlockedSdkRequests).toBeGreaterThan(0);
    expect(proxy.mappedTunnels.length).toBeGreaterThan(0);
    expect(proxy.attempts, 'No external request may reach the proxy').toHaveLength(0);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("denied /go click retains the undecorated route and no click identity", async ({ browser }) => {
  const selected = Object.values(loadGoSelection().programs).find(row => row.disposition === 'ADOPT' && governedProviderIds().includes(row.render_id));
  expect(selected).toBeTruthy();
  const proxy = await startDenyProxy({ snapshotDirectory: new URL("../../public/", import.meta.url) });
  const context = await browser.newContext({
    proxy: { server: proxy.url }, ignoreHTTPSErrors: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
      localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
        analytics: "denied", advertising: "denied", record_type: "preference_only",
        version: "gcs-cookie-v4-distinct-purposes", analytics_basis: "explicit",
        notice_acknowledged: true, saved_at: new Date().toISOString(),
      }));
    });
    const page = await context.newPage();
    await page.route("**/api/geo-state**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }) }));
    const response = await page.goto("https://glpclinicscout.com/providers/?sort=cheapest", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await page.waitForFunction(() => Boolean(window.GCSConsent && window.GCSAnalytics));
    expect(await page.evaluate(() => ({ host: location.hostname, consent: window.GCSConsent.allowsExports("analytics"), policy: window.GCS_EXPORT_POLICY?.stage, suppressed: window.GCS_ANALYTICS_SUPPRESSED === true }))).toEqual({
      host: "glpclinicscout.com", consent: false, policy: "production-seal", suppressed: false,
    });
    const anchor = (await canonicalCard(page, selected.render_id)).locator("[data-funnel-v2-go]");
    await expect(anchor).toHaveCount(1);
    const issued = await anchor.getAttribute("href");
    await page.evaluate(() => document.addEventListener("click", event => {
      if (event.target.closest("[data-funnel-v2-go]")) event.preventDefault();
    }, true));
    await anchor.click();
    await expect(anchor).toHaveAttribute("href", issued);
    expect(await page.evaluate(id => localStorage.getItem(`cs_click_id:last:${id}`), selected.program_id)).toBeNull();
    expect(new URL(page.url()).pathname).toBe("/providers/");
    expect(proxy.mappedTunnels.length).toBeGreaterThan(0);
    expect(proxy.attempts, 'Denied consent must not attempt external exports').toHaveLength(0);
  } finally {
    await context.close();
    await proxy.close();
  }
});

test("approved direct promotion stays live without minting a held /go route", async ({ page }) => {
  const approval = JSON.parse(readFileSync(new URL('../../data/affiliate-wire-in-approvals.json', import.meta.url), 'utf8')).programs
    .find(row => row.existing_release_alias === 'measured');
  expect(approval.approval_state).toBe('approved_active');
  await page.goto("/providers/?sort=cheapest", { waitUntil: "networkidle" });
  const card = await canonicalCard(page, "measured");
  // The index card is a deferred evidence stub, not an authorized activation
  // surface. The issued destination lives on Measured's provider-detail page.
  await expect(card.locator("[data-card-review]")).toHaveAttribute("href", "/reviews/measured/");
  await page.goto("/providers/measured/", { waitUntil: "networkidle" });
  const direct = page.locator('.p3-hero-actions [data-link-mode="transparent-direct"][data-analytics-event="affiliate_click"]');
  await expect(direct).toHaveCount(1);
  await expect(direct).toBeVisible();
  await expect(direct).toHaveAttribute("data-link-mode", "transparent-direct");
  await expect(direct).toHaveAttribute("rel", /(?:^|\s)sponsored(?:\s|$)/);
  await expect(direct).toHaveAttribute("href", approval.tracking.provider_issued_url);
  await expect(page.locator('a[href*="/go/measured"]')).toHaveCount(0);
});

test("editorial paid routes load one responsive Funnel V2 presentation with accessible paper-card colors", async ({ page }) => {
  const { acceptPresentationRetirement } = await import("./p19-acceptance-support.mjs");
  await acceptPresentationRetirement(page, test.info());
});

test("R14 rejects a white kicker over an opaque white aurora", async ({ page }) => {
  const { acceptPresentationRetirement } = await import("./p19-acceptance-support.mjs");
  const navigate = page.goto.bind(page);
  page.goto = async (...args) => {
    const response = await navigate(...args);
    await page.addStyleTag({ content: '#provider-results .p3-card-aurora{background:#fff!important;opacity:1!important} #provider-results .p3-card-header > .gcs-kicker{color:#fff!important;background-color:#fff!important}' });
    return response;
  };
  await expect(acceptPresentationRetirement(page, test.info())).rejects.toThrow(/kicker.*contrast/);
});

test("responsive paid cohort counts each provider once and preserves sourced ranks and visible CTA positions", async ({ page }) => {
  await page.goto("/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest", { waitUntil: "networkidle" });
  const expected = paidCohort("compounded-semaglutide-injection");
  expect(expected.length).toBeGreaterThanOrEqual(3);
  const funnel = page.locator("[data-funnel-v2]");
  await expect(funnel).toHaveCount(1);
  await expect(funnel.locator("[data-funnel-v2-count]")).toHaveText(`${expected.length} commercially ordered providers match this treatment evidence.`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const actual = await funnel.locator(".fv2-table-shell [data-funnel-v2-provider]").evaluateAll(rows => rows.map(row => ({
      program: row.dataset.program, rank: Number(row.dataset.economicRank), epc: Number(row.dataset.economicEpc),
      ctaRank: Number(row.querySelector('[data-analytics-event="affiliate_click"]')?.dataset.rankPosition),
    })));
    expect(actual).toEqual(expected.map((row, index) => ({ ...row, ctaRank: index + 1 })));
    expect(new Set(actual.map(row => row.program)).size).toBe(expected.length);
  }

  await page.goto("/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest", { waitUntil: "networkidle" });
  await expect(page.locator("[data-funnel-v2], [data-economic-rank], [data-economic-epc]")).toHaveCount(0);
  await expect(page.locator("main.listing")).not.toContainText(/commercially ordered|earnings per outbound click|earning the most per measured outbound click|\bEPC\b/i);
});
