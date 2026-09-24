import { test, expect } from "@playwright/test";

const ROUTE = "/tools/glp-1-savings-offer-monitor/";

test("manufacturer offer candidate exposes exact current lanes with no action or runtime surface", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push({ url: request.url(), type: request.resourceType() }));
  await page.goto(ROUTE, { waitUntil: "networkidle" });

  await expect(page.locator("h1")).toContainText("Current manufacturer savings terms");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow,noarchive,nosnippet");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://glpclinicscout.com/tools/glp-1-savings-offer-monitor/");
  await expect(page.locator("article[data-offer-id]")).toHaveCount(4);

  const covered = page.locator('[data-offer-id="wegovy-commercial-covered-2026"]');
  await expect(covered).toContainText("$25");
  await expect(covered).toContainText("Maximum stated savings: $100 per month");
  await expect(covered).toContainText("commercial non-government insurance");
  await expect(covered).toContainText("not eligible through government insurance");

  const dosePricing = page.locator('[data-offer-id="wegovy-self-pay-dose-pricing-2026"]');
  await expect(dosePricing).toContainText("Formulation: dose form not stated in the accepted capture");
  await expect(dosePricing).toContainText("Doses: 1.5 mg, 4 mg");
  await expect(dosePricing).toContainText("$149 per month — Wegovy 4 mg");
  await expect(dosePricing).toContainText("$199 per month — Wegovy 4 mg");
  await expect(dosePricing).not.toContainText(/tablet|reimburse(?:ment|d|able)?|insurance[- ]limit/i);

  const newPatient = page.locator('[data-offer-id="wegovy-new-patient-two-fill-2026"]');
  await expect(newPatient).toContainText("new to the Wegovy Savings offer or NovoCare Pharmacy");
  await expect(newPatient).toContainText("maximum during the offer period 2 monthly fills");
  await expect(newPatient).toContainText("$349 per month");
  await expect(newPatient).toContainText("Wegovy HD 7.2 mg after the offer");
  await expect(newPatient).toContainText("$399 per month");

  const zepbound = page.locator('[data-offer-id="zepbound-commercially-uncovered-single-dose-pen-2026"]');
  await expect(zepbound).toContainText("Formulation: single-dose pen");
  await expect(zepbound).toContainText("commercial drug insurance that does not cover Zepbound single-dose pen");
  await expect(zepbound).toContainText("$499 as low as");
  await expect(zepbound).toContainText("maximum of up to 11 prescription fills per calendar year");
  await expect(zepbound).toContainText("December 31, 2026");

  await expect(page.locator("[data-source-reference]")).toHaveCount(4);
  await expect(page.locator("[data-exact-source-quote]")).toHaveCount(4);
  await expect(page.locator("a, form, script, iframe, button, input, select, textarea")).toHaveCount(0);
  await expect(page.locator('link[rel="stylesheet"], link[rel="preconnect"], link[rel="dns-prefetch"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/go/"], a[href*="checkout"], a[href*="buy.stripe.com"]')).toHaveCount(0);

  const html = await page.content();
  expect(html).not.toMatch(/googletagmanager|google-analytics|clarity\.ms|GCS_ANALYTICS|\/api\/|checkout|enrollment/i);
  expect(requests).toHaveLength(1);
  expect(requests[0].type).toBe("document");
  expect(new URL(requests[0].url).pathname).toBe(ROUTE);
});
