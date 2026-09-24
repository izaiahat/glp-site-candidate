import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAPPING = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/OPERATOR-PAGE-MAPPING-SHEET-20260829.csv";
const PROOF = "/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass5-screenshots-20260829/operator-map";
mkdirSync(PROOF, { recursive: true });

test.setTimeout(240_000);

const mappings = readFileSync(MAPPING, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => {
    const [ours, theirs] = line.split(",");
    return { ours, theirs };
  });

const uniqueMappings = [...new Map(mappings.map((mapping) => [mapping.ours, mapping])).values()];

function slugFor(url) {
  const parsed = new URL(url);
  const route = parsed.pathname.replace(/^\/+|\/+$/g, "").replaceAll("/", "-") || "home";
  const drug = parsed.searchParams.get("drug")?.toLowerCase();
  const form = parsed.searchParams.get("form")?.toLowerCase();
  return [route, drug, form].filter(Boolean).join("-");
}

test("all unique operator-mapped Clinic Scout routes preserve intent on the Pass 5 candidate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.route(/https?:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) =>
    route.fulfill({ status: 204, contentType: "application/javascript", body: "" }),
  );
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));

  const rows = [];
  for (const mapping of uniqueMappings) {
    const ours = new URL(mapping.ours);
    const runtimeErrors = [];
    const failedRequests = [];
    const onError = (error) => runtimeErrors.push(`pageerror:${error.message}`);
    const onConsole = (message) => { if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`); };
    const onFailed = (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`);
    page.on("pageerror", onError);
    page.on("console", onConsole);
    page.on("requestfailed", onFailed);

    const response = await page.goto(`${ours.pathname}${ours.search}`, { waitUntil: "domcontentloaded" });
    expect(response?.status(), mapping.ours).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("h1").first()).toBeVisible();
    const consent = page.getByRole("button", { name: "OK", exact: true });
    if (await consent.count() && await consent.first().isVisible()) await consent.first().click();
    await page.waitForTimeout(120);

    const final = new URL(page.url());
    expect(final.pathname, mapping.ours).toBe(ours.pathname);
    for (const [key, value] of ours.searchParams) expect(final.searchParams.get(key), `${mapping.ours} ${key}`).toBe(value);
    const metrics = await page.evaluate(() => {
      const main = document.querySelector("main");
      const mainBackground = main ? getComputedStyle(main).backgroundColor : "";
      const channels = mainBackground.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        h1: document.querySelector("h1")?.innerText.trim() || "",
        mainTextLength: main?.innerText.trim().length || 0,
        mainBackground,
        mainBackgroundLuminance: (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]),
      };
    });
    expect(metrics.overflow, `${mapping.ours} overflow`).toBeLessThanOrEqual(1);
    expect(metrics.mainTextLength, `${mapping.ours} content`).toBeGreaterThan(120);
    expect(metrics.mainBackgroundLuminance, `${mapping.ours} main canvas ${metrics.mainBackground}`).toBeLessThan(0.08);
    expect(runtimeErrors, `${mapping.ours} runtime errors`).toEqual([]);
    expect(failedRequests, `${mapping.ours} failed requests`).toEqual([]);
    await page.screenshot({ path: path.join(PROOF, `${slugFor(mapping.ours)}.png`), animations: "disabled" });
    rows.push({ ...mapping, final: final.toString(), ...metrics, runtimeErrors, failedRequests });

    page.off("pageerror", onError);
    page.off("console", onConsole);
    page.off("requestfailed", onFailed);
  }

  expect(mappings).toHaveLength(26);
  expect(uniqueMappings).toHaveLength(13);
  writeFileSync(path.join(PROOF, "operator-page-mapping-readback.json"), JSON.stringify({ source: MAPPING, mappingRows: mappings.length, uniqueClinicScoutRoutes: uniqueMappings.length, rows }, null, 2) + "\n");
});
