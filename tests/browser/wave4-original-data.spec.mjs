import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const route = "/research/original-data/public-glp-1-program-pricing-sample/";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(readFileSync(new URL("../../artifacts/ops/wave4-original-data-manifest.json", import.meta.url), "utf8"));

test("provenance-bound descriptive dataset is network-dark and download-consistent", async ({ page, request, baseURL }) => {
  const requests = [];
  page.on("request", (entry) => requests.push(entry.url()));
  await page.goto(route, { waitUntil: "networkidle" });

  await expect(page.locator("h1")).toHaveText("Four-page GLP-1 program pricing disclosure sample");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow,noarchive,nosnippet");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://glpclinicscout.com/research/original-data/public-glp-1-program-pricing-sample/");
  await expect(page.locator("table tbody tr")).toHaveCount(4);
  await expect(page.getByText("3 recurring membership rows", { exact: false })).toBeVisible();
  await expect(page.getByText("1 initial-visit row", { exact: false })).toBeVisible();
  await expect(page.getByText("4 of 4 pages", { exact: false })).toBeVisible();
  await expect(page.getByText("no combined price statistic is calculated", { exact: false })).toBeVisible();
  await expect(page.locator('a[download]')).toHaveCount(3);
  await expect(page.locator('a[href^="http"],a[href^="//"],a[href^="mailto:"],a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator("form,script[src]")).toHaveCount(0);
  await expect(page.locator('script:not([type="application/ld+json"])')).toHaveCount(0);
  await expect(page.locator("ol li")).toHaveCount(4);

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  const structured = JSON.parse(jsonLd);
  expect(structured["@context"]).toBe("https://schema.org");
  expect(structured["@type"]).toBe("Dataset");
  expect(structured.name).toBe("Four-page GLP-1 program pricing disclosure sample");
  expect(structured.isBasedOn).toHaveLength(4);

  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).origin).toBe(new URL(baseURL).origin);

  const downloads = [
    ["/data/public-glp-1-program-pricing-sample.csv", "csv_sha256"],
    ["/data/public-glp-1-program-pricing-sample.json", "dataset_sha256"],
    ["/data/public-glp-1-program-pricing-sample-methodology.json", "methodology_sha256"],
  ];
  for (const [url, hashField] of downloads) {
    const response = await request.get(url);
    expect(response.ok()).toBeTruthy();
    expect(sha256(await response.body())).toBe(manifest[hashField]);
  }
});
