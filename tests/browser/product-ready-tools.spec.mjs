import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadAffiliateLinkMap } from "../../src/affiliate-link-map.mjs";

const pricingMatrix = JSON.parse(readFileSync(new URL("../../data/provider-pricing-matrix.json", import.meta.url), "utf8"));
const enhanceSemaglutide = pricingMatrix.providers["enhance-md"].medications
  .find((medication) => medication.medication_id === "compounded-semaglutide-injection");
const calculatorLinks = loadAffiliateLinkMap("calculator");
const manualProvider = Object.values(pricingMatrix.providers)
  .find((provider) => provider.medications.length === 0 && calculatorLinks[provider.program_id]?.live);

for (const width of [1280, 390]) {
  test(`cost calculator computes and restores a shareable estimate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const providerRequests = [];
    page.on("request", (request) => {
      if (/https:\/\/(?:track\.revoffers\.com|www\.awin1\.com)\//.test(request.url())) providerRequests.push(request.url());
    });
    await page.goto("/tools/glp-1-cost-calculator/");
    await expect(page.locator("h1")).toHaveText("What will your GLP‑1 program really cost?");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index,follow/);
    await expect(page.locator("html")).toHaveAttribute("data-release", "release-ready");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await page.locator("#provider").selectOption("enhance-md");
    await expect(page.locator("#first-base")).toHaveValue("112");
    await expect(page.locator("#recurring-base")).toHaveValue("212");
    await expect(page.locator("#cost-checked")).toHaveText(enhanceSemaglutide.captured_on);
    await page.locator("#edit-prices").click();
  await page.locator("#one-time").fill("15");
    await page.locator("#add-ons").fill("20");
    await page.locator("#discount").fill("10");
    await page.locator("#months").fill("3");
    await page.getByRole("button", { name: "Calculate estimate" }).click();

    await expect(page.locator("#cost-result")).toBeVisible();
    await expect(page.locator("#result-first")).toHaveText("$137");
    await expect(page.locator("#result-recurring")).toHaveText("$222");
    await expect(page.locator("#result-period")).toHaveText("$581");
    await expect(page).toHaveURL(/provider=enhance-md.*first=112.*recurring=212.*months=3/);
    const affiliateOffer = page.locator("#cost-affiliate-offer");
    await expect(affiliateOffer).toBeVisible();
    const affiliateCta = affiliateOffer.locator('a[data-analytics-event="affiliate_click"]');
    await expect(affiliateCta).toHaveCount(1);
    await expect(affiliateCta).toHaveText("Start with Enhance.MD →");
    await expect(affiliateCta).toHaveAttribute("href", /^https:\/\/track\.revoffers\.com\//);
    await expect(affiliateCta).toHaveAttribute("data-program", "enhance-md");
    await expect(affiliateCta).toHaveAttribute("data-link-mode", "transparent-direct");
    await expect(affiliateCta).toHaveAttribute("data-subid", "calculator-enhance-md-result-202608");
    expect(new Set((await affiliateCta.getAttribute("rel")).split(/\s+/))).toEqual(new Set(["sponsored", "nofollow", "noopener"]));
    await expect(affiliateOffer.locator(".cost-affiliate-disclosure")).toContainText("may earn a commission");
    const offerGeometry = await affiliateOffer.evaluate((panel) => {
      const link = panel.querySelector("a");
      const panelBox = panel.getBoundingClientRect();
      const linkBox = link.getBoundingClientRect();
      return { panelLeft: panelBox.left, panelRight: panelBox.right, linkLeft: linkBox.left, linkRight: linkBox.right, linkHeight: linkBox.height };
    });
    expect(offerGeometry.linkLeft).toBeGreaterThanOrEqual(offerGeometry.panelLeft);
    expect(offerGeometry.linkRight).toBeLessThanOrEqual(offerGeometry.panelRight + 1);
    expect(offerGeometry.linkHeight).toBeGreaterThanOrEqual(44);
    expect(providerRequests).toEqual([]);
    const shareable = page.url();

    await page.goto(shareable);
    await expect(page.locator("#cost-result")).toBeVisible();
    await expect(page.locator("#result-period")).toHaveText("$581");
    await expect(page.locator("#cost-source-link")).toHaveAttribute("href", /^https:\/\//);
    await expect(page.locator('#cost-affiliate-offer a[data-program="enhance-md"]')).toHaveAttribute("data-subid", "calculator-enhance-md-result-202608");
    const capture = page.locator('form[action="/api/content-upgrade"]');
    await expect(capture).toHaveCount(1);
    let submitted;
    await page.route("**/api/content-upgrade", async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "CAPTURED", send: "sent" }) });
    });
    await capture.locator('input[name="email"]').fill("reader@example.test");
    await capture.getByRole("button", { name: "Email me this cost breakdown" }).click();
    await expect(capture.locator(".capture-status")).toHaveText("Done — your cost breakdown was emailed.");
    expect(submitted).toMatchObject({
      lead_magnet_key: "tools-glp-1-cost-calculator-cost-breakdown",
      cost_provider_id: "enhance-md",
      cost_first_month_usd: "137",
      cost_recurring_month_usd: "222",
      cost_months: "3",
      cost_total_usd: "581",
      cost_checked_as_of: enhanceSemaglutide.captured_on
    });
    await page.locator("#provider").selectOption(manualProvider.program_id);
    await expect(page.locator("#cost-affiliate-offer")).toBeHidden();
    await expect(page.locator("#cost-affiliate-offer a")).toHaveCount(0);
    await expect(page.locator("#first-base")).toHaveValue("");
    await expect(page.locator("#recurring-base")).toHaveValue("");
    await expect(page.locator("#cost-evidence-gap")).toBeVisible();
    await page.locator("#first-base").fill("249");
    await page.locator("#recurring-base").fill("299");
    await page.getByRole("button", { name: "Calculate estimate" }).click();
    const manualCta = page.locator(`#cost-affiliate-offer a[data-program="${manualProvider.program_id}"]`);
    await expect(manualCta).toHaveText(`Start with ${calculatorLinks[manualProvider.program_id].merchant} →`);
    await expect(manualCta).toHaveAttribute("href", calculatorLinks[manualProvider.program_id].affiliate_href);
    await expect(manualCta).toHaveAttribute("data-subid", `calculator-${manualProvider.program_id}-result-202608`);
    expect(providerRequests).toEqual([]);
  });
}

test("published GLP guide exposes the approved compact internal conversion paths", async ({ page }) => {
  await page.goto("/guides/what-is-glp-1/");
  const approvedCards = page.locator(".guide-next-card");
  await expect(approvedCards).toHaveCount(2);
  await expect(approvedCards.locator('a[href^="/tools/glp-1-cost-calculator/"]').first()).toBeVisible();
  await expect(approvedCards.locator('a[href^="/providers/?sort=cheapest"]').first()).toBeVisible();
  await expect(approvedCards.locator('a[href^="/quiz/provider-fit/"]').first()).toBeVisible();
  const legacyCards = page.locator(".guide-next-step");
  await expect(legacyCards).toHaveCount(2);
  await expect(legacyCards.first()).toBeHidden();
  await expect(page.locator('form[action="/api/content-upgrade"]')).toHaveCount(1);
});

const captureGuideRoutes = [
  "/guides/found-vs-trimi-insurance-self-pay/",
  "/guides/gala-vs-shed/",
  "/guides/glp-1-insurance-support-vs-coverage/",
  "/guides/trimi-vs-yourera/",
];

test("guide comparisons expose one low-friction inline capture surface", async ({ page }) => {
  for (const route of captureGuideRoutes) {
    await page.goto(route);
    const form = page.locator('form[action="/api/content-upgrade"]');
    await expect(form, route).toHaveCount(1);
    await expect(form.locator('input[type="checkbox"]'), route).toHaveCount(0);
    await expect(form.locator('input[name="email_consent"]'), route).toHaveCount(0);
    await expect(page.locator("#content-upgrade-capture, [data-exit-open], [data-exit-close]"), route).toHaveCount(0);
    await expect(form.locator('input[name="privacy_consent"], input[name="marketing_consent"]'), route).toHaveCount(0);
  }
});

test("guide capture surfaces never request the endpoint before explicit submission", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => {
    if (/\/api\/content-upgrade(?:\?|$)/.test(request.url())) requests.push({ method: request.method(), url: request.url(), body: request.postData() });
  });
  for (const route of captureGuideRoutes) {
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page.locator('form[action="/api/content-upgrade"]'), route).toHaveCount(1);
  }
  expect(requests).toEqual([]);
});

test("inline guide capture renders without bypassing analytics consent", async ({ page }) => {
  await page.addInitScript(() => { window.dataLayer = []; });
  await page.goto("/guides/what-is-glp-1/", { waitUntil: "networkidle" });
  await expect(page.locator('form[action="/api/content-upgrade"]')).toBeVisible();
  const queued = await page.evaluate(() => window.dataLayer.filter((event) => event?.event === "content_upgrade_view"));
  expect(queued).toEqual([]);
});
