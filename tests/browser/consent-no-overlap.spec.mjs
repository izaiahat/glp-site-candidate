// Build gate — no fixed overlay may sit on a money CTA (SPEC-CRO P0-1 / B-03).
//
// The teardown screenshots caught the consent banner covering the #1 TOP MATCH
// card's action row on quiz results, the intro on the comparison page, and the
// "Bottom line" verdict card on review pages. This asserts the fix at the two
// breakpoints the spec names, on one page of every money template, with a fresh
// storage state so the banner is actually rendered.

import { expect, test } from "@playwright/test";
import { onRequestGet as resolveConsentRegion } from "../../functions/api/geo-state.js";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/geo-state?purpose=consent", async (route) => {
    const response = await resolveConsentRegion({ request: new Request(route.request().url(), { headers: { "cf-ipcountry": "US" } }) });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
});

async function assertDefaultNotice(page) {
  await expect(page.locator("#gcs-consent")).toBeVisible();
  await expect(page.locator("#gcs-consent input")).toHaveCount(0);
  await expect(page.locator("#gcs-consent button")).toHaveCount(1);
  await expect(page.locator('[data-consent="acknowledge"]')).toHaveText("Got it");
  expect(await page.evaluate(() => window.GCSConsent.read())).toMatchObject({
    analytics: "granted", advertising: "granted", record_type: "preference_only", analytics_basis: "global_default", notice_acknowledged: false,
  });
}

const ROUTES = [
  "/",
  "/best/online-glp-1-providers/",
  "/cost/online-glp-1-programs/",
  "/quiz/provider-fit/",
  "/reviews/orderlymeds/",
  "/glp-1-price-index/",
  "/tools/glp-1-cost-calculator/",
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`no fixed overlay covers a money CTA at ${viewport.name} on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route, { waitUntil: "load" });
      await assertDefaultNotice(page);
      // Fable design pass 2026-08-20: the toast now rises in at 800ms, so a 400ms
      // wait would measure a banner the check itself discards as invisible
      // (opacity 0) and pass without testing anything. Wait for the settled state.
      await page.waitForTimeout(1500);
      const collisions = await page.evaluate(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
            && Number(style.opacity) > 0.01 && !element.hasAttribute("aria-hidden") && !element.inert;
        };
        const overlays = [...document.querySelectorAll("body *")].filter((element) => {
          const position = getComputedStyle(element).position;
          return (position === "fixed" || position === "sticky") && visible(element);
        });
        const targets = [...document.querySelectorAll('.cta, [data-top-match], a[data-analytics-event="affiliate_click"]')].filter(visible);
        const hits = (a, b) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
        const findings = [];
        for (const overlay of overlays) {
          const overlayRect = overlay.getBoundingClientRect();
          for (const target of targets) {
            if (overlay.contains(target) || target.contains(overlay)) continue;
            if (hits(overlayRect, target.getBoundingClientRect())) {
              findings.push(`${overlay.id || overlay.className || overlay.tagName} covers ${target.className || target.tagName} "${(target.textContent || "").trim().slice(0, 40)}"`);
            }
          }
        }
        return findings;
      });
      expect(collisions, collisions.join(" | ")).toEqual([]);
    });
  }
}

// Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #1): the old
// collision-avoidance chain re-placed the banner on every scroll event and
// could flip it between fixed corners and an in-flow top bar mid-scroll —
// 0.296 CLS per hop on mobile, measured 0.24-0.59 window CLS on the money
// pages. The remediated runtime positions the toast ONCE (fixed; bottom-right
// desktop via 02-shell, bottom full-width mobile) and never moves it again.
// This asserts that stability: during a scripted scroll the banner must stay
// `position:fixed`, keep its class, keep its viewport rect, and contribute
// ZERO layout-shift entries. Consent semantics are asserted elsewhere
// (analytics-truth/analytics-hermetic) and are untouched.
for (const viewport of VIEWPORTS) {
  for (const route of ["/ozempic/", "/tools/glp-1-cost-calculator/"]) {
    test(`consent banner placement is scroll-stable at ${viewport.name} on ${route}`, async ({ page, browserName, isMobile }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        window.__consentShift = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            const banner = document.getElementById("gcs-consent");
            if (!banner) continue;
            if ((entry.sources || []).some((source) => source.node && (source.node === banner || banner.contains(source.node)))) {
              window.__consentShift += entry.value;
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(route, { waitUntil: "load" });
      await assertDefaultNotice(page);
      await page.waitForTimeout(1500); // banner rise completes at ~1.3s
      const before = await page.evaluate(() => {
        const banner = document.getElementById("gcs-consent");
        const rect = banner.getBoundingClientRect();
        return { className: banner.className, position: getComputedStyle(banner).position, top: Math.round(rect.top), left: Math.round(rect.left), inFlowFirstChild: document.body.firstElementChild === banner };
      });
      expect(before.position).toBe("fixed");
      expect(before.inFlowFirstChild).toBe(false);
      const beforeScrollY = await page.evaluate(() => window.scrollY);
      for (let tick = 0; tick < 10; tick += 1) {
        if (browserName === "webkit" && isMobile) {
          await page.evaluate(() => window.scrollBy({ top: 420, behavior: "instant" }));
        } else {
          await page.mouse.wheel(0, 420);
        }
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => window.scrollY), "scroll fixture did not move the document").toBeGreaterThan(beforeScrollY);
      const after = await page.evaluate(() => {
        const banner = document.getElementById("gcs-consent");
        const rect = banner.getBoundingClientRect();
        return { className: banner.className, position: getComputedStyle(banner).position, top: Math.round(rect.top), left: Math.round(rect.left), inFlowFirstChild: document.body.firstElementChild === banner, consentShift: window.__consentShift };
      });
      expect(after.position).toBe("fixed");
      expect(after.className).toBe(before.className);
      expect(after.inFlowFirstChild).toBe(false);
      expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
      expect(after.consentShift).toBe(0);
    });
  }
}
