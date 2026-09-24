import { test, expect } from "@playwright/test";

const route = "/guides/wegovy-pills-oral-semaglutide-cost/";
const title = "Wegovy Pills Cost in 2026: Oral Semaglutide Prices, Doses & Savings";
const sourceUrls = new Set([
  "https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/215256s029lbl.pdf",
  "https://www.wegovy.com/obesity/what-to-pay-for-wegovy.html",
  "https://www.wegovy.com/obesity/is-wegovy-right-for-me/wegovy-pill-results.html",
]);

for (const width of [1280, 390]) {
  test(`Wegovy pills guide is indexable, source-bound, and provider-CTA-free at ${width}px`, async ({ page }) => {
    const requests = [];
    const errors = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const response = await page.goto(route, { waitUntil: "load" });
    await expect(page.locator("h1")).toBeVisible();
    expect(response?.status()).toBe(200);
    expect(errors).toEqual([]);
    await expect(page).toHaveTitle(title);
    await expect(page.locator("h1")).toHaveText(title);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index,follow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://glpclinicscout.com${route}`);
    const capture = page.locator('main form[action="/api/content-upgrade"]');
    await expect(capture).toHaveCount(1);
    await expect(capture).toBeVisible();
    // O-28: submission is the consent event; the visible notice is mandatory.
    await expect(capture.locator('input[type="checkbox"][name="email_consent"], input[type="checkbox"][name="marketing_consent"], input[type="checkbox"][name="privacy_consent"], input[type="checkbox"][name="subscribe_consent"]')).toHaveCount(0);
    await expect(capture).toHaveAttribute("method", "post");
    await expect(capture).toHaveAttribute("data-content-upgrade-form-inline", "");
    await expect(capture.locator('input[type="hidden"][name="consent_version"]')).toHaveValue("glp-content-upgrade-v2-20260801");
    await expect(capture.locator('input[type="email"][name="email"]')).toHaveAttribute("required", "");
    await expect(capture.locator('input[type="email"][name="email"]')).toHaveAttribute("maxlength", "254");
    const notice = capture.locator(".capture-consent-note");
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText("By submitting your email, you agree to receive this resource and occasional provider-comparison research under the Privacy Policy. Unsubscribe anytime.");
    await expect(notice.locator("a")).toHaveAttribute("href", "/privacy/");
    await expect(notice.locator("a")).toHaveText("Privacy Policy");
    await expect(capture.locator('button[type="submit"]')).toHaveText("Email me the source-checked guide");
    await expect(page.locator("main .guide-next-card, main .guide-next-step, main .cta.affiliate")).toHaveCount(0);
    await expect(page.locator('main a[href^="/go/"], main a[href^="/best/"], main a[href^="/quiz/"], main a[href^="/tools/glp-1-cost-calculator/"]')).toHaveCount(0);
    await expect(page.locator("main .related-guides a")).toHaveCount(3);
    const external = await page.locator('main a[href^="https://"]').evaluateAll((nodes) => nodes.map((node) => node.href));
    const canonical = `https://glpclinicscout.com${route}`;
    const encodedUrl = encodeURIComponent(canonical);
    const encodedTitle = encodeURIComponent(title);
    const expectedExternal = new Set([
      ...sourceUrls,
      `https://x.com/intent/post?url=${encodedUrl}`,
      `https://x.com/intent/post?url=${encodedUrl}&text=${encodedTitle}`,
    ]);
    expect(new Set(external)).toEqual(expectedExternal);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(3);
    const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.flatMap((node) => {
      const parsed = JSON.parse(node.textContent);
      return parsed["@graph"] || [parsed];
    }));
    const types = new Set(schemas.map((node) => node["@type"]));
    expect(types.has("Article")).toBe(true);
    expect(types.has("BreadcrumbList")).toBe(true);
    expect(types.has("FAQPage")).toBe(true);
    expect(types.has("Organization")).toBe(true);
    expect(types.has("MedicalWebPage")).toBe(false);
    await expect(page.locator("body")).not.toContainText(/DRAFT|BRIDGE REVIEW|DO NOT PUBLISH|Medically reviewed by/i);
    const brokenImages = await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((image) => image.decode().catch(() => null)));
      return images.filter((image) => !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1).map((image) => image.src);
    });
    expect(brokenImages).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const allowedRequestHosts = new Set(["127.0.0.1", "localhost", "www.googletagmanager.com", "www.google-analytics.com"]);
    const disallowedRequests = requests.filter((url) => /^https?:/i.test(url) && !allowedRequestHosts.has(new URL(url).hostname));
    expect(disallowedRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
