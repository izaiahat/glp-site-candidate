// Build gate — above-the-fold conversion contract (SPEC-CRO §4.2 / §9 P0, B-12).
//
// The measured defect: the comparison page's first viewport had no provider, no
// price, no score and no money CTA — the first interactive element was an
// email-capture button. This asserts the fix by MEASUREMENT, not by inspection:
// a `$` figure and a monetized CTA must both be inside the first viewport, and
// the email capture must follow the first complete provider result (P67 / R14).

import { expect, test } from "@playwright/test";

const MONEY_ROUTES = ["/best/online-glp-1-providers/", "/cost/online-glp-1-programs/"];
// The disclosure-order contract binds every money-template page, including the
// expanded-curated comparison that is not part of the fold measurement above.
const DISCLOSURE_ROUTES = [...MONEY_ROUTES, "/best/expanded-curated-glp-1-programs/"];
const FOLD = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

for (const [name, viewport] of Object.entries(FOLD)) {
  for (const route of MONEY_ROUTES) {
    test(`${name} first viewport on ${route} carries a $ figure and a money CTA`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route, { waitUntil: "load" });
      await page.waitForTimeout(300);
      // Mobile fold discipline is 1.5 screens (SPEC-CRO MB7); desktop is one.
      const limit = name === "mobile" ? viewport.height * 1.5 : viewport.height;
      const result = await page.evaluate((foldLimit) => {
        const top = (element) => element.getBoundingClientRect().top + window.scrollY;
        const rendered = (element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          for (let node = element; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) return false;
          }
          return true;
        };
        const inFold = (element) => rendered(element) && top(element) >= 0 && top(element) < foldLimit;
        const results = [...document.querySelectorAll('main[data-listing-archetype="E"] [data-phase3-provider-grid] > [data-phase3-provider]')].filter(rendered);
        const firstResult = results[0];
        const priced = firstResult ? [...firstResult.querySelectorAll("*")]
          .filter((element) => element.children.length === 0 && /\$\s?\d/.test(element.textContent || "") && inFold(element)) : [];
        const money = firstResult ? [...firstResult.querySelectorAll('a[data-analytics-event="affiliate_click"]')].filter(inFold) : [];
        const capture = [...document.querySelectorAll("[data-content-upgrade-form-inline], .inline-capture")].filter(rendered).map(top);
        return {
          pricedAboveFold: priced.length,
          moneyAboveFold: money.length,
          firstCapture: capture.length ? Math.min(...capture) : Infinity,
          resultBottom: firstResult ? top(firstResult) + firstResult.getBoundingClientRect().height : null,
        };
      }, limit);
      expect(result.pricedAboveFold, "no $ figure in the first viewport").toBeGreaterThan(0);
      expect(result.moneyAboveFold, "no money CTA in the first viewport").toBeGreaterThan(0);
      expect(result.resultBottom, "no rendered provider result").not.toBeNull();
      expect(result.firstCapture, "email capture precedes the end of the first provider result").toBeGreaterThan(result.resultBottom);
    });
  }
}

// MOAT INVARIANT — "disclosure above results" is NON-REGRESSABLE.
// The first B-12 pass lifted the dated-price verdict card to the top of <main> and
// thereby pushed the first $ figure and the first sponsored CTA ABOVE the affiliate
// disclosure, which lived inside #methodology. Fold measurement alone could not see
// that, so it shipped. This asserts DOM order directly, in a real browser, on all
// three money pages: the disclosure must precede EVERY money element on the page —
// the first $ figure, the first sponsored anchor, and the first affiliate_click CTA.
for (const route of DISCLOSURE_ROUTES) {
  test(`affiliate disclosure precedes every money element on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: "load" });
    const order = await page.evaluate(() => {
      const all = [...document.querySelectorAll("*")];
      const rank = new Map(all.map((element, index) => [element, index]));
      const first = (nodes) => {
        const ranks = [...nodes].map((node) => rank.get(node)).filter((value) => value !== undefined);
        return ranks.length ? Math.min(...ranks) : Infinity;
      };
      const disclosure = [...document.querySelectorAll(".affiliate-disclosure, .affiliate-note, [data-atf-disclosure]")];
      const dollars = all.filter((element) => element.children.length === 0 && /\$\s?\d/.test(element.textContent || ""));
      return {
        disclosure: first(disclosure),
        disclosureCount: disclosure.length,
        dollar: first(dollars),
        sponsored: first(document.querySelectorAll('a[rel~="sponsored"]')),
        affiliateCta: first(document.querySelectorAll('a[data-analytics-event="affiliate_click"]')),
        topMatch: first(document.querySelectorAll('main[data-listing-archetype="E"] [data-phase3-provider-grid] > [data-phase3-provider]')),
      };
    });
    expect(order.disclosureCount, "no affiliate disclosure element on the page").toBeGreaterThan(0);
    for (const key of ["disclosure", "dollar", "sponsored", "affiliateCta", "topMatch"]) expect(Number.isFinite(order[key]), `missing ${key}`).toBe(true);
    expect(order.disclosure, "disclosure is not above the first $ figure").toBeLessThan(order.dollar);
    expect(order.disclosure, "disclosure is not above the first sponsored link").toBeLessThan(order.sponsored);
    expect(order.disclosure, "disclosure is not above the first affiliate CTA").toBeLessThan(order.affiliateCta);
    expect(order.disclosure, "disclosure is not above the verdict card").toBeLessThan(order.topMatch);
  });
}

test("the top-pick price carries its capture date", async ({ page }) => {
  await page.goto("/best/online-glp-1-providers/", { waitUntil: "load" });
  const card = page.locator('main[data-listing-archetype="E"] [data-phase3-provider-grid] > [data-phase3-provider]:visible').first();
  await expect(card).toBeVisible();
  const priceFact = card.locator("[data-provider-card-contract] > div")
    .filter({ has: page.locator("dt", { hasText: /^Total monthly cost$/ }) });
  await expect(priceFact).toHaveCount(1);
  const evidence = priceFact.locator("small[data-source-checked]");
  await expect(evidence).toHaveCount(1);
  const chip = evidence.locator("time");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  const checked = await evidence.getAttribute("data-source-checked");
  expect(await chip.getAttribute("datetime")).toBe(checked);
  await expect(chip).toHaveText(checked);
  await expect(evidence.locator("a[href]")).toHaveCount(1);
  await expect(evidence.locator("a[href]")).toHaveAttribute("href", /^https:\/\//);
  await expect(page.locator("[data-prices-checked-date]")).toBeVisible();
});
