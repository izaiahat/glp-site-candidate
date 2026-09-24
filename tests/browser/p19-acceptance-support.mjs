import { expect } from "@playwright/test";
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

// These are retirement IDs, not passed assertions. No default approval exists.
export const RETIRED = Object.freeze({
  R11: ["EPC-economic-order", "providers-wellmedr-first"],
  R14: ["desktop-table-mobile-hidden", "mobile-details-table-hidden", "exact-five-per-presentation", "paper-rgb-255-253-247", "kicker-rgb-14-125-92", "disclosure-action-rgb-20-32-27", "legacy-native-summary-presentation"],
  R32: ["providers-intent-navigation-grid"],
  R33: ["self-pay-cross-page-medication-tabs"],
});

function persistentFile(path) {
  expect(typeof path).toBe("string");
  expect(isAbsolute(path)).toBe(true);
  const actual = realpathSync(path);
  const rel = relative("/home/ubuntu/business/reports", actual);
  expect(rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)).toBe(true);
  return actual;
}

export async function approvedRetirement(family, testInfo) {
  expect(Object.hasOwn(RETIRED, family)).toBe(true);
  expect(process.env.P19_APPROVAL_ROOT, "P19 acceptance requires an actual operator ruling").toBeTruthy();
  const file = persistentFile(resolve(process.env.P19_APPROVAL_ROOT, `${family}-ACCEPT.json`));
  const bytes = readFileSync(file);
  const receipt = JSON.parse(bytes.toString("utf8"));
  expect(receipt.schema).toBe("glp-p19-ruling-v1");
  expect(receipt.family).toBe(family);
  expect(receipt.branch).toBe("ACCEPT");
  expect(receipt.status).toBe("APPROVED");
  expect(typeof receipt.approved_by === "string" && receipt.approved_by.trim().length > 0).toBe(true);
  expect(typeof receipt.approval_reference === "string" && receipt.approval_reference.trim().length > 0).toBe(true);
  expect(Number.isFinite(Date.parse(receipt.approved_at))).toBe(true);
  expect(receipt.retired).toEqual(RETIRED[family]);
  if (family === "R11") expect(typeof receipt.successor_ordering_authority === "string" && receipt.successor_ordering_authority.trim().length > 0).toBe(true);
  expect(receipt.producer_git_blob).toBe("0a59151218150ce28f32e113571a1dc3f143b807");
  expect(receipt.spec_git_blob).toBe(family === "R11" || family === "R14"
    ? "f4be63031d80b7134aa6c311048438d293e1f9f1"
    : "2c8a526a54ea15659be908d9a1fda2597098d7d8");
  expect(receipt.approval_artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
  const approvalBytes = readFileSync(persistentFile(receipt.approval_artifact_path));
  expect(createHash("sha256").update(approvalBytes).digest("hex")).toBe(receipt.approval_artifact_sha256);
  for (const assertion of RETIRED[family]) testInfo.annotations.push({
    type: "P19_RETIRED", description: `${family}:${assertion}; ${receipt.approval_reference}`,
  });
  await testInfo.attach(`${family}-retirement-ruling`, { body: bytes, contentType: "application/json" });
  return receipt;
}

async function listing(page) {
  const main = page.locator("main.listing");
  await expect(main).toHaveCount(1);
  await expect(main).toBeVisible();
  const grid = main.locator("#provider-results > [data-phase3-provider-grid]");
  await expect(grid).toHaveCount(1);
  await expect(grid).toBeVisible();
  const cards = grid.locator("[data-phase3-provider]:visible");
  await expect(cards.first()).toBeVisible();
  const programs = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.program));
  expect(programs.length).toBeGreaterThan(0);
  expect(programs.every(program => typeof program === "string" && program.length > 0)).toBe(true);
  expect(new Set(programs).size).toBe(programs.length);
  return { main, grid, cards, programs };
}

async function cashOrder(cards) {
  const amounts = await cards.evaluateAll(nodes => nodes.map(node => {
    const raw = node.getAttribute("data-price");
    return raw === "" || raw === null ? null : Number(raw);
  }));
  expect(amounts.some(value => Number.isFinite(value))).toBe(true);
  expect(amounts.every(value => value === null || (Number.isFinite(value) && value >= 0))).toBe(true);
  const ordered = amounts.map(value => value === null ? Infinity : value);
  expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
}

async function disclosureBeforeCommerce(main) {
  const disclosure = main.locator("header.listing__intro .p3-source-disclosure");
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).toBeVisible();
  const before = await main.evaluate(root => {
    const notice = root.querySelector("header.listing__intro .p3-source-disclosure");
    const commerce = root.querySelector("#provider-results [data-provider-card-contract], #provider-results [data-analytics-event='affiliate_click']");
    return Boolean(notice && commerce && (notice.compareDocumentPosition(commerce) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(before).toBe(true);
}

export async function acceptEconomicRetirement(page, route, testInfo) {
  await approvedRetirement("R11", testInfo);
  const { main, grid, cards } = await listing(page);
  expect(new URL(page.url()).pathname).toBe(new URL(route, page.url()).pathname);
  for (const [key, value] of new URL(route, page.url()).searchParams) expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  await cashOrder(cards);
  await disclosureBeforeCommerce(main);
  expect(/best provider|#1 provider|★/i.test(await grid.textContent())).toBe(false);
  await testInfo.attach("R11-current-price-order", {
    body: Buffer.from(JSON.stringify(await cards.evaluateAll(nodes => nodes.map(node => ({
      program: node.dataset.program, price: node.getAttribute("data-price"),
    }))), null, 2)), contentType: "application/json",
  });
}

async function boundedGeometry(page, grid, cards) {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    html: document.documentElement.scrollWidth - innerWidth,
    body: document.body.scrollWidth - innerWidth,
  }));
  expect(geometry.html).toBeLessThanOrEqual(1);
  expect(geometry.body).toBeLessThanOrEqual(1);
  const bounds = await grid.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(geometry.viewport + 1);
  const rows = await cards.evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, height: r.height };
  }));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.width).toBeGreaterThan(0);
    expect(row.height).toBeGreaterThan(0);
    expect(row.left).toBeGreaterThanOrEqual(-1);
    expect(row.right).toBeLessThanOrEqual(geometry.viewport + 1);
  }
}

export async function acceptPresentationRetirement(page, testInfo) {
  const receipt = await approvedRetirement("R14", testInfo);
  const successor = receipt.successor;
  expect(Array.isArray(successor?.program_ids) && successor.program_ids.length > 0).toBe(true);
  expect(new Set(successor.program_ids).size).toBe(successor.program_ids.length);
  expect(typeof successor.source_evidence_reference === "string" && successor.source_evidence_reference.length > 0).toBe(true);
  for (const key of ["card_background", "card_kicker", "review_link"]) expect(successor.styles?.[key]).toMatch(/^rgba?\([^)]+\)$/);
  await page.setViewportSize({ width: 1440, height: 1050 });
  const response = await page.goto("/lp/best-providers/compounded-semaglutide/?drug=SEMAGLUTIDE&form=COMPOUNDED&sort=cheapest", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  // Resize the same document, as the frozen test does; no second navigation.
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const { main, grid, cards, programs } = await listing(page);
    expect(programs).toEqual(successor.program_ids);
    await expect(cards).toHaveCount(successor.program_ids.length);
    await boundedGeometry(page, grid, cards);
    await disclosureBeforeCommerce(main);
    await expect(cards.first()).toHaveCSS("background-color", successor.styles.card_background);
    await expect(cards.first().locator(".p3-card-header > .gcs-kicker")).toHaveCSS("color", successor.styles.card_kicker);
    const review = cards.first().locator("[data-card-review]");
    await expect(review).toHaveCount(1);
    await expect(review).toBeVisible();
    await expect(review).toHaveCSS("color", successor.styles.review_link);
    const actions = grid.locator(".p3-card-actions .cs-btn:visible");
    const actionHeights = await actions.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(actionHeights.length).toBeGreaterThanOrEqual(programs.length);
    expect(actionHeights.every(height => height >= 44)).toBe(true);
    const summaryHeights = await main.locator("summary:visible").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(summaryHeights.every(height => height >= 44)).toBe(true);
    await testInfo.attach(`R14-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ fullPage: true }), contentType: "image/png",
    });
  }
}

export async function assertAcceptedModule(page, family, testInfo) {
  await approvedRetirement(family, testInfo);
  const { main, cards, programs } = await listing(page);
  await expect(main.locator(".p3-filterbar")).toHaveCount(1);
  await expect(main.locator(".p3-filterbar")).toBeVisible();
  if (family === "R32") {
    const ledger = main.locator("[data-directory-pricing]");
    await expect(ledger).toHaveCount(1);
    await expect(ledger).toBeVisible();
    const hrefs = await ledger.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every(href => Boolean(href) && href !== "#")).toBe(true);
    expect(new Set(hrefs).size).toBeGreaterThan(1);
    await expect(ledger).toContainText("Provider filters do not change this source ledger.");
  } else if (family === "R33") {
    await expect(cards).toHaveCount(3);
    expect(programs.length).toBe(3);
    await expect(main.locator("header.listing__intro h1")).toHaveText("Compare 3 self-pay provider options");
    await expect(main.locator(".listing__support")).toContainText("Selected by lowest reported cash starting amount, then provider name.");
    await expect(main.locator(".listing__support")).toContainText("this is not a treatment recommendation, quality ranking or confirmation of availability.");
    await cashOrder(cards);
  } else {
    throw new Error(`p19_module_retirement_not_defined:${family}`);
  }
}

export async function assertCompleteNoJsCards(page, testInfo) {
  // No R36 retirement: complete noscript twins are a source-visible counterpart.
  const { grid, cards, programs } = await listing(page);
  await expect(grid.locator("[data-provider-lazy-index]:visible")).toHaveCount(0);
  for (let index = 0; index < programs.length; index += 1) {
    const card = cards.nth(index);
    const facts = card.locator("[data-provider-card-contract]");
    await expect(facts).toHaveCount(1);
    await expect(facts).toBeVisible();
    await expect(facts.locator("dt")).toHaveText(["Medications offered", "Total monthly cost", "Cancellation"]);
    const values = await facts.locator("dd").allTextContents();
    expect(values.length).toBe(3);
    expect(values.every(value => value.trim().length > 0)).toBe(true);
    expect(await card.locator("[data-source-checked]").count()).toBeGreaterThan(0);
    const actions = card.locator(".p3-card-actions");
    await expect(actions).toHaveCount(1);
    await expect(actions).toBeVisible();
    expect(await actions.locator("a[href]").count()).toBeGreaterThan(0);
    const hrefs = await actions.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    expect(hrefs.every(href => Boolean(href) && href !== "#")).toBe(true);
  }
  const native = page.locator(".p3-state-native select");
  await expect(native).toHaveCount(1);
  await expect(native).toBeVisible();
  await expect(native).toBeEnabled();
  const initial = await native.inputValue();
  const alternate = await native.locator("option").evaluateAll(nodes => nodes.find(node => node.value !== "" && node.value !== nodes.find(option => option.selected)?.value && !node.disabled)?.value);
  expect(alternate).toBeTruthy();
  await native.selectOption(alternate);
  await expect(native).toHaveValue(alternate);
  await native.selectOption(initial);
  await expect(native).toHaveValue(initial);
  testInfo.annotations.push({ type: "P19_COUNTERPART", description: "R36: complete no-JS cards; no frozen assertion retired" });
  await testInfo.attach("R36-visible-no-js-programs", { body: Buffer.from(JSON.stringify(programs, null, 2)), contentType: "application/json" });
}
