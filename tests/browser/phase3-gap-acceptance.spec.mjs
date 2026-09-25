import { test, expect } from "@playwright/test";
import { approvedRetirement } from "./retirement-support.mjs";
import { governedProviderIds, governedBulkCohorts, governedWegovyIds, governedWegovyUnpricedIds, governedPaidPrimaryIds, governedUnpricedIds, governedCompoundedUnknownIds, governedBrandCohorts, governedExcludedIds, governedCardFacts, hydrateAllProviderCards } from "./governed-cohort.mjs";

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;

const DESKTOP_VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1366x768", width: 1366, height: 768 },
];

const DESKTOP_ROUTES = [
  {
    family: "brand product",
    route: "/wegovy/",
    archetype: "B",
    hero: 'main.listing[data-listing-archetype="B"] > header.listing__intro',
    required: [".listing__intro", "[data-listing-drug-panel]", "[data-listing-drug-panel] picture[data-product-visual]", ".p3-filterbar", "#provider-results > [data-phase3-provider-grid]", "[data-unpublished-provider-section]", ".p3-insurance", ".p3-product-related"],
    images: true,
    brandedArt: true,
  },
  {
    family: "compounded listing",
    route: "/lp/best-providers/compounded-semaglutide/",
    archetype: "C",
    hero: 'main.listing[data-listing-archetype="C"] > header.listing__intro',
    // KAEL-DECISION-20260923-optionc-governing-mappings.md A2.1–A2.2:
    // the numeric grid and non-priced evidence section are separate cohorts.
    required: [".listing__intro", ".listing__category-art", ".listing__category-art picture[data-product-visual]", ".p3-filterbar", "#provider-results > [data-phase3-provider-grid]", "[data-state-unverified-remainder]", "[data-unpublished-provider-section]", ".p3-evidence-boundary"],
  },
  {
    family: "provider directory",
    route: "/providers/",
    archetype: "E",
    hero: 'main.listing[data-listing-archetype="E"] > header.listing__intro',
    required: [".listing__intro", ".p3-filterbar", ".p3-provider-grid", { family: "R32", selector: "[data-directory-pricing]" }],
  },
  {
    family: "self-pay",
    route: "/self-pay/",
    archetype: "E",
    hero: 'main.listing[data-listing-archetype="E"] > header.listing__intro',
    required: [".listing__intro", { family: "R33", selector: ".p3-filterbar" }, ".p3-provider-grid"],
  },
  {
    family: "bulk duration",
    route: "/3-month/?drug=SEMAGLUTIDE",
    archetype: "A",
    hero: 'main.listing[data-listing-archetype="A"] > header.listing__intro',
    required: [".listing__intro", "header.listing__intro [data-filter-result]", "#provider-results > [data-phase3-provider-grid]", "[data-unpublished-provider-section]", ".p3-evidence-boundary"],
  },
  {
    family: "Insights cycles",
    route: "/insights/",
    hero: ".p3-insights-hero",
    minWidthRatio: 0.65,
    required: [".p3-insights-hero", ".p3-insight-cycle", ".p3-feature-story", ".p3-story-grid", ".p3-pagination"],
    images: true,
  },
  {
    family: "pharmacy directory",
    route: "/pharmacies/",
    archetype: "D",
    hero: 'main.listing[data-listing-archetype="D"] > header.listing__intro',
    required: [".listing__intro", ".p3-pharmacy-filters", ".p3-pharmacy-grid"],
  },
  {
    family: "pharmacy detail",
    route: "/pharmacies/red-rock/",
    hero: ".p3-pharmacy-hero",
    required: [".p3-pharmacy-hero", ".p3-classification-grid", ".p3-detail-grid", ".p3-source-rail"],
  },
];

const MAJOR_SURFACES = [
  ".breadcrumbs",
  ".listing__intro",
  "[data-listing-drug-panel]",
  ".listing__category-art",
  ".p3-product-hero",
  ".p3-category-hero",
  ".p3-bulk-hero",
  ".p3-index-hero",
  ".p3-insights-hero",
  ".p3-pharmacy-hero",
  ".p3-selfpay-summary",
  ".p3-insurance",
  ".p3-product-picker",
  ".p3-filterbar",
  ".p3-pharmacy-filters",
  ".p3-provider-section",
  ".p3-provider-grid",
  ".p3-pharmacy-grid",
  ".p3-insight-cycle",
  ".p3-detail-grid",
  ".p3-action-grid",
  ".p3-source-rail",
  ".p3-related",
  ".p3-evidence-boundary",
  ".p3-filter-empty:not([hidden])",
  ".p3-empty:not([hidden])",
].join(",");

const CARD_SELECTOR = [
  "[data-phase3-provider]",
  ".p3-pharmacy-card",
  ".p3-intent-card",
  ".p3-feature-story",
  ".p3-story",
  ".p3-product-related-card",
  ".p3-classification-grid > .cs-card",
  ".p3-detail-grid > article",
  ".p3-action",
  ".p3-empty:not([hidden])",
  ".p3-filter-empty:not([hidden])",
].join(",");

const LOOP_SELECTOR = ".p3-product-float, .p3-category-orb, .p3-card-aurora";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "gcs-cookie-v2-default-on-20260730",
      saved_at: "2026-08-26T00:00:00.000Z",
    }));
  });
  await page.route(ANALYTICS, (route) => route.fulfill({
    status: 204,
    contentType: "application/javascript",
    body: "",
  }));
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
});

async function goto(page, route) {
  const response = await page.goto(route, { waitUntil: "networkidle" });
  expect(response?.status(), route).toBe(200);
  await expect(page.locator("main")).toHaveCount(1);
}

async function expectNoHorizontalOverflow(page, label) {
  const state = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(state.html, `${label}: document overflow`).toBeLessThanOrEqual(1);
  expect(state.body, `${label}: body overflow`).toBeLessThanOrEqual(1);
}

async function expectWideDesktopAnatomy(page, routeSpec, viewport) {
  const hero = page.locator(routeSpec.hero);
  if (routeSpec.archetype) {
    await expect(hero, `${routeSpec.family}: one listing introduction`).toHaveCount(1);
    await expect(hero.locator("h1"), `${routeSpec.family}: one introduction heading`).toHaveCount(1);
  }
  const geometry = await (routeSpec.archetype ? hero : hero.first()).evaluate((node, ledeSelector) => {
    const box = node.getBoundingClientRect();
    const lede = node.querySelector(ledeSelector);
    return {
      left: box.left,
      right: box.right,
      width: box.width,
      viewportWidth: innerWidth,
      ledeCount: node.querySelectorAll(ledeSelector).length,
      ledeWidth: lede?.getBoundingClientRect().width || 0,
    };
  }, routeSpec.archetype ? ".listing__support" : ".lede");
  if (routeSpec.archetype) {
    expect(geometry.ledeCount, `${routeSpec.family}: one support line`).toBe(1);
    expect(geometry.ledeWidth, `${routeSpec.family}: support line renders`).toBeGreaterThan(0);
  }
  expect(geometry.left, `${routeSpec.family}: hero left bound`).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, `${routeSpec.family}: hero right bound`).toBeLessThanOrEqual(viewport.width + 1);
  if (["A", "B", "C", "E"].includes(routeSpec.archetype)) {
    await approvedRetirement("RR-2", test.info());
  } else {
    expect(geometry.width / geometry.viewportWidth, `${routeSpec.family}: desktop width use`).toBeGreaterThanOrEqual(routeSpec.minWidthRatio || 0.88);
  }
  if (geometry.ledeWidth) {
    expect(geometry.ledeWidth, `${routeSpec.family}: readable lede measure`).toBeLessThanOrEqual(760);
  }
}

async function expectCardAndContentBounds(page, label) {
  const violations = await page.locator(CARD_SELECTOR).evaluateAll((cards) => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const round = (value) => Math.round(value * 10) / 10;
    const problems = [];

    for (const [cardIndex, card] of cards.entries()) {
      if (!visible(card)) continue;
      const cardBox = card.getBoundingClientRect();
      if (cardBox.left < -1 || cardBox.right > innerWidth + 1) {
        problems.push({ cardIndex, kind: "viewport", left: round(cardBox.left), right: round(cardBox.right) });
      }
      if (card.scrollWidth > card.clientWidth + 1) {
        problems.push({ cardIndex, kind: "card-scroll-width", client: card.clientWidth, scroll: card.scrollWidth });
      }
      if (card.scrollHeight > card.clientHeight + 1) {
        problems.push({ cardIndex, kind: "card-scroll-height", client: card.clientHeight, scroll: card.scrollHeight,
          overflowingChildren: [...card.querySelectorAll('*')].filter(node => node.getBoundingClientRect().bottom > cardBox.bottom + 1)
            .map(node => ({ tag: node.tagName, className: String(node.className), bottom: round(node.getBoundingClientRect().bottom - cardBox.bottom), position: getComputedStyle(node).position })).slice(0, 6),
          contentVisibility: getComputedStyle(card).contentVisibility });
      }

      for (const child of card.querySelectorAll("h1,h2,h3,p,li,blockquote,small,strong,a,button,summary,label,output,.provider-logo,.provider-wordmark,.p3-card-actions")) {
        if (!visible(child) || child.closest("[hidden]")) continue;
        const style = getComputedStyle(child);
        if (style.position === "absolute" || style.position === "fixed") continue;
        const box = child.getBoundingClientRect();
        if (box.left < cardBox.left - 1 || box.right > cardBox.right + 1) {
          problems.push({
            cardIndex,
            kind: "child-horizontal-clip",
            tag: child.tagName,
            className: String(child.className || "").slice(0, 80),
            childLeft: round(box.left),
            childRight: round(box.right),
            cardLeft: round(cardBox.left),
            cardRight: round(cardBox.right),
          });
        }
        if (child.scrollWidth > child.clientWidth + 1 && !["auto", "scroll"].includes(style.overflowX)) {
          problems.push({
            cardIndex,
            kind: "child-scroll-width",
            tag: child.tagName,
            className: String(child.className || "").slice(0, 80),
            client: child.clientWidth,
            scroll: child.scrollWidth,
          });
        }
      }
    }
    return problems.slice(0, 40);
  });
  expect(violations, `${label}: no card, logo, name, price, source, or action clips`).toEqual([]);
}

async function expectResponsiveContentBounds(page, label) {
  const problems = await page.locator("main.p3-page").evaluate((root) => {
    const rootBox = root.getBoundingClientRect();
    const round = (value) => Math.round(value * 10) / 10;
    return [...root.children].flatMap((node, index) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      if (style.display === "none" || box.width === 0 || box.height === 0 || style.position === "fixed") return [];
      if (box.left >= Math.max(-1, rootBox.left - 1) && box.right <= Math.min(innerWidth + 1, rootBox.right + 1)) return [];
      return [{
        index,
        tag: node.tagName,
        className: String(node.className || "").slice(0, 100),
        left: round(box.left),
        right: round(box.right),
        viewportWidth: innerWidth,
      }];
    });
  });
  expect(problems, `${label}: direct content bounds`).toEqual([]);
}

async function decodeEveryImage(page, label) {
  const broken = await page.locator("main.p3-page img").evaluateAll(async (images) => {
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
    return images.flatMap((image) => (
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
        ? []
        : [{ src: image.currentSrc || image.src, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }]
    ));
  });
  expect(broken, `${label}: every image decodes`).toEqual([]);
}

async function expectAuroraLogoBands(page, label) {
  const cardCount = await page.locator("[data-phase3-provider]:visible").count();
  if (!cardCount) return;
  await expect(page.locator("[data-phase3-provider]:visible .p3-card-aurora")).toHaveCount(cardCount);
  const state = await page.locator("[data-phase3-provider]:visible").evaluateAll((cards) => cards.map((card) => {
    const band = card.querySelector(".p3-card-aurora");
    const logo = card.querySelector(".provider-logo");
    const logoBox = logo?.getBoundingClientRect();
    const bandStyle = band ? getComputedStyle(band) : null;
    const logoStyle = logo ? getComputedStyle(logo) : null;
    return {
      bandImage: bandStyle?.backgroundImage || "none",
      bandHeight: band?.getBoundingClientRect().height || 0,
      logoWidth: logoBox?.width || 0,
      logoHeight: logoBox?.height || 0,
      logoBackground: logoStyle?.backgroundColor || "rgba(0, 0, 0, 0)",
    };
  }));
  expect(state.every((row) => row.bandImage !== "none" && row.bandHeight >= 120), `${label}: aurora band geometry`).toBe(true);
  expect(state.every((row) => row.logoWidth >= 80 && row.logoHeight >= 42), `${label}: logo tile geometry`).toBe(true);
  expect(state.every((row) => row.logoBackground !== "rgba(0, 0, 0, 0)"), `${label}: logo contrast tile`).toBe(true);
}

async function expectBrandedArtUsesReadableCrop(page, label) {
  const primaryArt = page.locator("[data-listing-drug-panel] picture[data-product-visual] img");
  await expect(primaryArt, `${label}: one live brand image`).toHaveCount(1);
  await expect(primaryArt, `${label}: live brand image is visible`).toBeVisible();
  const art = page.locator("[data-listing-drug-panel] picture[data-product-visual] img, .p3-product-float img, .p3-product-card-picture img");
  expect(await art.count(), `${label}: branded art exists`).toBeGreaterThan(0);
  const state = await art.evaluateAll((images) => images.map((image) => {
    const style = getComputedStyle(image);
    const box = image.getBoundingClientRect();
    return {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      renderedWidth: box.width,
      renderedHeight: box.height,
    };
  }));
  expect(state.every((row) => row.complete && row.naturalWidth > 0 && row.naturalHeight > 0), `${label}: branded art decoded`).toBe(true);
  expect(state.every((row) => row.objectFit === "contain"), `${label}: full brand lettering stays uncropped`).toBe(true);
  expect(state.every((row) => row.renderedWidth > 0 && row.renderedHeight > 0), `${label}: branded art renders`).toBe(true);
}

async function expectOffscreenLoopsPaused(page, label) {
  const loops = page.locator(`${LOOP_SELECTOR}, [data-listing-drug-panel] picture[data-product-visual], .listing__category-art picture[data-product-visual]`);
  const count = await loops.count();
  if (!count) return;
  const states = await loops.evaluateAll((nodes) => nodes.map((node) => ({
    playState: getComputedStyle(node).animationPlayState,
    name: getComputedStyle(node).animationName,
    box: node.getBoundingClientRect().toJSON(),
  })));
  expect(states.every((row) => row.playState === "paused" || row.name === "none"), `${label}: idle and offscreen loops pause`).toBe(true);
}

async function expectVisibleStaticContent(page, label) {
  const hidden = await page.locator("main.p3-page :is(h1,h2,h3,p,a,button):not([hidden])").evaluateAll((nodes) => nodes.flatMap((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    if (!node.textContent.trim() || box.width === 0 || box.height === 0) return [];
    if (node.matches(':disabled,[aria-disabled="true"]') || node.closest("fieldset[disabled]")) return [];
    return Number(style.opacity) >= 0.99 && style.visibility === "visible"
      ? []
      : [{ tag: node.tagName, text: node.textContent.trim().slice(0, 80), opacity: style.opacity, visibility: style.visibility }];
  }));
  expect(hidden.slice(0, 30), `${label}: populated content remains visible`).toEqual([]);
}

async function progressiveScroll(page, label) {
  const surfaces = page.locator(MAJOR_SURFACES);
  const count = await surfaces.count();
  expect(count, `${label}: representative surfaces`).toBeGreaterThan(1);
  const passes = [
    [...Array(count).keys()],
    [...Array(count).keys()].reverse(),
    [...Array(count).keys()],
  ];

  for (const indexes of passes) {
    for (const index of indexes) {
      const surface = surfaces.nth(index);
      if (!await surface.isVisible()) continue;
      await surface.scrollIntoViewIfNeeded();
      await page.waitForTimeout(35);
      await expectNoHorizontalOverflow(page, `${label}: surface ${index}`);
      await expectResponsiveContentBounds(page, `${label}: surface ${index}`);
      await expectVisibleStaticContent(page, `${label}: surface ${index}`);
    }
  }
}

async function cardIds(locator) {
  return locator.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort());
}

async function assertPriceCardFacts(card, id) {
  const facts = governedCardFacts(id);
  const rows = card.locator('[data-provider-card-contract="option-c"] > div');
  await expect(rows.locator("dt")).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);
  for (const [index, expected] of [facts.medication, facts.cost, facts.cancellation].entries()) {
    await expect(rows.nth(index).locator("dd > span")).toHaveText(expected);
  }
}

async function assertUnpricedCardFacts(card) {
  const rows = card.locator('[data-provider-card-contract="option-c"] > div');
  await expect(rows.locator("dt")).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);
  await expect(rows.nth(0).locator("dd > span")).not.toBeEmpty();
  await expect(rows.nth(1).locator("dd > span")).toHaveText("Price not yet substantiated for this product/plan — check the provider's current terms");
  await expect(rows.nth(2).locator("dd > span")).toHaveText("Check the provider's cancellation terms.");
  await expect(card).toHaveAttribute("data-price", "");
}

test.setTimeout(180_000);

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`Lane F desktop visual acceptance at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "no-preference" });

    for (const routeSpec of DESKTOP_ROUTES) {
      test(`${routeSpec.family} progressively preserves width, content, cards, and images`, async ({ page, browser, baseURL }) => {
        await goto(page, routeSpec.route);
        if (routeSpec.archetype) {
          const pathname = new URL(routeSpec.route, "https://glpclinicscout.com").pathname;
          await expect(page.locator(`main.listing[data-listing-archetype="${routeSpec.archetype}"][data-phase3-route="${pathname}"]`)).toHaveCount(1);
        }
        for (const requirement of routeSpec.required) {
          const selector = typeof requirement === "string" ? requirement : requirement.selector;
          if (typeof requirement !== "string") {
            const { assertAcceptedModule } = await import("./p19-acceptance-support.mjs");
            await assertAcceptedModule(page, requirement.family, test.info());
          }
          const module = page.locator(selector);
          if (routeSpec.archetype) {
            await expect(module, `${routeSpec.route}: one ${selector}`).toHaveCount(1);
            if (routeSpec.archetype === "A" && selector === "#provider-results > [data-phase3-provider-grid]") {
              await expect(module, `${routeSpec.route}: empty numeric grid`).toBeHidden();
            } else {
              await expect(module, `${routeSpec.route}: ${selector}`).toBeVisible();
            }
          } else {
            await expect(module.first(), `${routeSpec.route}: ${selector}`).toBeVisible();
          }
        }
        if (routeSpec.archetype === "A") {
          const drug = new URL(routeSpec.route, "https://glpclinicscout.com").searchParams.get("drug");
          const { numeric, unpriced } = governedBulkCohorts(drug, routeSpec.route.startsWith("/3-") ? 3 : 6);
          expect(await cardIds(page.locator('#provider-results [data-phase3-provider-grid] [data-phase3-provider]'))).toEqual([...numeric].sort());
          expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...unpriced].sort());
          await expect(page.locator('[data-filter-result]')).toContainText(`${numeric.length} comparable price results`);
          for (const id of unpriced) await assertUnpricedCardFacts(page.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`));
          // The default numeric cohort is empty; select a real source-rendered
          // dose so Reset must clear a changed control rather than replay zero.
          const dose = page.locator('[data-filter-group="dose"] [data-filter="dose"][data-value="2.4"]');
          await dose.focus();
          await page.keyboard.press("Enter");
          await expect(dose).toHaveAttribute("aria-selected", "true");
          await expect(page.locator('[data-filter-group="dose"] [data-value="all"]')).toHaveAttribute("aria-selected", "false");
          await expect(page.locator('[data-active-filter-label]')).toContainText("Dose: 2.4 mg/week");
          await expect(page.locator('[data-filter-result]')).toContainText("0 comparable price results");
          const reset = page.locator('[data-filter-empty] [data-filter-reset]');
          await reset.focus();
          await page.keyboard.press("Enter");
          await expect(dose).toHaveAttribute("aria-selected", "false");
          await expect(page.locator('[data-filter-group="dose"] [data-value="all"]')).toHaveAttribute("aria-selected", "true");
          await expect(page.locator('[data-active-filter-label]')).toHaveText("Active filters: none.");
          await expect(page.locator('[data-filter-result]')).toContainText(`${numeric.length} comparable price results`);
          expect(await cardIds(page.locator('#provider-results [data-phase3-provider-grid] [data-phase3-provider]'))).toEqual([...numeric].sort());
          expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...unpriced].sort());
        }
        if (routeSpec.archetype === "C") {
          const primary = governedPaidPrimaryIds("SEMAGLUTIDE");
          const unknownIds = governedCompoundedUnknownIds("SEMAGLUTIDE");
          const unpricedIds = governedUnpricedIds("SEMAGLUTIDE");
          const unknown = page.locator('[data-state-unverified-remainder] [data-phase3-provider][data-state-mode="unknown"]');
          expect(unknownIds.length).toBeGreaterThan(0);
          expect(await cardIds(unknown)).toEqual(unknownIds);
          expect(await cardIds(page.locator('#provider-results [data-phase3-provider]'))).toEqual([...primary].sort());
          expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...unpricedIds].sort());
          expect(new Set([...primary, ...unknownIds, ...unpricedIds]).size).toBe(primary.length + unknownIds.length + unpricedIds.length);
          for (const id of [...primary, ...unknownIds]) await assertPriceCardFacts(page.locator(`[data-phase3-provider][data-program="${id}"]`).first(), id);
          for (const id of unpricedIds) await assertUnpricedCardFacts(page.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`));
          await expect(page.locator('[data-state-unverified-remainder]')).toContainText(/State availability not established/i);
          await page.locator('.p3-more-filters summary').click();
          const dose = page.locator('[data-filter-group="dose"] [data-value="2.4"]');
          await dose.focus();
          await page.keyboard.press("Enter");
          await expect(dose).toHaveAttribute("aria-selected", "true");
          await expect(page.locator('[data-filter-group="dose"] [data-value="all"]')).toHaveAttribute("aria-selected", "false");
          await expect(page.locator('[data-active-filter-label]')).toContainText("Dose: 2.4 mg/week");
          await expect(page.locator('[data-filter-result]')).toContainText("0 comparable price results");
          await expect(page.locator('[data-filter-empty]')).toContainText("No comparable price matches those filters.");
          const reset = page.locator('[data-filter-empty] [data-filter-reset]');
          await reset.focus();
          await page.keyboard.press("Enter");
          await expect(dose).toHaveAttribute("aria-selected", "false");
          await expect(page.locator('[data-filter-group="dose"] [data-value="all"]')).toHaveAttribute("aria-selected", "true");
          await expect(page.locator('[data-active-filter-label]')).toHaveText("Active filters: none.");
          await expect(page.locator('[data-filter-result]')).toContainText(`${primary.length} comparable price result`);
          expect(await cardIds(page.locator('#provider-results [data-phase3-provider-grid] [data-phase3-provider]'))).toEqual([...primary].sort());
          expect(await cardIds(page.locator('[data-state-unverified-remainder] [data-phase3-provider]'))).toEqual(unknownIds);
          expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...unpricedIds].sort());
        }
        if (routeSpec.archetype === "B") {
          const numericIds = await page.locator('#provider-results > [data-phase3-provider-grid] [data-phase3-provider]').evaluateAll((nodes) => nodes.map((node) => node.dataset.program));
          const unpricedIds = await page.locator('[data-unpublished-provider-section] [data-phase3-provider]').evaluateAll((nodes) => nodes.map((node) => node.dataset.program));
          expect(numericIds).toEqual(governedWegovyIds());
          expect([...unpricedIds].sort()).toEqual(governedWegovyUnpricedIds());
          const brand = governedBrandCohorts("brand-wegovy");
          expect([...numericIds].sort()).toEqual(brand.numeric);
          expect([...unpricedIds].sort()).toEqual(brand.unpriced);
          expect(new Set([...numericIds, ...unpricedIds]).size).toBe(numericIds.length + unpricedIds.length);
          await expect(page.locator('[data-filter-result]')).toContainText(`${brand.numeric.length} comparable price result`);
          if (brand.numeric.length === 0) await expect(page.locator('[data-numeric-empty]')).toBeVisible();
          for (const id of numericIds) await assertPriceCardFacts(page.locator(`#provider-results article[data-program="${id}"]`), id);
          for (const id of unpricedIds) {
            const card = page.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`);
            await expect(card).toBeVisible();
            await assertUnpricedCardFacts(card);
          }
          const excluded = new Set(governedExcludedIds());
          expect([...numericIds, ...unpricedIds].filter((id) => excluded.has(id))).toEqual([]);
          const ozempic = page.locator('[data-filter="treatment"][data-value="OZEMPIC"]');
          await ozempic.focus();
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(/\/ozempic\/\?/);
          const zero = governedBrandCohorts("brand-ozempic");
          expect(zero.numeric).toEqual([]);
          expect(await cardIds(page.locator('#provider-results > [data-phase3-provider-grid] [data-phase3-provider]'))).toEqual(zero.numeric);
          expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual(zero.unpriced);
          await expect(page.locator('[data-filter-empty]')).toBeVisible();
          // Ozempic has no numeric default to restore. Replay a non-default
          // form on Wegovy so keyboard Reset has an observable numeric recovery.
          await goto(page, `${routeSpec.route}?form=COMPOUNDED`);
          const adverseForm = page.locator('[data-filter-group="type"] [data-value="compounded"]');
          await expect(adverseForm).toHaveAttribute("aria-selected", "true");
          await expect(page.locator('[data-filter-group="type"] [data-value="brand"]')).toHaveAttribute("aria-selected", "false");
          await expect(page.locator('[data-active-filter-label]')).toContainText("Form: Compounded");
          await expect(page.locator('[data-filter-result]')).toContainText("0 comparable price results");
          expect(await cardIds(page.locator('#provider-results > [data-phase3-provider-grid] [data-phase3-provider]:visible'))).toEqual([]);
          const reset = page.locator('[data-filter-empty] [data-filter-reset]');
          await reset.focus();
          await expect(reset).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(adverseForm).toHaveAttribute("aria-selected", "false");
          await expect(page.locator('[data-filter-group="type"] [data-value="brand"]')).toHaveAttribute("aria-selected", "true");
          await expect(page.locator('[data-active-filter-label]')).toHaveText("Active filters: none.");
          await expect(page.locator('[data-filter-result]')).toContainText(`${brand.numeric.length} comparable price result`);
          expect(await cardIds(page.locator('#provider-results > [data-phase3-provider-grid] [data-phase3-provider]'))).toEqual(brand.numeric);
          expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual(brand.unpriced);
          const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: viewport.width, height: viewport.height } });
          try {
            const fallback = await noJs.newPage();
            await fallback.goto(new URL(routeSpec.route, baseURL).href, { waitUntil: "domcontentloaded" });
            await expect(fallback.locator('main.listing[data-listing-archetype="B"] h1')).toBeVisible();
            await expect(fallback.locator('main.listing .p3-state-native select')).toBeVisible();
            expect(await cardIds(fallback.locator('#provider-results [data-provider-noscript-card]'))).toEqual(brand.numeric);
            expect(await cardIds(fallback.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual(brand.unpriced);
            for (const id of brand.numeric) await assertPriceCardFacts(fallback.locator(`#provider-results [data-provider-noscript-card][data-program="${id}"]`), id);
            for (const id of brand.unpriced) await assertUnpricedCardFacts(fallback.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`));
            await expect(fallback.locator('[data-unpublished-provider-section] a[href^="/reviews/"]').first()).toBeVisible();
          } finally {
            await noJs.close();
          }
        }
        await expectWideDesktopAnatomy(page, routeSpec, viewport);
        await progressiveScroll(page, `${viewport.name} ${routeSpec.route}`);
        await expectNoHorizontalOverflow(page, `${viewport.name} ${routeSpec.route}`);
        await expectCardAndContentBounds(page, `${viewport.name} ${routeSpec.route}`);
        await expectResponsiveContentBounds(page, `${viewport.name} ${routeSpec.route}`);
        await expectAuroraLogoBands(page, `${viewport.name} ${routeSpec.route}`);
        await expectOffscreenLoopsPaused(page, `${viewport.name} ${routeSpec.route}`);
        if (routeSpec.images) await decodeEveryImage(page, `${viewport.name} ${routeSpec.route}`);
        if (routeSpec.brandedArt) await expectBrandedArtUsesReadableCrop(page, `${viewport.name} ${routeSpec.route}`);
      });
    }
  });
}

test.describe("Lane F static and motion fallbacks", () => {
  test("reduced motion stops every Phase 3 loop while content remains readable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await goto(page, "/wegovy/");
    await progressiveScroll(page, "reduced-motion Wegovy");
    const states = await page.locator(LOOP_SELECTOR).evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        name: style.animationName,
        duration: style.animationDuration,
        iterations: style.animationIterationCount,
        playState: style.animationPlayState,
        transform: style.transform,
      };
    }));
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((row) => row.name === "none"), "reduced motion removes animation rather than requiring an artificial paused state").toBe(true);
    await expectVisibleStaticContent(page, "reduced-motion Wegovy");
  });

  test("JS-off product and listing content stays visible with native controls", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1366, height: 768 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      const origin = baseURL || "http://127.0.0.1:4500";
      const response = await page.goto(new URL("/wegovy/", origin).href, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page.locator("main.p3-page")).toBeVisible();
      const heading = page.locator('main.listing[data-listing-archetype="B"][data-phase3-route="/wegovy/"] > header.listing__intro h1');
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeVisible();
      await expect(page.locator(".p3-filterbar")).toBeVisible();
      await expect(page.locator(".p3-provider-grid [data-phase3-provider]").first()).toBeVisible();
      await expect(page.locator(".p3-state-native select")).toBeVisible();
      await expectVisibleStaticContent(page, "JS-off Wegovy");
      await expectNoHorizontalOverflow(page, "JS-off Wegovy");
      await expectCardAndContentBounds(page, "JS-off Wegovy");
    } finally {
      await context.close();
    }
  });
});

/* Existing gap assertions remain in this owned spec so the visual pass does not
   erase the focused Phase 3 data/markup acceptance that preceded Lane F. */
test("G-2 provider hub exposes its evidence-qualified Option C cards", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await goto(page, "/providers/");
  const cards = page.locator("[data-phase3-provider]");
  // KAEL-DECISION-20260923-optionc-governing-mappings.md A3.1.
  const ids = governedProviderIds();
  const renderedIds = (await page.locator('[data-canonical-provider-ids]').getAttribute('data-canonical-provider-ids')).split(',');
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(renderedIds)).toEqual(new Set(ids));
  expect(await cards.evaluateAll((rows) => rows.map((row) => row.dataset.program).sort())).toEqual([...ids].sort());
  await expect(cards.locator("[data-provider-card-contract='option-c']")).toHaveCount(Math.min(12, ids.length));
  await expect(page.locator('[data-phase3-provider][data-provider-lazy-index]')).toHaveCount(Math.max(0, ids.length - 12));
  const hydrated = await hydrateAllProviderCards(page);
  await expect(hydrated.locator("[data-provider-card-contract='option-c']")).toHaveCount(ids.length);
  for (const id of ids) await assertPriceCardFacts(page.locator(`#provider-results article[data-program="${id}"]`), id);
  const excluded = new Set(governedExcludedIds());
  expect(ids.filter((id) => excluded.has(id))).toEqual([]);
  await expect(page.locator("[data-provider-record]")).toHaveCount(0);
  const nuImage = page.locator('article[data-program="nu-image-medical-review"]');
  await expect(nuImage).toContainText("Nu Image Medical");
  await expect(nuImage.locator('[data-provider-card-contract="option-c"] dt')).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);
  await expect(nuImage.locator('[data-citation="inline_fact_source"]').first()).toBeAttached();
  await expect(nuImage.locator('[data-affiliate-unavailable]')).toHaveCount(0);
  const nuImageAction = nuImage.locator('a[data-analytics-event="affiliate_click"][data-program="nu-image-medical-review"]');
  await expect(nuImageAction).toHaveCount(1);
  await expect(nuImageAction).toHaveAttribute("rel", /\bsponsored\b/);
  await expect(nuImage).not.toContainText(/facts remain unbound/i);
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  try {
    const fallback = await noJs.newPage();
    await fallback.goto(new URL("/providers/", baseURL).href, { waitUntil: "domcontentloaded" });
    const staticCards = fallback.locator('#provider-results article[data-phase3-provider]:not([data-provider-lazy-index])');
    expect(await cardIds(staticCards)).toEqual([...ids].sort());
    for (const id of ids) await assertPriceCardFacts(fallback.locator(`#provider-results article[data-phase3-provider]:not([data-provider-lazy-index])[data-program="${id}"]`), id);
    await expect(fallback.locator('.p3-state-native select')).toBeVisible();
  } finally { await noJs.close(); }
});

test("G-3 product treatment paths, completion action, and image-backed related shelf are served", async ({ page }) => {
  await goto(page, "/mounjaro/");
  const treatmentPaths = page.locator("[data-with-without-insurance]");
  await expect(treatmentPaths).toContainText(/Without insurance/i);
  await expect(treatmentPaths).toContainText(/With insurance/i);
  const wizard = treatmentPaths.locator("[data-insurance-wizard]");
  await expect(wizard.locator("[data-insurance-complete]")).toBeVisible();
  const related = page.locator("[data-related-provider-shelf]");
  await expect(related.locator("a[data-wrap-card]")).toHaveCount(3);
  await expect(related.locator("picture")).toHaveCount(3);
  await expect(related.locator("img[width][height]")).toHaveCount(3);
});

test("G-4 selecting a dose filters card metadata without rendering card dose grids", async ({ page }) => {
  await goto(page, "/lp/best-providers/compounded-semaglutide/");
  await page.locator(".p3-more-filters summary").click();
  const button = page.locator('[data-filter="dose"][data-value="0.25"]');
  await button.click();
  await expect(button).toHaveAttribute("role", "tab");
  await expect(button).toHaveAttribute("aria-selected", "true");
  await expect(button).toHaveAttribute("tabindex", "0");
  expect(await page.locator("[data-phase3-provider]:visible").count()).toBeGreaterThan(0);
  await expect(page.locator("[data-phase3-provider] .p3-dose-grid")).toHaveCount(0);
});

test("G-5 every bulk intent separates comparable prices from visible non-priced records", async ({ page, browser, baseURL }) => {
  for (const route of [
    "/3-month/?drug=SEMAGLUTIDE",
    "/3-month/?drug=TIRZEPATIDE",
    "/6-month/?drug=SEMAGLUTIDE",
    "/6-month/?drug=TIRZEPATIDE",
  ]) {
    await goto(page, route);
    // A2.2–A2.3: an empty numeric cohort is not an empty research cohort.
    const { numeric: expectedNumeric, unpriced: expectedUnpriced } = governedBulkCohorts(
      new URL(route, "https://glpclinicscout.com").searchParams.get("drug"), route.startsWith("/3-") ? 3 : 6,
    );
    const numeric = page.locator('#provider-results [data-phase3-provider-grid] > [data-phase3-provider]');
    await expect(page.locator("[data-filter-result]")).toContainText(`${expectedNumeric.length} comparable price results`);
    expect(await numeric.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedNumeric].sort());
    const unpriced = page.locator('[data-unpublished-provider-section] [data-phase3-provider]');
    expect(await cardIds(unpriced)).toEqual([...expectedUnpriced].sort());
    for (const id of expectedUnpriced) await assertUnpricedCardFacts(page.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`));
    const excluded = new Set(governedExcludedIds());
    expect([...expectedNumeric, ...expectedUnpriced].filter((id) => excluded.has(id))).toEqual([]);
    if (expectedUnpriced.length) {
      await expect(page.locator('[data-unpublished-provider-section]')).toBeVisible();
      await expect(unpriced.first()).toBeVisible();
    } else await expect(unpriced).toHaveCount(0);
    if (expectedNumeric.length === 0) {
      await expect(page.locator('[data-filter-empty]')).toContainText(expectedUnpriced.length
        ? "No comparable price matches those filters." : "No source-backed record matches those filters.");
      await expect(page.locator('[data-filter-empty]')).toContainText("not a medical or availability conclusion");
      // Bulk routes retain the source-default semaglutide dose controls.
      const doseValue = "2.4";
      const dose = page.locator(`[data-filter-group="dose"] [data-value="${doseValue}"]`);
      await dose.focus();
      await page.keyboard.press("Enter");
      await expect(dose).toHaveAttribute("aria-selected", "true");
      await expect(page.locator('[data-filter-group="dose"] [data-value="all"]')).toHaveAttribute("aria-selected", "false");
      await expect(page.locator('[data-active-filter-label]')).toContainText(`Dose: ${doseValue} mg/week`);
      await expect(page.locator('[data-filter-result]')).toContainText("0 comparable price results");
      const reset = page.locator('[data-filter-empty] [data-filter-reset]');
      await reset.focus();
      await expect(reset).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dose).toHaveAttribute("aria-selected", "false");
      await expect(page.locator('[data-filter-group="dose"] [data-value="all"]')).toHaveAttribute("aria-selected", "true");
      await expect(page.locator('[data-active-filter-label]')).toHaveText("Active filters: none.");
      expect(await cardIds(numeric)).toEqual([...expectedNumeric].sort());
      expect(await cardIds(unpriced)).toEqual([...expectedUnpriced].sort());
      await expect(page.locator('[data-filter-result]')).toContainText("0 comparable price results");
    }
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    try {
      const fallback = await noJs.newPage();
      await fallback.goto(new URL(route, baseURL).href, { waitUntil: "domcontentloaded" });
      expect(await cardIds(fallback.locator('#provider-results [data-phase3-provider-grid] [data-phase3-provider]'))).toEqual([...expectedNumeric].sort());
      expect(await cardIds(fallback.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...expectedUnpriced].sort());
      for (const id of expectedUnpriced) await assertUnpricedCardFacts(fallback.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`));
      await expect(fallback.locator('.p3-state-native select')).toBeVisible();
    } finally { await noJs.close(); }
  }
});

test("mapped C numeric empty, keyboard reset, and no-JS cohorts remain separate", async ({ page, browser, baseURL }) => {
  const route = "/lp/best-providers/compounded-semaglutide/";
  const primary = governedPaidPrimaryIds("SEMAGLUTIDE");
  const unknown = governedCompoundedUnknownIds("SEMAGLUTIDE");
  const unpriced = governedUnpricedIds("SEMAGLUTIDE");
  await goto(page, route);
  const initial = page.locator('#provider-results [data-phase3-provider]:visible');
  expect(await cardIds(initial)).toEqual([...primary].sort());
  await page.locator('[data-filter="plan"][data-value="1"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-filter="plan"][data-value="1"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('.p3-more-filters summary').click();
  const dose = page.locator('[data-filter="dose"][data-value="2.4"]');
  await dose.focus();
  await page.keyboard.press("Enter");
  await expect(dose).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-filter="dose"][data-value="all"]')).toHaveAttribute("aria-selected", "false");
  await expect(page.locator('[data-active-filter-label]')).toContainText("Dose: 2.4 mg/week");
  await expect(initial).toHaveCount(0);
  await expect(page.locator('[data-filter-empty]')).toBeVisible();
  await expect(page.locator('[data-filter-empty]')).toContainText("No comparable price matches those filters.");
  await expect(page.locator('[data-filter-result]')).toContainText("0 comparable price results");
  expect(await cardIds(page.locator('[data-state-unverified-remainder] [data-phase3-provider]'))).toEqual(unknown);
  expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...unpriced].sort());
  const reset = page.locator('[data-filter-empty] [data-filter-reset]');
  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-filter="plan"][data-value="1"]')).toHaveAttribute("aria-selected", "false");
  await expect(page.locator('[data-filter="plan"][data-value="both"]')).toHaveAttribute("aria-selected", "true");
  await expect(dose).toHaveAttribute("aria-selected", "false");
  await expect(page.locator('[data-filter="dose"][data-value="all"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-active-filter-label]')).toHaveText("Active filters: none.");
  await expect(page.locator('[data-filter-result]')).toContainText(`${primary.length} comparable price result`);
  expect(await cardIds(initial)).toEqual([...primary].sort());
  expect(await cardIds(page.locator('[data-state-unverified-remainder] [data-phase3-provider]'))).toEqual(unknown);
  expect(await cardIds(page.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...unpriced].sort());
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  try {
    const fallback = await noJs.newPage();
    await fallback.goto(new URL(route, baseURL).href, { waitUntil: "domcontentloaded" });
    expect(await cardIds(fallback.locator('#provider-results [data-phase3-provider]'))).toEqual([...primary].sort());
    expect(await cardIds(fallback.locator('[data-state-unverified-remainder] [data-phase3-provider]'))).toEqual(unknown);
    expect(await cardIds(fallback.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual([...unpriced].sort());
    for (const id of [...primary, ...unknown]) await assertPriceCardFacts(fallback.locator(`article[data-phase3-provider][data-program="${id}"]`).first(), id);
    for (const id of unpriced) await assertUnpricedCardFacts(fallback.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`));
    await expect(fallback.locator('.p3-state-native select')).toBeVisible();
  } finally { await noJs.close(); }
});

test("mapped brand zero-price branch retains source-backed records without JS", async ({ page, browser, baseURL }) => {
  const cohort = governedBrandCohorts("brand-ozempic");
  expect(cohort.numeric).toEqual([]);
  expect(cohort.unpriced.length).toBeGreaterThan(0);
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ javaScriptEnabled });
    try {
      const view = await context.newPage();
      await view.goto(new URL("/ozempic/", baseURL).href, { waitUntil: "domcontentloaded" });
      expect(await cardIds(view.locator('#provider-results [data-phase3-provider]'))).toEqual(cohort.numeric);
      expect(await cardIds(view.locator('[data-unpublished-provider-section] [data-phase3-provider]'))).toEqual(cohort.unpriced);
      await expect(view.locator('[data-filter-result]')).toContainText("0 comparable price results");
      await expect(view.locator('[data-filter-empty]')).toContainText("not a medical or availability conclusion");
      for (const id of cohort.unpriced) await assertUnpricedCardFacts(view.locator(`[data-unpublished-provider-section] [data-phase3-provider][data-program="${id}"]`));
      await expect(view.locator('.p3-state-native select')).toBeVisible();
    } finally { await context.close(); }
  }
});

test("G-6 guide exposes linked curator identity and FAQ disclosure", async ({ page }) => {
  await goto(page, "/guides/trimi-vs-yourera/");
  const author = page.locator("[data-author-block]");
  await expect(author).toContainText(/Curated and evidence-reviewed by/i);
  await expect(author.locator('a[href="/authors/clinic-scout-editorial-team/"]')).toHaveCount(1);
  await expect(page.locator("[data-faq-disclosure] details")).toHaveCount(2);
});

test("G-7 pharmacy additive filters, related shelf, and sourced reverse comparisons work", async ({ page }) => {
  await goto(page, "/pharmacies/");
  const additive = page.locator("[data-pharmacy-additive]");
  const options = await additive.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value).filter((value) => value !== "all"));
  expect(options.length).toBeGreaterThan(0);
  const mobileFilterTrigger = page.getByRole("button", { name: /^Pharmacy filters/ });
  if (await mobileFilterTrigger.isVisible()) {
    await mobileFilterTrigger.click();
    await expect(page.locator("[data-pharmacy-filters]")).toBeVisible();
  }
  await additive.selectOption(options[0]);
  await expect(page.locator("[data-pharmacy-result]")).toContainText(/Showing \d+ evidence record/i);
  if (await mobileFilterTrigger.isVisible()) {
    await page.getByRole("button", { name: "Show results" }).click();
    await expect(page.locator("[data-pharmacy-filters]")).toBeHidden();
  }
  expect(await page.locator("[data-pharmacy-card]:visible").count()).toBeGreaterThan(0);

  await goto(page, "/pharmacies/red-rock/");
  await expect(page.locator("[data-related-pharmacies] a")).toHaveCount(3);

  for (const route of ["/pharmacies/strive/compare-providers/", "/pharmacies/the-pharmacy-hub/compare-providers/"]) {
    await goto(page, route);
    await expect(page.getByText("Verified source relationship", { exact: true }).first()).toBeVisible();
    await expect(page.locator('a[href="https://enhance.md/faq"]')).toHaveCount(1);
    await expect(page.locator('a[href="/providers/enhance-md/"]')).toHaveCount(1);
  }
});

test("G-8 article cards use unique responsive AVIF/WebP pictures with intrinsic dimensions", async ({ page }) => {
  await goto(page, "/insights/");
  const pictures = page.locator(".p3-insight-cycle picture");
  const count = await pictures.count();
  expect(count).toBeGreaterThan(0);
  await expect(pictures.locator('source[type="image/avif"]')).toHaveCount(count);
  await expect(pictures.locator('source[type="image/webp"]')).toHaveCount(count);
  const images = pictures.locator("img");
  await expect(images).toHaveCount(count);
  const metadata = await images.evaluateAll((nodes) => nodes.map((node) => ({ src: node.getAttribute("src"), width: node.getAttribute("width"), height: node.getAttribute("height"), srcset: node.getAttribute("srcset") })));
  expect(new Set(metadata.map((row) => row.src)).size).toBe(metadata.length);
  expect(metadata.every((row) => row.width === "1600" && row.height === "900" && row.srcset)).toBe(true);
});

test("O-35 canonical Mounjaro coupon route remains served under its exact-byte contract", async ({ page }) => {
  await goto(page, "/guides/mounjaro-coupon/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://glpclinicscout.com/guides/mounjaro-coupon/");
  await expect(page.locator("h1")).toContainText(/Mounjaro Coupon/i);
});
