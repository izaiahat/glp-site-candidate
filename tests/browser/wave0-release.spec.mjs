import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadAffiliateLinkMap } from "../../src/affiliate-link-map.mjs";

const dataRoot = new URL("../../data/", import.meta.url);
const moneySpecs = JSON.parse(readFileSync(new URL("money-page-specs.json", dataRoot), "utf8"));
const selection = JSON.parse(readFileSync(new URL("affiliate-activation-selection.json", dataRoot), "utf8"));
const moneyRoutes = moneySpecs.pages.map((page) => page.path);
const reviewRoutes = selection.programs.map((program) => `/reviews/${program.program_id}/`);
const routes = [
  ...moneyRoutes.map((route) => ({ kind: "money", route })),
  ...reviewRoutes.map((route) => ({ kind: "review", route })),
];
const allowedTrackingHosts = new Set(["compare", "cost", "review"].flatMap((surface) =>
  Object.values(loadAffiliateLinkMap(surface)).filter((link) => link.live && link.affiliate_href).map((link) => new URL(link.affiliate_href).hostname)));
const forbidden = [
  "held until operator go-live",
  "no live route",
  "link-dark",
  "noindex in staging",
  "release-held",
  "addendum a",
  "batch 6 ledger",
  "substantiation worksheet cell",
  "supporting material matrix cell",
  "held gates",
  "staging preview",
  "held staging",
  "legal draft",
  "counsel review required",
  "production operator gate",
  "release receipt",
  "provider-sharing gate",
  "email delivery remains held",
  "after links are activated",
];

for (const width of [1280, 390]) {
  test(`Wave 0 affiliate surface is production-safe at ${width}px`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const spec of routes) {
      const pageErrors = [];
      page.removeAllListeners("pageerror");
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      const response = await page.goto(spec.route, { waitUntil: "networkidle" });
      expect(response?.status(), spec.route).toBe(200);
      expect(pageErrors, spec.route).toEqual([]);

      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots, spec.route).toContain("index");
      expect(robots, spec.route).not.toContain("noindex");
      await expect(page.locator(".gcs-utility"), spec.route).toHaveCount(0);
      const disclosure = page.locator(".affiliate-note").first();
      await expect(disclosure, spec.route).toBeVisible();
      await expect(disclosure, spec.route).toContainText(/may earn a commission.*never changes a score/i);
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical, spec.route).toHaveCount(1);
      await expect(canonical, spec.route).toHaveAttribute("href", `https://glpclinicscout.com${spec.route}`);
      await expect(page.locator('a[href^="/go/"]'), spec.route).toHaveCount(0);
      await expect(page.locator(".cta.affiliate.disabled"), spec.route).toHaveCount(0);

      const bodyText = (await page.locator("body").innerText()).toLowerCase();
      for (const phrase of forbidden) expect(bodyText, `${spec.route}: ${phrase}`).not.toContain(phrase);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, spec.route).toBeLessThanOrEqual(1);
      const brokenImages = await page.locator("img").evaluateAll(async (images) => {
        for (const image of images) image.loading = "eager";
        await Promise.all(images.map((image) => image.decode().catch(() => null)));
        return images
          .filter((image) => !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1)
          .map((image) => image.getAttribute("src"));
      });
      expect(brokenImages, spec.route).toEqual([]);

      const direct = page.locator('a[data-link-mode="transparent-direct"]');
      expect(await direct.count(), spec.route).toBeGreaterThan(0);
      for (const anchor of await direct.evaluateAll((nodes) => nodes.map((node) => ({
        host: new URL(node.href).hostname,
        rel: node.rel,
        event: node.dataset.analyticsEvent,
        subid: node.dataset.subid,
      })))) {
        expect(allowedTrackingHosts, spec.route).toContain(anchor.host);
        expect(anchor.rel, spec.route).toContain("sponsored");
        expect(anchor.rel, spec.route).toContain("nofollow");
        expect(anchor.event, spec.route).toBe("affiliate_click");
        expect(anchor.subid, spec.route).toMatch(/^[a-z0-9-]+-(?:intro|pros|pricing|conclusion)-\d{6}$/);
      }

      if (spec.kind === "review") {
        const cta = direct.first();
        await expect(cta, spec.route).toBeVisible();
        const style = await cta.evaluate((element) => {
          const computed = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return { background: computed.backgroundColor, color: computed.color, height: rect.height };
        });
        expect(style.background, spec.route).not.toBe("rgba(0, 0, 0, 0)");
        expect(style.color, spec.route).not.toBe(style.background);
        expect(style.height, spec.route).toBeGreaterThanOrEqual(44);
      }
    }

    await page.goto(moneyRoutes[0], { waitUntil: "networkidle" });
    const captureForms = page.locator("[data-content-upgrade-form-inline], [data-content-upgrade-form]");
    await expect(captureForms).toHaveCount(2);
    await expect(captureForms.locator('input[name="email_consent"][type="checkbox"]')).toHaveCount(2);
    await expect(captureForms.locator('input[name="privacy_consent"], input[name="marketing_consent"]')).toHaveCount(0);
  });
}
