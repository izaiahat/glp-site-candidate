import { test, expect } from "@playwright/test";

const DEPENDENCIES = [
  "/assets/vendor/gsap/gsap.min.js",
  "/assets/vendor/gsap/ScrollTrigger.min.js",
  "/assets/vendor/gsap/SplitText.min.js",
  "/assets/vendor/gsap/Flip.min.js",
  "/assets/vendor/lenis/lenis.min.js",
  "/assets/motion.js",
];

function dependencyPath(url) {
  const path = new URL(url).pathname;
  return DEPENDENCIES.includes(path) ? path : null;
}

test("fine-pointer desktop loads the single motion stack in declared order", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => {
    const path = dependencyPath(request.url());
    if (path) requests.push(path);
  });

  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect.poll(() => page.evaluate(() => Boolean(window.CS_MOTION?.__v2))).toBe(true);
  expect(requests).toEqual(DEPENDENCIES);
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", /native|reduced|fallback/);
  await context.close();
});

test("touch mobile skips all optional motion dependencies", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    reducedMotion: "no-preference",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => {
    const path = dependencyPath(request.url());
    if (path) requests.push(path);
  });

  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  // The registered title is historical: touch uses one motion owner, but
  // never instantiates the fine-pointer Lenis scroll transport.
  await expect.poll(() => page.evaluate(() => Boolean(window.CS_MOTION?.__v2))).toBe(true);
  expect(requests).toEqual(DEPENDENCIES);
  expect(await page.evaluate(() => ({
    nativeMobile: window.CS_MOTION.nativeMobile,
    lenis: window.CS_MOTION.lenis,
    reduced: window.CS_MOTION.reduced,
    globalLenis: Boolean(window.__gcsLenis),
  }))).toEqual({ nativeMobile: true, lenis: null, reduced: false, globalLenis: false });
  await context.close();
});

test("reduced-motion desktop skips all optional motion dependencies", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => {
    const path = dependencyPath(request.url());
    if (path) requests.push(path);
  });

  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  expect(requests).toEqual([]);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  expect(await page.evaluate(() => Boolean(window.CS_MOTION))).toBe(false);
  await context.close();
});
