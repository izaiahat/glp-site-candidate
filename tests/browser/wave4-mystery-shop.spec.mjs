import { test, expect } from "@playwright/test";

const ROUTE = "/research/public-funnel-evidence/";

test("public-funnel evidence is self-canonical, link-dark, and explicitly public-only", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push({ url: request.url(), resourceType: request.resourceType() }));
  await page.goto(ROUTE, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toContainText("Public-page evidence audit—not mystery shopping or a patient review");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow,noarchive,nosnippet");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://glpclinicscout.com/research/public-funnel-evidence/");
  await expect(page.locator("article[data-observation]")).toHaveCount(3);
  await expect(page.locator("[data-source-reference]")).toHaveCount(4);
  await expect(page.locator("a, form, script, img, iframe, video, audio, source, object, embed")).toHaveCount(0);
  await expect(page.locator('link:not([rel="canonical"])')).toHaveCount(0);
  await expect(page.locator("body")).toContainText("NOT_APPLICABLE_NO_PII_COLLECTED_OR_STORED");
  await expect(page.locator("body")).toContainText("$74 $25/first month");
  await expect(page.locator("body")).toContainText("Then, $74/month. GLP-1 meds cost not included");
  const html = await page.content();
  expect(html).not.toMatch(/\/go\/|AggregateRating|ReviewRating|"@type"\s*:\s*"Review"|GCS_ANALYTICS|analytics\.js|\/api\//i);
  expect(requests).toEqual([{
    url: new URL(ROUTE, page.url()).href,
    resourceType: "document",
  }]);
});

test("all seven prohibited activity flags are represented as zero in the visible boundary", async ({ page }) => {
  await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
  const text = await page.locator("body").innerText();
  for (const boundary of [
    "No staff contact",
    "form submission",
    "account creation",
    "impersonation",
    "clinical questionnaire",
    "payment",
    "patient experience",
  ]) expect(text).toContain(boundary);
});
