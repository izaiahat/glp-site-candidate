import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedTrackingHost, trackingNetworkIdentity } from "../../src/tracking-allowed-hosts.mjs";

// Operator directive 2026-07-30: every affiliate CTA must be genuinely tappable on
// mobile and desktop — no fixed overlay (exit-capture trigger, sticky bar, consent
// banner) may intercept the tap at any scroll position. Pure hit-testing: zero real
// affiliate clicks are fired by this spec.
const publicRoot = fileURLToPath(new URL("../../public/", import.meta.url));
function discoverAffiliatePages(root) {
  const routes = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile() && entry.name === "index.html" && readFileSync(path, "utf8").includes('data-analytics-event="affiliate_click"')) {
        const route = `/${relative(publicRoot, dirname(path)).split(sep).join("/")}/`;
        routes.push(route);
      }
    }
  };
  visit(root);
  return routes;
}
const PAGES = [...discoverAffiliatePages(join(publicRoot, "best")), ...discoverAffiliatePages(join(publicRoot, "reviews"))].sort();
if (!PAGES.includes("/reviews/gala-health/") || !PAGES.includes("/reviews/oak-weight-loss-program/")) {
  throw new Error(`Required Gala/Oak review routes missing from affiliate discovery: ${JSON.stringify(PAGES)}`);
}
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

// Fable ruling 2026-09-17, Correction to §2(a): the producer has exactly TWO authorised
// affiliate CTA shapes and the fixture must accept exactly those, keyed by the anchor's own
// data-link-mode (src/provider-review.mjs:238 emits the attribute and chooses the href):
//   server-redirect    -> the selected /go route (src/go-render-selection.mjs selectedGoOutbound)
//   transparent-direct -> an https href on an allowed host for THAT program
//                         (src/provider-review.mjs:223-238; the allowlist is the build's own
//                          derived document, read here through isAllowedTrackingHost)
// Both shapes must carry the rel token set (sponsored + nofollow + noopener, any order) and the
// analytics marker. An affiliate anchor with no data-link-mode, or a mode outside the two, FAILS:
// the mode is what selects the rail, so an unlabelled link is an unguarded one.
const PAID_LINK_MODES = new Set(["server-redirect", "transparent-direct"]);

async function expectPaidRail(anchor) {
  await expect(anchor, "PAID_SPONSORED").toHaveAttribute("rel", /(?:^|\s)sponsored(?:\s|$)/i);
  await expect(anchor, "PAID_NOFOLLOW").toHaveAttribute("rel", /(?:^|\s)nofollow(?:\s|$)/i);
  await expect(anchor, "PAID_NOOPENER").toHaveAttribute("rel", /(?:^|\s)noopener(?:\s|$)/i);
  await expect(anchor, "PAID_EVENT").toHaveAttribute("data-analytics-event", "affiliate_click");
  const mode = await anchor.getAttribute("data-link-mode");
  const href = await anchor.getAttribute("href");
  expect(PAID_LINK_MODES.has(mode ?? ""),
    `PAID_LINK_MODE: ${JSON.stringify(mode)} on href ${JSON.stringify(href)} is not one of ${[...PAID_LINK_MODES].join(" | ")}`).toBeTruthy();
  if (mode === "server-redirect") {
    expect(href, "PAID_RAIL_GO").toMatch(/^\/go\/[a-z0-9][a-z0-9-]*(?:\?[^#\s]*)?$/);
    const program = await anchor.getAttribute("data-program");
    await expect(anchor, "PAID_RAIL_GO_NETWORK").toHaveAttribute("data-network", trackingNetworkIdentity(program));
    return;
  }
  const program = await anchor.getAttribute("data-program");
  const network = await anchor.getAttribute("data-network");
  const url = new URL(href ?? "", "https://link-mode-transparent-direct.invalid");
  expect(url.protocol, `PAID_RAIL_DIRECT_PROTOCOL: ${href}`).toBe("https:");
  expect(isAllowedTrackingHost(program, network, url.hostname),
    `PAID_RAIL_DIRECT_HOST: ${url.hostname} is not an allowed tracking host for program ${program} on network ${network}`).toBeTruthy();
}

for (const vp of VIEWPORTS) {
  for (const path of PAGES) {
    test(`affiliate CTAs tappable · ${vp.name} · ${path}`, async ({ page }, testInfo) => {
      const pageOrigin = new URL(path, testInfo.project.use.baseURL).origin;
      const externalCompleted = [];
      const externalIntercepted = [];
      page.on("requestfinished", (request) => {
        const url = new URL(request.url());
        if (["http:", "https:"].includes(url.protocol) && url.origin !== pageOrigin) externalCompleted.push(request.url());
      });
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (["http:", "https:"].includes(url.protocol) && url.origin !== pageOrigin) {
          externalIntercepted.push(route.request().url());
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(path, { waitUntil: "networkidle" });
      // dismiss the consent banner if present so it cannot shadow CTAs mid-test
      const consentOk = page.locator('[data-consent="denied"], [data-consent-accept], [data-consent-ok]').first();
      if (await consentOk.isVisible().catch(() => false)) await consentOk.click();
      const anchors = page.locator('a[data-analytics-event="affiliate_click"], a[href^="/go/"], a[rel~="sponsored"]');
      const count = await anchors.count();
      expect(count).toBeGreaterThan(0);
      let visibleCount = 0;
      for (let i = 0; i < count; i++) {
        const anchor = anchors.nth(i);
        await expectPaidRail(anchor);
        if (await anchor.evaluate((element) => Boolean(element.closest('.sticky, .exit-capture')))) continue;
        if (!(await anchor.isVisible())) continue;
        visibleCount += 1;
        const probe = async (placement) => {
          await anchor.evaluate((element, targetPlacement) => {
            element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
            if (targetPlacement === "bottom") {
              const rect = element.getBoundingClientRect();
              const desiredTop = Math.max(8, innerHeight - Math.min(rect.height, innerHeight / 3) - 16);
              scrollBy({ top: rect.top - desiredTop, behavior: "instant" });
            }
          }, placement);
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const result = await anchor.evaluate((element) => {
            const rects = [...element.getClientRects()]
              .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth)
              .map((rect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
            const hits = rects.flatMap((rect) => {
              const visibleLeft = Math.max(0, rect.left);
              const visibleRight = Math.min(innerWidth, rect.left + rect.width);
              const visibleTop = Math.max(0, rect.top);
              const visibleBottom = Math.min(innerHeight, rect.top + rect.height);
              return [0.1, 0.3, 0.5, 0.7, 0.9].map((fraction) => {
                const x = visibleLeft + (visibleRight - visibleLeft) * fraction;
                const y = (visibleTop + visibleBottom) / 2;
                const hit = document.elementFromPoint(x, y);
                return { x, y, tag: hit?.tagName || null, tappable: Boolean(hit && (hit === element || element.contains(hit))) };
              });
            });
            return { href: element.href, rects, hits };
          });
          expect(result.rects.length, `CTA ${i} on ${path} (${vp.name}) has no visible client rect at ${placement}`).toBeGreaterThan(0);
          expect(result.hits.every((hit) => hit.tappable), `CTA ${i} on ${path} (${vp.name}) is intercepted at ${placement}: ${JSON.stringify(result)}`).toBeTruthy();
        };
        await probe("center");
        await probe("bottom");
      }
      expect(visibleCount, `${path} (${vp.name}) has no visible affiliate CTA`).toBeGreaterThan(0);
      const stickyAnchors = page.locator('.sticky a[data-analytics-event="affiliate_click"], .sticky a[href^="/go/"], .sticky a[rel~="sponsored"]');
      if (path.startsWith('/best/')) expect(await stickyAnchors.count(), `${path} missing sticky affiliate CTA`).toBeGreaterThan(0);
      if (vp.name === "mobile" && (await stickyAnchors.count()) > 0) {
        await page.locator('#methodology').first().scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const sticky = stickyAnchors.first();
        await expectPaidRail(sticky);
        expect(await sticky.isVisible(), `${path} mobile sticky CTA not visible at safe methodology position`).toBeTruthy();
        expect(await sticky.evaluate((element) => element.closest('.sticky')?.inert), `${path} mobile sticky CTA incorrectly suppressed at safe position`).toBeFalsy();
        const stickyHit = await sticky.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { tag: hit?.tagName || null, tappable: Boolean(hit && (hit === element || element.contains(hit))) };
        });
        expect(stickyHit.tappable, `${path} mobile sticky CTA is not tappable at safe position: ${JSON.stringify(stickyHit)}`).toBeTruthy();
      }
      expect(externalCompleted, `${path} (${vp.name}) completed cross-origin requests: ${JSON.stringify(externalCompleted)}`).toEqual([]);
      expect(externalIntercepted.every((url) => new URL(url).origin !== pageOrigin)).toBeTruthy();
    });
  }
}
