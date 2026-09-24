import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadAffiliateLinkMap } from "../../src/affiliate-link-map.mjs";

const dataRoot = new URL("../../data/", import.meta.url);
const builtBlog = JSON.parse(readFileSync(new URL("../../artifacts/ops/blog-system.json", import.meta.url), "utf8")).articles;
const selection = JSON.parse(readFileSync(new URL("affiliate-activation-selection.json", dataRoot), "utf8"));

const consolidatedGuideRoutes = new Map([
  ["/guides/cheapest-glp1/", "/providers/"],
  ["/guides/compare-online-glp-1-provider-fees/", "/providers/"],
  ["/guides/glp-1-program-total-cost-comparison/", "/providers/"],
  ["/guides/healthrx-vs-agelessrx/", "/providers/"],
  ["/guides/wellorithm-vs-enhance-md/", "/providers/"],
]);
const guideRoutes = [...new Set([...builtBlog.map((article) => article.canonical_path), ...consolidatedGuideRoutes.keys()])];
const articleIndexability = new Map(builtBlog.map((article) => [article.canonical_path, !article.noindex]));
const workerProgramIds = new Set(JSON.parse(readFileSync(new URL("../../artifacts/ops/worker-manifest.staging.json", import.meta.url), "utf8"))
  .programs.map((program) => program.program_id));
const frozenMounjaroCouponGoIds = ["healthrx", "oak-weight-loss-program", "serena-health", "trimi-glp-1", "yourera-program"];
const reviewRoutes = selection.programs.map((program) => `/reviews/${program.program_id}/`);
const authorRoutes = [
  { route: "/authors/izaiah-tilton/", schema: "Person" },
  { route: "/authors/clinic-scout-editorial-team/", schema: "Organization" },
];
const forbidden = /held until operator go-live|no live route|link-dark|noindex in staging|release-held|addendum a|batch 6 ledger|substantiation worksheet|supporting material matrix|staging preview|production operator gate|release receipt/i;
const grammarDefects = /\b(?:a|the|this|that|these|those|another|your|our)\s+(?:requires?|means?|entails?|provides?|includes?|involves?|needs?|uses?|offers?|covers?)\s+verify\b|\b(?:helps?|lets?|allows?)\s+(?:you|readers?|people|patients?|members?)\s+compare\s+the\s+verify\b|\bverify\s+(?:requirements?|steps?|details?)\s+(?:depends?|varies?|changes?)\b/i;
const reviewTrackingHosts = new Set(["compare", "cost", "review"].flatMap((surface) =>
  Object.values(loadAffiliateLinkMap(surface))
    .filter((link) => link.live && link.affiliate_href)
    .map((link) => new URL(link.affiliate_href).hostname)));

async function assertCommon(page, route, indexable) {
  const pageErrors = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), route).toBe(200);
  const expectedRoute = consolidatedGuideRoutes.get(route) || route;
  const predecessor = response.request().redirectedFrom();
  if (consolidatedGuideRoutes.has(route)) {
    expect(predecessor, route).not.toBeNull();
    expect(predecessor.redirectedFrom(), route).toBeNull();
    expect(new URL(predecessor.url()).pathname, route).toBe(route);
    expect(new URL(page.url()).origin, route).toBe(new URL(predecessor.url()).origin);
    const redirect = await predecessor.response();
    expect(redirect?.status(), route).toBe(301);
    expect(await redirect.headerValue("location"), route).toBe(new URL(expectedRoute, predecessor.url()).href);
  } else {
    expect(predecessor, route).toBeNull();
  }
  expect(new URL(page.url()).pathname, route).toBe(expectedRoute);
  expect(pageErrors, route).toEqual([]);
  await expect(page.locator("h1"), route).toBeVisible();
  await expect(page.locator("main"), route).toBeVisible();
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  if (consolidatedGuideRoutes.has(route) || indexable) {
    expect(robots, route).toMatch(/^index,follow/i);
  } else {
    expect(robots, route).toContain("noindex");
  }
  const canonical = page.locator('link[rel="canonical"]');
  await expect(canonical, route).toHaveCount(1);
  await expect(canonical, route).toHaveAttribute("href", `https://glpclinicscout.com${expectedRoute}`);
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, route).not.toMatch(forbidden);
  expect(bodyText, route).not.toMatch(grammarDefects);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, route).toBeLessThanOrEqual(1);
  const brokenImages = await page.locator("img").evaluateAll(async (images) => {
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
    return images
      .filter((image) => !image.complete || image.naturalWidth < 1 || image.naturalHeight < 1)
      .map((image) => image.getAttribute("src"));
  });
  expect(brokenImages, route).toEqual([]);
  const imageAttributeFailures = await page.locator("img").evaluateAll((images) => images
    .filter((image) => !image.hasAttribute("alt") || !image.hasAttribute("width") || !image.hasAttribute("height"))
    .map((image) => image.getAttribute("src")));
  expect(imageAttributeFailures, route).toEqual([]);
}

for (const width of [1280, 390]) {
  test(`Wave 1 content and authors are usable at ${width}px`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const visitedConsolidations = new Set();
    for (const route of guideRoutes) {
      await assertCommon(page, route, articleIndexability.get(route));
      if (consolidatedGuideRoutes.has(route)) {
        visitedConsolidations.add(route);
        const listing = page.locator('main[data-listing-archetype="E"][data-phase3-route="/providers/"]');
        await expect(listing, route).toBeVisible();
        await expect(listing.locator('[data-phase3-provider-grid]'), route).toBeVisible();
        expect(await listing.locator('[data-phase3-provider-grid] > [data-phase3-provider]:visible').count(), route).toBeGreaterThan(0);
      } else {
        const headings = page.locator("main h2");
        const headingTexts = (await headings.allTextContents()).map((heading) => heading.trim());
        expect(headingTexts.length, route).toBeGreaterThanOrEqual(6);
        expect(headingTexts.length, route).toBeLessThanOrEqual(24);
        expect(headingTexts.every(Boolean), route).toBe(true);
        const headingIds = (await headings.evaluateAll((nodes) => nodes.map((node) => node.id).filter(Boolean)));
        expect(new Set(headingIds).size, route).toBe(headingIds.length);
        await expect(page.locator("#verified-claims"), route).toHaveCount(1);
        await expect(page.locator(".guide-sources"), route).toHaveCount(1);
        await expect(page.locator('.guide-hero a[href^="/authors/"]'), route).toHaveCount(1);
        const goAnchors = page.locator('a[href^="/go/"]');
        if (route === "/guides/mounjaro-coupon/") {
          const actualGoIds = (await goAnchors.evaluateAll((anchors) => anchors.map((anchor) => new URL(anchor.href).pathname.split("/")[2]))).sort();
          expect(actualGoIds, route).toEqual(frozenMounjaroCouponGoIds);
          expect(actualGoIds.every((programId) => workerProgramIds.has(programId)), route).toBe(true);
          for (const anchor of await goAnchors.all()) {
            const closedDisclosure = anchor.locator("xpath=ancestor::details[not(@open)]").last();
            if (await closedDisclosure.count()) {
              const summary = closedDisclosure.locator(":scope > summary");
              await summary.focus();
              await summary.press("Enter");
              await expect(closedDisclosure, route).toHaveAttribute("open", "");
            }
            await expect(anchor, route).toBeVisible();
          }
        } else {
          await expect(goAnchors, route).toHaveCount(0);
        }
      }
      const schemaText = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
      expect(schemaText, route).not.toMatch(/AggregateRating|"@type"\s*:\s*"Review"|"(?:ratingCount|reviewCount)"\s*:/);
      expect(schemaText, route).not.toMatch(/"@type"\s*:\s*"Person"[\s\S]*?"name"\s*:\s*"Clinic Scout Editorial Team"/);
      await expect(page.locator("body"), route).not.toContainText(/Medically reviewed by|medical reviewer/i);
    }
    expect([...visitedConsolidations].sort()).toEqual([...consolidatedGuideRoutes.keys()].sort());
    for (const author of authorRoutes) {
      await assertCommon(page, author.route, true);
      await expect(page.locator(".authored-pages"), author.route).toBeVisible();
      expect(await page.locator(".authored-pages li a").count(), author.route).toBeGreaterThan(0);
      const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent)));
      expect(schemas.some((node) => node["@type"] === author.schema), author.route).toBe(true);
    }
  });

  test(`Wave 1 review template is usable at ${width}px`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of reviewRoutes) {
      await assertCommon(page, route, true);
      for (const sectionId of ["bottom-line", "pricing", "cancellation", "criteria", "comparisons", "sources"]) {
        await expect(page.locator(`.jump-nav a[href="#${sectionId}"]`), route).toHaveCount(1);
        await expect(page.locator(`#${sectionId}`), route).toHaveCount(1);
      }
      const direct = page.locator('a[data-link-mode="transparent-direct"]');
      await expect(direct.first(), route).toBeVisible();
      expect(await direct.count(), route).toBeGreaterThanOrEqual(1);
      for (const anchor of await direct.evaluateAll((nodes) => nodes.map((node) => ({
        host: new URL(node.href).hostname,
        rel: node.rel,
        event: node.dataset.analyticsEvent,
        subid: node.dataset.subid,
      })))) {
        expect(reviewTrackingHosts, route).toContain(anchor.host);
        expect(anchor.rel, route).toContain("sponsored");
        expect(anchor.rel, route).toContain("nofollow");
        expect(anchor.event, route).toBe("affiliate_click");
        expect(anchor.subid, route).toMatch(/^[a-z0-9-]+-conclusion-\d{6}$/);
      }
      await expect(page.getByRole("link", { name: "Find my match" }), route).toHaveCount(1);
      await expect(page.locator('a[href^="/go/"]'), route).toHaveCount(0);
      await expect(page.locator(".cta.affiliate.disabled"), route).toHaveCount(0);
    }
  });
}

test("all guide schemas keep the Editorial Team organizational and contain no fabricated authority", async ({ page }) => {
  test.setTimeout(300_000);
  for (const route of guideRoutes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBe(200);
    const schemaText = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
    expect(schemaText, route).not.toMatch(/AggregateRating|"@type"\s*:\s*"Review"|"(?:ratingCount|reviewCount)"\s*:/);
    expect(schemaText, route).not.toMatch(/"@type"\s*:\s*"Person"[\s\S]*?"name"\s*:\s*"Clinic Scout Editorial Team"/);
    await expect(page.locator("body"), route).not.toContainText(/Medically reviewed by|medical reviewer/i);
  }
});
