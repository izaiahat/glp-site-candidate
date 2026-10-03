import { expect, test } from "@playwright/test";
import { calculatorProviderIds } from "./round3-source-expectations.mjs";
import { loadGoSelection } from "../../src/go-runtime-selection.mjs";
import { readFileSync } from "node:fs";

const contracts = JSON.parse(readFileSync(new URL("../../data/provider-page-contracts.json", import.meta.url), "utf8")).providers;
const fastpath = JSON.parse(readFileSync(new URL("../../data/provider-fastpath-contract.json", import.meta.url), "utf8")).providers;

const routes = [
  ["mademed", "MadeMed", "transparent-direct"],
  ["live-vital-launch", "Live Vital", "transparent-direct"],
  ["strut-health", "Strut Health", "transparent-direct"],
  ["trt-nation", "TRT Nation", "server-redirect"],
];
// data/telos-research-hold-receipt.json: Telos retains its review, not an active link.
test("four active PASS-2 editorial review routes preserve their attributed partner actions; Telos stays held", async ({ page }) => {
  for (const [slug, provider, linkMode] of routes) {
    const response = await page.goto(`/reviews/${slug}/`);
    expect(response?.status(), slug).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-release", "release-ready");
    await expect(page.locator("html")).toHaveAttribute("data-link-dark", "false");
    await expect(page.locator("h1")).toContainText(provider);
    await expect(page.locator('[data-affiliate-state="active"]')).toHaveCount(1);
    await expect(page.locator('[data-affiliate-state="held"]')).toHaveCount(0);
    await expect(page.locator(`[data-link-mode="${linkMode}"]`)).toHaveCount(1);
    await expect(page.locator('a[href^="/go/"]')).toHaveCount(linkMode === "server-redirect" ? 1 : 0);
    const contract = contracts.find((row) => row.program_id === slug);
    expect(contract, `source review contract ${slug}`).toBeTruthy();
    expect(contract.row_contract.live_link_allowed).toBe(true);
    expect(contract.row_contract.promotion_authorized).toBe(true);
    const selected = Object.values(loadGoSelection()?.programs || {}).find((row) => row.render_id === slug && row.disposition === "ADOPT");
    const expectedHref = selected ? `${selected.route}?s=reviews.rv2&v=a` : contract.network_contract.tracking_url;
    const activation = fastpath.find((row) => row.program_id === slug);
    expect(activation, `source activation ${slug}`).toBeTruthy();
    const expectedSubid = selected ? 'reviews.rv2' : new RegExp(`^review-${slug}-conclusion-20\\d{4}$`);
    const action = page.locator(`main a[data-affiliate-state="active"][data-program="${slug}"]`);
    await expect(action).toHaveCount(1);
    await expect(action).toHaveAttribute('href', expectedHref);
    await expect(action).toHaveAttribute('data-link-mode', linkMode);
    await expect(action).toHaveAttribute('data-subid', expectedSubid);
    await expect(action).toHaveAttribute('data-analytics-event', 'affiliate_click');
    await expect(action).toHaveAttribute('data-merchant', contract.display_name);
    await expect(action).toHaveAttribute('data-page-slug', `review-${slug}`);
    await expect(action).toHaveAttribute('data-page-type', 'review');
    await expect(action).toHaveAttribute('data-provider-slug', contract.row_contract.review_slug || slug);
    await expect(action).toHaveAttribute('data-sub1', '1R');
    await expect(action).toHaveAttribute('data-sub2', `review-${slug}`);
    await expect(action).toHaveAttribute('data-link-position', 'conclusion');
    await expect(action).toHaveAttribute('data-variant', 'a');
    await expect(action).not.toHaveAttribute('target', '_blank');
    expect(new Set((await action.getAttribute('rel')).split(/\s+/))).toEqual(new Set(['sponsored', 'nofollow', 'noopener']));
    await expect(page.locator(".citation a").first()).toBeVisible();
    const citationTarget = await page.locator(".citation a").first().getAttribute("href");
    expect(citationTarget).toMatch(/^#source-[1-9]/);
    await expect(page.locator(citationTarget)).toBeVisible();
    await expect(page.locator(".score")).toContainText(/^\d+(?:\.\d+)?\/10/);
    const logo = page.locator(".review-logo img");
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((image) => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })), slug).toMatchObject({ complete: true });
    expect((await logo.evaluate((image) => image.naturalWidth)), slug).toBeGreaterThan(0);
  }
  await page.goto("/reviews/telos-rx/");
  await expect(page.locator("h1")).toContainText(/telos rx/i);
  await expect(page.locator("html")).toHaveAttribute("data-link-dark", "true");
  await expect(page.locator('main [data-affiliate-state="held"]')).toHaveCount(1);
  await expect(page.locator('main [data-affiliate-state="held"]')).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#affiliate-status")).toContainText(/Affiliate program paused/);
  await expect(page.locator(".citation a").first()).toBeVisible();
  await expect(page.locator(".review-logo img")).toBeVisible();
  await expect(page.locator('[data-affiliate-state="active"], [data-link-mode="transparent-direct"], a[href^="/go/"]')).toHaveCount(0);
  await expect(page.locator('main a[href^="https://track.revoffers.com/"], main a[href^="https://www.tkqlhce.com/"]')).toHaveCount(0);
});

test("Live Vital, Strut, and TRT provider-specific evidence and live attribution are preserved", async ({ page }) => {
  await page.goto("/reviews/live-vital-launch/");
  await expect(page.locator("#affiliate-status")).toContainText("one active affiliate link");

  await page.goto("/reviews/strut-health/");
  await expect(page.locator("#regulatory-warning")).toContainText("FDA warning-letter context");
  const order = await page.locator("main").evaluate((main) => ({ warning: main.innerHTML.indexOf("regulatory-warning"), affiliate: main.innerHTML.indexOf('data-affiliate-state="active"') }));
  expect(order.warning).toBeGreaterThanOrEqual(0);
  expect(order.affiliate).toBeGreaterThan(order.warning);

  await page.goto("/reviews/trt-nation/");
  await expect(page.locator("#affiliate-status")).toContainText("one active affiliate link");
  const selected = Object.values(loadGoSelection()?.programs || {})
    .filter((program) => program.render_id === "trt-nation");
  expect(selected).toHaveLength(1);
  expect(selected[0].disposition).toBe("ADOPT");
  expect(selected[0].issued_link).toMatch(/^https:\/\/www\.tkqlhce\.com\/click-101822575-17115008/);
  const trt = page.locator('a[data-program="trt-nation"]');
  await expect(trt).toHaveCount(1);
  await expect(trt).toHaveAttribute("href", `${selected[0].route}?s=reviews.rv2&v=a`);
  await expect(trt).toHaveAttribute("data-link-mode", "server-redirect");
  await expect(trt).toHaveAttribute("data-subid", "reviews.rv2");
  await expect(trt).toHaveAttribute("data-analytics-event", "affiliate_click");
  expect(new Set((await trt.getAttribute("rel")).split(/\s+/))).toEqual(new Set(["sponsored", "nofollow", "noopener"]));
});

test("calculator keeps retired Synergy out and includes exactly the current cash-eligible providers", async ({ page }) => {
  await page.goto("/tools/glp-1-cost-calculator/");
  const optionValues = await page.locator("#provider option").evaluateAll((options) => options.map((option) => option.value));
  expect(optionValues).not.toContain("synergy-rx");
  expect(optionValues.filter(Boolean).sort()).toEqual(calculatorProviderIds);
});
