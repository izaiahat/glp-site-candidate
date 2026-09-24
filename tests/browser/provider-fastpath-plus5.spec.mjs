import { expect, test } from "@playwright/test";
import { calculatorProviderIds } from "./round3-source-expectations.mjs";
import { loadGoSelection } from "../../src/go-runtime-selection.mjs";

const routes = [
  ["mademed", "MadeMed"],
  ["telos-rx", "telos rx"],
  ["live-vital-launch", "Live Vital"],
  ["strut-health", "Strut Health"],
  ["trt-nation", "TRT Nation"],
];
test("five PASS-2 editorial review routes preserve their active attributed partner actions", async ({ page }) => {
  for (const [slug, provider] of routes) {
    const response = await page.goto(`/reviews/${slug}/`);
    expect(response?.status(), slug).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-release", "release-ready");
    await expect(page.locator("html")).toHaveAttribute("data-link-dark", "false");
    await expect(page.locator("h1")).toContainText(provider);
    await expect(page.locator('[data-affiliate-state="active"]')).toHaveCount(1);
    await expect(page.locator('[data-affiliate-state="held"]')).toHaveCount(0);
    await expect(page.locator('[data-link-mode="transparent-direct"]')).toHaveCount(1);
    await expect(page.locator('a[href^="/go/"]')).toHaveCount(0);
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
