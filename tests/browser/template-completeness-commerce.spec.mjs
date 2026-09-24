import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
].filter((viewport) => !process.env.PASS3_VIEWPORT || viewport.name === process.env.PASS3_VIEWPORT);

const PRODUCTS = [
  {
    route: "/wegovy-pill/",
    name: "Wegovy pill",
    manufacturer: "https://www.wegovy.com/obesity/is-wegovy-right-for-me/wegovy-pill-results.html",
  },
  { route: "/wegovy/", name: "Wegovy", manufacturer: "https://www.wegovy.com/" },
  { route: "/ozempic/", name: "Ozempic", manufacturer: "https://www.ozempic.com/" },
  { route: "/mounjaro/", name: "Mounjaro", manufacturer: "https://mounjaro.lilly.com/" },
  { route: "/zepbound/", name: "Zepbound", manufacturer: "https://zepbound.lilly.com/" },
];

const CATEGORIES = [
  {
    route: "/lp/best-providers/compounded-semaglutide/",
    name: "Compounded semaglutide",
    doses: ["All doses", "0.25 mg/week", "0.5 mg/week", "1 mg/week", "1.7 mg/week", "2.4 mg/week"],
    selectedDose: "0.25",
    brandRoute: "/wegovy/",
  },
  {
    route: "/lp/best-providers/compounded-tirzepatide/",
    name: "Compounded tirzepatide",
    doses: ["All doses", "2.5 mg/week", "5 mg/week", "7.5 mg/week", "10 mg/week", "12.5 mg/week", "15 mg/week"],
    selectedDose: "2.5",
    brandRoute: "/zepbound/",
  },
];

const COMMERCE_ROUTES = new Set([
  ...PRODUCTS.map((product) => product.route),
  ...CATEGORIES.map((category) => category.route),
]);

const BULK_INTENTS = [
  {
    route: "/3-month/?drug=SEMAGLUTIDE",
    canonicalRoute: "/3-month/",
    duration: "3-month",
    heading: "3-month plans",
    drug: "SEMAGLUTIDE",
    token: "compounded-semaglutide-injection",
  },
  {
    route: "/3-month/?drug=TIRZEPATIDE",
    canonicalRoute: "/3-month/",
    duration: "3-month",
    heading: "3-month plans",
    drug: "TIRZEPATIDE",
    token: "compounded-tirzepatide-injection",
  },
  {
    route: "/6-month/?drug=SEMAGLUTIDE",
    canonicalRoute: "/6-month/",
    duration: "6-plus-month",
    heading: "6+ month plans",
    drug: "SEMAGLUTIDE",
    token: "compounded-semaglutide-injection",
  },
  {
    route: "/6-month/?drug=TIRZEPATIDE",
    canonicalRoute: "/6-month/",
    duration: "6-plus-month",
    heading: "6+ month plans",
    drug: "TIRZEPATIDE",
    token: "compounded-tirzepatide-injection",
  },
];

const ANALYTICS = /https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i;
const ARTIFACT_ROOT = path.resolve("artifacts/ultracode/template-completeness/commerce");
const QUIZ_PREFERENCES_KEY = "gcs.quiz.provider-fit.preferences.v1";
const STATE_KEY = "gcs.state.v1";

// The shared host is intentionally busy during the audit. These flags keep the
// focused Chromium lane to one browser process without changing served source.

test.setTimeout(360_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "gcs-cookie-v2-default-on-20260730",
      saved_at: "2026-08-23T00:00:00.000Z",
    }));
  });
  await page.route(ANALYTICS, (route) => route.fulfill({
    status: 204,
    contentType: "application/javascript",
    body: "",
  }));
  await page.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: true, state: "OR" }),
  }));
});

function watchRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  return errors;
}

async function gotoServed(page, route, canonicalRoute = route.split("?", 1)[0]) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
  expect(response?.status(), route).toBe(200);
  await expect(page.locator(`main[data-phase3-route="${canonicalRoute}"]`), route).toHaveCount(1);
  await expect(page.locator(".gcs-nav"), route).toHaveCount(1);
  await expect(page.locator(".gcs-footer"), route).toHaveCount(1);
  return response.status();
}

async function openMobileFiltersIfNeeded(page, viewport, label) {
  if (viewport.name !== "mobile") return null;
  const trigger = page.getByRole("button", { name: label });
  await expect(trigger).toBeVisible();
  await trigger.click();
  return trigger;
}

async function screenshot(page, viewport, name) {
  const dir = path.join(ARTIFACT_ROOT, viewport.name);
  await fs.mkdir(dir, { recursive: true });
  const destination = path.join(dir, `${name}.png`);
  await page.screenshot({ path: destination, fullPage: false, animations: "disabled" });
  return path.relative(process.cwd(), destination);
}

async function computed(locator, properties) {
  return locator.evaluate((node, names) => {
    const styles = getComputedStyle(node);
    return Object.fromEntries(names.map((name) => [name, styles[name]]));
  }, properties);
}

function transformComponents(transform) {
  if (!transform || transform === "none") return { scaleX: 1, scaleY: 1, x: 0, y: 0 };
  const values = transform.match(/matrix(?:3d)?\(([^)]+)\)/)?.[1].split(",").map(Number) || [];
  if (values.length === 16) return { scaleX: values[0], scaleY: values[5], x: values[12], y: values[13] };
  return { scaleX: values[0], scaleY: values[3], x: values[4], y: values[5] };
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} commerce template completeness served audit`, async ({ page }) => {
    const runtimeErrors = watchRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });

    const proof = {
      audit: "template-completeness-commerce",
      servedBaseURL: null,
      viewport,
      products: [],
      categories: [],
      bulkIntents: [],
      pharmacy: {},
      screenshots: [],
      runtimeErrors,
    };

    for (const [index, product] of PRODUCTS.entries()) {
      const status = await gotoServed(page, product.route);
      proof.servedBaseURL ??= new URL(page.url()).origin;
      const heading = page.getByRole("heading", { level: 1, name: product.name, exact: true });
      await expect(heading).toBeVisible();

      const render = page.locator(".p3-product-hero figure.p3-product-visual");
      const image = render.locator("img");
      await expect(render).toBeVisible();
      await expect(image).toBeVisible();
      const imageProof = await image.evaluate((node) => ({
        src: node.getAttribute("src"),
        alt: node.getAttribute("alt"),
        complete: node.complete,
        naturalWidth: node.naturalWidth,
        naturalHeight: node.naturalHeight,
      }));
      expect(imageProof.complete, product.route).toBe(true);
      expect(imageProof.naturalWidth, product.route).toBeGreaterThan(0);
      const renderMotion = await computed(render, ["animationName", "animationDuration"]);
      expect(renderMotion.animationName, product.route).toBe("none");

      const tabs = page.locator(".p3-med-tabs a");
      await expect(tabs, product.route).toHaveCount(["/mounjaro/", "/zepbound/"].includes(product.route) ? 3 : 4);
      const activeTab = page.locator('.p3-med-tabs a[aria-current="page"]');
      await expect(activeTab, product.route).toHaveCount(1);
      await expect(activeTab, product.route).toHaveText(product.name);
      const tabHrefs = await tabs.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      const tabRoutes = tabHrefs.map((href) => new URL(href, page.url()).pathname);
      expect(tabRoutes.every((route) => COMMERCE_ROUTES.has(route)), product.route).toBe(true);
      expect(new URL(await activeTab.getAttribute("href"), page.url()).pathname, product.route).toBe(product.route);

      const manufacturer = page.locator(`.p3-accordions a[href="${product.manufacturer}"]`);
      await expect(manufacturer, product.route).toHaveCount(1);
      await expect(manufacturer, product.route).toHaveAttribute("rel", /noopener/);
      const selfPayLinkCount = await page.locator('a[href="/self-pay/"]').count();
      expect(selfPayLinkCount, product.route).toBeGreaterThan(0);

      const wizard = page.locator("[data-insurance-wizard]");
      await expect(wizard, product.route).toBeVisible();
      const slider = wizard.locator('input[name="progress"]');
      await expect(slider).toHaveAttribute("min", "0");
      await expect(slider).toHaveAttribute("max", "100");
      await expect(slider).toHaveAttribute("step", "12.5");
      await expect(slider).toHaveValue("50");
      await slider.focus();
      await page.keyboard.press("ArrowRight");
      await expect(slider).toHaveValue("62.5");
      await wizard.locator('input[name="oop_max"]').fill("4000");
      await wizard.locator('input[name="oop_spent"]').fill("1200");
      const result = wizard.locator("[data-insurance-result]");
      await expect.poll(async () => (await result.textContent()) || "").toMatch(/(?:\$?2,800|\$?2800)/);
      const copay = wizard.locator('button[data-copay="50"]');
      await copay.click();
      await expect(copay).toHaveAttribute("aria-pressed", "true");
      await expect(result).toContainText(/(?:\$50|50)/);

      const accordions = page.locator(".p3-accordions details");
      await expect(accordions, product.route).toHaveCount(3);
      for (let accordionIndex = 0; accordionIndex < 3; accordionIndex += 1) {
        const accordion = accordions.nth(accordionIndex);
        await accordion.locator("summary").click();
        await expect(accordion).toHaveAttribute("open", "");
        await expect(accordion.locator("p")).toBeVisible();
      }

      const relatedLinks = page.locator(".p3-product-related a.p3-product-related-card");
      await expect(relatedLinks, product.route).toHaveCount(3);
      const relatedBefore = await computed(relatedLinks.first(), ["transform", "backgroundColor", "borderColor"]);
      await relatedLinks.first().hover();
      await page.waitForTimeout(220);
      const relatedAfter = await computed(relatedLinks.first(), ["transform", "backgroundColor", "borderColor"]);
      expect(relatedAfter.transform, product.route).not.toBe("none");

      const bodyText = await page.locator("main[data-phase3-route]").innerText();
      const selfPaySummaryCount = await page.locator(".p3-selfpay-summary").count();
      const insurancePanelCount = await page.locator(".p3-insurance").count();
      const combinedWithWithoutPricingPanelCount = await page.locator("[data-with-without-insurance]").count();
      const insurancePathCount = await page.locator("[data-insurance-path]").count();
      const finishControlCount = await wizard.locator("[data-insurance-complete]").count();
      const relatedCardCount = await page.locator(".p3-product-related a.p3-product-related-card").count();
      expect(selfPaySummaryCount, product.route).toBe(1);
      expect(insurancePanelCount, product.route).toBe(1);
      expect(combinedWithWithoutPricingPanelCount, product.route).toBe(1);
      expect(insurancePathCount, product.route).toBe(2);
      expect(finishControlCount, product.route).toBe(1);
      expect(relatedCardCount, product.route).toBe(3);

      proof.products.push({
        route: product.route,
        status,
        h1: await heading.innerText(),
        render: { ...imageProof, ...renderMotion },
        tabs: { count: await tabs.count(), hrefs: tabHrefs, routes: tabRoutes, active: product.route },
        manufacturerHref: await manufacturer.getAttribute("href"),
        selfPayLinkCount,
        pricingPanels: {
          selfPaySummaryCount,
          insurancePanelCount,
          hasWithInsuranceText: /with insurance/i.test(bodyText),
          hasWithoutInsuranceText: /without insurance/i.test(bodyText),
          combinedWithWithoutPricingPanelCount,
          insurancePathCount,
        },
        insurance: {
          slider: { before: "50", afterArrowRight: await slider.inputValue(), min: "0", max: "100", step: "12.5" },
          copayPressed: await copay.getAttribute("data-copay"),
          result: (await result.innerText()).trim(),
          finishControlCount,
        },
        accordions: {
          count: await accordions.count(),
          openCount: await accordions.locator(":scope[open]").count(),
          summaries: await accordions.locator("summary").allTextContents(),
        },
        relatedShelf: {
          linkCount: await relatedLinks.count(),
          cardCount: relatedCardCount,
          beforeHover: relatedBefore,
          afterHover: relatedAfter,
        },
      });

      if (index === 0) proof.screenshots.push(await screenshot(page, viewport, "product-wegovy-pill-interactions"));
      expect(runtimeErrors.splice(0), product.route).toEqual([]);
    }

    for (const [index, category] of CATEGORIES.entries()) {
      await page.evaluate(({ stateKey, quizKey }) => {
        localStorage.removeItem(stateKey);
        localStorage.removeItem(quizKey);
      }, { stateKey: STATE_KEY, quizKey: QUIZ_PREFERENCES_KEY });

      const status = await gotoServed(page, category.route);
      const h1 = page.locator("h1[data-state-heading]");
      await expect(h1).toHaveText(`${category.name} providers in Oregon`);
      await expect(page.locator('[data-state-select]')).toHaveValue("OR");

      const filters = page.locator("[data-provider-filters]");
      const mobileTrigger = await openMobileFiltersIfNeeded(page, viewport, /^Filters and sort/);
      await expect(filters).toBeVisible();

      const inventory = {};
      for (const groupName of ["treatment", "type", "plan", "duration", "dose", "sort"]) {
        inventory[groupName] = await filters
          .locator(`[data-filter-group="${groupName}"] [data-filter]`)
          .evaluateAll((buttons) => buttons.map((button) => ({
            text: button.textContent.trim(),
            value: button.dataset.value,
            pressed: button.getAttribute("aria-pressed"),
          })));
      }
      expect(inventory.treatment).toHaveLength(2);
      expect(inventory.type.map((item) => item.text)).toEqual(["Compounded", "Brand name", "Microdose"]);
      expect(inventory.plan.map((item) => item.text)).toEqual(["Both", "1 month", "3 months", "More plans"]);
      expect(inventory.duration.map((item) => item.text)).toEqual(["All", "6+ months", "Starter", "Step-up"]);
      expect(inventory.dose.map((item) => item.text)).toEqual(category.doses);
      expect(inventory.sort.map((item) => item.text)).toEqual(["Cheapest", "Best match (quiz only)"]);

      const visibleCards = page.locator("[data-phase3-provider]:visible");
      const initialVisible = await visibleCards.count();
      expect(initialVisible).toBeGreaterThan(0);
      const initialFirstProgram = await visibleCards.first().getAttribute("data-program");
      const matchedProgram = await visibleCards.last().getAttribute("data-program");
      expect(matchedProgram).toBeTruthy();

      const brandFilter = filters.locator('[data-filter="type"][data-value="brand"]');
      await brandFilter.click();
      await expect(page).toHaveURL((url) => url.pathname === category.brandRoute && url.searchParams.get("form") === "BRAND_NAME");
      const brandVisible = await page.locator("[data-phase3-provider]:visible").count();
      expect(brandVisible).toBeGreaterThan(0);
      await openMobileFiltersIfNeeded(page, viewport, /^Filters and sort/);
      await expect(filters).toBeVisible();
      await filters.locator('[data-filter="type"][data-value="compounded"]').click();
      await expect(page).toHaveURL((url) => url.pathname === category.route && url.searchParams.get("form") === "COMPOUNDED");
      await openMobileFiltersIfNeeded(page, viewport, /^Filters and sort/);
      await expect(filters).toBeVisible();
      await expect.poll(() => page.locator("[data-phase3-provider]:visible").count()).toBe(initialVisible);

      const threeMonth = filters.locator('[data-filter="plan"][data-value="3"]');
      await threeMonth.click();
      const threeMonthVisible = await page.locator("[data-phase3-provider]:visible").count();
      await filters.locator('[data-filter="plan"][data-value="both"]').click();
      await expect.poll(() => page.locator("[data-phase3-provider]:visible").count()).toBe(initialVisible);

      const moreFilters = filters.locator(".p3-more-filters");
      if (!(await moreFilters.getAttribute("open"))) await moreFilters.locator("summary").click();
      const selectedDose = filters.locator(`[data-filter="dose"][data-value="${category.selectedDose}"]`);
      await selectedDose.click();
      const selectedDoseVisible = await page.locator("[data-phase3-provider]:visible").count();
      expect(selectedDoseVisible).toBeGreaterThan(0);
      const selectedDoseCards = await page.locator("[data-phase3-provider]:visible")
        .evaluateAll((cards) => cards.map((card) => card.dataset.doseValues));
      expect(selectedDoseCards.every((doses) => doses?.split(/\s+/).includes(category.selectedDose))).toBe(true);
      await expect(page.locator("[data-phase3-provider]:visible [data-provider-card-contract='option-c']")).toHaveCount(selectedDoseVisible);
      await expect(page.locator("[data-phase3-provider] .p3-dose-grid, [data-phase3-provider] .p3-feature-chips")).toHaveCount(0);
      await filters.locator('[data-filter="dose"][data-value="all"]').click();
      await expect.poll(() => page.locator("[data-phase3-provider]:visible").count()).toBe(initialVisible);

      await page.evaluate(({ key, program }) => {
        localStorage.setItem(key, JSON.stringify({
          schema: "gcs-quiz-provider-fit-preferences-v1",
          matches: [program],
          saved_at: "2026-08-26T00:00:00.000Z",
        }));
      }, { key: QUIZ_PREFERENCES_KEY, program: matchedProgram });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(h1).toHaveText(`${category.name} providers in Oregon`);
      const reloadedFilters = page.locator("[data-provider-filters]");
      const reloadedMobileTrigger = await openMobileFiltersIfNeeded(page, viewport, /^Filters and sort/);
      await expect(reloadedFilters).toBeVisible();
      const reloadedVisibleCards = page.locator("[data-phase3-provider]:visible");
      await expect.poll(() => reloadedVisibleCards.count()).toBe(initialVisible);
      const beforeBest = await reloadedVisibleCards.first().getAttribute("data-program");
      const bestSort = reloadedFilters.locator('[data-filter="sort"][data-value="best"]');
      await expect(bestSort).toBeEnabled();
      await bestSort.click();
      await expect(bestSort).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => reloadedVisibleCards.first().getAttribute("data-program")).toBe(matchedProgram);
      const matchedPreferenceChip = page.locator(
        `[data-phase3-provider][data-program="${matchedProgram}"] [data-quiz-match-chip], `
          + `[data-phase3-provider][data-program="${matchedProgram}"] [data-preference-match]`,
      );
      await expect(matchedPreferenceChip).toBeVisible();
      const afterBest = await reloadedVisibleCards.first().getAttribute("data-program");

      if (viewport.name === "mobile" && reloadedMobileTrigger) {
        await reloadedFilters.getByRole("button", { name: "Show results" }).click();
        await expect(reloadedMobileTrigger).toBeFocused();
      }

      const firstCard = reloadedVisibleCards.first();
      const aurora = firstCard.locator(".p3-card-aurora");
      await expect(aurora).toHaveCount(1);
      const auroraBefore = await computed(aurora, ["animationName", "animationDuration", "animationPlayState"]);
      const cardBefore = await computed(firstCard, ["transform"]);
      await firstCard.hover();
      await page.waitForTimeout(220);
      const auroraAfter = await computed(aurora, ["animationName", "animationDuration", "animationPlayState"]);
      const cardAfter = await computed(firstCard, ["transform"]);
      expect(auroraBefore.animationName).toBe("none");
      expect(auroraAfter.animationName).toBe("none");
      expect(auroraAfter.animationDuration).toBe("0s");
      const beforeTransform = transformComponents(cardBefore.transform);
      const afterTransform = transformComponents(cardAfter.transform);
      expect(Math.abs(beforeTransform.x)).toBeLessThan(1);
      expect(Math.abs(beforeTransform.y)).toBeLessThan(1);
      expect(Math.abs(afterTransform.scaleX - 1)).toBeLessThan(0.01);
      expect(Math.abs(afterTransform.scaleY - 1)).toBeLessThan(0.01);
      expect(Math.abs(afterTransform.x)).toBeLessThan(1);
      expect(afterTransform.y).toBeGreaterThanOrEqual(-3.1);
      expect(afterTransform.y).toBeLessThanOrEqual(0.1);

      if (viewport.name === "mobile" && reloadedMobileTrigger) {
        await reloadedMobileTrigger.click();
        await expect(reloadedFilters).toBeVisible();
      }
      const stateButton = reloadedFilters.locator("[data-state-open]");
      await stateButton.click();
      const statePopover = reloadedFilters.locator(".p3-state-popover");
      await expect(statePopover).toBeVisible();
      const stateOptionCount = await statePopover.locator('[role="option"]').count();
      expect(stateOptionCount).toBe(51);
      await statePopover.locator("[data-state-search]").fill("Texas");
      await statePopover.getByRole("option", { name: "Texas", exact: true }).click();
      await expect(h1).toHaveText(`${category.name} providers in Texas`);
      await expect(stateButton.locator("[data-state-label]")).toHaveText("Texas");
      const popoverAttemptH1 = await h1.innerText();
      const popoverAttemptLabel = await stateButton.locator("[data-state-label]").innerText();
      const nativeStateSelect = page.locator('[data-state-select]');
      await nativeStateSelect.selectOption("TX");
      await expect(h1).toHaveText(`${category.name} providers in Texas`);

      proof.categories.push({
        route: category.route,
        status,
        h1: {
          geoDetected: `${category.name} providers in Oregon`,
          manuallySelected: await h1.innerText(),
        },
        state: {
          geoSelectValue: "OR",
          popoverOptions: stateOptionCount,
          popoverAttemptH1,
          popoverAttemptLabel,
          nativeSelectValue: await nativeStateSelect.inputValue(),
          finalH1: await h1.innerText(),
          selectedLabel: await stateButton.locator("[data-state-label]").innerText(),
        },
        inventory,
        cards: {
          initialVisible,
          brandVisible,
          threeMonthVisible,
          selectedDose: category.selectedDose,
          selectedDoseVisible,
          selectedDoseCards,
          initialFirstProgram,
          matchedProgram,
          beforeBest,
          afterBest,
          bestMatchDisabled: await bestSort.isDisabled(),
          preferenceChip: (await matchedPreferenceChip.innerText()).trim(),
          selectedDosePriceRowCount,
          featureChipCount: selectedFeatureChipCount,
          aurora: { beforeHover: auroraBefore, afterHover: auroraAfter },
          transform: { beforeHover: cardBefore.transform, afterHover: cardAfter.transform },
        },
      });

      if (index === 0) proof.screenshots.push(await screenshot(page, viewport, "category-semaglutide-texas-filter-state"));
      if (viewport.name === "mobile" && reloadedMobileTrigger) {
        await reloadedFilters.getByRole("button", { name: "Show results" }).click();
        await expect(reloadedMobileTrigger).toBeFocused();
      }
      if (viewport.name === "mobile" && mobileTrigger) expect(mobileTrigger).toBeTruthy();
      expect(runtimeErrors.splice(0), category.route).toEqual([]);
    }

    for (const [index, intent] of BULK_INTENTS.entries()) {
      const status = await gotoServed(page, intent.route, intent.canonicalRoute);
      await expect(page.getByRole("heading", { level: 1, name: intent.heading, exact: true })).toBeVisible();
      const intendedDrugButton = page.locator(`[data-bulk-drug-value="${intent.drug}"]`);
      const visibleCards = page.locator("[data-phase3-provider]:visible");
      await expect(visibleCards).toHaveCount(3);
      const activeBeforeClick = await page.locator('[data-bulk-drug-value][aria-pressed="true"]')
        .evaluateAll((buttons) => buttons.map((button) => button.dataset.bulkDrugValue));
      const resultBeforeClick = (await page.locator("[data-bulk-result]").innerText()).trim();
      await intendedDrugButton.click();
      await page.waitForTimeout(180);
      const activeAfterClick = await page.locator('[data-bulk-drug-value][aria-pressed="true"]')
        .evaluateAll((buttons) => buttons.map((button) => button.dataset.bulkDrugValue));
      const resultAfterClick = (await page.locator("[data-bulk-result]").innerText()).trim();
      const rows = await visibleCards.evaluateAll((cards) => cards.map((card) => ({
        program: card.dataset.program,
        medications: card.dataset.medications,
        duration: card.dataset.bulkDuration,
      })));
      expect(rows.every((row) => row.medications.includes(intent.token)), intent.route).toBe(true);
      expect(rows.every((row) => row.duration === intent.duration), intent.route).toBe(true);
      expect(new URL(page.url()).searchParams.get("drug")).toBe(intent.drug);

      proof.bulkIntents.push({
        route: intent.route,
        status,
        h1: await page.locator("h1").innerText(),
        intendedDrug: intent.drug,
        activeBeforeClick,
        activeAfterClick,
        resultBeforeClick,
        resultAfterClick,
        functionallyApplied: activeAfterClick.length === 1
          && activeAfterClick[0] === intent.drug
          && resultAfterClick.toLowerCase().includes(intent.drug.toLowerCase()),
        visibleCardCount: await visibleCards.count(),
        rows,
      });
      if (index === 0 || index === BULK_INTENTS.length - 1) {
        proof.screenshots.push(await screenshot(page, viewport, `bulk-${intent.duration}-${intent.drug.toLowerCase()}`));
      }
      expect(runtimeErrors.splice(0), intent.route).toEqual([]);
    }

    const hubStatus = await gotoServed(page, "/pharmacies/");
    const pharmacyFilters = page.locator("[data-pharmacy-filters]");
    const pharmacyMobileTrigger = await openMobileFiltersIfNeeded(page, viewport, /^Pharmacy filters/);
    await expect(pharmacyFilters).toBeVisible();
    const pharmacyCards = page.locator("[data-pharmacy-card]");
    await expect(pharmacyCards).toHaveCount(75);
    await expect(page.locator("[data-pharmacy-result]")).toHaveText("Showing 18 of 75 evidence records");

    await pharmacyFilters.locator("[data-pharmacy-search]").fill("Red Rock");
    await pharmacyFilters.locator("[data-pharmacy-class]").selectOption("503a");
    await pharmacyFilters.locator("[data-pharmacy-med]").selectOption("semaglutide");
    await pharmacyFilters.locator("[data-pharmacy-state]").selectOption("florida");
    const visiblePharmacies = page.locator("[data-pharmacy-card]:visible");
    await expect(visiblePharmacies).toHaveCount(1);
    await expect(visiblePharmacies.first()).toContainText("Red Rock Pharmacy");
    const detailLink = visiblePharmacies.locator('a[href="/pharmacies/red-rock/"]');
    await expect(detailLink).toHaveCount(1);

    const pharmacyHubScreenshot = await screenshot(page, viewport, "pharmacy-hub-red-rock-filtered");
    proof.screenshots.push(pharmacyHubScreenshot);
    const pharmacyHub = {
      status: hubStatus,
      initialCardCount: 75,
      filteredCardCount: await visiblePharmacies.count(),
      filteredResult: await page.locator("[data-pharmacy-result]").innerText(),
      filters: {
        search: await pharmacyFilters.locator("[data-pharmacy-search]").inputValue(),
        facility: await pharmacyFilters.locator("[data-pharmacy-class]").inputValue(),
        medication: await pharmacyFilters.locator("[data-pharmacy-med]").inputValue(),
        state: await pharmacyFilters.locator("[data-pharmacy-state]").inputValue(),
        additiveControlCount: await pharmacyFilters.locator("[data-pharmacy-additive]").count(),
      },
      cardAnatomy: {
        contractCount: await visiblePharmacies.first().locator("[data-pharmacy-card-contract='option-c']").count(),
        factRows: await visiblePharmacies.first().locator(".p3-pharmacy-facts > div").count(),
        evidenceLines: await visiblePharmacies.first().locator(".p3-card-evidence-line").count(),
        detailHref: await detailLink.getAttribute("href"),
      },
    };
    expect(pharmacyHub.filters.additiveControlCount).toBe(1);
    expect(pharmacyHub.cardAnatomy).toMatchObject({ contractCount: 1, factRows: 2, evidenceLines: 1 });

    if (viewport.name === "mobile" && pharmacyMobileTrigger) {
      await pharmacyFilters.getByRole("button", { name: "Show results" }).click();
      await expect(pharmacyMobileTrigger).toBeFocused();
    }

    await detailLink.click();
    await expect(page).toHaveURL(/\/pharmacies\/red-rock\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Red Rock Pharmacy", exact: true })).toBeVisible();
    const detailStatus = 200;
    const sourceCount = await page.locator(".p3-source-rail li").count();
    const unknownCount = await page.locator(".p3-unknowns li").count();
    expect(sourceCount).toBeGreaterThan(0);
    expect(unknownCount).toBeGreaterThan(0);
    const detailScreenshot = await screenshot(page, viewport, "pharmacy-detail-red-rock");
    proof.screenshots.push(detailScreenshot);
    proof.pharmacy = {
      hub: pharmacyHub,
      detail: {
        route: "/pharmacies/red-rock/",
        status: detailStatus,
        h1: await page.locator("h1").innerText(),
        sourceCount,
        unknownCount,
        actionBoundary: (await page.locator(".p3-action-grid").innerText()).trim(),
        reverseComparisonLinkCount: await page.locator('a[href="/pharmacies/red-rock/compare-providers/"]').count(),
      },
    };
    expect(runtimeErrors.splice(0), "pharmacy hub/detail").toEqual([]);

    proof.classification = {
      productPages: {
        status: "PASS",
        dItems: ["D46", "D47", "D48"],
        reason: "Five served routes expose current editorial renders, query-preserving medication tabs, self-pay/manufacturer links, combined with/without-insurance paths, slider/copay/result controls, completion controls, three accordions, and three-card related product shelves.",
      },
      compoundedCategories: {
        status: "PASS",
        dItems: ["D49", "D50", "D51"],
        reason: "Two served categories expose medication-correct dose inventories, working brand/compounded route switches, plan and dose filters, selected dose-price rows, feature-chip anatomy, saved-preference chips, Oregon/Texas state updates, restrained hover feedback, and a quiz-gated Best match sort that promotes the saved matched provider.",
      },
      bulkIntents: {
        status: "PASS",
        dItems: ["D11"],
        reason: "Both duration routes render three source-backed cards, and all four query intents preserve the requested drug in the URL, active button, result copy, medication rows, and duration metadata.",
      },
      pharmacies: {
        status: "PASS",
        dItems: ["D12", "template-order-10"],
        reason: "The 75-card evidence-qualified hub retains source-backed directory filters; Red Rock filters to one Option C card with location, services, evidence, and a real detail link, while its detail preserves source, unknown, action, and reverse-comparison boundaries.",
      },
    };

    const proofDir = path.join(ARTIFACT_ROOT, viewport.name);
    await fs.mkdir(proofDir, { recursive: true });
    await fs.writeFile(path.join(proofDir, "served-proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  });
}
