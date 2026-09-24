// Current route-graph gate for the mobile provider-detail action bar.
//
// W11 retired the old evidence-wall comparison routes that the v1 "follow"
// probe targeted. W18's measured mobile contract now belongs to each canonical
// /providers/{program}/ detail page: one touch-safe action bar, bound to the
// exact provider identity. It stays fixed without scroll-direction motion until
// the pre-footer/footer boundary enters the viewport, then releases to the end
// of main so it cannot obscure newsletter, legal, or footer links. This validator checks every served provider
// detail statically, then proves representative mobile geometry/identity through
// a real browser. An empty provider graph or source-only implementation fails.
import { createServer } from "node:http";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { phase3Registry } from "../src/phase3-page-graph.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, "public");
const PROVIDERS = path.join(PUBLIC, "providers");
const REPORT = path.join(ROOT, "artifacts", "ops", "sticky-cta-follow.json");
const registry = JSON.parse(await readFile(path.join(ROOT, "data", "program-registry.json"), "utf8"));
const phase3Graph = JSON.parse(await readFile(path.join(ROOT, "data", "phase3-page-graph.json"), "utf8"));
const expectedPrograms = phase3Registry(phase3Graph, registry).programs.map((row) => row.program_id).sort();
const violations = [];

function fail(extra = []) {
  console.log(JSON.stringify({
    schema: "glp-provider-detail-sticky-cta-v3",
    status: "FAIL",
    violations: [...violations, ...extra],
  }, null, 2));
  process.exit(1);
}

const entries = await readdir(PROVIDERS, { withFileTypes: true });
const servedPrograms = [];
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const program = entry.name;
  const file = path.join(PROVIDERS, program, "index.html");
  let html;
  try {
    html = await readFile(file, "utf8");
  } catch {
    continue;
  }
  servedPrograms.push(program);
  const bars = html.match(/data-provider-sticky(?:\s|>)/g) || [];
  if (bars.length !== 1) violations.push({ program, code: "provider_sticky_count", expected: 1, actual: bars.length });
  if (!html.includes(`data-provider-sticky data-program="${program}"`)) {
    violations.push({ program, code: "provider_sticky_identity_mismatch" });
  }
  const expectedHref = `/quiz/provider-fit/?source=provider-sticky&amp;provider=${program}`;
  if (!html.includes(`href="${expectedHref}" data-provider-sticky-primary`)) {
    violations.push({ program, code: "provider_sticky_primary_target_mismatch", expected: expectedHref });
  }
}
servedPrograms.sort();
if (!expectedPrograms.length) violations.push({ code: "empty_program_registry" });
if (JSON.stringify(servedPrograms) !== JSON.stringify(expectedPrograms)) {
  violations.push({
    code: "served_provider_graph_mismatch",
    expected_count: expectedPrograms.length,
    actual_count: servedPrograms.length,
    missing: expectedPrograms.filter((id) => !servedPrograms.includes(id)),
    extra: servedPrograms.filter((id) => !expectedPrograms.includes(id)),
  });
}

const servedCss = await readFile(path.join(PUBLIC, "assets", "site.css"), "utf8");
for (const token of [".p3-provider-sticky", "position: fixed", ".p3-provider-sticky.is-released", "position: absolute", "min-height: 81px", "z-index: 40"]) {
  if (!servedCss.includes(token)) violations.push({ code: "served_sticky_css_missing", token });
}
if (violations.length) fail();

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png",
  ".jpg": "image/jpeg", ".xml": "application/xml", ".txt": "text/plain", ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const probes = [...new Set([
  servedPrograms[0],
  servedPrograms[Math.floor(servedPrograms.length / 2)],
  servedPrograms.at(-1),
])].filter(Boolean);
const results = [];
try {
  for (const program of probes) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    const response = await page.goto(`${base}/providers/${program}/`, { waitUntil: "load", timeout: 120000 });
    if (response?.status() !== 200) {
      violations.push({ program, code: "provider_route_not_200", status: response?.status() ?? null });
      await context.close();
      continue;
    }
    const sticky = page.locator("[data-provider-sticky]");
    if (await sticky.count() !== 1 || !await sticky.isVisible()) {
      violations.push({ program, code: "mobile_sticky_not_visible" });
      await context.close();
      continue;
    }
    const identity = await sticky.getAttribute("data-program");
    const primary = sticky.locator("[data-provider-sticky-primary]");
    const href = await primary.getAttribute("href");
    if (identity !== program) violations.push({ program, code: "browser_sticky_identity_mismatch", actual: identity });
    if (href !== `/quiz/provider-fit/?source=provider-sticky&provider=${program}`) {
      violations.push({ program, code: "browser_sticky_target_mismatch", actual: href });
    }

    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const mainPaddingBottom = await page.locator("main.p3-page").evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingBottom || "0"));
    const maxScroll = Math.max(0, documentHeight - 844);
    const measure = async (label) => {
      await page.waitForTimeout(50);
      return sticky.evaluate((node, stateLabel) => {
        const box = node.getBoundingClientRect();
        const footerBox = document.querySelector('.cs-prefooter, .gcs-footer')?.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          label: stateLabel,
          scroll_y: Math.round(window.scrollY),
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
          sticky_bottom: Math.round(box.bottom * 10) / 10,
          footer_top: footerBox ? Math.round(footerBox.top * 10) / 10 : null,
          footer_overlap: footerBox ? Math.max(0, Math.round((box.bottom - footerBox.top) * 10) / 10) : null,
          bottom_gap: Math.round((innerHeight - box.bottom) * 10) / 10,
          position: style.position,
          display: style.display,
          transform: style.transform,
          released: node.classList.contains('is-released'),
          direction: node.dataset.scrollDirection || null,
          at_top: node.dataset.atTop || null,
          near_end: node.dataset.nearEnd || null,
        };
      }, label);
    };
    const waitForReleaseSync = async (expectedReleased) => {
      try {
        await page.waitForFunction((expected) => {
          const node = document.querySelector('[data-provider-sticky]');
          const footerNode = document.querySelector('.cs-prefooter, .gcs-footer');
          if (!node || !footerNode) return false;
          if (!expected) return !node.classList.contains('is-released');
          return footerNode.getBoundingClientRect().top > window.innerHeight || node.classList.contains('is-released');
        }, expectedReleased, { polling: 'raf', timeout: 2000 });
      } catch {
        // Geometry below remains authoritative and will fail with evidence if
        // the runtime never reaches the expected state.
      }
    };
    const scrollAndMeasure = async (top, label, expectedReleased = null) => {
      await page.evaluate((nextTop) => window.scrollTo({ top: nextTop, behavior: 'instant' }), top);
      if (expectedReleased !== null) await waitForReleaseSync(expectedReleased);
      return measure(label);
    };
    const downY = Math.min(Math.max(640, Math.floor(maxScroll * 0.45)), Math.max(640, maxScroll - 500));
    const fixedGeometry = [];
    fixedGeometry.push(await scrollAndMeasure(0, 'fixed-top'));
    fixedGeometry.push(await scrollAndMeasure(downY, 'fixed-down-scroll'));
    fixedGeometry.push(await scrollAndMeasure(Math.max(120, downY - 320), 'fixed-up-scroll'));
    for (const measured of fixedGeometry) {
      if (measured.position !== 'fixed' || measured.x < -1 || measured.width < 389 || measured.height < 81 || measured.height > 96 || Math.abs(measured.bottom_gap) > 1) {
        violations.push({ program, code: 'mobile_sticky_base_geometry_mismatch', measured });
      }
      if (measured.released) violations.push({ program, code: 'mobile_sticky_released_too_early', measured });
      if (measured.transform !== 'none' || measured.direction !== null || measured.at_top !== null || measured.near_end !== null) {
        violations.push({ program, code: 'mobile_sticky_must_not_track_scroll_state', measured });
      }
    }
    /* Provider pages lazy-load editorial and product imagery below the fold.
       Scrolling can therefore increase scrollHeight after the initial geometry
       sample. Converge on the live document end instead of testing a stale
       pre-lazy-load maxScroll coordinate. */
    let releasedEnd;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const liveMaxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
      releasedEnd = await scrollAndMeasure(liveMaxScroll, 'released-before-footer', true);
      const settledMaxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
      if (Math.abs(settledMaxScroll - liveMaxScroll) <= 1) break;
    }
    if (releasedEnd.position !== 'absolute' || !releasedEnd.released || releasedEnd.height < 81 || releasedEnd.height > 96
      || releasedEnd.x < -1 || releasedEnd.width < 389 || releasedEnd.footer_top === null
      || Math.abs(releasedEnd.sticky_bottom - releasedEnd.footer_top) > 1 || releasedEnd.footer_overlap > 1) {
      violations.push({ program, code: 'mobile_sticky_footer_release_mismatch', measured: releasedEnd });
    }
    if (releasedEnd.transform !== 'none' || releasedEnd.direction !== null || releasedEnd.at_top !== null || releasedEnd.near_end !== null) {
      violations.push({ program, code: 'mobile_sticky_release_must_not_track_scroll_state', measured: releasedEnd });
    }
    const restoredFixed = await scrollAndMeasure(Math.max(120, downY - 320), 'fixed-after-footer-exit', false);
    if (restoredFixed.position !== 'fixed' || restoredFixed.released || Math.abs(restoredFixed.bottom_gap) > 1) {
      violations.push({ program, code: 'mobile_sticky_did_not_restore_fixed_position', measured: restoredFixed });
    }
    const geometry = [...fixedGeometry, releasedEnd, restoredFixed];
    if (pageErrors.length) violations.push({ program, code: "provider_page_runtime_error", errors: pageErrors.slice(0, 3) });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(40);
    if (await sticky.isVisible()) violations.push({ program, code: "desktop_sticky_must_be_hidden" });
    if (mainPaddingBottom + 1 < geometry[0].height) {
      violations.push({ program, code: "mobile_sticky_content_release_insufficient", main_padding_bottom: mainPaddingBottom, sticky_height: geometry[0].height });
    }
    results.push({ program, document_height: documentHeight, main_padding_bottom: mainPaddingBottom, geometry, runtime_errors: pageErrors });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (violations.length) fail();
const receipt = {
  schema: "glp-provider-detail-sticky-cta-v3",
  status: "PASS",
  contract: "canonical provider detail mobile action bar fixed through content and released before footer",
  served_provider_routes: servedPrograms.length,
  statically_verified_programs: servedPrograms,
  browser_probed_programs: probes,
  viewport: "390x844 mobile plus 1440x900 hidden check",
  results,
  deploys: 0,
};
await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(REPORT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
