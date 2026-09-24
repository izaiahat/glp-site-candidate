import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const routes = [
  "/guides/tirzepatide-cost/",
  "/reviews/advanced-trichology/",
  "/reviews/lyfefuel-us/",
  "/reviews/mademed/",
  "/reviews/paternity-lab/",
  "/reviews/telos-rx/",
];
const retiredRoutes = new Set([
  "/reviews/advanced-trichology/",
  "/reviews/lyfefuel-us/",
  "/reviews/paternity-lab/",
]);
const redirects = readFileSync(new URL("../../public/_redirects", import.meta.url), "utf8");

for (const route of routes) {
  test(`capture idempotence or explicit retirement is preserved · ${route}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (retiredRoutes.has(route)) {
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      const initialRequest = response.request().redirectedFrom();
      expect(initialRequest, "retired review must traverse its real 301").toBeTruthy();
      expect(new URL(initialRequest.url()).pathname).toBe(route);
      expect(initialRequest.redirectedFrom()).toBeNull();
      const initialResponse = await initialRequest.response();
      expect(initialResponse?.status()).toBe(301);
      const destination = new URL(initialResponse.headers().location, initialRequest.url());
      expect(destination.origin).toBe(new URL(initialRequest.url()).origin);
      expect(destination.pathname).toBe("/providers/");
      expect(destination.search).toBe("");
      expect(destination.hash).toBe("");
      // The providers index normalises its own default filters into the query string after load
      // (history.replaceState); the redirect target itself is asserted above with an empty search.
      expect(new URL(page.url()).pathname).toBe(destination.pathname);
      // The retired URL itself must serve no capture surface: its only response is the 301 with no HTML body.
      expect((initialResponse.headers()["content-type"] || "").startsWith("text/html")).toBe(false);
      expect((await initialResponse.text().catch(() => "")).includes("/api/content-upgrade")).toBe(false);
      expect(redirects).toContain(`${route} /providers/ 301`);
      expect(errors).toEqual([]);
      return;
    }
    await page.route("**/api/content-upgrade", (request) => request.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "CAPTURED_SENDS_HELD" }) }));
    await page.goto(route, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.__captureEvents = [];
      window.GCSAnalytics = { event: (name, params) => window.__captureEvents.push({ name, params }) };
    });
    const form = page.locator('form[action="/api/content-upgrade"]').first();
    await expect(form).toBeVisible();
    await form.locator('input[name="email"]').fill("reader@example.test");
    await expect(form.locator('input[type="checkbox"][name="email_consent"], input[type="checkbox"][name="marketing_consent"], input[type="checkbox"][name="privacy_consent"], input[type="checkbox"][name="subscribe_consent"]')).toHaveCount(0);
    await expect(form.locator(".capture-consent-note")).toBeVisible();
    await expect(form.locator(".capture-consent-note")).toHaveText("By submitting your email, you agree to receive this resource and occasional provider-comparison research under the Privacy Policy. Unsubscribe anytime.");
    await expect(form.locator('a[href="/privacy/"]')).toBeVisible();
    await expect(form.locator('input[name="consent_version"]')).toHaveValue("glp-content-upgrade-v2-20260801");
    await form.locator('button[type="submit"]').click();
    await expect(form.locator(".capture-status")).toHaveText("Saved — email delivery is not active yet.");
    const names = await page.evaluate(() => window.__captureEvents.map((event) => event.name));
    expect(names.filter((name) => name === "content_upgrade_submit")).toHaveLength(1);
    expect(names.filter((name) => name === "content_upgrade_success")).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
