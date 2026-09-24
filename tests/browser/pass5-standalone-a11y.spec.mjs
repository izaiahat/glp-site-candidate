import { expect, test } from "@playwright/test";
import axe from "axe-core";

const ROUTES = [
  "/research/original-data/public-glp-1-program-pricing-sample/",
  "/research/public-funnel-evidence/",
  "/tools/glp-1-price-tracker/",
  "/tools/glp-1-savings-offer-monitor/",
  "/lp/r/orderlymeds/",
];

async function auditRoutes(page, routes) {
  const findings = [];
  await page.route("https://**", (route) => route.abort());

  for (const route of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: axe.source });
    const result = await page.evaluate(async () => window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"],
      },
    }));
    for (const violation of result.violations.filter(({ impact }) => impact === "critical" || impact === "serious")) {
      findings.push({
        route,
        rule: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target.join(" ")),
      });
    }
  }

  return findings;
}

test("standalone dark surfaces have no serious or critical Axe findings on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await auditRoutes(page, ROUTES)).toEqual([]);
});

test("standalone dark surfaces have no serious or critical Axe findings on reduced-motion mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await auditRoutes(page, ROUTES)).toEqual([]);
});
