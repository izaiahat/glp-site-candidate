import { test, expect } from "@playwright/test";

test.setTimeout(120_000);

async function blockAnalytics(page) {
  await page.route(/https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) => route.fulfill({ status: 204, contentType: "application/javascript", body: "" }));
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectImagesDecoded(page, selector) {
  const images = page.locator(selector);
  const count = await images.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((node) =>
      node.complete && node.naturalWidth > 0 && node.naturalHeight > 0), {
      message: `image ${index + 1} did not finish decoding: ${selector}`,
      timeout: 10_000,
    }).toBe(true);
  }
}

async function progressivelyScrollSections(page, direction = "forward") {
  return page.evaluate(async (requestedDirection) => {
    const sections = [...document.querySelectorAll("main > section")]
      .filter((section) => {
        const box = section.getBoundingClientRect();
        const style = getComputedStyle(section);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
    if (requestedDirection === "reverse") sections.reverse();
    const visited = [];
    for (const [index, section] of sections.entries()) {
      section.scrollIntoView({ behavior: "auto", block: "center" });
      window.ScrollTrigger?.update();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 140));
      visited.push({
        index,
        id: section.id || section.className || section.tagName,
        scrollY: Math.round(window.scrollY),
      });
    }
    return visited;
  }, direction);
}

async function expectEveryMotionTargetVisible(page) {
  await expect.poll(() => page.locator('[data-motion], [data-motion-group] > *').evaluateAll((nodes) => nodes
    .map((node, index) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        index,
        name: node.id || node.className || node.tagName,
        rendered: box.width > 0 && box.height > 0,
        display: style.display,
        visibility: style.visibility,
        opacity: Number.parseFloat(style.opacity),
      };
    })
    .filter((target) => target.rendered)
    .filter((target) => target.display === "none" || target.visibility !== "visible" || target.opacity < 0.98)), {
    message: "motion targets did not settle to their fully visible state",
    timeout: 3_000,
  }).toEqual([]);
}

function translationX(transform) {
  if (!transform || transform === "none") return 0;
  const values = transform.match(/matrix(?:3d)?\(([^)]+)\)/)?.[1].split(",").map(Number) || [];
  return values.length === 16 ? values[12] : values[4] || 0;
}

test.beforeEach(async ({ page }) => {
  await blockAnalytics(page);
});

test("Phase 2 desktop progressively validates the complete home flow and keyboard interactions", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.locator(".cs-home2-hero")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find a GLP-1 plan that fits." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Calculate your cost" })).toBeVisible();
  await expect(page.locator(".cs-home2-editorial")).toBeVisible();
  await expect(page.locator(".cs-home2-wall")).toBeVisible();
  await expectImagesDecoded(page, ".cs-home2-cluster img");
  await expectImagesDecoded(page, ".cs-home2-lifestyle img");
  await expectNoOverflow(page);
  const consentOk = page.getByRole("button", { name: "OK", exact: true });
  if (await consentOk.isVisible()) await consentOk.click();

  const tooltipTrigger = page.locator("[data-price-info]").first();
  await tooltipTrigger.scrollIntoViewIfNeeded();
  await tooltipTrigger.focus();
  await expect(tooltipTrigger).toHaveAttribute("aria-expanded", "true");
  const tooltipId = await tooltipTrigger.getAttribute("aria-describedby");
  expect(tooltipId).toBeTruthy();
  await expect(page.locator(`#${tooltipId}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltipTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(`#${tooltipId}`)).toBeHidden();

  const risk = page.locator("[data-risk-card]").first();
  await risk.focus();
  await page.keyboard.press("Enter");
  await expect(risk).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(risk).toHaveAttribute("aria-pressed", "false");

  const newsletterTrigger = page.locator("[data-newsletter-open]").first();
  await newsletterTrigger.click();
  await expect(page.locator("[data-subscribe-layer]")).toBeVisible();
  const closeFirst = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches
    || window.matchMedia("(max-width: 700px)").matches);
  await expect(page.locator(closeFirst
    ? ".cs-subscribe-sheet [data-subscribe-close]"
    : "[data-subscribe-form] input[type=email]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-subscribe-layer]")).toBeHidden();
  await expect(newsletterTrigger).toBeFocused();

  const reviewTrigger = page.getByRole("button", { name: "Share your experience", exact: true }).first();
  await reviewTrigger.click();
  await expect(page.locator("[data-review-sheet]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Share your experience" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-review-sheet]")).toBeHidden();
  await expect(reviewTrigger).toBeFocused();

  const forward = await progressivelyScrollSections(page, "forward");
  expect(forward.length).toBeGreaterThan(8);
  expect(new Set(forward.map((entry) => entry.scrollY)).size).toBeGreaterThan(6);
  await expectEveryMotionTargetVisible(page);
  const reverse = await progressivelyScrollSections(page, "reverse");
  expect(reverse.length).toBe(forward.length);
  const replay = await progressivelyScrollSections(page, "forward");
  expect(replay.length).toBe(forward.length);
  await expectEveryMotionTargetVisible(page);

  await page.setViewportSize({ width: 1366, height: 768 });
  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test("H17 alternates entrance direction, image placement, and keeps reduced-motion static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  const cards = page.locator("[data-h17-card]");
  await expect(cards).toHaveCount(2);
  // Design pass 2026-08-26 (home spec fix #4): text-first geometry — panel 1
  // TEXT LEFT / IMAGE RIGHT (--reverse, art enters from the right), panel 2
  // mirrored.
  await expect(cards.nth(0)).toHaveAttribute("data-motion", "slide-from-right");
  await expect(cards.nth(1)).toHaveAttribute("data-motion", "slide-from-left");
  await expect(cards.getByRole("link", { name: "Find a provider" })).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await expect(cards.nth(index).getByRole("link", { name: "Find a provider" })).toHaveAttribute("href", "/providers/?sort=cheapest");
  }
  await expect(cards.nth(0).locator("img")).toHaveAttribute("src", /pass3-h17-shipping-1600\.jpg$/);
  await expect(cards.nth(1).locator("img")).toHaveAttribute("src", /pass3-h17-schedule-1600\.jpg$/);
  await expect(cards.nth(0).locator(".cs-home2-logistics__art")).toHaveCSS("order", "2");
  await expect(cards.nth(1).locator(".cs-home2-logistics__art")).toHaveCSS("order", "0");
  await expectImagesDecoded(page, "[data-h17-card] img");

  // Motion v2 (operator 2026-08-26): the restraint doctrine is retired. H17 is a
  // split timeline owned by motion.js (art and copy enter from opposite outer
  // edges), and the data-motion vocabulary animates the rest of the site — the
  // v1 pins (per-card startX/duration datasets, zero generic tweens) described
  // exactly the behaviour the operator rejected.
  await expect.poll(() => cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.h17State)
    .every((state) => state === "pending" || state === "complete"))).toBe(true);
  expect(await page.evaluate(() => window.CS_MOTION?.__v2 === true)).toBe(true);
  expect(await page.evaluate(() => window.CS_MOTION?.reduced === false)).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await cards.nth(0).scrollIntoViewIfNeeded();
  await expect.poll(async () => Math.abs(translationX(await cards.nth(0).evaluate((node) => getComputedStyle(node).transform))), {
    message: "left-origin H17 card did not settle at x=0",
    timeout: 3_000,
  }).toBeLessThan(1);
  await expect(cards.nth(0)).toHaveAttribute("data-h17-state", "complete");
  await cards.nth(1).scrollIntoViewIfNeeded();
  await expect.poll(async () => Math.abs(translationX(await cards.nth(1).evaluate((node) => getComputedStyle(node).transform))), {
    message: "right-origin H17 card did not settle at x=0",
    timeout: 3_000,
  }).toBeLessThan(1);
  await expect(cards.nth(1)).toHaveAttribute("data-h17-state", "complete");
  await expectNoOverflow(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  const reducedCards = page.locator("[data-h17-card]");
  await expect.poll(() => page.evaluate(() => Boolean(window.__gcsLenis))).toBe(false);
  const reducedState = await reducedCards.evaluateAll((nodes) => nodes.map((node) => ({
    opacity: Number.parseFloat(getComputedStyle(node).opacity),
    transform: getComputedStyle(node).transform,
  })));
  expect(reducedState).toEqual([
    { opacity: 1, transform: "none" },
    { opacity: 1, transform: "none" },
  ]);
});

test("welcome toast ignores internal navigation but appears for a genuine cross-session return", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.setItem("gcs.quiz.provider-fit.completed.v1", JSON.stringify({ completedAt: new Date().toISOString() }));
  });
  await page.locator('a[href="/providers/"]').first().click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/providers/");
  await expect(page.locator(".cs-welcome-toast")).toHaveCount(0);

  await page.evaluate(() => {
    localStorage.removeItem("gcs.quiz.provider-fit.completed.v1");
    localStorage.setItem("gcs.visit.v1", JSON.stringify({
      lastPath: "/providers/",
      lastTitle: "Providers · GLP Clinic Scout",
      lastSeenAt: Date.now() - 5 * 60 * 1000,
    }));
  });
  await page.close();

  const returningPage = await context.newPage();
  await blockAnalytics(returningPage);
  const response = await returningPage.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(returningPage.locator(".cs-welcome-toast")).toBeVisible({ timeout: 3_000 });
  await expect(returningPage.locator(".cs-welcome-toast")).toContainText("Welcome back.");
  await returningPage.close();
});

test("medication rail auto-advances, pauses on hover, wraps manually, and stays controllable under reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/", { waitUntil: "networkidle" });
  const section = page.locator(".cs-home2-meds");
  const track = page.locator("[data-med-track]");
  const next = page.locator("[data-med-next]");
  const dots = page.locator("[data-med-dots] button");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toHaveAttribute("data-med-rail-state", "playing");
  await expect(track).toHaveAttribute("data-med-active-index", "0");
  await expect.poll(() => track.getAttribute("data-med-active-index"), {
    message: "rail did not auto-advance within one 3s cadence",
    timeout: 4_500,
  }).toBe("1");
  await expect(track).toHaveCSS("transition-duration", "0.26s");

  await section.hover();
  await expect(section).toHaveAttribute("data-med-rail-state", "paused");
  const hoverIndex = await track.getAttribute("data-med-active-index");
  await page.waitForTimeout(5_500);
  await expect(track).toHaveAttribute("data-med-active-index", hoverIndex);
  await page.mouse.move(0, 0);

  await dots.first().click();
  await expect(track).toHaveAttribute("data-med-active-index", "0");
  await expect.poll(async () => translationX(await track.evaluate((node) => getComputedStyle(node).transform)), {
    message: "rail did not settle on its first card",
    timeout: 2_000,
  }).toBeGreaterThan(-1);
  const firstTransform = await track.evaluate((node) => getComputedStyle(node).transform);
  await next.click();
  await expect(track).toHaveAttribute("data-med-active-index", "1");
  await expect.poll(async () => translationX(await track.evaluate((node) => getComputedStyle(node).transform)), {
    message: "rail did not settle left on its next card",
    timeout: 2_000,
  }).toBeLessThan(translationX(firstTransform));

  const count = await dots.count();
  await dots.nth(count - 1).click();
  await expect(track).toHaveAttribute("data-med-active-index", String(count - 1));
  await next.click();
  await expect(track).toHaveAttribute("data-med-active-index", "0");
  await expect(dots.first()).toHaveAttribute("aria-current", "true");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  const reducedSection = page.locator(".cs-home2-meds");
  const reducedTrack = page.locator("[data-med-track]");
  await reducedSection.scrollIntoViewIfNeeded();
  await expect(reducedSection).toHaveAttribute("data-med-rail-state", "paused");
  const reducedIndex = await reducedTrack.getAttribute("data-med-active-index");
  await page.waitForTimeout(5_500);
  await expect(reducedTrack).toHaveAttribute("data-med-active-index", reducedIndex);
  await page.locator("[data-med-next]").click();
  await expect(reducedTrack).not.toHaveAttribute("data-med-active-index", reducedIndex);
});

test("popular reviews and short-answer rails move continuously and become static for reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/", { waitUntil: "networkidle" });

  for (const selector of [".cs-home2-marquee__track", ".cs-home2-verdict-track"]) {
    const track = page.locator(selector);
    await track.evaluate((node) => node.closest("section")?.scrollIntoView({ behavior: "auto", block: "center" }));
    await expect(track).toBeVisible();
    const before = await track.evaluate((node) => getComputedStyle(node).transform);
    await page.waitForTimeout(650);
    const after = await track.evaluate((node) => getComputedStyle(node).transform);
    expect(after, `${selector} did not auto-scroll`).not.toBe(before);
    expect(await track.evaluate((node) => getComputedStyle(node).animationPlayState)).toBe("running");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  for (const selector of [".cs-home2-marquee__track", ".cs-home2-verdict-track"]) {
    const track = page.locator(selector);
    await expect(track).toHaveCSS("animation-name", "none");
    await expect(track).toHaveCSS("transform", "none");
  }
});

test("W18 mobile home remains complete, readable, and free of horizontal overflow", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.locator(".cs-home2-hero")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find a GLP-1 plan that fits." })).toBeVisible();
  await expect(page.getByRole("link", { name: "See your matches" })).toBeVisible();
  await expectImagesDecoded(page, ".cs-home2-cluster img");
  await expectNoOverflow(page);

  await page.locator("[data-menu-toggle]").click();
  await expect(page.locator("[data-menu]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-menu]")).toBeHidden();
  expect(errors).toEqual([]);
});
