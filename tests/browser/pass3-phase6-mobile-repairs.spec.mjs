import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 430, height: 932 },
];

function parseRgb(value) {
  const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`unparseable color: ${value}`);
  return channels;
}

function luminance(rgb) {
  const channels = rgb.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const light = Math.max(luminance(parseRgb(foreground)), luminance(parseRgb(background)));
  const dark = Math.min(luminance(parseRgb(foreground)), luminance(parseRgb(background)));
  return (light + 0.05) / (dark + 0.05);
}

async function completeNoBranch(page) {
  await page.locator('[data-multi="intents"][data-value="SEMAGLUTIDE"]').click();
  await page.locator('[data-quiz-position="0"] [data-quiz-next]').click();
  await page.locator('[data-single="current_use"][data-value="no"]').click();
  await page.locator('[data-quiz-position="1"] [data-quiz-next]').click();
  await page.locator('[data-quiz-position="4"] [data-quiz-next]').click();
  await page.locator('[data-quiz-select="state"]').selectOption("OR");
  await page.locator('[data-quiz-position="5"] [data-quiz-next]').click();
  await page.locator("[data-quiz-finish]").click();
}

async function colorPair(locator) {
  return locator.evaluate((node) => {
    const transparent = new Set(["transparent", "rgba(0, 0, 0, 0)"]);
    let surface = node;
    let background = "rgba(0, 0, 0, 0)";
    while (surface && transparent.has(background)) {
      background = getComputedStyle(surface).backgroundColor;
      surface = surface.parentElement;
    }
    return { color: getComputedStyle(node).color, background };
  });
}

async function expectTargets(page, selector, label) {
  const nodes = page.locator(selector);
  const visible = [];
  for (let index = 0; index < await nodes.count(); index += 1) {
    const node = nodes.nth(index);
    if (await node.isVisible()) visible.push(node);
  }
  expect(visible.length, `${label}: visible target count`).toBeGreaterThan(0);
  for (const node of visible) {
    const box = await node.boundingBox();
    expect(box, `${label}: target geometry`).not.toBeNull();
    expect(box.width, `${label}: target width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${label}: target height`).toBeGreaterThanOrEqual(44);
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`Pass 3 Phase 6 mobile repairs at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, reducedMotion: "reduce" });

    test("quiz and review content retain readable mobile contrast", async ({ page }) => {
      await page.goto("/quiz/provider-fit/", { waitUntil: "domcontentloaded" });
      const origin = new URL(page.url()).origin;
      await completeNoBranch(page);
      await page.waitForURL((url) => url.origin === origin && url.pathname === "/matches/customized/");
      const resultUrl = new URL(page.url());
      expect(resultUrl.searchParams.get("drug")).toBe("SEMAGLUTIDE");
      expect(resultUrl.searchParams.get("state")).toBe("OR");
      expect(resultUrl.searchParams.get("form")).toBe("COMPOUNDED");
      const goal = resultUrl.searchParams.get("goal") || "medication-form";
      expect(["medication-form", "coaching", "price"]).toContain(goal);
      const payload = JSON.parse(await page.locator("#phase4-matches-data").textContent());
      expect(payload.schema).toBe("glp-phase4-compact-matcher-data-v1");
      const expectedIds = payload.result_sets[`SEMAGLUTIDE|OR|${goal}`];
      expect(Array.isArray(expectedIds)).toBe(true);
      expect(expectedIds.length).toBeGreaterThan(0);
      expect(new Set(expectedIds).size).toBe(expectedIds.length);
      const cards = page.locator("[data-result-cards] .qz-card");
      await expect(cards).toHaveCount(expectedIds.length);
      expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.program))).toEqual(expectedIds);
      const names = cards.locator(".qz-card-name");
      await expect(names).toHaveText(expectedIds.map((id) => payload.candidate_records[id].display_name));
      for (let index = 0; index < await names.count(); index += 1) {
        const pair = await colorPair(names.nth(index));
        expect(contrast(pair.color, pair.background), `quiz result ${index + 1} contrast`).toBeGreaterThanOrEqual(4.5);
      }

      await page.goto("/reviews/coivas/", { waitUntil: "domcontentloaded" });
      const coivasText = page.locator("main > .panel:not(.inline-capture) p").first();
      await expect(coivasText).toBeVisible();
      const coivasPair = await colorPair(coivasText);
      expect(contrast(coivasPair.color, coivasPair.background), "Coivas panel contrast").toBeGreaterThanOrEqual(4.5);

      await page.goto("/reviews/measured/", { waitUntil: "domcontentloaded" });
      const measuredCell = page.locator("table.cs-mobile-card-table tbody td").first();
      await expect(measuredCell).toBeVisible();
      const measuredPair = await colorPair(measuredCell);
      expect(contrast(measuredPair.color, measuredPair.background), "Measured mobile table contrast").toBeGreaterThanOrEqual(4.5);
    });

    test("repeated compact controls expose 44px touch geometry", async ({ page }) => {
      await page.goto("/guides/how-to-get-ozempic-online/", { waitUntil: "domcontentloaded" });
      const claimMap = page.locator("details.claim-evidence-fold");
      await expect(claimMap).toHaveCount(1);
      await claimMap.locator(":scope > summary").click();
      await expect(claimMap).toHaveAttribute("open", "");
      await expectTargets(page, "sup.inline-citation a", "guide source chips");

      await page.goto("/reviews/coivas/", { waitUntil: "domcontentloaded" });
      await expectTargets(page, ".citation > a", "review source chips");
      await expectTargets(page, ".ready6-jump-nav a", "review jump links");

      await page.goto("/lp/best-providers/compounded-semaglutide/", { waitUntil: "domcontentloaded" });
      await expectTargets(page, 'ul[aria-label="Dated price evidence"] > li > details > summary', "captured price wording summaries");

      await page.goto("/reviews/submit/", { waitUntil: "domcontentloaded" });
      await expectTargets(page, ".p5-check", "review attestations");

      await page.goto("/pharmacies/", { waitUntil: "domcontentloaded" });
      await expectTargets(page, ".cs-footer-grid a, .cs-footer-legal a", "footer links");
    });
  });
}
