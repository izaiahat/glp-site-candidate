import { test, expect } from "@playwright/test";

const routes = [
  "/",
  "/quiz/provider-fit/",
  "/providers/?sort=cheapest",
  "/3-month/",
  "/reviews/",
  "/reviews/found-health/",
  "/guides/wegovy-pills-oral-semaglutide-cost/",
];

async function viewportPaint(page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const height = innerHeight;
    const effectiveOpacity = (node) => {
      let value = 1;
      let owner = null;
      for (let current = node; current instanceof Element; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return { value: 0, owner: current };
        value *= Number(style.opacity || 1);
        if (Number(style.opacity || 1) < 0.05 && !owner) owner = current;
      }
      return { value, owner };
    };
    const selectors = "main h1,main h2,main h3,main p,main a,main button,main input,main select,main table,main article,main img,main svg,footer h2,footer p,footer a";
    const intersecting = [...document.querySelectorAll(selectors)].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.right > 0
        && rect.left < width
        && rect.bottom > 0
        && rect.top < height
        && Math.min(rect.right, width) - Math.max(rect.left, 0) > 2
        && Math.min(rect.bottom, height) - Math.max(rect.top, 0) > 2;
    });
    const visible = intersecting.filter((node) => effectiveOpacity(node).value >= 0.05);
    const hidden = intersecting.filter((node) => effectiveOpacity(node).value < 0.05);
    return {
      scrollY,
      maxScroll: Math.max(0, document.documentElement.scrollHeight - height),
      visibleCount: visible.length,
      visibleLabels: visible.slice(0, 8).map((node) => (node.textContent || node.getAttribute("alt") || node.tagName).trim().slice(0, 80)),
      hiddenLabels: hidden.slice(0, 8).map((node) => {
        const state = effectiveOpacity(node);
        return {
          node: `${node.tagName.toLowerCase()}.${node.className || ""}`.slice(0, 100),
          owner: state.owner ? `${state.owner.tagName.toLowerCase()}.${state.owner.className || ""}`.slice(0, 100) : null,
          text: (node.textContent || node.getAttribute("alt") || "").trim().slice(0, 80),
        };
      }),
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    };
  });
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test.describe(`Pass 5 scroll stability — ${viewport.name}`, () => {
    test.use({ viewport, reducedMotion: "no-preference" });

    for (const route of routes) {
      test(`${route} never blanks while scrolling down and back up`, async ({ page }) => {
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.goto(route, { waitUntil: "load" });
        await page.waitForTimeout(350);
        const initial = await viewportPaint(page);
        const points = [0, 0.28, 0.62, 1, 0.62, 0.28, 0].map((ratio) => Math.round(initial.maxScroll * ratio));
        const samples = [];
        for (const point of points) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), point);
          samples.push(await viewportPaint(page));
          await page.waitForTimeout(50);
          samples.push(await viewportPaint(page));
          await page.waitForTimeout(130);
          samples.push(await viewportPaint(page));
        }
        for (const sample of samples) {
          expect(sample.visibleCount, `blank viewport at ${route} y=${sample.scrollY}; ${JSON.stringify(sample)}`).toBeGreaterThan(0);
        }
        expect(pageErrors, `${route} page errors`).toEqual([]);
      });
    }
  });
}
