import { test, expect } from "@playwright/test";
import { expectSurveyHandoff, retakeSurvey } from "./round5-quiz-contract.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROOF = path.join(ROOT, "artifacts", "ultracode", "template-completeness", "content-tools");
mkdirSync(PROOF, { recursive: true });
test.setTimeout(180_000);
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function prepare(page, viewport) {
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push("pageerror:" + error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push("console:" + message.text()); });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.route(/https?:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) =>
    route.fulfill({ status: 204, contentType: "application/javascript", body: "" }),
  );
  return runtimeErrors;
}
async function dismissConsent(page) {
  const button = page.getByRole("button", { name: "OK", exact: true });
  if (await button.count()) if (await button.first().isVisible()) await button.first().click();
}
async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  return overflow;
}
async function expectDecoded(page, selector) {
  const images = page.locator(selector);
  const count = await images.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0),
      { timeout: 10_000, message: "image did not decode: " + selector + " #" + index }).toBe(true);
  }
  return count;
}
async function imageSurfaceCount(page, selector) {
  return page.locator(selector).evaluateAll((roots) => roots.filter((root) => {
    const nodes = [root, ...root.querySelectorAll("*")];
    return nodes.some((node) => {
      if (node.tagName === "IMG" && node.complete && node.naturalWidth > 0) return true;
      return [getComputedStyle(node), getComputedStyle(node, "::before"), getComputedStyle(node, "::after")].some((style) => /url\(/.test(style.backgroundImage || ""));
    });
  }).length);
}
async function shot(page, name, options = {}) {
  const file = path.join(PROOF, name);
  const browserName = page.context().browser()?.browserType().name() || "unknown";
  const pageMetrics = options.fullPage
    ? await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      deviceScaleFactor: window.devicePixelRatio || 1,
    }))
    : { height: 0, deviceScaleFactor: 1 };
  if (options.fullPage && pageMetrics.height * pageMetrics.deviceScaleFactor > 32_760) {
    const parsed = path.parse(file);
    const fallback = path.join(parsed.dir, `${parsed.name}-${browserName}-viewport${parsed.ext}`);
    const viewportOptions = { ...options };
    delete viewportOptions.fullPage;
    await page.screenshot({ path: fallback, animations: "disabled", ...viewportOptions });
    return path.relative(ROOT, fallback);
  }
  await page.screenshot({ path: file, animations: "disabled", ...options });
  return path.relative(ROOT, file);
}
function evidence(name, payload) {
  const file = path.join(PROOF, name);
  writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
  return path.relative(ROOT, file);
}
async function served(page, url) {
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response && response.status()).toBe(200);
}

for (const viewport of VIEWPORTS) {
  test("CTC-20260823 unique served-output homepage D18-D44 :: " + viewport.name, async ({ page }) => {
    const errors = await prepare(page, viewport);
    await served(page, "/");
    await dismissConsent(page);
    await expect(page.locator(".cs-home2-hero")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Find a GLP-1 plan that fits." })).toBeVisible();
    await expect(page.locator(".cs-home2-flow")).toHaveCount(1);
    await expect(page.locator(".cs-home2-cycle")).toHaveCount(1);
    await expect(page.locator(".cs-home2-cluster img")).toHaveCount(3);
    await expect(page.locator(".cs-btn--orbit")).toHaveCount(1);
    const body = page.locator("body");
    await expect(body).not.toContainText("We compare 33 online GLP-1 providers");
    await expect(body).not.toContainText("Updated August 2026");
    await expect(body).not.toContainText("capture hashed");
    await expect(body).not.toContainText("checked date");
    // Design pass 2026-08-26 (home spec fix #11): 15-band arc — calculator
    // folded into pricing, review capture grown into the review wall, news
    // merged into the editorial panel, help as the pre-footer line.
    const requiredOrder = ["cs-home2-hero","cs-home2-marquee","cs-home2-trust","cs-home2-meds","cs-home2-lifestyle","cs-home2-pricing","cs-home2-care","cs-home2-risks","cs-home2-logistics","cs-home2-verdicts","cs-home2-strongest","cs-home2-wall","cs-home2-position","cs-home2-editorial","cs-home2-help"];
    const servedOrder = await page.locator("main > section").evaluateAll((nodes) => nodes.map((node) => node.className));
    let cursor = -1;
    for (const token of requiredOrder) {
      const next = servedOrder.findIndex((classes, index) => index > cursor && String(classes).split(/\s+/).includes(token));
      expect(next, "missing/out-of-order homepage section " + token).toBeGreaterThan(cursor);
      cursor = next;
    }
    const quickCount = await page.locator(".cs-home2-quick a[href]").count();
    expect(quickCount).toBe(7);
    const marqueeLinks = await page.locator(".cs-home2-marquee a[href]").count();
    expect(marqueeLinks).toBe(12);
    await expect(page.locator(".cs-home2-trust")).toContainText(/0\s*paid\s*placements/);
    await expect(page.locator(".cs-home2-trust")).toContainText("Nobody can buy a rank or a score");
    await expect(page.locator(".cs-home2-trust")).not.toContainText("how we make money");
    const medImages = await expectDecoded(page, ".cs-home2-meds img");
    expect(medImages).toBe(7);
    await expect(page.getByRole("button", { name: "Previous medication" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next medication" })).toBeVisible();
    expect(await expectDecoded(page, ".cs-home2-lifestyle img")).toBe(1);
    await expect(page.locator(".cs-home2-price")).toHaveCount(2);
    expect(await expectDecoded(page, ".cs-home2-care img")).toBe(3);
    await expect(page.locator(".cs-riskcard")).toHaveCount(6);
    expect(await page.locator(".cs-home2-verdict").count()).toBeGreaterThanOrEqual(6);
    await expect(page.locator(".cs-home2-pick")).toHaveCount(3);
    await expect(page.locator(".cs-home2-pricing__calc")).toContainText("Know your monthly cost before checkout");
    await expect(page.locator(".cs-home2-wall")).toContainText("contact you to verify it before publication");
    await expect(page.locator(".cs-home2-wall")).not.toContainText("manual moderation");
    await expect(page.locator(".cs-home2-position")).toContainText("We do not sell medication. We help you navigate the choices.");
    await expect(page.locator(".cs-home2-position__wash")).toHaveCount(1);
    const editorialImages = await expectDecoded(page, ".cs-home2-editorial img");
    expect(editorialImages).toBe(6);
    const helpAlignment = await page.locator(".cs-home2-help").evaluate((node) => getComputedStyle(node).textAlign);
    expect(helpAlignment).toBe("center");
    await expect(page.locator(".cs-home2-editorial [data-newsletter-open]")).toBeVisible();
    const motionCount = await page.locator("[data-motion], [data-motion-group], [data-price-roll]").count();
    expect(motionCount).toBeGreaterThan(0);
    const overflow = await expectNoOverflow(page);
    const screenshot = await shot(page, "homepage-" + viewport.name + "-full.png", { fullPage: true });
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const proof = evidence("homepage-" + viewport.name + ".json", { viewport, dItems: "D18-D44", servedOrder, quickCount, marqueeLinks, medImages, editorialImages, motionCount, scrollHeight, overflow, screenshot, exactKnownGap: "D42 premium article-image art direction remains open." });
    expect(errors, "runtime errors; proof " + proof).toEqual([]);
  });

  test("CTC-20260823 unique served-output Insights index plus article D15 D16 D17 D42 :: " + viewport.name, async ({ page, browserName }) => {
    const errors = await prepare(page, viewport);
    await served(page, "/insights/");
    await dismissConsent(page);
    await expect(page.locator(".p3-insights-hero")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
    const subscribe = page.getByRole("button", { name: "Subscribe", exact: true });
    await expect(subscribe).toBeVisible();
    await expect(page.locator(".p3-insight-cycle")).toHaveCount(3);
    await expect(page.locator(".p3-feature-story")).toHaveCount(3);
    await expect(page.locator(".p3-story")).toHaveCount(9);
    const indexImageMarkup = await page.locator(".p3-feature-story, .p3-story").evaluateAll((roots) => roots
      .filter((root) => root.querySelector("picture img[src], img[src]")).length);
    expect(indexImageMarkup).toBe(12);
    if (browserName === "chromium") await expectDecoded(page, ".p3-feature-story img, .p3-story img");
    const indexImages = browserName === "chromium"
      ? await imageSurfaceCount(page, ".p3-feature-story, .p3-story")
      : indexImageMarkup;
    expect(indexImages).toBeGreaterThanOrEqual(7);
    await expect(page.locator(".p3-pagination a[href='/insights/page/2/']").first()).toBeVisible();
    const indexOverflow = await expectNoOverflow(page);
    const indexScreenshot = await shot(page, "insights-index-" + viewport.name + "-full.png", { fullPage: true });
    await subscribe.click();
    const sheet = page.locator(".cs-subscribe-sheet");
    await expect(sheet).toBeVisible();
    const closeFirst = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches
      || window.matchMedia("(max-width: 700px)").matches);
    await expect(sheet.locator(closeFirst ? "[data-subscribe-close]" : "input[type='email']")).toBeFocused();
    const subscribeScreenshot = await shot(page, "insights-subscribe-d17-" + viewport.name + ".png");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await served(page, "/guides/trimi-vs-yourera/");
    await dismissConsent(page);
    await expect(page.locator(".guide-hero")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Trimi vs yourEra/i })).toBeVisible();
    await expect(page.locator(".p3-article-share").first()).toBeVisible();
    await expect(page.locator(".answer")).toBeVisible();
    await expect(page.locator(".disclosure")).toBeVisible();
    await expect(page.locator(".claim-evidence")).toBeVisible();
    await expect(page.locator(".guide-data-table")).toBeVisible();
    await expect(page.locator(".guide-sources")).toBeVisible();
    await expect(page.locator(".p3-keep-reading")).toBeVisible();
    await expect(page.locator("[data-subscribe-open]").first()).toBeVisible();
    const heroImages = await imageSurfaceCount(page, ".guide-hero");
    expect(heroImages).toBe(1);
    const articleOverflow = await expectNoOverflow(page);
    const articleScreenshot = await shot(page, "insights-article-" + viewport.name + "-full.png", { fullPage: true });
    const articleScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const authorBlocks = await page.locator(".guide-author, .p3-author, [data-author-block]").count();
    const faqBlocks = await page.locator(".guide-faq, [data-faq], .faq").count();
    const proof = evidence("insights-" + viewport.name + ".json", {
      viewport, dItems: ["D15", "D16", "D17", "D42"],
      index: { cycles: 3, featuredCards: 3, standardCards: 9, indexImages, indexOverflow, screenshot: indexScreenshot },
      subscribe: { sheetClass: "cs-subscribe-sheet", state: "visible after trigger", screenshot: subscribeScreenshot },
      article: { route: "/guides/trimi-vs-yourera/", heroImages, articleScrollHeight, articleOverflow, authorBlocks, faqBlocks, screenshot: articleScreenshot },
      exactKnownGaps: ["No test claim is made for reference image fade/load choreography; the teardown marks it missing.", "Representative article serves no detectable curator/author block selector and no explicit FAQ block selector."],
    });
    expect(errors, "runtime errors; proof " + proof).toEqual([]);
  });

  test("CTC-20260823 unique served-output full quiz step flow result reveal and scroll-through :: " + viewport.name, async ({ page }) => {
    const errors = await prepare(page, viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await served(page, "/quiz/provider-fit/");
    const manageChoices = page.locator('#gcs-consent [data-consent-open]');
    await expect(manageChoices).toBeVisible();
    await manageChoices.click();
    await page.getByRole("button", { name: "Turn off analytics", exact: true }).click();
    await expect(page.locator("#gcs-consent")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("gcs_tracking_consent_v1") || "null");
      return {
        analytics: saved?.analytics,
        advertising: saved?.advertising,
        version: saved?.version,
        record_type: saved?.record_type,
        purposes: window.GCSConsent?.purposes(),
      };
    })).toEqual({
      analytics: "denied",
      advertising: "denied",
      version: "gcs-cookie-v4-distinct-purposes",
      record_type: "preference_only",
      purposes: { analytics: "denied", advertising: "denied" },
    });
    await expect(page.locator("#health-consent, #health-consent-gate")).toHaveCount(0);
    // No start control: the quiz auto-initializes and position 0 is shown on load.
    await expect(page.locator("#begin-quiz")).toHaveCount(0);
    await expect(page.locator('[data-quiz-position="0"]:not([hidden])')).toBeVisible();
    const questions = page.locator("[data-phase4-questions]");
    await expect(questions).toBeVisible();
    const questionCount = await page.locator("[data-quiz-position]").count();
    expect(questionCount).toBe(7);
    const stepScreenshot = await shot(page, "quiz-step-flow-" + viewport.name + ".png");
    const visited = [];
    const progressWidths = [];
    const visit = async (index) => {
      const current = page.locator(`[data-quiz-position="${index}"]`);
      await expect(current).toBeVisible();
      visited.push(index);
      progressWidths.push(await page.locator(".qz-progress span").evaluate((node) => getComputedStyle(node).transform));
    };
    await visit(0);
    await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
    await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
    await visit(2);
    await page.locator('[data-single="current_use"][data-value="no"]').click();
    await visit(1);
    await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
    await visit(4);
    await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
    await visit(5);
    await page.locator('[data-quiz-select="state"]').selectOption("OR");
    await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
    await visit(6);
    const { result, ids } = await expectSurveyHandoff(page, () => page.locator("[data-quiz-finish]").click(), "OR");
    await expect(questions).toHaveCount(0);
    await expect(page.locator("[data-result-cards] .qz-card-status")).toHaveCount(ids.length);
    await expect(page.locator("[data-result-cards] .qz-card-status").first()).toContainText("Top rule-based match");
    await page.waitForTimeout(600);
    const resultTop = await result.evaluate((node) => node.getBoundingClientRect().top);
    expect(resultTop).toBeLessThan(viewport.height);
    const resultScreenshot = await shot(page, "quiz-results-reveal-" + viewport.name + ".png");
    const resultFullScreenshot = await shot(page, "quiz-results-" + viewport.name + "-full.png", { fullPage: true });
    const revealScrollY = await page.evaluate(() => window.scrollY);
    await page.locator("[data-p1-capture-surface]").scrollIntoViewIfNeeded();
    const captureScrollY = await page.evaluate(() => window.scrollY);
    expect(captureScrollY).toBeGreaterThan(revealScrollY);
    await page.locator("footer").scrollIntoViewIfNeeded();
    const footerScrollY = await page.evaluate(() => window.scrollY);
    expect(footerScrollY).toBeGreaterThanOrEqual(captureScrollY);
    const scrollScreenshot = await shot(page, "quiz-scroll-through-" + viewport.name + ".png");
    const overflow = await expectNoOverflow(page);
    await retakeSurvey(page);
    await expect(result).toHaveCount(0);
    await expect(questions).toBeVisible();
    const proof = evidence("quiz-" + viewport.name + ".json", {
      viewport, questionCount, visited, uniqueVisited: [...new Set(visited)], progressWidths, backBehaviorProof: "tests/browser/w18-mobile-parity.spec.mjs and tests/browser/cross-device.spec.mjs",
      resultCardCount: ids.length, resultProgramIds: ids, resultTop, revealScrollY, captureScrollY, footerScrollY, overflow,
      screenshots: { step: stepScreenshot, result: resultScreenshot, resultFull: resultFullScreenshot, scrollThrough: scrollScreenshot },
      exactKnownGap: "The test proves state transitions and the revealed/scrollable result bytes; it does not claim competitor-reference reveal choreography parity.",
    });
    expect(errors, "runtime errors; proof " + proof).toEqual([]);
  });

  test("CTC-20260823 unique served-output search expanded in-flight results empty :: " + viewport.name, async ({ page }) => {
    const errors = await prepare(page, viewport);
    await served(page, "/");
    await dismissConsent(page);
    const toggle = page.locator(".cs-search-toggle");
    await toggle.click();
    const panel = page.locator(".cs-search-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const input = panel.locator("input[type='search']");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("placeholder", "Search providers or pharmacies");
    const expandedScreenshot = await shot(page, "search-expanded-" + viewport.name + ".png");
    await input.fill("wegovy");
    await expect(panel).toHaveClass(/is-searching/);
    await expect(panel.locator(".cs-search-loading")).toBeVisible();
    await expect(panel.locator(".cs-search-loading")).toContainText("Searching Clinic Scout");
    const inFlightScreenshot = await shot(page, "search-in-flight-" + viewport.name + ".png");
    await expect(panel.locator(".cs-search-summary")).toContainText(/result/i, { timeout: 10_000 });
    const resultCount = await panel.locator(".cs-search-hit").count();
    expect(resultCount).toBeGreaterThan(0);
    expect(resultCount).toBeLessThanOrEqual(12);
    await expect(panel.locator("mark").first()).toBeVisible();
    const resultsScreenshot = await shot(page, "search-results-" + viewport.name + ".png");
    await input.fill("zzzz-no-matching-page-20260823");
    await expect(panel.locator(".cs-search-empty")).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator(".cs-search-empty")).toContainText("No match yet");
    await expect(panel.locator(".cs-search-empty")).toContainText("Try a provider, pharmacy, medication, or a word like “cost”.");
    const emptyScreenshot = await shot(page, "search-empty-" + viewport.name + ".png");
    const openOverflow = await expectNoOverflow(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    const proof = evidence("search-" + viewport.name + ".json", {
      viewport, states: ["expanded", "in-flight", "results", "empty", "closed"],
      minimumInFlightMsFromServedCode: 420, debounceMsFromServedCode: 160, resultCount, cap: 12, openOverflow,
      mobileDialogExpected: viewport.name === "mobile",
      screenshots: { expanded: expandedScreenshot, inFlight: inFlightScreenshot, results: resultsScreenshot, empty: emptyScreenshot },
    });
    expect(errors, "runtime errors; proof " + proof).toEqual([]);
  });
}
