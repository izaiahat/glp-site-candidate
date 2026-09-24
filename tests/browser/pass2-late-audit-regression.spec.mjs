import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!configuredBaseURL) throw new Error("pass2-late-audit-regression requires PLAYWRIGHT_BASE_URL; it must not start a server");

const root = new URL("../..", import.meta.url);
const registry = JSON.parse(await readFile(new URL("data/program-registry.json", root), "utf8"));
const graph = JSON.parse(await readFile(new URL("data/phase3-page-graph.json", root), "utf8"));
const articleImages = JSON.parse(await readFile(new URL("artifacts/ultracode/article-image-manifest.json", root), "utf8"));

const providerPrograms = [...registry.programs, ...graph.provider_work_order_additions];
const productRoutes = [
  ...graph.brand_pages.map((page) => [page.route, `brand-${page.slug}`]),
  ...graph.compounded_pages.map((page) => [page.route, `compounded-${page.medication_id}`]),
  ...graph.bulk_pages.map((page) => [page.route, `bulk-${page.duration_months}-month`]),
];
const consolidatedArticleRoutes = new Set([
  "/guides/cheapest-glp1/",
  "/guides/compare-online-glp-1-provider-fees/",
  "/guides/glp-1-program-total-cost-comparison/",
  "/guides/healthrx-vs-agelessrx/",
  "/guides/wellorithm-vs-enhance-md/",
]);

test("review directory filters and paginates without inventing approved reviews", async ({ page }) => {
  // 2026-08-26 review-capture redesign: page size 24, honest-zero state block
  // renamed .cs-revhub-state; every card carries an explicit no-reviews state.
  const response = await page.goto("/reviews/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  const cards = page.locator("[data-review-card]");
  expect(await cards.count()).toBe(123);
  await expect(page.locator(".cs-revhub-state dd").first()).toHaveText("0");
  await expect(page.locator("[data-review-card]:visible")).toHaveCount(24);
  await expect(cards.first().locator(".cs-revhub-card__status")).toHaveText("No published reviews yet");
  await page.locator('[data-review-type-filter="pharmacy"]').click();
  await expect(page.locator('[data-review-card][data-review-type="pharmacy"]:visible')).toHaveCount(24);
  await expect(page.locator('[data-review-card][data-review-type="provider"]:visible')).toHaveCount(0);
  await page.locator("[data-review-filter]").fill("Hallandale Pharmacy");
  await expect(page.locator("[data-review-card]:visible")).toHaveCount(1);
  await page.locator("[data-review-filter]").fill("No governed entity has this name");
  await expect(page.locator("[data-review-card]:visible")).toHaveCount(0);
  await page.locator("[data-review-filter-clear]").click();
  await expect(page.locator("[data-review-card]:visible")).toHaveCount(24);
  await page.locator("[data-review-load-more]").click();
  await expect(page.locator("[data-review-card]:visible")).toHaveCount(48);
});

test("review submission enforces exact entity type and exposes optional evidence", async ({ page }) => {
  // 2026-08-26 review-capture redesign: v2 intake fields (public_display_name,
  // primary_*), star radios, combobox entity picker with an explicit
  // "Add as new" path; exact-entity enforcement unchanged for typed names.
  const response = await page.goto("/reviews/submit/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  const form = page.locator("[data-review-page-form]");
  await expect(form.locator('input[name="evidence"]')).toHaveAttribute("accept", /application\/pdf/);
  await expect(form.locator('input[name="rating"]')).toHaveCount(5);
  await form.locator('input[name="public_display_name"]').fill("Test");
  await form.locator('input[name="verification_email"]').fill("test@example.com");
  const rating = form.locator('input[name="rating"][value="5"]');
  await rating.locator("xpath=..").click();
  await expect(rating).toBeChecked();
  await form.locator('input[name="primary_headline"]').fill("Verified experience");
  await form.locator('input[name="primary_experience_date"]').fill("2026-08-01");
  await form.locator('textarea[name="primary_review_body"]').fill("This is a browser acceptance narrative with enough detail to satisfy the governed minimum length requirement.");
  await form.locator('input[name="combined_attestation"]').check();
  const entity = form.locator('input[name="subject_name"]');
  await entity.fill("Hallandale Pharmacy");
  await expect(form.locator('input[name="experience_type"][value="pharmacy"]')).toBeChecked();
  await entity.fill("Unknown pharmacy");
  await page.locator("main").click({ position: { x: 4, y: 4 } });
  await form.locator("[data-review-next]").click();
  await expect.poll(() => entity.evaluate((input) => input.validationMessage)).toContain("Pick a listed entity");
});

test("served provider and product routes prove their distinct visual lineage", async ({ page, request }) => {
  expect(registry.programs.length).toBeGreaterThan(0);
  const providerIds = providerPrograms.map((program) => program.program_id);
  expect(providerIds.every((id) => typeof id === "string" && /^[a-z0-9-]+$/.test(id))).toBe(true);
  expect(new Set(providerIds).size).toBe(providerPrograms.length);
  for (const program of providerPrograms) {
    const response = await request.get(`/providers/${program.program_id}/`);
    expect(response.status(), program.program_id).toBe(200);
    const html = await response.text();
    expect(html, program.program_id).toContain(`data-provider-visual="${program.program_id}"`);
    expect(html, program.program_id).toContain(`/assets/images/provider-review-pass2/${program.program_id}-1280.avif`);
  }
  expect(productRoutes).toHaveLength(9);
  for (const [route, id] of productRoutes) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    const html = await response.text();
    expect(html, route).toContain(`data-product-visual="${id}"`);
    expect(html, route).toContain(`/assets/images/product-comparison-pass2/${id}-1280.avif`);
  }
  await page.goto(`/providers/${providerPrograms[0].program_id}/`, { waitUntil: "networkidle" });
  const providerImage = page.locator("[data-provider-visual] img");
  await expect(providerImage).toBeVisible();
  await providerImage.evaluate((image) => image.decode());
  const providerImageState = await providerImage.evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    currentSrc: image.currentSrc,
    width: image.getAttribute("width"),
    height: image.getAttribute("height"),
  }));
  expect(providerImageState).toEqual(expect.objectContaining({
    currentSrc: expect.stringMatching(/\/assets\/images\/provider-review-pass2\/[a-z0-9-]+-(640|1280)\.(avif|webp|jpg)$/),
    width: "1280",
    height: "720",
  }));
  expect(providerImageState.naturalWidth).toBeGreaterThanOrEqual(640);
  await page.goto(productRoutes[0][0], { waitUntil: "networkidle" });
  const productImage = page.locator("[data-product-visual] img");
  await expect(productImage).toBeVisible();
  expect((await productImage.evaluate((image) => image.naturalWidth))).toBeGreaterThanOrEqual(640);
});

test("all served articles expose native, email, X, and copy sharing while subscription routes stay zero-click", async ({ request }) => {
  const articleRoutes = articleImages.records.map((record) => record.route);
  expect(new Set(articleRoutes).size).toBe(articleRoutes.length);
  for (const route of consolidatedArticleRoutes) expect(articleRoutes, route).toContain(route);
  const liveArticleRoutes = articleRoutes.filter((route) => !consolidatedArticleRoutes.has(route));
  expect(liveArticleRoutes.length).toBeGreaterThan(0);
  let checked = 0;
  for (const record of articleImages.records) {
    const response = await request.get(record.route, { maxRedirects: 0 });
    if (consolidatedArticleRoutes.has(record.route)) {
      expect(response.status(), record.route).toBe(301);
      expect(new URL(response.headers().location, configuredBaseURL).pathname, record.route).toBe("/providers/");
      continue;
    }
    expect(response.status(), record.route).toBe(200);
    const html = await response.text();
    expect((html.match(/data-article-share/g) || []).length, record.route).toBe(1);
    expect(html, record.route).toContain("data-share-native");
    expect(html, record.route).toContain("mailto:?subject=");
    expect(html, record.route).toContain("https://x.com/intent/post?");
    expect(html, record.route).toContain("data-share-copy");
    checked += 1;
  }
  expect(checked).toBe(liveArticleRoutes.length);
  for (const route of ["/", "/guides/mounjaro-coupon/", "/guides/glp-1-insurance-support-vs-coverage/", "/insights/"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    const html = await response.text();
    const checkboxInputs = html.match(/<input\b[^>]*type=["']checkbox["'][^>]*>/gi) || [];
    expect(checkboxInputs.some((input) => /\bname=["']email_consent["']/.test(input) || /\bclass=["'][^"']*\bcapture-consent\b/.test(input)), route).toBe(false);
    expect(html, route).toMatch(/consent_version/);
    expect(html, route).toMatch(/href=["']\/privacy\//);
  }
});
