import { expect, test } from "@playwright/test";
import { calculatorProviderIds } from "./round3-source-expectations.mjs";
import { loadAffiliateLinkMap } from "../../src/affiliate-link-map.mjs";
import { loadGoSelection, loadGoPromotionAuthority } from "../../src/go-runtime-selection.mjs";
// C03: the current receipt-backed GO selection supersedes the 202608 direct-only
// surface. Derive expectations from authority, never the rendered CTA.
const goSelection = Object.values(loadGoSelection().programs);
const promotion = loadGoPromotionAuthority().programs;

const expectedProviderIds = calculatorProviderIds;
const expectedLinks = loadAffiliateLinkMap("calculator");
const expectedAffiliateUrls = new Set(Object.values(expectedLinks).filter((link) => link.live).map((link) => link.affiliate_href));

test("every calculator program computes and every authority-backed offer preserves exact attribution without provider navigation", async ({ page }) => {
  const providerRequests = [];
  page.on("request", (request) => {
    if (expectedAffiliateUrls.has(request.url())) providerRequests.push(request.url());
  });
  await page.goto("/tools/glp-1-cost-calculator/");
  const programIds = await page.locator("#provider option:not([value=''])").evaluateAll((options) => options.map((option) => option.value));
  expect([...programIds].sort()).toEqual(expectedProviderIds);

  for (const programId of programIds) {
    await page.locator("#provider").selectOption(programId);
    await expect(page.locator("#cost-affiliate-offer")).toBeHidden();
    if (await page.locator("#first-base").inputValue() === "") {
      if (await page.locator("#first-base").getAttribute("readonly") !== null) await page.locator("#edit-prices").click();
      await page.locator("#first-base").fill("1");
      await page.locator("#recurring-base").fill("1");
    }
    await page.getByRole("button", { name: "Calculate estimate" }).click();
    const panel = page.locator("#cost-affiliate-offer");
    const cta = panel.locator('a[data-analytics-event="affiliate_click"]');
    const authority = expectedLinks[programId];
    if (authority?.live && authority.affiliate_href) {
      await expect(panel).toBeVisible();
      await expect(cta).toHaveCount(1);
      await expect(cta).toHaveAttribute("data-program", programId);
      const selected = goSelection.find(row => row.render_id === programId || row.program_id === programId);
      const go = selected?.disposition === 'ADOPT' && selected.status === 'VERIFIED'
        && promotion[selected.program_id]?.promotion_authorized === true;
      await expect(cta).toHaveAttribute("data-link-mode", go ? "server-redirect" : "transparent-direct");
      await expect(cta).toHaveAttribute("data-subid", go ? 'calculator.pc1' : `calculator-${programId}-result-202608`);
      await expect(cta).toHaveAttribute("href", go ? `${selected.route}?s=calculator.pc1&v=a` : authority.affiliate_href);
      expect(new Set((await cta.getAttribute("rel")).split(/\s+/))).toEqual(new Set(["sponsored", "nofollow", "noopener"]));
      await expect(cta).toHaveText(`Start with ${authority.merchant} →`);
      await expect(panel.locator(".cost-affiliate-disclosure")).toContainText("at no extra cost to you");
    } else {
      await expect(panel).toBeHidden();
      await expect(cta).toHaveCount(0);
    }
    expect(providerRequests).toEqual([]);
  }
});
