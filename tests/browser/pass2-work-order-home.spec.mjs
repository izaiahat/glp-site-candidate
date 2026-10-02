import { test, expect } from "@playwright/test";

const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!configuredBaseURL) {
  throw new Error("pass2-work-order-home requires PLAYWRIGHT_BASE_URL; it must not start a server");
}
const baseOrigin = new URL(configuredBaseURL).origin;

const rgb = (value) => {
  const match = String(value).match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  return match ? match.slice(1, 4).map(Number) : null;
};
const luminance = ([r, g, b]) => {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (left, right) => {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const translateX = (transform) => {
  if (!transform || transform === "none") return 0;
  const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
  if (matrix3d) return Number(matrix3d[1].split(",")[12]);
  const matrix = transform.match(/^matrix\((.+)\)$/);
  return matrix ? Number(matrix[1].split(",")[4]) : Number.NaN;
};
const pathOf = (url) => new URL(url).pathname;

async function openHome(page) {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main > .cs-home2-hero")).toBeVisible();
}

async function decodeImages(locator) {
  await locator.evaluateAll(async (images) => {
    // Horizontal/offscreen cards retain native lazy loading. Promoting only the
    // already-rendered <img> nodes lets acceptance inspect every chosen source.
    images.forEach((image) => { image.loading = "eager"; });
    await Promise.all(images.map(async (image) => {
      try { await image.decode(); } catch { /* assertions below report broken images */ }
    }));
  });
}

async function imageFacts(locator) {
  return locator.evaluateAll((images) => images.map((image) => ({
    src: image.currentSrc,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    alt: image.alt,
    bounds: image.getBoundingClientRect().toJSON(),
  })));
}

async function centeredControlFacts(page) {
  const wrappers = page.locator(".cs-home2-centered");
  const facts = [];
  for (const wrapper of [wrappers.filter({ hasText: /Read every verdict/i }), wrappers.filter({ hasText: /See all \d+ evidence-qualified cards/i })]) {
    await wrapper.evaluate((node) => node.scrollIntoView({ block: "center" }));
    facts.push(await wrapper.evaluate((node) => {
      const control = node.firstElementChild.getBoundingClientRect();
      const parent = node.parentElement.getBoundingClientRect();
      const signedDelta = (control.left + control.width / 2) - (parent.left + parent.width / 2);
      return {
        text: node.textContent.trim(),
        controlCenter: control.left + control.width / 2,
        parentCenter: parent.left + parent.width / 2,
        signedDelta,
        delta: Math.abs(signedDelta),
      };
    }));
  }
  return facts;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseOrigin || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
});

test.describe("PASS 2 home — desktop served acceptance", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });

  test("O-1–O-7: routes, text-only brand, tightened static aurora hero, and responsive hero imagery", async ({ page }) => {
    await openHome(page);

    const brand = page.locator(".gcs-nav .gcs-brand");
    await expect(brand).toHaveText(/Clinic\s+Scout/);
    await expect(brand.locator("img, svg, picture")).toHaveCount(0);

    const expectedQuickRoutes = new Map([
      ["Compounded semaglutide", "/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest"],
      ["Compounded tirzepatide", "/lp/best-providers/compounded-tirzepatide/?drug=TIRZEPATIDE&form=COMPOUNDED&sort=cheapest"],
      ["Ozempic", "/ozempic/?drug=OZEMPIC&form=BRAND_NAME&sort=cheapest"],
      ["Wegovy pill", "/wegovy-pill/?drug=WEGOVY_PILL&form=COMPOUNDED&sort=cheapest"],
      ["Wegovy", "/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest"],
      ["Mounjaro", "/mounjaro/?drug=MOUNJARO&form=BRAND_NAME&sort=cheapest"],
      ["Zepbound", "/zepbound/?drug=ZEPBOUND&form=BRAND_NAME&sort=cheapest"],
    ]);
    const quickLinks = page.locator(".cs-home2-quick .cs-home-quick");
    await expect(quickLinks).toHaveCount(expectedQuickRoutes.size);
    for (const [name, pathname] of expectedQuickRoutes) {
      await expect(quickLinks.filter({ has: page.getByText(name, { exact: true }) })).toHaveAttribute("href", pathname);
    }
    await expect(page.getByRole("link", { name: /Compare \d+ evidence-qualified cards/i }).first()).toHaveAttribute("href", "/providers/?sort=cheapest");

    const heroMetrics = await page.locator("main > .cs-home2-hero").evaluate((hero) => {
      const style = getComputedStyle(hero);
      const heading = hero.querySelector("h1").getBoundingClientRect();
      const primary = hero.querySelector(".gcs-home-actions a").getBoundingClientRect();
      const flow = hero.querySelector(".cs-home2-flow");
      const flowStyle = getComputedStyle(flow);
      return {
        bounds: hero.getBoundingClientRect().toJSON(),
        heading: heading.toJSON(),
        primary: primary.toJSON(),
        minHeight: parseFloat(style.minHeight),
        paddingTop: parseFloat(style.paddingTop),
        flowOpacity: Number(flowStyle.opacity),
        flowFilter: flowStyle.filter,
        animationNames: [...flow.children].map((node) => getComputedStyle(node).animationName),
        flowBackgrounds: [...flow.children].map((node) => getComputedStyle(node).backgroundImage),
        flowFilters: [...flow.children].map((node) => getComputedStyle(node).filter),
        flowBlendModes: [...flow.children].map((node) => getComputedStyle(node).mixBlendMode),
      };
    });
    expect(heroMetrics.minHeight).toBeLessThanOrEqual(760.5);
    expect(heroMetrics.paddingTop).toBeLessThanOrEqual(92.5);
    expect(heroMetrics.bounds.height).toBeLessThanOrEqual(830);
    expect(heroMetrics.heading.top).toBeLessThan(300);
    expect(heroMetrics.primary.bottom).toBeLessThanOrEqual(900);
    expect(heroMetrics.flowOpacity).toBeGreaterThanOrEqual(0.9);
    expect(heroMetrics.flowFilter).toBe("none");
    expect(heroMetrics.flowFilters).toEqual(["none", "none", "none"]);
    expect(heroMetrics.flowBlendModes).toEqual(["normal", "normal", "normal"]);
    expect(heroMetrics.flowBackgrounds.every((background) => background.includes("radial-gradient") && background.includes("rgba"))).toBe(true);
    expect(heroMetrics.animationNames).toEqual(["cs-home-aurora-orbit-a", "cs-home-aurora-orbit-b", "cs-home-aurora-orbit-c"]);

    const value = page.locator("[data-home-value]");
    await expect(value).toHaveText("Compare real monthly costs.");

    const heroImages = page.locator(".cs-home2-cluster img");
    await expect(heroImages).toHaveCount(3);
    await decodeImages(heroImages);
    const heroFacts = await imageFacts(heroImages);
    expect(new Set(heroFacts.map((image) => pathOf(image.src))).size).toBe(3);
    expect(new Set(heroFacts.map((image) => image.alt)).size).toBe(3);
    for (const image of heroFacts) {
      expect(pathOf(image.src)).toMatch(/home-hero-(?:fruit|fridge|hand)-(?:640|1024)\.avif$/);
      expect(image.naturalWidth).toBeGreaterThan(0);
      expect(image.naturalHeight).toBeGreaterThan(0);
      expect(image.bounds.width).toBeGreaterThan(180);
      expect(image.bounds.height).toBeGreaterThan(180);
    }
    const handTransform = await page.locator(".cs-home2-cluster__hand img").evaluate((image) => getComputedStyle(image).transform);
    expect(handTransform).toMatch(/matrix\(1\.1(?:,|\))/);
  });

  test("O-7–O-13: medication rail has unique rendered art, real loop/controls/peek, light contrast, and white actions", async ({ page }) => {
    await openHome(page);
    const section = page.locator(".cs-home2-meds");
    await section.scrollIntoViewIfNeeded();

    const cards = section.locator("[data-med-card]");
    const images = cards.locator("img");
    await expect(cards).toHaveCount(7);
    await decodeImages(images);
    const facts = await imageFacts(images);
    expect(new Set(facts.map((image) => pathOf(image.src))).size).toBe(7);
    expect(new Set(facts.map((image) => image.alt)).size).toBe(7);
    for (const image of facts) {
      expect(image.naturalWidth).toBeGreaterThan(0);
      expect(image.naturalHeight).toBeGreaterThan(0);
      expect(image.alt.trim().length).toBeGreaterThan(24);
    }
    const paths = facts.map((image) => pathOf(image.src));
    for (const stem of ["med-rail-semaglutide", "med-rail-tirzepatide", "phase3-product-wegovy-pill", "phase3-product-ozempic", "phase3-product-wegovy", "phase3-product-mounjaro", "phase3-product-zepbound"]) {
      expect(paths.some((pathname) => pathname.includes(stem))).toBe(true);
    }

    const dots = section.locator("[data-med-dots] button");
    await expect(dots).toHaveCount(7);
    await section.hover();
    await dots.nth(1).click();
    await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
    await expect.poll(
      () => section.locator("[data-med-track]").evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41),
      { timeout: 1500, intervals: [32, 64, 128] },
    ).toBeLessThan(-50);
    const layout = await section.evaluate((root) => {
      const viewport = root.querySelector("[data-med-viewport]").getBoundingClientRect();
      const cardBounds = [...root.querySelectorAll("[data-med-card]")].map((node) => node.getBoundingClientRect());
      const fullyVisible = cardBounds.filter((box) => box.left >= viewport.left - 1 && box.right <= viewport.right + 1).length;
      const partiallyVisible = cardBounds.filter((box) => box.right > viewport.left && box.left < viewport.right && !(box.left >= viewport.left - 1 && box.right <= viewport.right + 1)).length;
      const pseudoBefore = getComputedStyle(root.querySelector("[data-med-viewport]"), "::before");
      const pseudoAfter = getComputedStyle(root.querySelector("[data-med-viewport]"), "::after");
      return {
        viewport: viewport.toJSON(),
        trackTransform: getComputedStyle(root.querySelector("[data-med-track]")).transform,
        widths: cardBounds.map((box) => box.width),
        fullyVisible,
        partiallyVisible,
        leftFade: { content: pseudoBefore.content, width: parseFloat(pseudoBefore.width), background: pseudoBefore.backgroundImage },
        rightFade: { content: pseudoAfter.content, width: parseFloat(pseudoAfter.width), background: pseudoAfter.backgroundImage },
      };
    });
    expect(layout.widths.every((width) => width >= 329 && width <= 431)).toBe(true);
    expect(layout.fullyVisible).toBeGreaterThanOrEqual(2);
    expect(layout.partiallyVisible).toBeGreaterThanOrEqual(1);
    expect(Math.abs(translateX(layout.trackTransform))).toBeGreaterThan(50);
    expect(layout.leftFade.content).not.toBe("none");
    expect(layout.rightFade.content).not.toBe("none");
    expect(layout.leftFade.width).toBeGreaterThan(30);
    expect(layout.rightFade.width).toBeGreaterThan(30);
    expect(layout.leftFade.background).toContain("linear-gradient");
    expect(layout.rightFade.background).toContain("linear-gradient");

    expect(await dots.evaluateAll((nodes) => nodes.filter((node) => node.getAttribute("aria-current") === "true").length)).toBe(1);
    const track = section.locator("[data-med-track]");
    await page.mouse.move(1, 1);
    await page.locator(".gcs-brand").focus();
    await page.waitForTimeout(100);
    const initialTransform = await track.evaluate((node) => getComputedStyle(node).transform);
    const initialCurrent = await dots.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute("aria-current") === "true"));
    await expect.poll(
      () => dots.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute("aria-current") === "true")),
      { timeout: 7500, intervals: [250, 500, 750] },
    ).not.toBe(initialCurrent);
    await expect.poll(
      () => track.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41),
      { timeout: 1200, intervals: [32, 64, 128] },
    ).not.toBeCloseTo(translateX(initialTransform), 0);

    await section.hover();
    await page.waitForTimeout(700);
    const hoverStart = await track.evaluate((node) => getComputedStyle(node).transform);
    await page.waitForTimeout(3200);
    const hoverEnd = await track.evaluate((node) => getComputedStyle(node).transform);
    expect(translateX(hoverEnd)).toBeCloseTo(translateX(hoverStart), 0);

    const hoverIndex = await dots.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute("aria-current") === "true"));
    await page.mouse.move(2, 2);
    const next = section.locator("[data-med-next]");
    await next.click();
    await page.waitForTimeout(700);
    const controlIndex = await dots.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute("aria-current") === "true"));
    expect(controlIndex).not.toBe(hoverIndex);
    await dots.first().click();
    await expect(dots.first()).toHaveAttribute("aria-current", "true");

    // Design pass 2026-08-26 (home spec fix #1): overlay anatomy — the WHOLE
    // card is one link; the title/qualifier sit on a dark scrim over the art
    // (near-white type against the scrim's dark bands) and the price/CTA pill
    // is white with dark text, bottom-right.
    const contrastFacts = await cards.evaluateAll((nodes) => nodes.map((card) => {
      const title = card.querySelector(".cs-home-med__overlay h3");
      const qualifier = card.querySelector(".cs-home-med__qualifier");
      const scrim = card.querySelector(".cs-home-med__scrim");
      const action = card.querySelector(".cs-home-med__pill");
      const actionStyle = getComputedStyle(action);
      return {
        isLink: card.tagName === "A" && Boolean(card.getAttribute("href")),
        titleColor: getComputedStyle(title).color,
        qualifierVisible: Boolean(qualifier && qualifier.offsetWidth && qualifier.offsetHeight),
        scrimImage: scrim ? getComputedStyle(scrim).backgroundImage : "",
        actionColor: actionStyle.color,
        actionBackground: actionStyle.backgroundColor,
        actionDisplay: actionStyle.display,
        actionHeight: action.getBoundingClientRect().height,
        actionVisible: Boolean(action.offsetWidth && action.offsetHeight),
        cardHeight: card.getBoundingClientRect().height,
      };
    }));
    for (const item of contrastFacts) {
      expect(item.isLink).toBe(true);
      // Title reads against the scrim's darkest stop at AA or better.
      const scrimStops = [...item.scrimImage.matchAll(/rgba?\([^)]*\)/g)].map((match) => rgb(match[0])).filter(Boolean);
      expect(scrimStops.length).toBeGreaterThanOrEqual(2);
      expect(contrast(rgb(item.titleColor), rgb("rgb(4, 16, 12)"))).toBeGreaterThanOrEqual(4.5);
      expect(item.qualifierVisible).toBe(true);
      expect(contrast(rgb(item.actionColor), rgb(item.actionBackground))).toBeGreaterThanOrEqual(7);
      expect(item.actionBackground).toBe("rgb(255, 255, 255)");
      expect(item.actionDisplay).toMatch(/^(?:inline-)?flex$/);
      expect(item.actionHeight).toBeGreaterThanOrEqual(36);
      expect(item.actionVisible).toBe(true);
      // One-viewport contract: full card ≈539px tall at 1440x900.
      expect(item.cardHeight).toBeGreaterThanOrEqual(455);
      expect(item.cardHeight).toBeLessThanOrEqual(545);
    }
  });

  test("O-10, O-14, O-16–O-21: lifestyle/care imagery, authentic logo fallbacks, risk hover/keyboard, and centered controls", async ({ page, browserName }) => {
    await openHome(page);

    const lifestyle = page.locator(".cs-home2-lifestyle img");
    await lifestyle.scrollIntoViewIfNeeded();
    await decodeImages(lifestyle);
    const lifestyleFact = (await imageFacts(lifestyle))[0];
    expect(pathOf(lifestyleFact.src)).toMatch(/home-lifestyle-phone-(?:768|1536)\.avif$/);
    expect(lifestyleFact.naturalWidth).toBeGreaterThan(0);
    expect(lifestyleFact.naturalHeight).toBeGreaterThan(0);

    const compareProviderLinks = page.getByRole("link", { name: "Compare providers", exact: true });
    const compareProviderHrefs = await compareProviderLinks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    expect(compareProviderHrefs.length).toBeGreaterThanOrEqual(2);
    expect(compareProviderHrefs.every((href) => href?.includes("sort=cheapest"))).toBe(true);
    expect(compareProviderHrefs.every((href) => href?.startsWith("/lp/best-providers/") || href?.startsWith("/wegovy-pill/"))).toBe(true);

    const careCards = page.locator(".cs-home2-carecard");
    await careCards.first().scrollIntoViewIfNeeded();
    const careBounds = await careCards.evaluateAll((nodes) => nodes.map((node) => ({
      card: node.getBoundingClientRect().toJSON(),
      media: node.querySelector(".cs-home2-carecard__art").getBoundingClientRect().toJSON(),
    })));
    expect(careBounds).toHaveLength(3);
    expect(careBounds.every(({ card, media }) => card.height >= 429 && media.height >= 199)).toBe(true);

    for (const selector of [".cs-home2-verdict", ".cs-home2-pick"]) {
      const cardsWithIdentity = page.locator(selector);
      await cardsWithIdentity.first().evaluate((node) => node.scrollIntoView({ block: "center" }));
      await cardsWithIdentity.locator("img").evaluateAll((images) => images.forEach((image) => { image.loading = "eager"; }));
      await page.waitForTimeout(1000);
      const identities = await cardsWithIdentity.evaluateAll((nodes) => nodes.map((node) => {
        const image = node.querySelector(".provider-logo img");
        const wordmark = node.querySelector(".provider-wordmark");
        if (image) {
          return { kind: "image", src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, visible: Boolean(image.offsetWidth && image.offsetHeight) };
        }
        return { kind: "wordmark", text: wordmark?.textContent.trim() || "", visible: Boolean(wordmark?.offsetWidth && wordmark?.offsetHeight) };
      }));
      expect(identities.length).toBeGreaterThanOrEqual(3);
      for (const identity of identities) {
        expect(identity.visible).toBe(true);
        if (identity.kind === "image") {
          expect(pathOf(identity.src)).toMatch(/^\/assets\/provider-logos\//);
          expect(identity.width).toBeGreaterThan(0);
          expect(identity.height).toBeGreaterThan(0);
        } else {
          expect(identity.text.length).toBeGreaterThan(1);
        }
      }
    }

    const risk = page.locator("[data-risk-card]").first();
    await risk.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const riskBack = risk.locator('xpath=ancestor::article[contains(@class,"cs-riskcard")]').locator(".cs-riskcard__back");
    await expect(risk).toHaveAttribute("aria-pressed", "false");
    if (browserName === "webkit") {
      await risk.focus();
      await page.keyboard.press("Enter");
      await expect(risk).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => riskBack.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0.95);
      await page.keyboard.press("Escape");
      await expect(risk).toHaveAttribute("aria-pressed", "false");
    } else {
      await risk.hover();
      await expect.poll(() => riskBack.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0.95);
      await risk.click();
      await expect(risk).toHaveAttribute("aria-pressed", "false");
      await page.mouse.move(1, 1);
      await expect.poll(() => riskBack.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeLessThan(0.05);
    }
    await risk.focus();
    await page.keyboard.press("Enter");
    await expect(risk).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(risk).toHaveAttribute("aria-pressed", "false");

    const centered = await centeredControlFacts(page);
    expect(centered[0].text).toMatch(/Read every verdict/i);
    expect(centered[1].text).toMatch(/See all \d+ evidence-qualified cards/i);
    expect.soft(centered[0].delta, "O-20 Read every verdict must be centered under the full verdict rail").toBeLessThanOrEqual(2);
    expect.soft(centered[1].delta, "O-21 See all programs must be centered under the full strongest-program section").toBeLessThanOrEqual(2);
  });

  test("O-22–O-24: review sheet has a dark compact form, focus containment, and smooth bidirectional close", async ({ page }) => {
    await openHome(page);
    const trigger = page.locator("[data-review-open]").first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();

    const openingStart = await page.evaluate(() => {
      document.querySelector("[data-review-open]").click();
      const sheet = document.querySelector("[data-review-sheet]");
      const panel = sheet.querySelector(".cs-review-sheet__panel");
      return {
        hidden: sheet.hidden,
        open: sheet.classList.contains("is-open"),
        transform: getComputedStyle(panel).transform,
        width: panel.getBoundingClientRect().width,
        cssWidth: getComputedStyle(panel).width,
        viewport: { inner: innerWidth, visualWidth: visualViewport?.width, scale: visualViewport?.scale, dpr: devicePixelRatio },
        animations: panel.getAnimations().map(animation => ({ state: animation.playState, time: animation.currentTime })),
      };
    });
    expect(openingStart.hidden).toBe(false);
    expect(openingStart.open).toBe(false);
    expect(translateX(openingStart.transform), JSON.stringify(openingStart)).toBeGreaterThan(openingStart.width * 0.9);

    const sheet = page.locator("[data-review-sheet]");
    const panel = sheet.locator(".cs-review-sheet__panel");
    await expect(sheet).toHaveClass(/is-open/);
    await expect.poll(
      () => panel.evaluate((node) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(node).transform).m41)),
      { timeout: 1200, intervals: [16, 32, 64] },
    ).toBeLessThan(1);

    const heading = sheet.locator("#review-sheet-title");
    const headingStyle = await heading.evaluate((node) => ({ color: getComputedStyle(node).color, background: getComputedStyle(node.closest(".cs-review-sheet__panel")).backgroundColor }));
    expect(contrast(rgb(headingStyle.color), rgb(headingStyle.background))).toBeGreaterThanOrEqual(7);
    expect(rgb(headingStyle.color).every((channel) => channel > 220)).toBe(true);

    const layout = await panel.evaluate((node) => {
      const form = node.querySelector("form");
      const primaryStep = form.querySelector('[data-review-step="primary"]');
      const contactFields = ["public_display_name", "verification_email"]
        .map((name) => form.querySelector(`[name="${name}"]`).closest("label"));
      const style = getComputedStyle(node);
      const formStyle = getComputedStyle(form);
      return {
        panel: node.getBoundingClientRect().toJSON(),
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: style.overflowY,
        columns: formStyle.gridTemplateColumns.split(" ").filter(Boolean).length,
        primaryStep: primaryStep.getBoundingClientRect().toJSON(),
        contactFields: contactFields.map((label) => label.getBoundingClientRect().toJSON()),
        compact: form.hasAttribute("data-review-compact"),
        hasCounterpart: Boolean(form.querySelector('[data-review-step="counterpart"]')),
        hasEvidenceUpload: Boolean(form.querySelector('input[type="file"]')),
      };
    });
    expect(layout.panel.height).toBeLessThanOrEqual(900);
    expect(layout.clientHeight).toBeLessThanOrEqual(900);
    expect(layout.overflowY).toMatch(/auto|scroll/);
    expect(layout.columns).toBe(1);
    expect(layout.compact).toBe(true);
    expect(layout.hasCounterpart).toBe(false);
    expect(layout.hasEvidenceUpload).toBe(false);
    expect(layout.primaryStep.width).toBeGreaterThan(600);
    expect(Math.max(...layout.contactFields.map((field) => field.top)) - Math.min(...layout.contactFields.map((field) => field.top))).toBeLessThan(2);
    const primaryAction = sheet.getByRole("button", { name: "Submit for review", exact: true });
    await expect(primaryAction).toBeInViewport();

    const closeButton = sheet.getByRole("button", { name: "Close", exact: true });
    await closeButton.focus();
    await page.keyboard.press("Shift+Tab");
    expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
    // Keyboard-initiated closes are intentionally instant (B4); the backdrop
    // path below covers the pointer-mode 180ms exit transition.
    await expect(sheet).toBeHidden({ timeout: 250 });

    await trigger.click();
    await expect(sheet).toHaveClass(/is-open/);
    await sheet.locator(".cs-review-sheet__backdrop").click({ position: { x: 4, y: 4 } });
    await expect(sheet).toBeHidden({ timeout: 1000 });
    expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
  });
});

test.describe("PASS 2 home — 390x844 served acceptance", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference", isMobile: true, hasTouch: true });

  test("O-1, O-6–O-10, O-16, O-18: mobile routes, responsive images, rail peek/swipe, care sizing, and touch-only risk toggle", async ({ page }) => {
    await openHome(page);

    const heroImages = page.locator(".cs-home2-cluster img");
    await decodeImages(heroImages);
    const heroFacts = await imageFacts(heroImages);
    expect(heroFacts).toHaveLength(3);
    expect(heroFacts.every((image) => /-(?:640|1024)\.avif$/.test(pathOf(image.src)))).toBe(true);
    expect(heroFacts.every((image) => image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);

    const quickLinks = page.locator(".cs-home2-quick .cs-home-quick");
    await expect(quickLinks).toHaveCount(7);
    const quickLayout = await quickLinks.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    expect(quickLayout.every((box) => box.height >= 48)).toBe(true);
    expect(quickLayout.every((box) => box.left >= 0 && box.right <= 390)).toBe(true);

    const meds = page.locator(".cs-home2-meds");
    await meds.scrollIntoViewIfNeeded();
    const medCards = meds.locator("[data-med-card]");
    const mobileWidths = await medCards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
    expect(mobileWidths.every((width) => width >= 325 && width <= 327)).toBe(true);
    const medImages = medCards.locator("img");
    await decodeImages(medImages);
    const medFacts = await imageFacts(medImages);
    expect(new Set(medFacts.map((image) => pathOf(image.src))).size).toBe(7);
    // High-DPR phones may select the larger advertised AVIF; bind each loaded image to its own picture.
    const medAvifChoices = await medImages.evaluateAll((nodes) => nodes.map((image) =>
      (image.closest("picture")?.querySelector('source[type="image/avif"]')?.srcset || "")
        .split(",").map((candidate) => new URL(candidate.trim().split(/\s+/)[0], location.href).pathname)));
    expect(medFacts.every((image, index) => medAvifChoices[index].includes(pathOf(image.src)))).toBe(true);

    const track = meds.locator("[data-med-track]");
    const beforeSwipe = translateX(await track.evaluate((node) => getComputedStyle(node).transform));
    const viewport = meds.locator("[data-med-viewport]");
    await viewport.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: 330, clientY: 300, bubbles: true });
    await viewport.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", clientX: 150, clientY: 300, bubbles: true });
    await page.waitForTimeout(700);
    const afterSwipe = translateX(await track.evaluate((node) => getComputedStyle(node).transform));
    expect(afterSwipe).not.toBeCloseTo(beforeSwipe, 0);

    const lifestyle = page.locator(".cs-home2-lifestyle img");
    await lifestyle.scrollIntoViewIfNeeded();
    await decodeImages(lifestyle);
    const lifestyleFact = (await imageFacts(lifestyle))[0];
    expect(pathOf(lifestyleFact.src)).toMatch(/home-lifestyle-phone-(?:768|1536)\.avif$/);
    expect(lifestyleFact.naturalWidth).toBeGreaterThan(0);
    expect(lifestyleFact.naturalHeight).toBeGreaterThan(0);

    const careCards = page.locator(".cs-home2-carecard");
    await careCards.first().scrollIntoViewIfNeeded();
    const careBounds = await careCards.evaluateAll((nodes) => nodes.map((node) => ({
      card: node.getBoundingClientRect().toJSON(),
      media: node.querySelector(".cs-home2-carecard__art").getBoundingClientRect().toJSON(),
    })));
    expect(careBounds.every(({ card, media }) => card.height >= 449 && media.height >= 239)).toBe(true);

    const risk = page.locator("[data-risk-card]").first();
    await risk.scrollIntoViewIfNeeded();
    await expect(risk).toHaveAttribute("aria-pressed", "false");
    await risk.tap();
    await expect(risk).toHaveAttribute("aria-pressed", "true");
    await page.locator("#risks-title").tap();
    await expect(risk).toHaveAttribute("aria-pressed", "false");
    await risk.tap();
    await expect(risk).toHaveAttribute("aria-pressed", "true");
    await risk.tap();
    await expect(risk).toHaveAttribute("aria-pressed", "false");
  });

  test("O-20–O-21: mobile verdict and strongest-program controls are centered under their full sections", async ({ page }) => {
    await openHome(page);
    const centered = await centeredControlFacts(page);
    expect(centered[0].text).toMatch(/Read every verdict/i);
    expect(centered[1].text).toMatch(/See all \d+ evidence-qualified cards/i);
    expect.soft(centered[0].delta, "O-20 mobile Read every verdict must be centered under the full verdict rail").toBeLessThanOrEqual(2);
    expect.soft(centered[1].delta, "O-21 mobile See all programs must be centered under the full strongest-program section").toBeLessThanOrEqual(2);
  });

  test("O-22–O-24: mobile review sheet is compact, bounded, scrollable to its primary action, and closes with focus return", async ({ page }) => {
    await openHome(page);
    const trigger = page.locator("[data-review-open]").first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.tap();

    const sheet = page.locator("[data-review-sheet]");
    const panel = sheet.locator(".cs-review-sheet__panel");
    await expect(sheet).toHaveClass(/is-open/);
    const layout = await panel.evaluate((node) => {
      const form = node.querySelector("form");
      const primaryStep = form.querySelector('[data-review-step="primary"]');
      const fields = ["public_display_name", "verification_email", "subject_name", "primary_headline", "primary_experience_date", "primary_review_body"]
        .map((name) => form.querySelector(`[name="${name}"]`).closest(".p5-field, label"));
      return {
        panel: node.getBoundingClientRect().toJSON(),
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
        columns: getComputedStyle(form).gridTemplateColumns.split(" ").filter(Boolean).length,
        primaryStep: primaryStep.getBoundingClientRect().toJSON(),
        lefts: fields.map((label) => label.getBoundingClientRect().left),
        compact: form.hasAttribute("data-review-compact"),
      };
    });
    expect(layout.panel.width).toBeLessThanOrEqual(390);
    expect(layout.panel.height).toBeLessThanOrEqual(844);
    expect(layout.columns).toBe(1);
    expect(layout.compact).toBe(true);
    expect(Math.max(...layout.lefts) - Math.min(...layout.lefts)).toBeLessThan(2);
    expect(layout.overflowY).toMatch(/auto|scroll/);

    const primaryAction = sheet.getByRole("button", { name: "Submit for review", exact: true });
    await primaryAction.scrollIntoViewIfNeeded();
    await expect(primaryAction).toBeInViewport();
    const actionBounds = await primaryAction.boundingBox();
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(844);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden({ timeout: 1000 });
    expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);
  });
});
