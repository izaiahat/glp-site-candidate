import { test, expect } from "@playwright/test";

// P67 / R14: the approved destination is the E listing, not the retired table.
const route = "/providers/";
const filters = '[data-provider-filters]';
const grid = 'main[data-listing-archetype="E"] [data-phase3-provider-grid]';
const cards = `${grid} > [data-phase3-provider]`;
const options = '[data-provider-search] [role="option"]';
const defaults = { treatment: "all", type: "all", plan: "both", duration: "all", dose: "all", sort: "cheapest" };
const search = (page) => page.getByRole("combobox", { name: "Provider", exact: true });
const chip = (page, key, value) => page.locator(`${filters} [data-filter="${key}"][data-value="${value}"]`);

async function openListing(page, query = "", destination = route) {
  await page.goto(`${destination}${query}`);
  await expect(page.locator(filters)).toHaveAttribute("data-filter-state-ready", "true");
}
async function canonicalProgramIds(page) {
  const value = await page.locator("[data-provider-search]").getAttribute("data-canonical-provider-ids");
  const ids = value.split(",").filter(Boolean);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(await page.locator(cards).evaluateAll((rows) => rows.map((row) => row.dataset.program)))).toEqual(new Set(ids));
  return ids;
}
async function visibleProgramIds(page) {
  return page.locator(`${cards}:visible`).evaluateAll((rows) => rows.map((row) => row.dataset.program));
}
async function assertCount(page, expectedIds) {
  await expect.poll(() => page.locator(`${cards}[data-filter-match="true"]`).evaluateAll((rows) => rows.map((row) => row.dataset.program).sort())).toEqual([...expectedIds].sort());
  // Progressive disclosure is 12 cards in the accepted E renderer/runtime.
  const shown = Math.min(12, expectedIds.length);
  await expect(page.locator(`${cards}:visible`)).toHaveCount(shown);
  const prefix = shown < expectedIds.length ? `Showing ${shown} of ${expectedIds.length}` : `Showing ${shown}`;
  await expect(page.locator("[data-filter-result]")).toHaveText(`${prefix} program card${expectedIds.length === 1 ? "" : "s"}`);
}
async function appliedHistorySnapshot(page) {
  return page.evaluate(({ filters, cards }) => ({
    path: location.pathname, search: location.search,
    payload: history.state?.glpProviderFilters || null,
    query: document.querySelector('[data-provider-search] input')?.value || "",
    selected: Object.fromEntries([...document.querySelectorAll(`${filters} button[data-filter][aria-selected="true"], ${filters} button[data-filter][aria-pressed="true"]`)].map((node) => [node.dataset.filter, node.dataset.value])),
    count: document.querySelector('[data-filter-result]')?.textContent || "",
    visibleProgramIds: [...document.querySelectorAll(cards)].filter((row) => !row.hidden).map((row) => row.dataset.program),
    historyLength: history.length,
  }), { filters, cards });
}
async function installHistoryCallRecorder(page) {
  await page.addInitScript(() => {
    const calls = [];
    Object.defineProperty(window, '__glpHistoryCalls', { value: calls });
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function recordedHistoryWrite(state, title, url) {
        calls.push({ method, state: JSON.parse(JSON.stringify(state ?? null)), url: String(url ?? '') });
        return original.call(this, state, title, url);
      };
    }
  });
}
async function historyCallCounts(page) {
  return page.evaluate(() => ({
    pushState: window.__glpHistoryCalls.filter((call) => call.method === 'pushState').length,
    replaceState: window.__glpHistoryCalls.filter((call) => call.method === 'replaceState').length,
  }));
}

test("provider autocomplete is canonical, mouse accessible, and draft-only until Search providers", async ({ page }) => {
  await openListing(page);
  const canonicalIds = await canonicalProgramIds(page);
  await search(page).focus();
  await expect(search(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(options)).toHaveCount(canonicalIds.length);
  const labels = await page.locator(options).allTextContents();
  expect(new Set(labels.map((label) => label.trim().toLowerCase())).size).toBe(canonicalIds.length);
  expect(new Set(await page.locator(options).evaluateAll((entries) => entries.map((entry) => entry.dataset.program)))).toEqual(new Set(canonicalIds));
  expect(labels.filter((label) => /shed/i.test(label))).toHaveLength(1);
  const beforeIds = await visibleProgramIds(page), beforeUrl = page.url();
  await search(page).fill("Enhance");
  const enhance = page.locator(options).filter({ hasText: /^Enhance\.MD$/ });
  await expect(enhance).toBeVisible();
  expect(await visibleProgramIds(page)).toEqual(beforeIds);
  expect(page.url()).toBe(beforeUrl);
  await enhance.click();
  expect(await visibleProgramIds(page)).toEqual(beforeIds);
  expect(page.url()).toBe(beforeUrl);
  await page.locator("[data-provider-search]").getByRole("button", { name: "Search providers", exact: true }).click();
  await expect(page).toHaveURL(/provider=Enhance(?:\.|%2E)MD/);
  await assertCount(page, ["enhance-md"]);
});

test("keyboard selection applies on Enter, Escape only closes, and Reset applies defaults", async ({ page }) => {
  await openListing(page);
  await search(page).focus();
  await search(page).press("ArrowDown");
  const activeId = await search(page).getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  const active = page.locator(`#${activeId}`);
  const activeLabel = (await active.textContent()).trim();
  const activeProgram = await active.getAttribute("data-program");
  await search(page).press("Escape");
  await expect(search(page)).toHaveAttribute("aria-expanded", "false");
  expect(page.url()).not.toContain("provider=");
  await search(page).press("ArrowDown");
  await search(page).press("Enter");
  await assertCount(page, [activeProgram]);
  await expect(search(page)).toHaveValue(activeLabel);
  await page.locator("[data-provider-search-reset]").click();
  await expect(page).toHaveURL(`${route}?plan=both&sort=cheapest`);
  await expect(search(page)).toHaveValue("");
  await assertCount(page, await canonicalProgramIds(page));
});

test("facet drafts do not filter or change URL; button and Enter apply; sort keeps the applied set", async ({ page }) => {
  await openListing(page);
  const expected = await page.locator(cards).evaluateAll((rows) => rows.filter((row) => (row.dataset.drugs || "").split(/\s+/).includes("SEMAGLUTIDE")).map((row) => row.dataset.program));
  expect(expected.length).toBeGreaterThan(0);
  const beforeIds = await visibleProgramIds(page), beforeUrl = page.url();
  await chip(page, "treatment", "SEMAGLUTIDE").click();
  expect(await visibleProgramIds(page)).toEqual(beforeIds);
  expect(page.url()).toBe(beforeUrl);
  await page.locator("[data-provider-search]").getByRole("button", { name: "Search providers", exact: true }).click();
  await expect(page).toHaveURL(/drug=SEMAGLUTIDE/);
  await assertCount(page, expected);
  const appliedUrl = page.url(), appliedIds = await visibleProgramIds(page);
  await chip(page, "sort", "cheapest").click();
  expect(await visibleProgramIds(page)).toEqual(appliedIds);
  expect(page.url()).toBe(appliedUrl);
  const prices = await page.locator(`${cards}:visible`).evaluateAll((rows) => rows.map((row) => {
    const values = (row.dataset.priceMap || "").split("|").map((entry) => entry.split(":"))
      .filter(([token, value]) => token === "SEMAGLUTIDE" && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(([, value]) => Number(value));
    const raw = String(row.dataset.price ?? "").trim();
    const fallback = raw === "" ? Infinity : Number(raw);
    return values.length ? Math.min(...values) : Number.isFinite(fallback) && fallback >= 0 ? fallback : Infinity;
  }));
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
  await search(page).fill("OrderlyMeds");
  expect(page.url()).toBe(appliedUrl);
  await search(page).press("Enter");
  await assertCount(page, ["orderlymeds"]);
});

test("plain source labels, retatrutide guard, and mobile controls remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openListing(page);
  await expect(page.locator(filters).getByText("Medication", { exact: true })).toBeVisible();
  await expect(page.locator(filters).getByText("Form", { exact: true })).toBeVisible();
  for (const value of ["all", "compounded", "brand"]) await expect(chip(page, "type", value)).toBeVisible();
  // P17 supplies no per-string disposition here. Do not erase this truth check.
  await expect(page.getByText(/Retatrutide is not available as a consumer provider filter/)).toBeVisible();
  await expect(page.locator('.cmp-retatrutide-note a[href*="fda.gov"]')).toHaveCount(1);
  await expect(page.locator('.cmp-retatrutide-note a[href*="lilly.com"]')).toHaveCount(1);
  await expect(page.locator(filters).getByRole("tab", { name: /Retatrutide/i })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Retatrutide/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("retired local compare route reaches the approved E listing without a false four-row invariant", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/compare/found-vs-yourera/");
  await expect(page).toHaveURL(/\/providers\/(?:\?|$)/);
  await expect(page.locator(filters)).toHaveAttribute("data-filter-state-ready", "true");
  await assertCount(page, await canonicalProgramIds(page));
  expect(pageErrors).toEqual([]);
});

test("applied mouse, Enter, reset, back, and forward states are navigable while drafts stay unapplied", async ({ page }) => {
  await openListing(page);
  const initialLength = await page.evaluate(() => history.length);
  await chip(page, "treatment", "SEMAGLUTIDE").click();
  await page.locator("[data-provider-search]").getByRole("button", { name: "Search providers", exact: true }).click();
  const medication = await appliedHistorySnapshot(page);
  expect(medication.historyLength).toBe(initialLength + 1);
  await search(page).fill("OrderlyMeds");
  expect(page.url()).not.toContain("provider=");
  await search(page).press("Enter");
  await assertCount(page, ["orderlymeds"]);
  const provider = await appliedHistorySnapshot(page);
  expect(provider.historyLength).toBe(initialLength + 2);
  await page.goBack();
  await expect.poll(() => appliedHistorySnapshot(page)).toEqual({ ...medication, historyLength: initialLength + 2 });
  await page.goForward();
  await expect.poll(() => appliedHistorySnapshot(page)).toEqual(provider);
  await page.locator("[data-provider-search-reset]").click();
  await expect(page).toHaveURL(`${route}?plan=both&sort=cheapest`);
  expect(await page.evaluate(() => history.length)).toBe(initialLength + 3);
  await page.goBack();
  await expect(search(page)).toHaveValue("OrderlyMeds");
  await page.goForward();
  await expect(search(page)).toHaveValue("");
  await assertCount(page, await canonicalProgramIds(page));
});

test("initial hydration writes at most one complete normalized entry; drafts stay inert and apply/sort retain every field", async ({ page }) => {
  await installHistoryCallRecorder(page);
  await openListing(page, "?provider=%20Shed%20&drug=tirzepatide&form=compounded");
  await expect(page).toHaveURL(`${route}?provider=Shed&drug=TIRZEPATIDE&form=COMPOUNDED&plan=both&sort=cheapest`);
  expect(await historyCallCounts(page)).toEqual({ pushState: 0, replaceState: 1 });
  const before = await appliedHistorySnapshot(page);
  expect(before.payload).toEqual({ version: 1, query: "Shed", state: "", selected: { ...defaults, treatment: "TIRZEPATIDE", type: "compounded" } });
  await search(page).fill("");
  await search(page).press("Escape");
  await chip(page, "treatment", "SEMAGLUTIDE").click();
  await chip(page, "type", "brand").click();
  expect((await appliedHistorySnapshot(page)).payload).toEqual(before.payload);
  expect(await historyCallCounts(page)).toEqual({ pushState: 0, replaceState: 1 });
  await chip(page, "sort", "cheapest").click();
  expect((await appliedHistorySnapshot(page)).payload).toEqual(before.payload);
  expect(await historyCallCounts(page)).toEqual({ pushState: 0, replaceState: 1 });
  await page.locator("[data-provider-search]").getByRole("button", { name: "Search providers", exact: true }).click();
  expect((await appliedHistorySnapshot(page)).payload).toEqual({ version: 1, query: "", state: "", selected: { ...defaults, treatment: "SEMAGLUTIDE", type: "brand" } });
  expect(await historyCallCounts(page)).toEqual({ pushState: 1, replaceState: 1 });
});

test("default -> Shed -> medication/source -> back/back -> forward/forward has two entries and exact restoration", async ({ page }) => {
  await installHistoryCallRecorder(page);
  await openListing(page);
  const initial = await appliedHistorySnapshot(page);
  expect(initial.payload).toEqual({ version: 1, query: "", state: "", selected: defaults });
  await search(page).fill("Shed");
  await page.locator(options).filter({ hasText: /^Shed$/ }).click();
  await page.locator("[data-provider-search]").getByRole("button", { name: "Search providers", exact: true }).click();
  await assertCount(page, ["shedrx"]);
  const shed = await appliedHistorySnapshot(page);
  await search(page).fill("");
  await search(page).press("Escape");
  await chip(page, "treatment", "TIRZEPATIDE").click();
  await chip(page, "type", "compounded").click();
  expect(await historyCallCounts(page)).toEqual({ pushState: 1, replaceState: 1 });
  await page.locator("[data-provider-search]").getByRole("button", { name: "Search providers", exact: true }).click();
  const combo = await appliedHistorySnapshot(page);
  expect(combo.payload).toEqual({ version: 1, query: "", state: "", selected: { ...defaults, treatment: "TIRZEPATIDE", type: "compounded" } });
  expect(combo.historyLength).toBe(initial.historyLength + 2);
  const stableCalls = await historyCallCounts(page);
  expect(stableCalls).toEqual({ pushState: 2, replaceState: 1 });
  for (const [direction, target] of [["goBack", shed], ["goBack", initial], ["goForward", shed], ["goForward", combo]]) {
    await page[direction]();
    await expect.poll(() => appliedHistorySnapshot(page)).toEqual({ ...target, historyLength: combo.historyLength });
    expect(await historyCallCounts(page)).toEqual(stableCalls);
  }
});

test("a normalized synthetic next identity initializes runtime suggestions, counts, and compare filtering", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`**${route}`, async (intercept) => {
    const response = await intercept.fetch();
    let body = await response.text();
    const replaceOnce = (pattern, replacement) => {
      expect([...body.matchAll(new RegExp(pattern.source, "g"))]).toHaveLength(1);
      body = body.replace(pattern, replacement);
    };
    // The accepted producer emits the canonical IDs, options and cards together.
    replaceOnce(/data-canonical-provider-ids="([^"]+)"/, (_match, ids) => `data-canonical-provider-ids="${ids},synthetic-runtime-clinic"`);
    replaceOnce(/(<div id="p3-provider-options"[^>]*>)/, '$1<button type="button" role="option" id="p3-provider-option-synthetic" data-program="synthetic-runtime-clinic" aria-selected="false" tabindex="-1">Synthetic Runtime Clinic</button>');
    replaceOnce(/(<div[^>]*data-phase3-provider-grid[^>]*>)/, '$1<article data-phase3-provider data-program="synthetic-runtime-clinic" data-price="" data-price-map="" data-drugs="SEMAGLUTIDE" data-forms="compounded" data-duration="unknown" data-dose="unknown" data-state-mode="unknown"><h3>Synthetic Runtime Clinic</h3><p>No comparable published price.</p><a href="/providers/synthetic-runtime-clinic/">Provider details</a></article>');
    await intercept.fulfill({ response, body });
  });
  await openListing(page);
  const ids = await canonicalProgramIds(page);
  await assertCount(page, ids);
  const order = await page.locator(cards).evaluateAll((rows) => rows.map((row) => ({
    id: row.dataset.program,
    priced: String(row.dataset.price ?? "").trim() !== "" && Number.isFinite(Number(row.dataset.price)) && Number(row.dataset.price) >= 0,
  })));
  expect(order.some((row) => row.priced)).toBe(true);
  const unknownIndex = order.findIndex((row) => row.id === "synthetic-runtime-clinic");
  expect(unknownIndex).toBeGreaterThan(Math.max(...order.map((row, index) => row.priced ? index : -1)));
  await search(page).focus();
  await expect(page.locator(options)).toHaveCount(ids.length);
  await search(page).fill("Synthetic Runtime");
  await page.locator(options).filter({ hasText: /^Synthetic Runtime Clinic$/ }).click();
  await page.locator("[data-provider-search]").getByRole("button", { name: "Search providers", exact: true }).click();
  await assertCount(page, ["synthetic-runtime-clinic"]);
  await expect(page.locator(`${cards}:visible`)).toContainText("No comparable published price.");
  expect(errors).toEqual([]);
});
