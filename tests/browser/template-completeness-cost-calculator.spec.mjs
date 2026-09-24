import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const ROUTE = "/tools/glp-1-cost-calculator/";
const PROOF = path.resolve("artifacts/ultracode/template-completeness/cost-calculator");
const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

async function assertNoOverflow(page) {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(geometry.document, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.body, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport);
}

for (const viewport of VIEWPORTS) {
  test(`owned cost calculator keeps full functionality and house design at ${viewport.name}`, async ({ page, browserName }) => {
    await mkdir(PROOF, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const response = await page.goto(ROUTE, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).toHaveAttribute("data-page", "cost-calculator");
    await expect(page.locator("link[href*='site-tools.css']")).toHaveCount(1);
    const restrainedMotion = await page.locator("[data-motion]").evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        opacity: style.opacity,
        visibility: style.visibility,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      };
    }));
    expect(restrainedMotion.length).toBeGreaterThan(0);
    expect(restrainedMotion.filter((entry) => entry.opacity === "0"
      || entry.visibility === "hidden"
      || entry.animationName !== "none"
      || entry.animationDuration !== "0s"
      || entry.transitionDuration !== "0s")).toEqual([]);
    expect(await page.locator(".cs-palette-action").count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#cost-form")).toBeVisible();
    await expect(page.locator("#provider")).toBeVisible();
    await assertNoOverflow(page);

    if (viewport.width === 390) {
      const shortControls = await page.locator("#cost-form :is(input, select, button), #cost-result :is(a, button)").evaluateAll((nodes) => nodes
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => ({ label: node.id || node.textContent?.trim(), height: node.getBoundingClientRect().height }))
        .filter((entry) => entry.height < 44));
      expect(shortControls).toEqual([]);
    }

    if (browserName === "chromium") {
      await page.screenshot({ path: path.join(PROOF, `${viewport.name}-initial.png`), animations: "disabled", fullPage: true });
    }

    await page.locator("#provider").selectOption({ index: 1 });
    const medication = page.locator("#medication");
    if (await medication.isVisible()) await medication.selectOption({ index: 0 });
    await expect(page.locator("#first-base")).not.toHaveValue("");
    await expect(page.locator("#recurring-base")).not.toHaveValue("");
    await page.locator("#months").fill("3");
    await page.getByRole("button", { name: "Calculate estimate" }).click();

    await expect(page.locator("#cost-result")).toBeVisible();
    await expect(page.locator("#result-first")).toContainText("$");
    await expect(page.locator("#result-recurring")).toContainText("$");
    await expect(page.locator("#result-period")).toContainText("$");
    await expect(page).toHaveURL(/provider=.*months=3/);
    await assertNoOverflow(page);

    if (browserName === "chromium") {
      await page.screenshot({ path: path.join(PROOF, `${viewport.name}-result.png`), animations: "disabled", fullPage: true });
    }
    expect(errors).toEqual([]);
  });

  test(`owned cost calculator is complete with reduced motion at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    const hiddenMotion = await page.locator("[data-motion]").evaluateAll((nodes) => nodes
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => {
        const style = getComputedStyle(node);
        return { opacity: style.opacity, visibility: style.visibility };
      })
      .filter((entry) => entry.opacity === "0" || entry.visibility === "hidden"));
    expect(hiddenMotion).toEqual([]);
    await assertNoOverflow(page);
  });
}
