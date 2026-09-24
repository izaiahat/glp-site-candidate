import { test, expect } from "@playwright/test";

const ROUTES = [
  "/research/original-data/public-glp-1-program-pricing-sample/",
  "/research/public-funnel-evidence/",
  "/tools/glp-1-price-tracker/",
  "/tools/glp-1-savings-offer-monitor/",
  "/lp/r/orderlymeds/",
];

for (const route of ROUTES) {
  test(`standalone dark surface stays readable and contained on ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("https://**/*", (request) => request.abort());
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const readback = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const heading = document.querySelector("h1");
      const headingStyle = heading ? getComputedStyle(heading) : null;
      const main = document.querySelector("main");
      const hero = document.querySelector(".hero");
      const observations = document.querySelector(".observations");
      const tableWrap = document.querySelector(".table-wrap");
      const cta = document.querySelector(".cta");
      const parseRgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const [red = 255, green = 255, blue = 255] = parseRgb(body.backgroundColor);
      const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      return {
        colorScheme: body.colorScheme,
        backgroundLuminance: luminance,
        bodyMargin: body.margin,
        mainPadding: main ? getComputedStyle(main).padding : null,
        heroPadding: hero ? getComputedStyle(hero).padding : null,
        headingVisible: Boolean(heading && heading.getClientRects().length && headingStyle?.visibility !== "hidden" && headingStyle?.opacity !== "0"),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || "",
        observations: observations ? { background: getComputedStyle(observations).backgroundColor, padding: getComputedStyle(observations).padding } : null,
        tableOverflowX: tableWrap ? getComputedStyle(tableWrap).overflowX : null,
        tableTabIndex: tableWrap ? tableWrap.tabIndex : null,
        ctaColor: cta ? getComputedStyle(cta).color : null,
        ctaHeight: cta ? cta.getBoundingClientRect().height : null,
      };
    });

    expect(readback.colorScheme).toContain("dark");
    expect(readback.backgroundLuminance).toBeLessThan(0.2);
    expect(readback.bodyMargin).toBe("0px");
    if (route === "/lp/r/orderlymeds/") {
      expect(readback.heroPadding).not.toBe("0px");
      expect(readback.ctaColor).toBe("rgb(4, 18, 14)");
      expect(readback.ctaHeight).toBeGreaterThanOrEqual(44);
    } else {
      expect(readback.mainPadding).not.toBe("0px");
    }
    expect(readback.headingVisible).toBe(true);
    expect(readback.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(readback.robots).toContain("noindex");
    if (route.includes("public-funnel-evidence")) {
      expect(readback.observations).toEqual({ background: "rgba(0, 0, 0, 0)", padding: "0px" });
    }
    if (readback.tableOverflowX !== null) {
      expect(readback.tableOverflowX).toBe("auto");
      expect(readback.tableTabIndex).toBe(0);
    }
  });
}

test("paid landing discloses before measurable commerce without navigating away", async ({ page }) => {
  await page.goto("/lp/r/orderlymeds/", { waitUntil: "domcontentloaded" });
  const disclosure = page.locator(".table-disclosure").first();
  const commerce = page.locator('[data-analytics-event="affiliate_click"]').first();
  await expect(disclosure).toBeVisible();
  await expect(commerce).toBeVisible();
  expect(await disclosure.evaluate((node, action) => Boolean(node.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING), await commerce.elementHandle())).toBe(true);
});
