import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Run after the guarded build. Inspect emitted documents, not a second renderer.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const ORIGIN = "http://p26.test";
const PAID = new Map([
  ["/lp/best-providers/compounded-semaglutide/", "compounded-semaglutide-injection"],
  ["/lp/best-providers/compounded-tirzepatide/", "compounded-tirzepatide-injection"],
]);
const REQUIRED_TYPED = ["wellmedr-review", "trimi-glp-1", "shedrx"];
const json = async name => JSON.parse(await readFile(path.join(ROOT, "data", name), "utf8"));
const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();

async function* htmlFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(file);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield file;
  }
}

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
};

// Serve the real public tree through browser interception. No affiliate clicks,
// external requests, public-tree edits, or synthetic replacement stylesheets.
async function servePublic(request) {
  const url = new URL(request.request().url());
  if (url.origin !== ORIGIN || !["GET", "HEAD"].includes(request.request().method())) {
    await request.abort();
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  const file = path.resolve(PUBLIC, `.${pathname}${pathname.endsWith("/") ? "index.html" : ""}`);
  if (!file.startsWith(`${PUBLIC}${path.sep}`)) {
    await request.fulfill({ status: 403, body: "Forbidden" });
    return;
  }
  try {
    await request.fulfill({ status: 200, body: await readFile(file), contentType: MIME[path.extname(file)] || "application/octet-stream" });
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    await request.fulfill({ status: 404, body: "Not found" });
  }
}

test("P26: paid R11 payout order, typed cohort, organic isolation and last-smallest disclosure", async t => {
  const [economics, pricing, graph] = await Promise.all([
    json("funnel-v2-economics.json"), json("provider-pricing-matrix.json"), json("phase3-page-graph.json"),
  ]);
  assert.equal(economics.schema, "glp-funnel-v2-economics-v1");
  assert.ok(normalize(economics.public_disclosure), "P26_DISCLOSURE_SOURCE_MISSING");
  const economicRows = economics.paid_search_provider_order;
  assert.ok(Array.isArray(economicRows) && economicRows.length >= 3, "P26_ECONOMICS_MISSING");
  assert.equal(new Set(economicRows.map(row => row.program_id)).size, economicRows.length);
  for (const row of economicRows) {
    assert.ok(Number.isFinite(row.network_epc_usd) && row.network_epc_usd >= 0, `P26_REAL_EPC_REQUIRED:${row.program_id}`);
    for (const key of ["paid_search_allowed", "tracking_ready", "wired_live"]) assert.equal(row[key], true, `${row.program_id}:${key}`);
  }
  const ranked = economicRows.slice().sort((a, b) => b.network_epc_usd - a.network_epc_usd || a.program_id.localeCompare(b.program_id));
  const entries = Object.values(pricing.providers);
  assert.equal(new Set(entries.map(entry => entry.program_id)).size, entries.length, "P26_PRICING_ID_COLLISION");
  const pricingById = new Map(entries.map(entry => [entry.program_id, entry]));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.route("**/*", servePublic);
  const page = await context.newPage();

  for (const [route, medicationId] of PAID) {
    const matching = id => (pricingById.get(id)?.medications || []).filter(row => row.medication_id === medicationId);
    for (const id of REQUIRED_TYPED) {
      const rows = matching(id);
      assert.ok(rows.length && rows.every(row => Object.hasOwn(row, "price_kind") && !Number.isFinite(row.ongoing_usd)), `P26_TYPED_REGRESSION_INPUT:${route}:${id}`);
    }
    // The oracle joins raw records by program_id, not by the price-sorted grid
    // or object property names. Never fabricate evidence for empty medication arrays.
    const expected = ranked.filter(row => matching(row.program_id).some(price => Object.hasOwn(price, "price_kind") || Number.isFinite(price.ongoing_usd)));
    assert.ok(expected.length >= 3, `P26_EXPECTED_COHORT_MISSING:${route}`);

    for (const width of [1280, 390]) {
      await t.test(`${route} at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto(`${ORIGIN}${route}`, { waitUntil: "load" });
        assert.equal(response.status(), 200, `P26_PAGE_MISSING:${route}`);
        const funnel = page.locator("[data-funnel-v2]");
        assert.equal(await funnel.count(), 1, `P26_R11_MISSING:${route}`);
        await funnel.scrollIntoViewIfNeeded();
        const actual = await funnel.evaluate(section => {
          const shown = element => {
            if (!element.getClientRects().length) return false;
            for (let node = element; node; node = node.parentElement) {
              const css = getComputedStyle(node);
              if (css.display === "none" || ["hidden", "collapse"].includes(css.visibility) || Number(css.opacity) === 0) return false;
            }
            return true;
          };
          const disclosure = section.querySelector("[data-funnel-v2-disclosure]");
          const rows = [...section.querySelectorAll("[data-funnel-v2-provider]")];
          const otherSizes = [];
          const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim() || disclosure?.contains(node) || !shown(node.parentElement)) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) otherSizes.push(parseFloat(getComputedStyle(node.parentElement).fontSize));
          }
          return {
            visible: shown(section),
            rows: rows.map(row => ({
              id: row.dataset.program, epc: Number(row.dataset.economicEpc), rank: Number(row.dataset.economicRank),
              visible: shown(row), top: row.getBoundingClientRect().top,
              commerce: !!row.querySelector('[data-analytics-event="affiliate_click"]'),
              medications: row.querySelector(".p3-provider-card")?.getAttribute("data-medications"),
              cashPrice: row.querySelector(".p3-provider-card")?.getAttribute("data-price"),
              priceMap: row.querySelector(".p3-provider-card")?.getAttribute("data-price-map"),
            })),
            disclosureCount: section.querySelectorAll("[data-funnel-v2-disclosure]").length,
            last: !!disclosure && section.lastElementChild === disclosure,
            disclosureVisible: !!disclosure && shown(disclosure),
            disclosureText: disclosure?.textContent || "",
            disclosureSize: disclosure ? parseFloat(getComputedStyle(disclosure).fontSize) : 0,
            minimumOtherSize: otherSizes.length ? Math.min(...otherSizes) : 0,
          };
        });
        assert.ok(actual.visible && actual.rows.length >= 3 && actual.rows.every(row => row.visible), "P26_R11_NOT_VISIBLE");
        // Compare DOM order directly. Sorting the actual rows would mask the bug.
        assert.deepEqual(actual.rows.map(row => row.id), expected.map(row => row.program_id), "P26_R11_ORDER");
        assert.deepEqual(actual.rows.map(row => row.epc), expected.map(row => row.network_epc_usd), "P26_R11_EPC");
        assert.deepEqual(actual.rows.map(row => row.rank), expected.map(row => ranked.indexOf(row) + 1), "P26_R11_RANK");
        assert.ok(actual.rows.every((row, index) => index === 0 || actual.rows[index - 1].top <= row.top), "P26_R11_VISUAL_ORDER");
        assert.ok(actual.rows.every(row => row.commerce), "P26_R11_COMMERCE_MISSING");
        assert.ok(REQUIRED_TYPED.every(id => actual.rows.some(row => row.id === id
          && row.medications?.split(" ").includes(medicationId)
          && row.cashPrice === "" && row.priceMap === "")), "P26_R11_TYPED_COHORT_LOST");
        assert.equal(actual.disclosureCount, 1, "P26_R11_DISCLOSURE_COUNT");
        assert.equal(actual.last, true, "P26_R11_LAST");
        assert.equal(actual.disclosureVisible, true, "P26_R11_DISCLOSURE_HIDDEN");
        assert.equal(normalize(actual.disclosureText), normalize(economics.public_disclosure), "P26_R11_DISCLOSURE_COPY");
        assert.ok(actual.disclosureSize > 0 && actual.disclosureSize < actual.minimumOtherSize, "P26_R11_SMALLEST");
      });
    }
  }

  await t.test("all other output, including organic, contains no funnel", async () => {
    const checked = new Set();
    for await (const file of htmlFiles(PUBLIC)) {
      const relative = path.relative(PUBLIC, file).split(path.sep).join("/");
      if ([...PAID.keys()].some(route => relative === `${route.slice(1)}index.html`)) continue;
      const html = await readFile(file, "utf8");
      const count = await page.evaluate(source => new DOMParser().parseFromString(source, "text/html").querySelectorAll("[data-funnel-v2]").length, html);
      assert.equal(count, 0, `P26_ORGANIC_FUNNEL:${relative}`);
      checked.add(relative);
    }
    for (const route of ["/providers/", "/self-pay/", ...(graph.organic_compounded_pages || []).map(item => item.route)]) {
      assert.ok(checked.has(`${route.slice(1)}index.html`), `P26_ORGANIC_PAGE_MISSING:${route}`);
    }
  });
});
