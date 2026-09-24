import { expect, test } from "@playwright/test";

const INTAKE = "/reviews/submit/";
const DIRECTORY = "/reviews/";

async function publishedDirectoryCardCount(request) {
  const response = await request.get(DIRECTORY);
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).not.toContain("Approved submitted reviews");
  return (html.match(/data-review-card/g) || []).length;
}

async function completePrimary(page) {
  // 2026-08-26 redesign: the combobox resolves the entity type automatically
  // (the no-JS type radios are runtime-hidden), product/topic live in an
  // optional disclosure with honest defaults, and ONE required checkbox
  // carries all three attestation substances.
  await page.locator('[name="public_display_name"]').fill("BrowserScout");
  await page.locator('[name="verification_email"]').fill("browser-phase5@example.invalid");
  await page.locator('[name="subject_name"]').fill("OrderlyMeds");
  await expect(page.locator('[name="experience_type"][value="provider"]')).toBeChecked();
  await page.keyboard.press("Escape");
  const details = page.locator('[data-review-step="primary"] .cs-intake-more');
  await details.locator("summary").click();
  await page.locator('[name="primary_product"]').selectOption("compounded_semaglutide");
  await page.locator('[name="primary_review_type"]').selectOption("service_and_support");
  const rating = page.locator('[name="rating"][value="4"]');
  await rating.locator("xpath=..").click();
  await expect(rating).toBeChecked();
  await page.locator('[name="primary_headline"]').fill("Browser moderation path stayed understandable");
  await page.locator('[name="primary_review_body"]').fill("Support answered the synthetic browser questions clearly, and the published service timeline stayed understandable throughout this test.");
  await page.locator('[name="primary_experience_date"]').fill("2026-08-01");
  await page.locator('[name="combined_attestation"]').check();
}

test("Phase 5 two-step skip posts one structured first-party intake and leaves approved public count unchanged", async ({ page, request, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const externalRequests = [];
  page.on("request", (outbound) => {
    const url = new URL(outbound.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.origin !== origin) externalRequests.push(url.href);
  });

  let postCount = 0;
  let postedPayload = null;
  await page.route("**/api/review-capture", async (route) => {
    postCount += 1;
    postedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({
        status: "CAPTURED_HELD_MANUAL_REVIEW",
        review_id: "review_phase5_browser_receipt",
        published: false,
        counterpart_received: false,
        evidence_received: false,
      }),
    });
  });

  const before = await publishedDirectoryCardCount(request);
  expect(before).toBeGreaterThan(0);
  await page.goto(INTAKE);
  await expect(page.locator("main[data-review-intake-root]")).toBeVisible();
  await expect(page.locator('[data-review-step="primary"]')).toBeVisible();
  await expect(page.locator('[data-review-step="counterpart"]')).toBeHidden();
  await expect(page.getByText(/How to audit the captured/i)).toHaveCount(0);
  await expect(page.locator(".review-depth-supplement, .review-depth")).toHaveCount(0);

  await completePrimary(page);
  await page.locator("[data-review-next]").click();
  await expect(page.locator('[data-review-step="primary"]')).toBeHidden();
  await expect(page.locator('[data-review-step="counterpart"]')).toBeVisible();
  await expect(page.locator("[data-review-counterpart-title]")).toHaveText("Optional pharmacy review");
  await expect(page.locator("[data-review-skip]")).toHaveText("Skip pharmacy review and submit provider review");
  await page.locator("[data-review-skip]").click();

  await expect.poll(() => postCount).toBe(1);
  expect(postedPayload).toMatchObject({
    schema_version: "review_intake_v2",
    public_display_name: "BrowserScout",
    verification_email: "browser-phase5@example.invalid",
    primary: {
      entity_name: "OrderlyMeds",
      entity_type: "provider",
      product: "compounded_semaglutide",
      rating: 4,
      review_type: "service_and_support",
      experience_date: "2026-08-01",
    },
    counterpart: null,
    truthful_attestation: true,
    privacy_attestation: true,
    moderation_consent: true,
    company: "",
  });
  await expect(page.locator("[data-review-page-status]")).toContainText("Held for manual review; nothing was published");
  await expect(page.locator("[data-review-page-status]")).toContainText("review_phase5_browser_receipt");
  expect(await publishedDirectoryCardCount(request)).toBe(before);
  expect(externalRequests).toEqual([]);
});

test("Phase 5 intake is overflow-free, touch-accessible, and instant under reduced motion at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(INTAKE);

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

  const ratingLabels = page.locator('[data-review-step="primary"] [data-review-rating] label');
  await expect(ratingLabels).toHaveCount(5);
  for (const label of await ratingLabels.all()) {
    const box = await label.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const motion = await page.locator('[data-review-step="primary"]').evaluate((element) => {
    const style = getComputedStyle(element);
    const toMs = (value) => value.split(",").map((part) => Number.parseFloat(part) * (part.trim().endsWith("ms") ? 1 : 1000));
    return [...toMs(style.transitionDuration), ...toMs(style.animationDuration)];
  });
  expect(motion.every((duration) => duration < 300)).toBeTruthy();
});

for (const viewport of [{ width: 375, height: 667 }, { width: 430, height: 932 }]) {
  test(`Phase 5 optional-step transition restores focused context at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(INTAKE);
    await completePrimary(page);
    await page.locator("[data-review-next]").click();

    const heading = page.locator("[data-review-counterpart-title]");
    await expect(heading).toBeFocused();
    await expect.poll(() => heading.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.top >= -1 && box.top < innerHeight / 2 && box.bottom <= innerHeight;
    })).toBe(true);
  });
}
