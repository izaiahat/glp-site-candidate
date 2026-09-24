import { test, expect } from "@playwright/test";

const ROUTE = "/tools/glp-1-price-tracker/";
const CANONICAL = `https://glpclinicscout.com${ROUTE}`;
const PRICE_SOURCE_HOSTS = ["ro.co", "www.weightwatchers.com", "lifemd.com", "plushcare.com"];

test("price tracker is self-canonical, link-dark, noindex/nofollow, and plain-source only", async ({ page }) => {
  const sitemapResponse = await page.request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBe(true);
  expect(await sitemapResponse.text()).not.toContain(ROUTE);
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("Track published GLP-1 program prices without missing key terms.");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow,noarchive");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", CANONICAL);
  await expect(page.locator("table tbody tr")).toHaveCount(4);
  await expect(page.locator("[data-source-reference]")).toHaveCount(4);
  await expect(page.locator("a, form, script")).toHaveCount(0);
  await expect(page.locator('[href^="/go/"]')).toHaveCount(0);
  const sources = await page.locator("[data-source-reference]").allTextContents();
  expect(sources.map((value) => new URL(value.trim()).hostname)).toEqual(PRICE_SOURCE_HOSTS);
  expect(await page.locator("body").innerText()).not.toMatch(/Mochi|personalized estimate|email address/i);
});

test("price tracker loads no analytics, provider, or shared runtime requests", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push({ url: request.url(), type: request.resourceType() }));
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe(ROUTE);
  expect(requests[0].type).toBe("document");
  expect(JSON.stringify(requests)).not.toMatch(/googletagmanager|google-analytics|clarity|analytics\.js|consent\.js|site\.js|ro\.co|weightwatchers|lifemd|plushcare/i);
  await expect(page.locator('link[rel="stylesheet"], script[src], img[src], iframe[src]')).toHaveCount(0);
});
