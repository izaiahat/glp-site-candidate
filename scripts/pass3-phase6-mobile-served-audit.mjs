import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE_URL = (process.env.PASS3_BASE_URL || "http://127.0.0.1:4500").replace(/\/$/, "");
const REPORT = process.env.PASS3_PHASE6_REPORT || path.resolve(
  ROOT,
  "../../../../reports/glp-clinic-scout/rebuild/pass3/phase6-mobile-served-evidence.json",
);

const viewports = [
  { name: "primary", width: 390, height: 844 },
  { name: "compact", width: 375, height: 667 },
  { name: "large", width: 430, height: 932 },
];

const routes = [
  { family: "home", route: "/", shellInteractions: true },
  { family: "provider directory", route: "/providers/" },
  { family: "compounded semaglutide", route: "/lp/best-providers/compounded-semaglutide/" },
  { family: "compounded tirzepatide", route: "/lp/best-providers/compounded-tirzepatide/" },
  { family: "held provider detail", route: "/providers/awin-128761/", providerSticky: true },
  { family: "held provider detail long record", route: "/providers/measured/", providerSticky: true },
  { family: "live provider detail", route: "/providers/yourera-program/", providerSticky: true },
  { family: "brand product", route: "/wegovy/" },
  { family: "bulk duration", route: "/3-month/?drug=SEMAGLUTIDE" },
  { family: "self pay", route: "/self-pay/" },
  { family: "insights", route: "/insights/" },
  { family: "pharmacy directory", route: "/pharmacies/" },
  { family: "pharmacy detail", route: "/pharmacies/red-rock/" },
  { family: "review directory", route: "/reviews/" },
  { family: "review detail", route: "/reviews/yourera-program/" },
  { family: "review intake", route: "/reviews/submit/" },
  { family: "quiz", route: "/quiz/provider-fit/" },
  { family: "cost calculator", route: "/tools/glp-1-cost-calculator/" },
];

const majorSurfaceSelector = [
  "main",
  ".breadcrumbs",
  ".p3-product-hero",
  ".p3-category-hero",
  ".p3-bulk-hero",
  ".p3-index-hero",
  ".p3-insights-hero",
  ".p3-pharmacy-hero",
  ".p3-provider-grid",
  ".p3-pharmacy-grid",
  ".p3-filterbar",
  ".p3-pharmacy-filters",
  "[data-phase3-provider]",
  ".p3-pharmacy-card",
  ".p3-story",
  ".p3-feature-story",
  ".review-card",
  "[data-review-card]",
].join(",");

const interactiveSelector = [
  "button",
  ".cs-btn",
  ".cta",
  ".option",
  ".submit",
  "[role='button']",
  "select",
  "input[type='submit']",
  "input[type='button']",
  "a.inline-citation",
  ".inline-citation a",
  ".citation a",
  ".ready6-jump-nav a",
  ".cs-footer-grid a",
  ".cs-footer-legal a",
  ".p3-source-price > details summary",
  ".p3-price-source summary",
  ".p5-check",
].join(",");

const round = (value) => Math.round(value * 10) / 10;
const violations = [];
const results = [];

function recordViolation(context, code, details = {}) {
  violations.push({ ...context, code, ...details });
}

async function configureContext(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    colorScheme: "light",
    locale: "en-US",
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    localStorage.setItem("gcs_tracking_consent_v1", JSON.stringify({
      analytics: "denied",
      version: "gcs-cookie-v2-default-on-20260730",
      saved_at: "2026-08-26T00:00:00.000Z",
    }));
  });
  await context.route(/https:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com|clarity\.ms|i\.posthog\.com)\//i, (route) => route.fulfill({
    status: 204,
    contentType: "application/javascript",
    body: "",
  }));
  await context.route("**/api/geo-state", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({ schema: "glp-geo-state-v1", available: false, state: null }),
  }));
  return context;
}

async function inspectShellInteractions(page, contextKey, viewport) {
  const state = { search: null, drawer: null };
  const searchToggle = page.locator(".cs-search-toggle").first();
  if (await searchToggle.count() && await searchToggle.isVisible()) {
    await searchToggle.click();
    const panel = page.locator(".cs-search-panel").first();
    if (!await panel.isVisible()) {
      recordViolation(contextKey, "mobile_search_panel_not_visible");
    } else {
      state.search = await panel.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
          modal: node.getAttribute("aria-modal"),
          bodyOverflow: getComputedStyle(document.body).overflowY,
          activeInside: node.contains(document.activeElement),
        };
      });
      if (state.search.x < -1 || state.search.y < -1 || state.search.width > viewport.width + 1 || state.search.height > viewport.height + 1) {
        recordViolation(contextKey, "mobile_search_panel_out_of_viewport", { measured: state.search });
      }
      if (state.search.modal !== "true" || state.search.bodyOverflow !== "hidden" || !state.search.activeInside) {
        recordViolation(contextKey, "mobile_search_modal_boundary_mismatch", { measured: state.search });
      }
    }
    const close = page.getByRole("button", { name: "Close search and clear" });
    if (await close.count()) await close.click();
  } else {
    recordViolation(contextKey, "mobile_search_toggle_missing");
  }

  const menuToggle = page.locator("[data-menu-toggle]").first();
  const drawer = page.locator("[data-menu]").first();
  if (await menuToggle.count() && await drawer.count()) {
    await menuToggle.click();
    if (!await drawer.isVisible()) {
      recordViolation(contextKey, "mobile_drawer_not_visible");
    } else {
      state.drawer = await drawer.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          right: Math.round(box.right * 10) / 10,
          bottom: Math.round(box.bottom * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
          activeInside: node.contains(document.activeElement),
        };
      });
      if (state.drawer.x < -1 || state.drawer.y < -1 || state.drawer.right > viewport.width + 1 || state.drawer.bottom > viewport.height + 1) {
        recordViolation(contextKey, "mobile_drawer_out_of_viewport", { measured: state.drawer });
      }
      if (!state.drawer.activeInside) recordViolation(contextKey, "mobile_drawer_focus_not_trapped", { measured: state.drawer });
    }
    await page.keyboard.press("Escape");
    if (await drawer.isVisible()) recordViolation(contextKey, "mobile_drawer_escape_failed");
  } else {
    recordViolation(contextKey, "mobile_drawer_controls_missing");
  }
  return state;
}

async function inspectRoute(page, browserName, viewport, spec) {
  const contextKey = {
    browser: browserName,
    viewport: `${viewport.width}x${viewport.height}`,
    family: spec.family,
    route: spec.route,
  };
  const pageErrors = [];
  const failedRequests = [];
  const onPageError = (error) => pageErrors.push(String(error));
  const onRequestFailed = (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" });
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);

  const response = await page.goto(`${BASE_URL}${spec.route}`, { waitUntil: "networkidle", timeout: 120_000 });
  const status = response?.status() ?? null;
  if (status !== 200) recordViolation(contextKey, "route_not_200", { status });

  const measurements = await page.evaluate(({ majorSelector, controlSelector }) => {
    const isVisible = (node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && box.width > 0 && box.height > 0;
    };
    const describe = (node, box) => ({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      class: typeof node.className === "string" ? node.className.slice(0, 120) : null,
      text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
      x: Math.round(box.x * 10) / 10,
      y: Math.round(box.y * 10) / 10,
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
      right: Math.round(box.right * 10) / 10,
      bottom: Math.round(box.bottom * 10) / 10,
    });
    const outOfBounds = [...document.querySelectorAll(majorSelector)].flatMap((node) => {
      if (!isVisible(node)) return [];
      const box = node.getBoundingClientRect();
      if (box.left >= -1 && box.right <= innerWidth + 1) return [];
      return [describe(node, box)];
    });
    const undersized = [...document.querySelectorAll(controlSelector)].flatMap((node) => {
      if (!isVisible(node) || node.matches(":disabled,[aria-disabled='true']")) return [];
      const box = node.getBoundingClientRect();
      if (box.width >= 44 && box.height >= 44) return [];
      return [describe(node, box)];
    });
    const viewportFixed = [...document.querySelectorAll("body *")].flatMap((node) => {
      if (!isVisible(node)) return [];
      const style = getComputedStyle(node);
      if (style.position !== "fixed" && style.position !== "sticky") return [];
      const box = node.getBoundingClientRect();
      if (box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1) return [];
      return [{ ...describe(node, box), position: style.position }];
    });
    const tables = [...document.querySelectorAll("table")].map((table) => {
      const wrapper = table.closest(".table-wrap, [data-table-scroll]");
      const target = wrapper || table.parentElement;
      return {
        wrapped: Boolean(wrapper),
        clientWidth: Math.round((target?.clientWidth || 0) * 10) / 10,
        scrollWidth: Math.round((target?.scrollWidth || 0) * 10) / 10,
      };
    });
    return {
      documentOverflow: Math.round((document.documentElement.scrollWidth - document.documentElement.clientWidth) * 10) / 10,
      bodyOverflow: Math.round((document.body.scrollWidth - document.documentElement.clientWidth) * 10) / 10,
      documentHeight: document.documentElement.scrollHeight,
      outOfBounds,
      undersized,
      viewportFixed,
      tables,
    };
  }, { majorSelector: majorSurfaceSelector, controlSelector: interactiveSelector });

  if (measurements.documentOverflow > 1 || measurements.bodyOverflow > 1) {
    recordViolation(contextKey, "horizontal_document_overflow", {
      documentOverflow: measurements.documentOverflow,
      bodyOverflow: measurements.bodyOverflow,
    });
  }
  if (measurements.outOfBounds.length) recordViolation(contextKey, "major_surface_out_of_bounds", { items: measurements.outOfBounds.slice(0, 12) });
  if (measurements.undersized.length) recordViolation(contextKey, "undersized_touch_target", { items: measurements.undersized.slice(0, 12) });
  if (measurements.viewportFixed.length) recordViolation(contextKey, "fixed_or_sticky_surface_out_of_viewport", { items: measurements.viewportFixed.slice(0, 12) });
  if (measurements.tables.some((table) => !table.wrapped && table.scrollWidth > table.clientWidth + 1)) {
    recordViolation(contextKey, "wide_table_without_containment", { tables: measurements.tables });
  }

  let providerSticky = null;
  if (spec.providerSticky) {
    const sticky = page.locator("[data-provider-sticky]");
    if (await sticky.count() !== 1 || !await sticky.isVisible()) {
      recordViolation(contextKey, "provider_sticky_missing");
    } else {
      const measureSticky = () => sticky.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const main = node.closest("main") || document.querySelector("main");
        const footerBox = document.querySelector(".cs-prefooter, .gcs-footer")?.getBoundingClientRect();
        const primary = node.querySelector("[data-provider-sticky-primary]");
        const primaryBox = primary?.getBoundingClientRect();
        return {
          x: Math.round(box.x * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
          bottomGap: Math.round((innerHeight - box.bottom) * 10) / 10,
          position: getComputedStyle(node).position,
          mainPaddingBottom: Number.parseFloat(getComputedStyle(main).paddingBottom || "0"),
          primaryWidth: Math.round((primaryBox?.width || 0) * 10) / 10,
          primaryHeight: Math.round((primaryBox?.height || 0) * 10) / 10,
          unavailableVisible: Boolean(node.querySelector("[data-affiliate-unavailable]")?.getClientRects().length),
          released: node.classList.contains("is-released"),
          footerTop: Math.round((footerBox?.top ?? 0) * 10) / 10,
          stickyBottom: Math.round(box.bottom * 10) / 10,
        };
      });
      const initial = await measureSticky();
      if (initial.position !== "fixed" || initial.released || Math.abs(initial.x) > 1 || Math.abs(initial.width - viewport.width) > 1 || Math.abs(initial.bottomGap) > 1) {
        recordViolation(contextKey, "provider_sticky_geometry_mismatch", { measured: initial });
      }
      if (initial.height < 81 || initial.height > 96) {
        recordViolation(contextKey, "provider_sticky_height_out_of_contract", { measured: initial });
      }
      if (initial.primaryWidth < 44 || initial.primaryHeight < 44) {
        recordViolation(contextKey, "provider_sticky_primary_target_undersized", { measured: initial });
      }
      if (initial.mainPaddingBottom + 1 < initial.height) {
        recordViolation(contextKey, "provider_sticky_content_release_insufficient", { measured: initial });
      }

      await page.evaluate(() => {
        const footer = document.querySelector(".cs-prefooter, .gcs-footer");
        if (!footer) return;
        const target = window.scrollY + footer.getBoundingClientRect().top - window.innerHeight + 1;
        window.scrollTo(0, Math.max(0, target));
      });
      await page.waitForFunction(() => document.querySelector("[data-provider-sticky]")?.classList.contains("is-released"));
      const released = await measureSticky();
      if (!released.released || released.position !== "absolute" || Math.abs(released.stickyBottom - released.footerTop) > 2) {
        recordViolation(contextKey, "provider_sticky_footer_release_failed", { measured: released });
      }

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => !document.querySelector("[data-provider-sticky]")?.classList.contains("is-released"));
      const restored = await measureSticky();
      if (restored.released || restored.position !== "fixed" || Math.abs(restored.bottomGap) > 1) {
        recordViolation(contextKey, "provider_sticky_restore_failed", { measured: restored });
      }
      providerSticky = { initial, released, restored };
    }
  }

  const shell = spec.shellInteractions ? await inspectShellInteractions(page, contextKey, viewport) : null;
  if (pageErrors.length) recordViolation(contextKey, "runtime_page_error", { errors: pageErrors.slice(0, 5) });
  if (failedRequests.length) recordViolation(contextKey, "failed_network_request", { requests: failedRequests.slice(0, 5) });

  page.off("pageerror", onPageError);
  page.off("requestfailed", onRequestFailed);
  return {
    ...contextKey,
    status,
    measurements,
    providerSticky,
    shell,
    pageErrors,
    failedRequests,
  };
}

for (const [browserName, browserType] of Object.entries({ chromium, webkit })) {
  const browser = await browserType.launch();
  try {
    for (const viewport of viewports) {
      const context = await configureContext(browser, viewport);
      const page = await context.newPage();
      try {
        for (const spec of routes) results.push(await inspectRoute(page, browserName, viewport, spec));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

const receipt = {
  schema: "glp-pass3-phase6-mobile-served-v1",
  status: violations.length ? "FAIL" : "PASS",
  base_url: BASE_URL,
  generated_at: new Date().toISOString(),
  engines: ["chromium", "webkit"],
  viewports,
  route_count: routes.length,
  probe_count: results.length,
  checks: [
    "HTTP 200 and zero browser/network errors",
    "zero document/body horizontal overflow",
    "major cards and layout surfaces remain in viewport",
    "button/select/CTA targets are at least 44x44",
    "tables have deliberate containment",
    "fixed and sticky surfaces remain inside viewport",
    "provider action bars stay fixed and 81-96px tall through content, release exactly before the footer, and restore after the footer exits",
    "mobile search and navigation drawer remain bounded, modal, and focus-safe",
  ],
  violations,
  results,
  deploys: 0,
};

await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(REPORT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  schema: receipt.schema,
  status: receipt.status,
  report: REPORT,
  probe_count: receipt.probe_count,
  violations: receipt.violations,
  deploys: 0,
}, null, 2));
if (violations.length) process.exitCode = 1;
