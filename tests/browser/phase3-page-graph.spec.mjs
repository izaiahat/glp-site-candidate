import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { approvedRetirement } from "./retirement-support.mjs";
import { pageSeoCopy } from "../../src/page-seo-copy.mjs";
import { loadGoSelection } from "../../src/go-runtime-selection.mjs";
import { governedBulkCohorts, governedCompoundedUnknownIds, governedPaidPrimaryIds, governedUnpricedIds } from "./governed-cohort.mjs";

const SITE_JS_PATH = fileURLToPath(new URL("../../assets/site.js", import.meta.url));

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const REPRESENTATIVE_ROUTES = [
  { family: "brand", path: "/wegovy/", marker: 'main.listing[data-listing-archetype="B"] > .listing__intro', heading: "Wegovy" },
  {
    family: "compounded",
    path: "/lp/best-providers/compounded-semaglutide/",
    marker: 'main.listing[data-listing-archetype="C"] > .listing__intro',
    heading: "Compounded semaglutide",
  },
  {
    family: "bulk-3",
    path: "/3-month/",
    marker: 'main.listing[data-listing-archetype="A"] > .listing__intro',
    heading: "3-month",
  },
  {
    family: "bulk-6",
    path: "/6-month/",
    marker: 'main.listing[data-listing-archetype="A"] > .listing__intro',
    heading: "6+ month",
  },
  {
    family: "providers",
    path: "/providers/",
    marker: 'main.listing[data-listing-archetype="E"] > .listing__intro',
    heading: pageSeoCopy("/providers/").h1,
  },
  {
    family: "self-pay",
    path: "/self-pay/",
    marker: 'main.listing[data-listing-archetype="E"] > .listing__intro',
    heading: "Compare 3 self-pay provider options",
  },
  {
    family: "insights",
    path: "/insights/",
    marker: ".p3-insights-hero",
    heading: "Insights",
  },
  {
    family: "provider-detail",
    path: "/providers/trimi-glp-1/",
    marker: ".p3-index-hero",
    heading: "Trimi · Compounded semaglutide (injection)",
  },
  {
    family: "pharmacy-hub",
    path: "/pharmacies/",
    marker: 'main.listing[data-listing-archetype="D"] > .listing__intro',
    heading: "Compare compounding pharmacies",
  },
  {
    family: "pharmacy-detail",
    path: "/pharmacies/red-rock/",
    marker: ".p3-pharmacy-hero",
    heading: "Red Rock Pharmacy",
  },
];

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;
const QUIZ_PREFERENCES_KEY = "gcs.quiz.provider-fit.preferences.v1";

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "gcs-cookie-v2-default-on-20260730",
      saved_at: "2026-08-22T00:00:00.000Z",
    }));
  });
  // Lane G changes source only. Fulfill this one owned asset from source so the
  // focused runtime checks remain baseline-safe and never require a worker build.
  await page.route("**/assets/site.js*", (route) => route.fulfill({
    status: 200,
    path: SITE_JS_PATH,
    contentType: "application/javascript",
    headers: { "cache-control": "no-store" },
  }));
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

function watchRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  return errors;
}

async function gotoPhase3(page, route) {
  const response = await page.goto(route, { waitUntil: "networkidle" });
  expect(response?.status(), route).toBe(200);
  const path = new URL(route, "https://glpclinicscout.com").pathname;
  await expect(page.locator(`main[data-phase3-route="${path}"]`), route).toHaveCount(1);
  return response;
}

async function readUrlState(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    search: Object.fromEntries(new URL(location.href).searchParams.entries()),
  }));
}

async function expectUrlState(page, expected) {
  await expect.poll(() => readUrlState(page)).toEqual(expected);
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

async function expectGovernedGoLinks(links, page) {
  const selectedPrograms = Object.values(loadGoSelection()?.programs || {});
  const records = await links.evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute("href"), program: node.dataset.program,
    mode: node.dataset.linkMode, event: node.dataset.analyticsEvent,
    rel: node.rel.split(/\s+/).filter(Boolean),
  })));
  for (const link of records) {
    const selected = selectedPrograms.filter((program) => program.program_id === link.program || program.render_id === link.program);
    expect(selected).toHaveLength(1);
    expect(selected[0].disposition).toBe("ADOPT");
    expect(link.mode).toBe("server-redirect");
    expect(link.event).toBe("affiliate_click");
    expect(link.rel).toEqual(expect.arrayContaining(["sponsored", "nofollow", "noopener"]));
    const target = new URL(link.href, page.url());
    expect(target.origin).toBe(new URL(page.url()).origin);
    expect(target.pathname).toBe(selected[0].route);
    expect(target.hash).toBe("");
    expect([...target.searchParams.keys()].sort()).toEqual(["s", "v"]);
    expect(target.searchParams.get("s")).toMatch(/^[a-z0-9][a-z0-9-]{0,79}\.[a-z0-9][a-z0-9-]{0,11}$/);
    expect(target.searchParams.get("v")).toBe("a");
  }
}

async function expectLinksAreUsable(page) {
  await expect(page.locator("a:not([href])")).toHaveCount(0);
  await expectGovernedGoLinks(page.locator('a[href^="/go/"]'), page);
  const problems = await page.locator("a[href]").evaluateAll((anchors) => anchors.flatMap((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (!href.trim()) return [{ href, reason: "empty href" }];
    if (/^javascript:/i.test(href)) return [{ href, reason: "javascript target" }];
    let target;
    try {
      target = new URL(href, location.href);
    } catch {
      return [{ href, reason: "unparseable target" }];
    }
    if (!["http:", "https:", "mailto:", "tel:"].includes(target.protocol)) {
      return [{ href, reason: `unsupported protocol ${target.protocol}` }];
    }
    if (target.origin === location.origin
      && target.pathname === location.pathname
      && target.hash
      && !document.getElementById(decodeURIComponent(target.hash.slice(1)))) {
      return [{ href, reason: "missing same-page fragment" }];
    }
    if (anchor.target === "_blank" && !anchor.rel.split(/\s+/).includes("noopener")) {
      return [{ href, reason: "blank target lacks noopener" }];
    }
    return [];
  }));
  expect(problems).toEqual([]);
}

async function expectContained(child, parent) {
  const [childBox, parentBox] = await Promise.all([child.boundingBox(), parent.boundingBox()]);
  expect(childBox).not.toBeNull();
  expect(parentBox).not.toBeNull();
  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x - 1);
  expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y - 1);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + parentBox.width + 1);
  expect(childBox.y + childBox.height).toBeLessThanOrEqual(parentBox.y + parentBox.height + 1);
}

async function expectCouponChipsStayInsideCards(page) {
  const chips = page.locator("[data-coupon-copy]:visible");
  const count = await chips.count();
  for (let index = 0; index < count; index += 1) {
    const chip = chips.nth(index);
    const code = await chip.getAttribute("data-coupon-code");
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(chip).toHaveAttribute("aria-label", /Copy coupon/i);
    const card = chip.locator("xpath=ancestor::*[@data-phase3-provider][1]");
    await expect(card).toHaveCount(1);
    await expectContained(chip, card);
  }
  return count;
}

async function expectInsideViewport(locator) {
  const readGeometry = () => locator.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  await expect.poll(async () => {
    const geometry = await readGeometry();
    return geometry.left >= -1
      && geometry.right <= geometry.viewportWidth + 1
      && geometry.top >= -1
      && geometry.bottom <= geometry.viewportHeight + 1;
  }, { timeout: 2000, message: "element should settle fully inside the viewport" }).toBe(true);
}

async function openAndCloseMobileDrawer(page) {
  const toggle = page.locator("[data-menu-toggle]");
  const drawer = page.locator("[data-menu]");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).toBeVisible();
  await expectInsideViewport(drawer);
  await expect(drawer.locator('a[href="/insights/"]')).toBeVisible();
  await expect(drawer.locator('a[href="/pharmacies/"]')).toBeVisible();
  await drawer.locator("[data-menu-close]").click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toBeHidden();
}

for (const viewport of VIEWPORTS) {
  test(`representative Phase 3 route families render truthfully at ${viewport.width}px`, async ({ page }) => {
    const errors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of REPRESENTATIVE_ROUTES) {
      errors.length = 0;
      await gotoPhase3(page, route.path);
      await expect(page.locator(route.marker), route.path).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: route.heading, exact: true }), route.path).toBeVisible();
      await expect(page.locator("h1"), route.path).toHaveCount(1);
      const expectedRobots = route.path.startsWith("/lp/") ? /^noindex,nofollow/ : /^index,follow/;
      await expect(page.locator('meta[name="robots"]'), route.path).toHaveAttribute("content", expectedRobots);
      await expect(page.locator('link[rel="canonical"]'), route.path).toHaveAttribute("href", `https://glpclinicscout.com${route.path}`);
      await expect(page.locator("body > .skip-link"), route.path).toHaveCount(1);
      await expect(page.locator(".gcs-nav"), route.path).toHaveCount(1);
      await expect(page.locator(".gcs-footer"), route.path).toHaveCount(1);

      const duplicateIds = await page.locator("[id]").evaluateAll((nodes) => nodes
        .map((node) => node.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index));
      expect(duplicateIds, route.path).toEqual([]);
      await expectLinksAreUsable(page);
      await expectNoHorizontalOverflow(page);

      if (viewport.name === "mobile") {
        await openAndCloseMobileDrawer(page);
        await expectNoHorizontalOverflow(page);
      }

      await page.waitForTimeout(50);
      expect(errors, route.path).toEqual([]);
    }
  });
}

test("listing controls canonicalize product, molecule, form, plan, dose, sort, and state URL semantics", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const route = "/lp/best-providers/compounded-semaglutide/";
  await gotoPhase3(page, `${route}?region=OR&drug=SEMAGLUTIDE&form=COMPOUNDED&duration=3&dose=0.5&sort=cheapest`);

  await expectUrlState(page, {
    path: route,
    search: {
      state: "OR",
      drug: "SEMAGLUTIDE",
      form: "COMPOUNDED",
      plan: "3",
      dose: "0.5",
      sort: "cheapest",
    },
  });
  const filters = page.locator("[data-provider-filters]");
  await expect(filters).toHaveAttribute("data-phase3-route-ready", "true");
  for (const group of ["treatment", "type", "plan", "dose", "sort"]) {
    const selected = filters.locator(`[data-filter-group="${group}"] [aria-selected="true"]`);
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("role", "tab");
    await expect(selected).toHaveAttribute("tabindex", "0");
  }
  await expect(filters.locator('[data-filter-group="treatment"] [aria-selected="true"]')).toHaveCount(1);
  await expect(filters.locator('[data-filter="type"][data-value="compounded"]')).toHaveAttribute("aria-selected", "true");
  await expect(filters.locator('[data-filter="plan"][data-value="3"]')).toHaveAttribute("aria-selected", "true");
  await expect(filters.locator('[data-filter="dose"][data-value="0.5"]')).toHaveAttribute("aria-selected", "true");
  await expect(filters.locator('[data-filter="sort"][data-value="cheapest"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('main.listing .listing__intro .p3-state-popover [data-state="OR"]')).toHaveAttribute("aria-selected", "true");
  const currentProduct = page.locator('a[data-filter-route][data-route-family="compounded-category"][aria-current="page"]');
  await expect(currentProduct).toHaveCount(1);
  const productState = await currentProduct.evaluate((link) => {
    const target = new URL(link.href);
    return { path: target.pathname, search: Object.fromEntries(target.searchParams.entries()) };
  });
  expect(productState).toEqual({
    path: route,
    search: { state: "OR", drug: "SEMAGLUTIDE", form: "COMPOUNDED", plan: "3", dose: "0.5", sort: "cheapest" },
  });

  await filters.locator('.p3-more-filters summary').click();
  await filters.locator('[data-filter="dose"][data-value="2.4"]').click();
  const changed = await readUrlState(page);
  expect(changed.search).toEqual({
    state: "OR",
    drug: "SEMAGLUTIDE",
    form: "COMPOUNDED",
    plan: "3",
    dose: "2.4",
    sort: "cheapest",
  });
  await expect(filters.locator('[data-filter-group="dose"] [aria-selected="true"]')).toHaveCount(1);
  await expect(filters.locator('[data-filter="dose"][data-value="2.4"]')).toHaveAttribute("aria-selected", "true");
  // KAEL-DECISION-20260923-optionc-governing-mappings.md A2.1: the
  // unknown-state remainder is not an Oregon-verified match.
  const remainder = page.locator('[data-state-unverified-remainder]');
  await expect(page.locator("[data-filter-result]")).toContainText('0 requiring direct state verification');
  await expect(remainder).toBeHidden();
  await filters.locator('[data-filter="dose"][data-value="all"]').click();
  await filters.locator('[data-filter="plan"][data-value="both"]').click();
  const expectedVerified = governedPaidPrimaryIds("SEMAGLUTIDE").sort();
  const expectedUnknown = governedCompoundedUnknownIds("SEMAGLUTIDE");
  expect(expectedUnknown.length).toBeGreaterThan(0);
  const verifiedCards = page.locator('#provider-results [data-phase3-provider][data-filter-match="true"][data-selected-state-status="verified"]');
  const unknownCards = remainder.locator('[data-phase3-provider][data-state-mode="unknown"][data-filter-match="true"][data-selected-state-status="unverified"]');
  await expect.poll(() => verifiedCards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual(expectedVerified);
  await expect.poll(() => unknownCards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual(expectedUnknown);
  await expect(remainder).toBeVisible();
  expect(await remainder.locator('[data-phase3-provider][data-filter-match="true"]').count()).toBe(expectedUnknown.length);
  await expect(page.locator("[data-filter-result]")).toContainText(`${expectedVerified.length} with explicit state evidence`);
  await expect(page.locator("[data-filter-result]")).toContainText(`${expectedUnknown.length} requiring direct state verification`);
  if (expectedVerified.length === 0) await expect(page.locator("[data-filter-empty]")).toBeVisible();
  else await expect(page.locator("[data-filter-empty]")).toBeHidden();
  expect(errors).toEqual([]);
});

test("brand and compounded controls cross-route within the matching molecule family", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoPhase3(page, "/wegovy/?state=OR&duration=12&plan=3&sort=cheapest");

  await expectUrlState(page, {
    path: "/wegovy/",
    search: { state: "OR", drug: "WEGOVY", form: "BRAND_NAME", sort: "cheapest" },
  });
  await expect(page.locator('[data-filter-group="plan"]:visible, [data-filter-group="duration"]:visible')).toHaveCount(0);
  await page.locator('[data-provider-filters] [data-filter="type"][data-value="compounded"]').click();
  await page.waitForURL(/\/lp\/best-providers\/compounded-semaglutide\//);
  // The compounded route selects Both by default; wait for its own runtime
  // canonicalization rather than reading the incoming link before hydration.
  await expect(page.locator('[data-provider-filters]')).toHaveAttribute('data-phase3-route-ready', 'true');
  await expectUrlState(page, {
    path: "/lp/best-providers/compounded-semaglutide/",
    search: { state: "OR", drug: "SEMAGLUTIDE", form: "COMPOUNDED", plan: "both", sort: "cheapest" },
  });

  await page.locator('a[data-filter-route][data-route-family="brand-product"][href^="/ozempic/"]').click();
  await page.waitForURL(/\/ozempic\//);
  await expectUrlState(page, {
    path: "/ozempic/",
    search: { state: "OR", drug: "OZEMPIC", form: "BRAND_NAME", sort: "cheapest" },
  });
  await page.locator('[data-provider-filters] [data-filter="type"][data-value="compounded"]').click();
  await page.waitForURL(/\/lp\/best-providers\/compounded-semaglutide\//);
  await page.locator('[data-provider-filters] [data-filter="type"][data-value="brand"]').click();
  await page.waitForURL(/\/wegovy\//);
  await expectUrlState(page, {
    path: "/wegovy/",
    search: { state: "OR", drug: "WEGOVY", form: "BRAND_NAME", sort: "cheapest" },
  });
  expect(errors).toEqual([]);
});

test("Wegovy Pill owns Monthly, 3, 6, and 12 month duration state without leaking it to Wegovy", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoPhase3(page, "/wegovy-pill/?duration=12&sort=cheapest");

  const durations = page.locator('[data-provider-filters] [data-filter-group="duration"]:visible');
  await expect(durations).toBeVisible();
  await expect(durations.locator('button[data-filter="duration"]')).toHaveText(["Any published duration", "Monthly", "3 months", "6 months", "12 months"]);
  await expect(durations.locator('[data-value="12"]')).toHaveAttribute("aria-pressed", "true");
  await expectUrlState(page, {
    path: "/wegovy-pill/",
    search: { drug: "WEGOVY_PILL", form: "COMPOUNDED", duration: "12", sort: "cheapest" },
  });

  await durations.locator('[data-value="1"]').click();
  await expect(durations.locator('[data-value="1"]')).toHaveAttribute("aria-pressed", "true");
  await expectUrlState(page, {
    path: "/wegovy-pill/",
    search: { drug: "WEGOVY_PILL", form: "COMPOUNDED", duration: "1", sort: "cheapest" },
  });

  await gotoPhase3(page, "/wegovy/?duration=12&plan=3&sort=cheapest");
  const wegovy = await readUrlState(page);
  expect(wegovy.search).toEqual({ drug: "WEGOVY", form: "BRAND_NAME", sort: "cheapest" });
  await expect(page.locator('[data-filter-group="plan"]:visible, [data-filter-group="duration"]:visible')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("state popover supports roving keyboard, Escape, outside click, native fallback, and unknown-state honesty", async ({ page, browser, baseURL }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const route = "/lp/best-providers/compounded-semaglutide/";
  await gotoPhase3(page, `${route}?state=ZZ&sort=cheapest`);

  expect((await readUrlState(page)).search.state).toBeUndefined();
  await expect(page.locator("[data-filter-result]")).toContainText("State code “ZZ” was not recognized and was ignored.");
  const stateControl = page.locator("main.listing .listing__intro .p3-state-control");
  await expect(stateControl).toHaveCount(1);
  const opener = stateControl.locator("[data-state-open]");
  const popover = stateControl.locator(".p3-state-popover");
  const search = popover.locator("[data-state-search]");

  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(search).toBeFocused();
  await search.fill("Oregon");
  await search.press("ArrowDown");
  const oregon = popover.getByRole("option", { name: "Oregon", exact: true });
  await expect(oregon).toBeFocused();
  await oregon.press("Enter");
  await expect(popover).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(popover.locator('[data-state="OR"]')).toHaveAttribute("aria-selected", "true");
  expect((await readUrlState(page)).search.state).toBe("OR");

  await opener.click();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.locator("h1").click();
  await expect(popover).toBeHidden();
  await expect(opener).toHaveAttribute("aria-expanded", "false");

  await opener.click();
  await popover.getByRole("option", { name: "Washington", exact: true }).click();
  await expect(opener.locator("[data-state-label]")).toHaveText("Washington");
  await expect(popover.locator('[data-state="WA"]')).toHaveAttribute("aria-selected", "true");
  expect((await readUrlState(page)).search.state).toBe("WA");

  const fallbackContext = await browser.newContext({ javaScriptEnabled: false });
  try {
    const fallbackPage = await fallbackContext.newPage();
    const response = await fallbackPage.goto(new URL(route, baseURL).href, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    const native = fallbackPage.locator("main.listing .p3-state-native select[data-state-native]");
    await expect(native).toHaveCount(1);
    await expect(native).toBeVisible();
    await native.selectOption("WA");
    await expect(native).toHaveValue("WA");
    await expect(fallbackPage.locator("main h1")).toBeVisible();
  } finally {
    await fallbackContext.close();
  }
  expect(errors).toEqual([]);
});

test("mobile category filters trap route links and Escape closes only the active overlay layer", async ({ page }, testInfo) => {
  await approvedRetirement("RR-4", testInfo);
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await gotoPhase3(page, "/lp/best-providers/compounded-semaglutide/");

  const stateControl = page.locator("main.listing .listing__intro .p3-state-control");
  await expect(stateControl).toHaveCount(1);
  const opener = stateControl.locator("[data-state-open]");
  const popover = stateControl.locator(".p3-state-popover");
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(popover).toBeVisible();
  await expect(popover.locator("[data-state-search]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");

  const routeLink = page.locator('a[data-filter-route][data-route-family="brand-product"][href^="/ozempic/"]');
  await expect(routeLink).toHaveCount(1);
  await expectLinksAreUsable(page);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/ozempic/"),
    routeLink.click(),
  ]);
  expect(errors).toEqual([]);
});

test("bulk molecule state is canonical and provider details stay separate from conversion actions", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoPhase3(page, "/6-month/?drug=UNKNOWN");
  expect((await readUrlState(page)).search.drug).toBe("SEMAGLUTIDE");
  const bulk = page.locator('[data-provider-filters] [data-filter-group="treatment"]');
  await bulk.locator('[data-filter="treatment"][data-value="TIRZEPATIDE"]').click();
  await expect(bulk.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(bulk.locator('[data-value="TIRZEPATIDE"]')).toHaveAttribute("aria-selected", "true");
  expect((await readUrlState(page)).search.drug).toBe("TIRZEPATIDE");
  // KAEL-DECISION-20260923-optionc-governing-mappings.md A2.2–A2.3.
  const expectedBulk = governedBulkCohorts("TIRZEPATIDE", 6);
  const numeric = page.locator('#provider-results [data-phase3-provider-grid] [data-phase3-provider]');
  expect(await numeric.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedBulk.numeric].sort());
  await expect(page.locator("[data-filter-result]")).toContainText(`${expectedBulk.numeric.length} comparable price results`);
  const unpriced = page.locator('[data-unpublished-provider-section] [data-phase3-provider]');
  expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedBulk.unpriced].sort());
  if (expectedBulk.unpriced.length) await expect(page.locator('[data-unpublished-provider-section]')).toBeVisible();
  else await expect(page.locator('[data-unpublished-provider-section]')).toHaveCount(0);
  await expect(page.locator("[data-filter-result]")).toContainText("Tirzepatide");

  await gotoPhase3(page, "/providers/");
  const firstCard = page.locator("[data-phase3-provider]").first();
  const internal = firstCard.locator("a[data-provider-review-link][href^='/reviews/']");
  expect(await internal.count()).toBeGreaterThan(0);
  const internalProblems = await internal.evaluateAll((links) => links.flatMap((link) => {
    const target = new URL(link.href);
    return target.origin !== location.origin || link.dataset.analyticsEvent === "affiliate_click" ? [link.href] : [];
  }));
  expect(internalProblems).toEqual([]);
  await expectGovernedGoLinks(firstCard.locator('a[href^="/go/"]'), page);
  const external = firstCard.locator("a[data-analytics-event='affiliate_click']");
  if (await external.count()) {
    const externalProblems = await external.evaluateAll((links) => links.flatMap((link) => {
      const target = new URL(link.href);
      const governedGo = target.origin === location.origin
        && target.pathname.startsWith('/go/')
        && link.dataset.linkMode === 'server-redirect';
      return (!governedGo && target.origin === location.origin) || link.dataset.analyticsEvent !== "affiliate_click" ? [link.href] : [];
    }));
    expect(externalProblems).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("mobile shell exposes every Phase 3 navigation target plus search and keyboard dismissal", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPhase3(page, "/wegovy/");

  const toggle = page.locator("[data-menu-toggle]");
  const drawer = page.locator("[data-menu]");
  await toggle.click();
  await expect(drawer).toBeVisible();

  const providers = drawer.getByRole("button", { name: "Telehealth Providers", exact: true });
  await providers.click();
  await expect(providers).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.locator('a[href="/wegovy/?drug=WEGOVY&form=BRAND_NAME&sort=cheapest"]')).toBeVisible();
  await expect(drawer.locator('a[href="/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest"]')).toBeVisible();

  const bulk = drawer.getByRole("button", { name: "Bulk", exact: true });
  await bulk.click();
  await expect(bulk).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.locator('a[href="/3-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&plan=3&sort=cheapest"]')).toBeVisible();
  await expect(drawer.locator('a[href="/3-month/?drug=TIRZEPATIDE&form=COMPOUNDED&plan=3&sort=cheapest"]')).toBeVisible();
  await expect(drawer.locator('a[href="/6-month/?drug=SEMAGLUTIDE&form=COMPOUNDED&duration=6&sort=cheapest"]')).toBeVisible();
  await expect(drawer.locator('a[href="/6-month/?drug=TIRZEPATIDE&form=COMPOUNDED&duration=6&sort=cheapest"]')).toBeVisible();
  await expect(drawer.locator('a[href="/insights/"]')).toHaveAttribute("href", "/insights/");
  await expect(drawer.locator('a[href="/pharmacies/"]')).toHaveAttribute("href", "/pharmacies/");

  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toBeHidden();

  const searchToggle = page.getByRole("button", { name: "Search providers" });
  await searchToggle.click();
  const searchPanel = page.locator(".cs-search-panel");
  const searchInput = searchPanel.locator('input[type="search"]');
  await expect(searchPanel).toBeVisible();
  await expect(searchInput).toBeFocused();
  await searchInput.fill("Wegovy");
  await expect(page.locator(".cs-search-hit").first()).toBeVisible();
  await page.getByRole("button", { name: "Close search and clear" }).click();
  await expect(searchPanel).toBeHidden();
  await expect(searchInput).toHaveValue("");
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

const D47_LABELS = ["Not covered / unsure", "Probably not", "Probably", "Covered"];
const D47_ROUTES = ["/wegovy-pill/", "/wegovy/", "/ozempic/", "/mounjaro/", "/zepbound/"];

async function expectCoverageWizard(page, touch = false) {
  const form = page.locator("[data-insurance-wizard]");
  const slider = form.locator('input[name="coverage"]');
  const monthly = form.locator('[name="monthly_oop"]');
  const result = form.locator("[data-insurance-result]");
  const finish = form.locator("[data-insurance-complete]");
  const status = form.locator("[data-insurance-finish-status]");
  const labels = form.locator(".p3-progress-labels span");
  await expect(form).toBeVisible();
  await expect(form).toContainText(/does not verify coverage, prior authorization, eligibility/i);
  await expect(labels).toHaveText(D47_LABELS);
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", "3");
  await expect(slider).toHaveAttribute("step", "1");
  await expect(slider).toHaveValue("0");
  await expect(monthly).toHaveValue("");
  await expect(form.locator('[name="oop_max"], [name="oop_spent"], [name="progress"]')).toHaveCount(0);
  await expect(form.locator('[data-copay][aria-pressed="true"]')).toHaveCount(0);
  const sourceAmount = await form.getAttribute("data-self-pay-amount");
  expect(sourceAmount).not.toBeNull();
  const select = async (state) => {
    await slider.press("Home");
    for (let index = 0; index < state; index += 1) await slider.press("ArrowRight");
    await expect(slider).toHaveValue(String(state));
    await expect(slider).toHaveAttribute("aria-valuetext", D47_LABELS[state]);
    await expect(form.locator("[data-coverage-label]")).toHaveText(D47_LABELS[state]);
    await expect(form.locator(".p3-progress-labels .is-active")).toHaveText(D47_LABELS[state]);
    expect(await slider.evaluate(node => node.style.getPropertyValue("--p3-progress"))).toBe(`${state / 3 * 100}%`);
  };
  const amount = async (value, basis) => {
    await expect(result).toHaveAttribute("data-estimate-basis", basis);
    await expect(result).toHaveAttribute("data-estimate-amount", value);
    if (value === "") await expect(result).toContainText("unknown");
    else await expect(result).toContainText(`Estimated monthly out-of-pocket: $${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}.`);
  };
  for (const state of [0, 1, 2, 3]) {
    await select(state);
    if (state < 2) await amount(sourceAmount, sourceAmount === "" ? "unknown" : "self-pay");
    else await amount("", "unknown");
  }
  await slider.press("End");
  await expect(slider).toHaveValue("3");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("2");
  await monthly.fill("-1");
  await amount("", "unknown");
  await finish.click();
  await expect(result).not.toHaveAttribute("data-finished", "true");
  await expect(status).toBeEmpty();
  await monthly.fill("2800");
  await amount("2800", "entered");
  await expect(result).toContainText("if coverage applies");
  await expect(result).toContainText("not a coverage quote or verified pharmacy price");
  await select(3);
  await amount("2800", "entered");
  await expect(result).toContainText("self-reported coverage");
  for (const value of ["0", "25", "50", "75"]) {
    await form.locator(`[data-copay="${value}"]`).click();
    await expect(monthly).toHaveValue(value);
    await amount(value, "entered");
    await expect(form.locator('[data-copay][aria-pressed="true"]')).toHaveCount(1);
    await expect(form.locator(`[data-copay="${value}"]`)).toHaveAttribute("aria-pressed", "true");
  }
  await form.locator('[data-copay="50"]').click();
  await amount("50", "entered");
  await finish.click();
  await expect(result).toHaveAttribute("data-finished", "true");
  await expect(status).toContainText("Estimate ready");
  await expect(finish).not.toContainText(/saved/i);
  await monthly.fill("2800");
  await expect(form.locator('[data-copay][aria-pressed="true"]')).toHaveCount(0);
  await expect(result).not.toHaveAttribute("data-finished", "true");
  await expect(status).toBeEmpty();
  for (const state of [0, 1]) {
    await select(state);
    await amount(sourceAmount, sourceAmount === "" ? "unknown" : "self-pay");
  }
  await select(2);
  await monthly.fill("");
  await amount("", "unknown");
  await expect(form.locator('[data-copay][aria-pressed="true"]')).toHaveCount(0);
  await form.locator('[data-copay="0"]').click();
  await amount("0", "entered");
  await finish.click();
  await expect(result).toHaveAttribute("data-finished", "true");
  if (touch) {
    // Real touch input, not programmatic value assignment or synthetic input events.
    for (const state of [0, 1, 2, 3]) {
      const box = await slider.boundingBox();
      expect(box).not.toBeNull();
      await slider.tap({ position: { x: 8 + (box.width - 16) * state / 3, y: box.height / 2 } });
      await expect(slider).toHaveValue(String(state));
      await expect(slider).toHaveAttribute("aria-valuetext", D47_LABELS[state]);
      await expect(form.locator(".p3-progress-labels .is-active")).toHaveText(D47_LABELS[state]);
    }
  }
  const activePaint = await labels.evaluateAll(nodes => nodes.map(node => ({
    active: node.classList.contains("is-active"), image: getComputedStyle(node).backgroundImage,
  })));
  expect(activePaint.filter(node => node.active)).toHaveLength(1);
  expect(activePaint.find(node => node.active).image).not.toBe("none");
  for (const node of activePaint.filter(node => !node.active)) expect(node.image).toBe("none");
  await expectNoHorizontalOverflow(page);
}

for (const route of D47_ROUTES) {
  for (const reducedMotion of ["reduce", "no-preference"]) {
    test(`D47 coverage model ${route} ${reducedMotion}`, async ({ page, hasTouch }) => {
      const errors = watchRuntimeErrors(page);
      await page.emulateMedia({ reducedMotion });
      await gotoPhase3(page, route);
      await expectCoverageWizard(page, hasTouch);
      // Exercise missing evidence on a real rendered form without inventing a price.
      const form = page.locator("[data-insurance-wizard]");
      await form.evaluate(node => { delete node.dataset.selfPayAmount; });
      await form.locator('[name="coverage"]').press("End");
      await form.locator('[name="coverage"]').press("Home");
      const result = form.locator("[data-insurance-result]");
      await expect(result).toHaveAttribute("data-estimate-basis", "unknown");
      await expect(result).toHaveAttribute("data-estimate-amount", "");
      await expect(result).toContainText("unknown");
      expect(errors).toEqual([]);
    });
  }
}

for (const viewport of VIEWPORTS) {
  test(`D47 insurance wizard and D48 product accordions work at ${viewport.width}px`, async ({ page }) => {
    const errors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoPhase3(page, "/wegovy/");

    await expectCoverageWizard(page);

    const accordions = page.locator("[data-listing-drug-panel] .listing__drug-faq details");
    await expect(accordions).toHaveCount(3);
    await expect(accordions.locator("summary")).toHaveText([
      "What is Wegovy?",
      "How does it work?",
      "Benefits",
    ]);
    for (let index = 0; index < 3; index += 1) {
      const accordion = accordions.nth(index);
      await accordion.locator("summary").click();
      await expect(accordion).toHaveAttribute("open", "");
      await expect(accordion.locator("p")).toBeVisible();
    }

    const firstProviderCard = page.locator(".p3-provider-card").first();
    await firstProviderCard.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await expect(firstProviderCard.locator("[data-provider-card-contract='option-c']")).toHaveCount(1);
    await expect(firstProviderCard.locator("dt")).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);
    await expect(firstProviderCard.locator(".p3-dose-grid")).toHaveCount(0);
    await expect(firstProviderCard).not.toContainText(/Not published|UNKNOWN_NO_SOURCE/);

    const currentMedication = page.locator('[data-cross-route-options] a[aria-current="page"]');
    await expect(currentMedication).toHaveCount(1);
    await expect(currentMedication).toHaveAttribute("href", /^\/wegovy\/\?drug=WEGOVY&form=BRAND_NAME&sort=cheapest$/);
    await expect(page.locator('[data-listing-drug-panel] a[href="/guides/wegovy-side-effects-evidence-guide/"]')).toHaveCount(1);
    await expect(page.locator('a[href="/self-pay/"]')).not.toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const viewport of VIEWPORTS) {
  test(`category filters, state chip, and truthful empty state work at ${viewport.width}px`, async ({ page }, testInfo) => {
    if (viewport.name === "mobile") await approvedRetirement("RR-5", testInfo);
    const errors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoPhase3(page, "/lp/best-providers/compounded-semaglutide/");

    const filters = page.locator("[data-provider-filters]");
    const cards = page.locator("[data-phase3-provider]");
    const empty = page.locator("[data-filter-empty]");
    const activeLabel = empty.locator("[data-active-filter-label]");
    const result = page.locator("[data-filter-result]");
    await expect(filters).toBeVisible();
    const expectedUnpriced = governedUnpricedIds("SEMAGLUTIDE");
    const unpriced = page.locator('[data-unpublished-provider-section] [data-phase3-provider]');
    const initialVisible = await page.locator("#provider-results [data-phase3-provider]:visible").count();
    expect(initialVisible).toBeGreaterThan(0);
    expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedUnpriced].sort());
    await expect(filters.locator('[data-filter-group="treatment"] button')).toHaveCount(2);
    await expect(filters.locator('[data-filter-group="type"] button')).toHaveCount(3);
    await expect(filters.locator('[data-filter-group="plan"] button')).toHaveCount(4);

    const moreFilters = filters.locator(".p3-more-filters");
    const oneMonth = filters.locator('[data-filter="plan"][data-value="1"]');
    await oneMonth.click();
    await expect(oneMonth).toHaveAttribute("role", "tab");
    await expect(oneMonth).toHaveAttribute("aria-selected", "true");
    await expect(oneMonth).toHaveAttribute("tabindex", "0");
    await moreFilters.locator("summary").click();
    await expect(moreFilters).toHaveAttribute("open", "");
    const unsupportedDose = filters.locator('[data-filter="dose"][data-value="2.4"]');
    await unsupportedDose.click();
    await expect(unsupportedDose).toHaveAttribute("role", "tab");
    await expect(unsupportedDose).toHaveAttribute("aria-selected", "true");
    await expect(unsupportedDose).toHaveAttribute("tabindex", "0");
    // KAEL-DECISION-20260923-optionc-governing-mappings.md A2.2/A2.4:
    // no numeric match must not suppress separate source-backed records.
    await expect(page.locator('#provider-results [data-phase3-provider-grid] [data-phase3-provider]:visible')).toHaveCount(0);
    expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedUnpriced].sort());
    await expect(empty).toBeVisible();
    const emptyCopy = await empty.locator("p").first().innerText();
    const emptyCount = await result.innerText();
    await expect(activeLabel).toHaveText("Active filters: Plan: 1 month, Dose: 2.4 mg/week.");
    await expect(oneMonth).toHaveAttribute("aria-selected", "true");
    await expect(unsupportedDose).toHaveAttribute("aria-selected", "true");
    const reset = empty.getByRole("button", { name: "Reset filters" });
    await reset.focus();
    await expect(reset).toBeFocused();
    await reset.press("Enter");
    await expect.poll(() => page.locator("#provider-results [data-phase3-provider]:visible").count()).toBe(initialVisible);
    expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedUnpriced].sort());
    await expect(empty).toBeHidden();
    await expect(activeLabel).toHaveText("Active filters: none.");
    await expect(oneMonth).toHaveAttribute("aria-selected", "false");
    await expect(unsupportedDose).toHaveAttribute("aria-selected", "false");
    await expect(filters.locator('[data-filter-group="plan"] [aria-selected="true"]')).toHaveCount(1);
    await expect(filters.locator('[data-filter-group="dose"] [aria-selected="true"]')).toHaveCount(1);
    await expect(filters.locator('[data-filter="plan"][data-value="both"]')).toHaveAttribute("aria-selected", "true");
    await expect(filters.locator('[data-filter="dose"][data-value="all"]')).toHaveAttribute("aria-selected", "true");
    await expectUrlState(page, { path: "/lp/best-providers/compounded-semaglutide/", search: { drug: "SEMAGLUTIDE", form: "COMPOUNDED", plan: "both", sort: "cheapest" } });

    const stateControl = page.locator("main.listing .listing__intro .p3-state-control");
    await expect(stateControl).toHaveCount(1);
    const stateButton = stateControl.locator("[data-state-open]");
    const statePopover = stateControl.locator(".p3-state-popover");
    await stateButton.click();
    await expect(stateButton).toHaveAttribute("aria-expanded", "true");
    await expect(statePopover).toBeVisible();
    await expect(statePopover.getByRole("option")).toHaveCount(51);
    const stateSearch = statePopover.locator("[data-state-search]");
    await expect(stateSearch).toBeFocused();
    if (viewport.name === "mobile") {
      await expectInsideViewport(statePopover);
      await expectNoHorizontalOverflow(page);
    }
    await stateSearch.fill("Oregon");
    const oregon = statePopover.getByRole("option", { name: "Oregon", exact: true });
    await expect(oregon).toBeVisible();
    await stateSearch.press("ArrowDown");
    await expect(oregon).toBeFocused();
    await oregon.press("Enter");
    await expect(stateButton.locator("[data-state-label]")).toHaveText("Oregon");
    await expect(statePopover).toBeHidden();
    await expect.poll(() => page.locator("#provider-results [data-phase3-provider]:visible").count()).toBe(initialVisible);
    expect(await unpriced.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedUnpriced].sort());
    if (viewport.name === "mobile") {
      await expect(stateButton).toBeFocused();
    }

    expect(emptyCopy).toContain("No comparable price matches those filters.");
    expect(emptyCopy).toContain("This is not a medical or availability conclusion.");
    expect(emptyCount).toContain("0 comparable price results");

    await expect(cards.first().locator('a[data-card-review][href^="/reviews/"]')).toHaveCount(1);
    await expect(cards.first().locator('a[data-analytics-event="affiliate_click"]')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const viewport of VIEWPORTS) {
  test(`legacy quiz memory is purged and empty coupon data renders no chip at ${viewport.width}px`, async ({ page }) => {
    const errors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const route = "/lp/best-providers/compounded-semaglutide/";
    await gotoPhase3(page, route);

    const initialCouponCount = await expectCouponChipsStayInsideCards(page);
    if (initialCouponCount === 0) await expect(page.locator("body")).not.toContainText(/Use code [A-Z0-9_-]+ for/i);
    await expect(page.locator("[data-quiz-match-chip]:visible, [data-preference-match]:visible")).toHaveCount(0);
    const firstProgram = await page.locator("[data-phase3-provider]").first().getAttribute("data-program");
    expect(firstProgram).toMatch(/^[a-z0-9-]+$/);

    await page.evaluate(({ key, program }) => {
      const legacy = JSON.stringify({
        version: "provider-fit-preferences-v1",
        completedAt: new Date().toISOString(),
        answers: { medication_preference: "semaglutide", state: "OR" },
        matches: [program],
      });
      localStorage.setItem(key, legacy);
      sessionStorage.setItem(key, legacy);
    }, { key: QUIZ_PREFERENCES_KEY, program: firstProgram });
    await page.reload({ waitUntil: "networkidle" });

    await expect.poll(() => page.evaluate((key) => ({
      local: localStorage.getItem(key), session: sessionStorage.getItem(key),
    }), QUIZ_PREFERENCES_KEY)).toEqual({ local: null, session: null });
    await expect(page.locator("[data-quiz-match-chip]:visible, [data-preference-match]:visible")).toHaveCount(0);
    await expect(page.locator("[data-preference-popover]")).toHaveCount(0);

    const reloadedCouponCount = await expectCouponChipsStayInsideCards(page);
    if (reloadedCouponCount === 0) await expect(page.locator("body")).not.toContainText(/Use code [A-Z0-9_-]+ for/i);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const viewport of VIEWPORTS) {
  test(`source-backed bulk cards preserve duration, source, and unpublished-dose boundaries at ${viewport.width}px`, async ({ page }) => {
    const errors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoPhase3(page, "/3-month/");

    await expect(page.locator('main.listing[data-listing-archetype="A"] .p3-evidence-boundary')).toContainText("A lower per-month figure can require a larger upfront payment or longer commitment.");
    await expect(page.locator('main.listing[data-listing-archetype="A"] .p3-evidence-boundary')).toContainText("The cited provider wording controls; Clinic Scout does not invent bundle math.");
    // A2.2: numeric and non-priced cohorts stay physically separate.
    const expectedBulk = governedBulkCohorts("SEMAGLUTIDE", 3);
    const numeric = page.locator('#provider-results [data-phase3-provider-grid] [data-phase3-provider]');
    expect(await numeric.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedBulk.numeric].sort());
    await expect(page.locator('[data-filter-result]')).toContainText(`${expectedBulk.numeric.length} comparable price results`);
    const cards = page.locator('[data-unpublished-provider-section] [data-phase3-provider]');
    const cardCount = await cards.count();
    expect(cardCount).toBe(expectedBulk.unpriced.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program).sort())).toEqual([...expectedBulk.unpriced].sort());
    for (let index = 0; index < await cards.count(); index += 1) {
      const card = cards.nth(index);
      await expect(card).toContainText('No comparable published price.');
      await expect(card).toHaveAttribute("data-duration", /\b3\b/);
      const source = card.locator('a[data-citation="inline_fact_source"]').first();
      await expect(source).toHaveAttribute("href", /^https:\/\//);
      await expect(source).toHaveAttribute("rel", /noopener/);
      await expect(card.locator('a[data-card-review]')).toHaveCount(1);
    }

    const firstBulkCard = cards.first();
    await firstBulkCard.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await expect(firstBulkCard.locator("[data-provider-card-contract='option-c']")).toHaveCount(1);
    await expect(firstBulkCard.locator("dt")).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);
    await expect(firstBulkCard.locator(".p3-dose-grid")).toHaveCount(0);
    await expect(firstBulkCard).not.toContainText(/Not published|UNKNOWN_NO_SOURCE/);

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const viewport of VIEWPORTS) {
  test(`pharmacy filters and no-match copy remain evidence-bounded at ${viewport.width}px`, async ({ page }) => {
    const errors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoPhase3(page, "/pharmacies/");

    const filters = page.locator("[data-pharmacy-filters]");
    const cards = page.locator("[data-pharmacy-card]");
    const result = page.locator("[data-pharmacy-result]");
    const empty = page.locator("[data-pharmacy-empty]");
    const mobileFilterTrigger = page.getByRole("button", { name: /^Pharmacy filters/ });
    if (viewport.name === "mobile") {
      await expect(mobileFilterTrigger).toBeVisible();
      await mobileFilterTrigger.click();
      await expect(filters).toHaveAttribute("role", "dialog");
      await expect(page.locator("body")).toHaveClass(/cs-mobile-filters-open/);
    }
    await expect(filters).toBeVisible();
    await expect(cards).toHaveCount(75);
    await expect(result).toHaveText("Showing 18 of 75 evidence records");
    await expect(page.locator("body")).not.toContainText(/Rating not collected|Research in progress|None verified/);
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveAttribute("href", /^\/pharmacies\/[a-z0-9-]+\/$/);
    const stateControl = filters.locator(".p3-state-control");
    await expect(stateControl.locator("[data-state-open]")).toHaveCount(1);
    await expect(stateControl.locator('[role="option"][data-state]')).toHaveCount(51);

    await filters.locator('[data-filter="data-pharmacy-class"][data-value="503b"]').click();
    await expect.poll(() => page.locator("[data-pharmacy-card]:visible").count()).toBeGreaterThan(0);
    const classifiedCount = await page.locator("[data-pharmacy-card]:visible").count();
    expect(classifiedCount).toBeLessThan(75);

    await filters.locator('[data-filter="data-pharmacy-class"][data-value="all"]').click();
    await filters.locator('[data-filter="data-pharmacy-med"][data-value="all"]').click();
    const search = filters.locator("[data-pharmacy-search]");
    await search.fill("zzzz-no-real-pharmacy-zzzz");
    await expect(page.locator("[data-pharmacy-card]:visible")).toHaveCount(0);
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No source-backed record matches those filters.");
    await expect(empty).toContainText("An empty result is not a medical or availability conclusion.");
    await expect(result).toContainText("0");

    await search.fill("");
    await expect.poll(() => page.locator("[data-pharmacy-card]:visible").count()).toBe(18);
    await expect(empty).toBeHidden();
    await stateControl.locator("[data-state-open]").click();
    await stateControl.getByRole("option", { name: "Oregon", exact: true }).click();
    await expect(stateControl.locator("[data-state-label]")).toHaveText("Oregon");
    const stateVisible = await page.locator("[data-pharmacy-card]:visible").count();
    await expect(result).toContainText(new RegExp(`Showing ${stateVisible} evidence record`));
    if (stateVisible === 0) {
      await expect(empty).toBeVisible();
      await expect(empty).toContainText("An empty result is not a medical or availability conclusion.");
    }
    if (viewport.name === "mobile") {
      await filters.getByRole("button", { name: "Show results" }).click();
      await expect(mobileFilterTrigger).toBeFocused();
    }
    await expect(cards.first()).toHaveAttribute("href", /^\/pharmacies\/[a-z0-9-]+\/$/);

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const viewport of VIEWPORTS) {
  test(`insights rhythm, article targets, pagination, and subscribe sheet work at ${viewport.width}px`, async ({ page }) => {
    const errors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoPhase3(page, "/insights/");

    const cycles = page.locator(".p3-insight-cycle");
    expect(await cycles.count()).toBeGreaterThan(0);
    for (let index = 0; index < await cycles.count(); index += 1) {
      const cycle = cycles.nth(index);
      await expect(cycle.locator(".p3-feature-story")).toHaveCount(1);
      const standardCount = await cycle.locator(".p3-story").count();
      expect(standardCount).toBeGreaterThan(0);
      expect(standardCount).toBeLessThanOrEqual(3);
    }
    const storyTargets = await page.locator(".p3-feature-story, .p3-story").evaluateAll((stories) => stories.map((story) => story.getAttribute("href")));
    expect(storyTargets.every((href) => /^\/guides\/[a-z0-9-]+\/$/.test(href || ""))).toBe(true);
    await expect(page.locator('.p3-pagination a[rel="next"][href="/insights/page/2/"]')).toHaveText("Next");

    const subscribe = page.locator(".p3-insights-hero [data-subscribe-open]");
    await subscribe.click();
    const sheet = page.locator("[data-subscribe-layer]");
    await expect(sheet).toBeVisible();
    const closeFirst = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(max-width: 700px)').matches);
    await expect(sheet.locator(closeFirst ? '.cs-subscribe-close' : 'input[type="email"]')).toBeFocused();
    if (viewport.name === "mobile") await expectInsideViewport(sheet);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("pharmacy detail states action absence honestly and withholds unverified reverse comparisons", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoPhase3(page, "/pharmacies/red-rock/");

  await expect(page.locator(".p3-action-grid")).toContainText("No regulatory action was found in the bounded search.");
  await expect(page.locator(".p3-action-grid")).toContainText("That is not a categorical absence claim.");
  expect(await page.locator(".p3-unknowns li").count()).toBeGreaterThan(0);
  expect(await page.locator(".p3-source-rail li").count()).toBeGreaterThan(0);
  const sourceTargets = await page.locator(".p3-source-rail a").evaluateAll((links) => links.map((link) => link.href));
  expect(sourceTargets.every((href) => href.startsWith("https://"))).toBe(true);

  const faq = page.locator(".p3-accordions details");
  await expect(faq).toHaveCount(1);
  await faq.locator("summary").click();
  await expect(faq).toHaveAttribute("open", "");
  await expect(faq.locator("p")).toBeVisible();

  const reverse = page.locator('a[href="/pharmacies/red-rock/compare-providers/"]');
  await expect(reverse).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Compare named provider relationships");
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("canonical provider detail keeps its mobile action bar fixed through content and releases before the footer", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPhase3(page, "/providers/trimi-glp-1/");

  const sticky = page.locator("[data-provider-sticky]");
  await expect(sticky).toBeVisible();
  await expect(sticky).toHaveAttribute("data-program", "trimi-glp-1");
  await expect(sticky.locator("[data-provider-sticky-primary]")).toHaveAttribute(
    "href",
    "/quiz/provider-fit/?source=provider-sticky&provider=trimi-glp-1",
  );

  const geometry = async () => sticky.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const footer = document.querySelector(".cs-prefooter, .gcs-footer")?.getBoundingClientRect();
    return {
      position: getComputedStyle(node).position,
      left: rect.left,
      right: innerWidth - rect.right,
      bottom: innerHeight - rect.bottom,
      top: rect.top,
      height: rect.height,
      stickyBottom: rect.bottom,
      footerTop: footer?.top ?? null,
      released: node.classList.contains("is-released"),
    };
  });

  const initial = await geometry();
  expect(initial.position).toBe("fixed");
  expect(Math.abs(initial.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.bottom)).toBeLessThanOrEqual(1);
  expect(initial.height).toBeGreaterThanOrEqual(81);
  expect(initial.height).toBeLessThanOrEqual(96);

  for (const target of [900, 450]) {
    await page.evaluate((scrollTarget) => window.scrollTo(0, scrollTarget), target);
    await page.waitForTimeout(100);
    await expect(sticky).toBeVisible();
    const state = await geometry();
    expect(state.position).toBe("fixed");
    expect(state.released).toBe(false);
    expect(Math.abs(state.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(state.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(state.bottom)).toBeLessThanOrEqual(1);
    expect(state.top).toBeLessThan(844);
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const released = await geometry();
  expect(released.position, `footer geometry: ${JSON.stringify(released)}`).toBe("absolute");
  expect(released.released).toBe(true);
  expect(released.footerTop).not.toBeNull();
  expect(Math.abs(released.stickyBottom - released.footerTop)).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.scrollTo(0, 450));
  await page.waitForTimeout(100);
  const restored = await geometry();
  expect(restored.position, `return-to-content geometry: ${JSON.stringify(restored)}`).toBe("fixed");
  expect(restored.released).toBe(false);
  expect(Math.abs(restored.bottom)).toBeLessThanOrEqual(1);

  await expect(sticky).not.toHaveAttribute("data-scroll-direction", /.+/);
  await expect(sticky).not.toHaveAttribute("data-near-end", /.+/);
  const reservedSpace = await page.locator("main.p3-page").evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingBottom));
  expect(reservedSpace).toBeGreaterThanOrEqual(initial.height);

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("link-dark provider action bars stay compact at mobile sanity widths", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  for (const viewport of [{ width: 375, height: 667 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport);
    for (const program of ["awin-128761", "measured"]) {
      await gotoPhase3(page, `/providers/${program}/`);
      const sticky = page.locator("[data-provider-sticky]");
      await expect(sticky).toBeVisible();
      await expect(sticky.locator("[data-affiliate-unavailable]")).toBeHidden();
      await expect(sticky.locator("[data-provider-sticky-primary]")).toBeVisible();
      const measured = await sticky.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const main = node.closest("main");
        return {
          left: box.left,
          right: innerWidth - box.right,
          bottom: innerHeight - box.bottom,
          height: box.height,
          mainPaddingBottom: Number.parseFloat(getComputedStyle(main).paddingBottom || "0"),
        };
      });
      expect(Math.abs(measured.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.bottom)).toBeLessThanOrEqual(1);
      expect(measured.height).toBeGreaterThanOrEqual(81);
      expect(measured.height).toBeLessThanOrEqual(96);
      expect(measured.mainPaddingBottom).toBeGreaterThanOrEqual(measured.height);
      await expectNoHorizontalOverflow(page);
    }
  }
  expect(errors).toEqual([]);
});
