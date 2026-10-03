import { test, expect } from "@playwright/test";

// Effect companions to phase1-foundation (motion admission), phase2-home
// (aurora/H17/rail locality), and pass5-performance-stability (consent).
// Filter history is already exercised by compare-facet-integrity.spec.mjs:
// "initial hydration writes at most one complete normalized entry" and
// "default -> Shed -> medication/source -> back/back -> forward/forward".
// Run those named tests with this file; source predicate negatives remain in
// pass5-performance-stability.test.mjs. A regexp is not a browser effect.
const localOnly = async (page) => page.route("**/*", route => {
  const { hostname, protocol } = new URL(route.request().url());
  return hostname === "127.0.0.1" || hostname === "localhost" || protocol === "data:"
    ? route.continue() : route.abort("blockedbyclient");
});
const ready = page => expect.poll(() => page.evaluate(() => Boolean(window.CS_MOTION?.__v2))).toBe(true);
const auroraState = page => page.evaluate(() => window.CS_MOTION.getAuroras().map(item => ({
  paused: item.tween.paused(), visible: item.visible, killed: !item.tween.parent,
})));

// pass5-motion-loader.spec.mjs already checks dependency order and reduced
// startup; this checks the effects which a loader token cannot establish.
test("fine-pointer Lenis versus touch admission, Chromium native swipe, navigation and no-JS content", async ({ browser, browserName, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference", hasTouch: false });
  const d = await desktop.newPage();
  await localOnly(d);
  await d.goto("/", { waitUntil: "load" });
  await ready(d);
  expect(await d.evaluate(() => ({ fine: matchMedia("(pointer: fine) and (min-width: 901px)").matches, lenis: !!window.CS_MOTION.lenis, ticker: !!window.__gcsLenisRaf }))).toEqual({ fine: true, lenis: true, ticker: true });
  const trigger = d.getByRole("button", { name: "Telehealth Providers", exact: true });
  await trigger.hover();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger.locator("+ .cs-navmenu")).toBeVisible();
  await d.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await d.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await d.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await desktop.close();

  const touch = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
  const m = await touch.newPage();
  await localOnly(m);
  await m.goto("/", { waitUntil: "load" });
  await ready(m);
  expect(await m.evaluate(() => ({ fine: matchMedia("(pointer: fine) and (min-width: 901px)").matches, native: window.CS_MOTION.nativeMobile, lenis: !!window.CS_MOTION.lenis, ticker: !!window.__gcsLenisRaf }))).toEqual({ fine: false, native: true, lenis: false, ticker: false });
  const start = await m.evaluate(() => scrollY);
  if (browserName === 'chromium') {
    const input = await touch.newCDPSession(m);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 680 }] });
    for (const y of [600, 500, 400, 300, 200]) {
      await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
      await m.waitForTimeout(25);
    }
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await input.detach();
  } else {
    testInfo.annotations.push({ type: 'measurement-scope', description: 'WebKit: native touch admission/navigation verified; scrolling smoke is programmatic because Playwright exposes no WebKit swipe API.' });
    await m.evaluate(() => scrollBy({ top: 650, behavior: "instant" }));
  }
  await expect.poll(() => m.evaluate(() => scrollY)).toBeGreaterThan(start + 300);
  await m.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  const menuToggle = m.locator("[data-menu-toggle]");
  await expect(menuToggle).toBeVisible();
  await expect(m.locator("[data-menu]")).toBeHidden(); // no desktop-hover simulation
  await menuToggle.tap();
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  await expect(m.locator("[data-menu]")).toBeVisible();
  await m.keyboard.press("Escape");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "false");
  await touch.close();

  const noJS = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticPage = await noJS.newPage();
  await localOnly(staticPage);
  await staticPage.goto("/", { waitUntil: "load" });
  const visible = await staticPage.locator("[data-h17-card]").evaluateAll(nodes => nodes.map(node => ({
    opacity: getComputedStyle(node).opacity, visibility: getComputedStyle(node).visibility,
    text: !!node.textContent.trim(),
  })));
  expect(visible).toHaveLength(2);
  expect(visible.every(item => item.opacity === "1" && item.visibility === "visible" && item.text)).toBe(true);
  await noJS.close();
});

test("aurora explicit/offscreen/hidden/reduced lifecycle does not gate the CSS rails", async ({ page }) => {
  await localOnly(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "load" });
  await ready(page);
  const rails = page.locator(".cs-home2-marquee__track, .cs-home2-verdict-track");
  await expect(rails).toHaveCount(2);
  const railState = () => rails.evaluateAll(nodes => nodes.map(node => ({
    duration: getComputedStyle(node).animationDuration, state: getComputedStyle(node).animationPlayState,
    name: getComputedStyle(node).animationName,
  })));
  expect((await railState()).map(item => item.duration)).toEqual(["30s", "56s"]);
  expect((await railState()).every(item => item.name !== "none" && item.state === "running")).toBe(true);
  const cards = page.locator("[data-h17-card]");
  await expect(cards).toHaveCount(2);
  const entranceOrigins = await cards.evaluateAll(nodes => nodes.map(card => [".cs-home2-logistics__art", ".cs-home2-logistics__copy"].map(selector => {
    const element = card.querySelector(selector);
    return window.CS_MOTION.getTweens().flatMap(timeline => timeline.getChildren?.(true) || []).filter(tween => tween.targets().includes(element)).map(tween => [tween.vars.startAt?.x, tween.vars.x]);
  })));
  expect(entranceOrigins).toEqual([[[[84, 0]], [[-84, 0]]], [[[-84, 0]], [[84, 0]]]]);
  await cards.nth(1).scrollIntoViewIfNeeded();
  expect((await railState()).every(item => item.state === "running")).toBe(true);
  const beforeRailTime = await rails.evaluateAll(nodes => nodes.map(node => Number(node.getAnimations()[0]?.currentTime)));
  expect(beforeRailTime.every(Number.isFinite)).toBe(true);
  await page.waitForTimeout(120);
  const afterRailTime = await rails.evaluateAll(nodes => nodes.map(node => Number(node.getAnimations()[0]?.currentTime)));
  afterRailTime.forEach((time, index) => expect(time).toBeGreaterThan(beforeRailTime[index]));
  // Browser-applied observer effects matter: an aurora may pause offscreen,
  // while the CSS rails keep animating even when outside the viewport.
  await page.goto("/providers/", { waitUntil: "load" });
  await ready(page);
  const aura = page.locator(".p3-card-aurora").first();
  await expect(aura).toHaveCount(1);
  const tickerListeners = await page.evaluate(() => window.gsap.ticker._listeners.length);
  const control = page.locator("[data-aurora-pause]").first();
  await expect(control).toHaveRole("button");
  await aura.evaluate(node => node.scrollIntoView({ behavior: "instant", block: "center" }));
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(false);
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  expect((await auroraState(page))[0].paused).toBe(true);
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(async () => (await auroraState(page))[0]?.visible).toBe(false);
  await aura.evaluate(node => node.scrollIntoView({ behavior: "instant", block: "center" }));
  await expect.poll(async () => (await auroraState(page))[0]?.visible).toBe(true);
  expect((await auroraState(page))[0].paused).toBe(true); // explicit pause survives re-entry
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await aura.evaluate(node => node.scrollIntoView({ behavior: "instant", block: "center" })); // clicking the preceding control can move the card offscreen
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(false);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(true);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(false);
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(true);
  await aura.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(false);
  await control.click();
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  expect((await auroraState(page))[0].paused).toBe(true);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  expect((await auroraState(page))[0].paused).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => window.CS_MOTION?.reduced)).toBe(true);
  expect(await page.evaluate(() => ({ auroras: window.CS_MOTION.getAuroras().length, lenis: !!window.__gcsLenis, controls: document.querySelectorAll("[data-aurora-pause]").length }))).toEqual({ auroras: 0, lenis: false, controls: 0 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => (await auroraState(page)).length).toBeGreaterThan(0);
  expect(await control.count()).toBe(1); // reinit must not duplicate controls
  expect(await page.evaluate(() => window.gsap.ticker._listeners.length)).toBe(tickerListeners);
  await aura.evaluate(node => node.scrollIntoView({ behavior: "instant", block: "center" }));
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(true);
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "false"); // exactly one toggle after reinit
  await aura.evaluate(node => node.scrollIntoView({ behavior: "instant", block: "center" }));
  await expect.poll(async () => (await auroraState(page))[0]?.paused).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/providers/", { waitUntil: "load" });
  expect(await page.evaluate(() => Boolean(window.CS_MOTION))).toBe(false);
  await expect(page.locator(".p3-card-aurora").first()).toHaveCount(1);
  await expect(page.locator(".p3-provider-card").first()).toBeVisible();
});

test("quiz consent measures a real slot and clears only overlapping focus targets", async ({ page }) => {
  await localOnly(page);
  await page.addInitScript(() => {
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    window.__focusClearanceListeners = new Set();
    document.addEventListener = (type, listener, ...options) => {
      if (type === "focusin" && listener?.name === "focusClearance") window.__focusClearanceListeners.add(listener);
      return add(type, listener, ...options);
    };
    document.removeEventListener = (type, listener, ...options) => {
      if (type === "focusin") window.__focusClearanceListeners.delete(listener);
      return remove(type, listener, ...options);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("#gcs-consent")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--consent-clearance").trim())).toBe("0px");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/geo-state?purpose=consent", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }) }));
  await page.goto("/quiz/provider-fit/", { waitUntil: "load" });
  const notice = page.locator("#gcs-consent");
  await expect(notice).toBeVisible();
  await expect.poll(() => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--consent-clearance")))).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__focusClearanceListeners.size)).toBe(1);
  const clearance = await page.evaluate(() => ({
    reserved: parseFloat(document.documentElement.style.getPropertyValue("--consent-clearance")),
    measured: document.querySelector("#gcs-consent").getBoundingClientRect().height,
  }));
  expect(clearance.reserved).toBeGreaterThanOrEqual(Math.ceil(clearance.measured) + 16);
  const next = page.locator(".qz-next").first();
  await expect(next).toBeVisible();
  // No overlap: focus must not manufacture clearance scrolling.
  await next.scrollIntoViewIfNeeded();
  const baseline = await page.evaluate(() => scrollY);
  await next.focus();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => scrollY)).toBe(baseline);
  // Put the control under the live notice without focusing it, then focus it.
  await next.evaluate(node => node.blur());
  await page.evaluate(() => {
    const target = document.querySelector(".qz-next").getBoundingClientRect();
    const banner = document.querySelector("#gcs-consent").getBoundingClientRect();
    scrollBy({ top: target.bottom - banner.top - 20, behavior: "instant" });
  });
  const before = await page.evaluate(() => {
    const target = document.querySelector(".qz-next").getBoundingClientRect();
    const banner = document.querySelector("#gcs-consent").getBoundingClientRect();
    return { targetBottom: target.bottom, bannerTop: banner.top };
  });
  expect(before.targetBottom).toBeGreaterThan(before.bannerTop);
  await next.focus({ preventScroll: true });
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector(".qz-next").getBoundingClientRect();
    const banner = document.querySelector("#gcs-consent").getBoundingClientRect();
    return target.bottom <= banner.top - 7;
  })).toBe(true);
  await page.evaluate(() => window.GCSConsent.open());
  expect(await page.evaluate(() => window.__focusClearanceListeners.size)).toBe(1);
  await page.evaluate(() => window.GCSConsent.open());
  expect(await page.evaluate(() => window.__focusClearanceListeners.size)).toBe(1);
  await page.locator('#gcs-consent [data-consent="denied"]').click();
  await expect(notice).toHaveCount(0);
  expect(await page.evaluate(() => window.__focusClearanceListeners.size)).toBe(0);
});

test("product default leaves served cards alone while a nondefault query hydrates", async ({ page }) => {
  await localOnly(page);
  await page.goto("/lp/best-providers/compounded-semaglutide/", { waitUntil: "load" });
  const filters = page.locator("[data-provider-filters]");
  const cards = page.locator("[data-phase3-provider-grid] [data-phase3-provider]");
  await expect(filters).toHaveAttribute("data-filter-state-ready", "true");
  const served = await cards.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.program, marker: node.hasAttribute("data-filter-match") })));
  expect(served.length).toBeGreaterThan(0);
  expect(served.every(item => !item.marker)).toBe(true);
  await page.goto("/lp/best-providers/compounded-semaglutide/?plan=1", { waitUntil: "load" });
  await expect(filters).toHaveAttribute("data-filter-state-ready", "true");
  expect(await cards.evaluateAll(nodes => nodes.every(node => node.hasAttribute("data-filter-match")))).toBe(true);
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.program).sort())).toEqual(served.map(item => item.id).sort());
  expect(new URL(page.url()).searchParams.get("plan")).toBe("1");
  // Query, storage, reset and Back behavior for the searchable hub is not
  // duplicated here: compare-facet-integrity.spec.mjs:194-241 is the effect gate.
});
