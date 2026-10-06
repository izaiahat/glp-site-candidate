// GLP-327: unauthenticated desktop (1440x1000) and mobile (390x844) captures of
// the three sponsor surfaces, rendered by the site's own renderers and shared
// shell. Each surface/viewport writes an unscrolled viewport image and a
// full-page image, and records the fold geometry the layouts must satisfy:
// the required label, price/terms and CTA rects are fully inside the first
// viewport and not covered, every h1 is <=48px (desktop) / <=32px (mobile), and
// nothing overflows horizontally. No CSS is injected; the page is as rendered.
//
//   GLP327_SPONSOR_PLACEMENT_PREVIEW=1 npm run build
//   node scripts/glp327-capture.mjs                 # captures public/ (built output)
//   npm run assemble:css && node scripts/glp327-capture.mjs --scoped   # see below
//
// --scoped exists only for mirrors where the registered build cannot finish
// (absent host-only inputs). It renders the same three routes with the same
// renderer calls build-staging.mjs makes (renderConfiguredListing → pageDocument
// → upgradePhase3PageVisuals → addSharedRuntime; renderRateCard/renderPromo →
// addSharedRuntime) and serves the repo's assembled assets/. Copy tokens are
// finalized through the build's own count path: deriveLiveProviders() (the
// registry + projected-ledger merchant tally main() uses) feeding
// resolveDerivedCounts(), which substitutes {{LIVE_PROVIDER_COUNT}} and runs the
// assertTalliesDerived gate on providers/index.html. Other write-time finalizers
// are not applied. CAPTURE.json records the source and tally; never a deployment.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname, sep, join } from "node:path";
import { tmpdir } from "node:os";
import { checkControls } from "./glp327-check-controls.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import axe from "axe-core";
import { auditPage } from "./validate-public-email-aliases.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const scoped = args.includes("--scoped");
// /providers/ renders every organic record (about 74,000px tall on mobile).
// By default its page image is top-anchored and ends after the first row of
// independent results; --providers-full-page writes the unbounded page.
const providersFullPage = args.includes("--providers-full-page");
const out = resolve(args.find((a) => !a.startsWith("--")) || "reports/glp327/captures");
const sha = (b) => createHash("sha256").update(b).digest("hex");
// `fold`: elements that must be fully visible and unobscured in the unscrolled
// first viewport, at both sizes.
const SURFACES = [
  { key: "rate-card", route: "/sponsors/rates/", file: "sponsors/rates/index.html", panels: 1, fold: {
    label: "#sponsor-offer-title", price: "[data-sponsor-price] .cs-price", terms: "[data-sponsor-price-terms]",
    deliverables: "[data-sponsor-deliverables]", renewal: "[data-sponsor-renewal]", cta: "[data-sponsor-booking-cta]", disclosure: "[data-sponsor-independence]",
  } },
  { key: "providers-sponsored-panel", route: "/providers/", file: "providers/index.html", panels: 1, fold: {
    label: "[data-sponsor-placement-candidate] .p3-chip", identity: "#sponsored-placement-title", cta: "[data-sponsor-placement-candidate] .cs-btn",
  } },
  { key: "paid-promo", route: "/sponsors/example-provider/", file: "sponsors/example-provider/index.html", panels: 0, fold: {
    label: "[data-sponsor-lead-label] .p3-chip", identity: "#sponsor-provider-title", intro: "[data-sponsor-lead] .lede", cta: "[data-sponsor-lead] .cs-btn", disclosure: "[data-sponsor-ad-disclosure]",
  } },
];
const VIEWPORTS = [["desktop", 1440, 1000, 48], ["mobile", 390, 844, 32]];

async function scopedRender() {
  process.env.GLP327_SPONSOR_PLACEMENT_PREVIEW = "1";
  const json = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
  const graphModule = await import("../src/phase3-page-graph.mjs");
  const { upgradePhase3PageVisuals } = await import("../src/pass2-page-visual-upgrades.mjs");
  const { loadGoPromotionAuthority } = await import("../src/go-runtime-selection.mjs");
  const { renderRateCard, renderPromo, SPONSOR_ROBOTS } = await import("../src/paid-promo.mjs");
  const { addSharedRuntime, deriveLiveProviders, resolveDerivedCounts } = await import("./build-staging.mjs");
  const { projectProviderDisplayLedger } = await import("../src/provider-display-evidence.mjs");
  const graph = json("phase3-page-graph.json"), pharmacyInput = json("phase3-pharmacy-render-input.json");
  graphModule.validatePhase3Graph(graph, pharmacyInput);
  const programRegistry = json("program-registry.json");
  const registry = graphModule.phase3Registry(graph, programRegistry);
  const listing = graphModule.renderConfiguredListing("E", { route: "/providers/", slug: "providers", name: "Compare weight loss providers" }, {
    graph, pharmacyInput, pricingMatrix: json("provider-pricing-matrix.json"), registry, coupons: {},
    doseCapture: graphModule.loadPass2DoseCapture(), logoManifest: graphModule.loadProviderLogoManifest(), articles: [], goAuthority: loadGoPromotionAuthority(),
  });
  const robots = (html) => html.replace(/<meta name="robots" content="[^"]*">/, `<meta name="robots" content="${SPONSOR_ROBOTS}">`);
  // main() derives the tally from the same consumer ledger view it builds:
  // structuredClone(raw programs) projected through projectProviderDisplayLedger.
  const ledgerPrograms = structuredClone(json("program-content-ledger.json").programs).map((row) => projectProviderDisplayLedger(row));
  tallies.LIVE_PROVIDER_COUNT = deriveLiveProviders(programRegistry, ledgerPrograms).liveProgramCount;
  // write() runs resolveDerivedCounts on every page; do the same per route file.
  const finalize = (file, html) => resolveDerivedCounts(html, file, tallies);
  return {
    "/providers/": finalize("providers/index.html", addSharedRuntime(upgradePhase3PageVisuals(listing, { family: "providers-hub", route: "/providers/", graph, registry: programRegistry }))),
    "/sponsors/rates/": finalize("sponsors/rates/index.html", robots(addSharedRuntime(renderRateCard()))),
    "/sponsors/example-provider/": finalize("sponsors/example-provider/index.html", robots(addSharedRuntime(renderPromo()))),
  };
}
const tallies = {};

const publicRoot = join(root, "public");
let siteRoot = publicRoot, assetsRoot = publicRoot, tempRoot = null, source = "built-public";
if (scoped) {
  // The registered build assembles site-p3.css from assets/css-src first; do the same.
  if (!readFileSync(join(root, "assets", "site-p3.css"), "utf8").includes("[data-sponsor-layout]")) throw new Error("stale_site_css: run npm run assemble:css before --scoped captures");
  tempRoot = await mkdtemp(join(tmpdir(), "glp327-"));
  const pages = await scopedRender();
  for (const s of SURFACES) { await mkdir(join(tempRoot, s.file, ".."), { recursive: true }); await writeFile(join(tempRoot, s.file), pages[s.route]); }
  siteRoot = tempRoot; assetsRoot = root; source = "scoped-render";
} else {
  const missing = SURFACES.filter((s) => !existsSync(join(publicRoot, s.file)));
  if (missing.length) throw new Error(`built_output_missing:${missing.map((s) => s.file).join(",")} (run GLP327_SPONSOR_PLACEMENT_PREVIEW=1 npm run build, or use --scoped where host inputs are absent)`);
}

const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (path.endsWith("/")) path += "index.html";
    const base = path.startsWith("/assets/") ? assetsRoot : siteRoot;
    const file = resolve(base, "." + path);
    if (!file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
const base = await new Promise((ok, bad) => server.listen(0, "127.0.0.1", (e) => e ? bad(e) : ok(`http://127.0.0.1:${server.address().port}`)));
await mkdir(out, { recursive: true });
const checks = [];
const aliasMap = JSON.parse(readFileSync(join(root, "data", "email-alias-map.json"), "utf8"));
const gateFindings = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.GLP327_CHROMIUM ? { executablePath: process.env.GLP327_CHROMIUM } : {}) });
  for (const surface of SURFACES) {
    // The repo's own public email-alias gate, on the exact bytes captured.
    const audit = auditPage(aliasMap, surface.route, await readFile(join(siteRoot, surface.file), "utf8"));
    if (audit.violations.length) gateFindings.push({ gate: "validate:email-aliases", route: surface.route, violations: audit.violations.map(({ alias, code }) => ({ alias, code })) });
    for (const [name, width, height, maxH1] of VIEWPORTS) {
      // Unauthenticated, no service workers, no network beyond the local server.
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", reducedMotion: "reduce", ...(name === "mobile" ? { hasTouch: true } : {}) });
      const blocked = [], pageErrors = [];
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (request.url().startsWith(base + "/") && ["GET", "HEAD"].includes(request.method())) await route.continue();
        else { blocked.push(new URL(request.url()).origin); await route.abort("blockedbyclient"); }
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      const response = await page.goto(base + surface.route, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      const dom = await page.evaluate(({ fold }) => {
        const panel = [...document.querySelectorAll("[data-sponsor-placement-candidate]")];
        const results = document.querySelector("#provider-results");
        const rect = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
        const foldRects = Object.fromEntries(Object.entries(fold).map(([key, selector]) => {
          const e = document.querySelector(selector);
          if (!e) return [key, { selector, missing: true, visible: false }];
          const r = e.getBoundingClientRect();
          const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
          // Covered by a sticky header, consent layer or anything else?
          const probe = inside && [[0.5, 0.5], [0.1, 0.2], [0.9, 0.8]].every(([x, y]) => { const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y); return !!hit && (e === hit || e.contains(hit) || hit.contains(e)); });
          return [key, { selector, ...rect(e), visible: inside && probe }];
        }));
        const h1 = [...document.querySelectorAll("h1")].map((e) => ({ text: e.textContent.trim().slice(0, 60), fontSize: parseFloat(getComputedStyle(e).fontSize), ...rect(e) }));
        const filters = document.querySelector("[data-provider-filters]");
        const more = document.querySelector("[data-sponsor-preview-more-filters]");
        const shown = (e) => !!e && !e.closest("details:not([open])") && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0;
        const firstCard = results?.querySelector("article[data-phase3-provider]");
        return {
          documentHeight: document.documentElement.scrollHeight,
          pageImageBottom: firstCard ? Math.ceil(firstCard.getBoundingClientRect().bottom + scrollY + 32) : null,
          robots: document.querySelector('meta[name="robots"]')?.content || "",
          stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => new URL(l.href).pathname),
          siteCssLoaded: [...document.styleSheets].some((s) => /\/assets\/site-p3\.css$/.test(new URL(s.href || "http://x/").pathname) && s.cssRules.length > 100),
          header: !!document.querySelector("nav.gcs-nav .gcs-brand"), footer: !!document.querySelector("footer.gcs-footer"),
          readerPriceAlertCta: !!document.querySelector(".cs-prefooter [data-subscribe-open]"),
          prefooterAliases: [...document.querySelectorAll(".cs-prefooter a[href^='mailto:']")].map((a) => a.getAttribute("href")),
          panels: panel.length,
          sponsoredLabel: panel.every((p) => /^Sponsored$/.test(p.querySelector(".p3-chip")?.textContent.trim() || "")),
          panelOutsideResults: panel.every((p) => !results || !results.contains(p)),
          panelBeforeResults: !results || panel.every((p) => !!(p.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING)),
          panelAfterFilters: !results || panel.every((p) => !filters || !!(filters.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)),
          panelLocalStyles: panel.some((p) => p.querySelector("style,[style]")),
          organicOrder: results ? [...results.querySelectorAll("[data-phase3-provider-grid] > [data-phase3-provider], [data-phase3-provider-grid] > [data-provider-lazy-index]")].map((e) => e.dataset.program || `lazy:${e.dataset.providerLazyIndex}`) : [],
          directoryControls: filters ? { search: shown(filters.querySelector("[data-provider-search]")), sort: shown(filters.querySelector('[data-filter-group="sort"]')), state: shown(filters.querySelector("[data-state-native]")), extendedFiltersCollapsed: !!more && !more.open, nativeStateCount: filters.querySelectorAll('[data-state-native]').length, customStateCount: filters.querySelectorAll('[data-state-open]').length, panelTop: rect(panel[0]).top, filterHeight: filters.getBoundingClientRect().height } : null,
          viewport: { width: innerWidth, height: innerHeight, scrollY },
          fold: foldRects, h1,
          scrollWidth: document.documentElement.scrollWidth,
          fella: /fella/i.test(document.body.innerText),
          unresolvedTokens: document.documentElement.outerHTML.match(/\{\{[A-Z_]+\}\}/g) || [],
        };
      }, { fold: surface.fold });
      // Same Axe tags and serious/critical threshold as tests/browser/pass5-standalone-a11y.spec.mjs.
      // Sponsor pages are audited whole; on /providers/ the audit covers every
      // element this preview adds or recomposes, so pre-existing listing
      // findings are not attributed to it.
      await page.addScriptTag({ content: axe.source });
      const a11y = await page.evaluate(async (context) => (await window.axe.run(context, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } }))
        .violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => ({ rule: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) })),
        surface.route === "/providers/" ? { include: [["[data-sponsor-placement-candidate]"], ["[data-sponsor-preview-intro]"], ["[data-sponsor-preview-filters]"], ["[data-sponsor-preview-results-lead]"]] } : { include: [["body"]] });
      await page.evaluate(() => window.scrollTo(0, 0));
      const viewportPath = resolve(out, `${surface.key}-${name}-${width}x${height}-viewport.png`);
      const viewportPng = await page.screenshot({ path: viewportPath, fullPage: false, animations: "disabled" });
      // Page images of the sponsor pages are attachment references: expand the
      // secondary-terms accordions after the collapsed viewport image is taken.
      const expanded = surface.route.startsWith("/sponsors/")
        ? await page.evaluate(() => [...document.querySelectorAll("[data-sponsor-layout] details:not([open])")].map((d) => { d.open = true; return d.querySelector("summary")?.textContent.trim(); }))
        : [];
      const bounded = dom.pageImageBottom && !providersFullPage;
      const fullPath = resolve(out, bounded ? `${surface.key}-${name}-${width}-page-through-first-results.png` : `${surface.key}-${name}-${width}-full.png`);
      // captureBeyondViewport skips auto-contained offscreen cards. Paint the
      // supplementary directory image in a native expanded viewport, without
      // injecting CSS or changing source. First-screen pixels stay untouched.
      let fullPagePaintAudit;
      if (!bounded && surface.key === "providers-sponsored-panel") {
        const paintHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width, height: paintHeight });
        await page.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))));
        fullPagePaintAudit = await page.evaluate(() => {
          const nodes = [...document.querySelectorAll("main *")].filter(e =>
            getComputedStyle(e).contentVisibility === "auto" && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0);
          return { method: "native-expanded-viewport", width: innerWidth, height: innerHeight,
            documentHeight: document.documentElement.scrollHeight, autoNodeCount: nodes.length,
            autoNodeMaxBottom: Math.max(0, ...nodes.map(e => e.getBoundingClientRect().bottom)),
            skippedAutoNodes: nodes.filter(e => !e.checkVisibility({ contentVisibilityAuto: true })).map(e => e.id || e.className) };
        });
        if (fullPagePaintAudit.skippedAutoNodes.length || fullPagePaintAudit.height < fullPagePaintAudit.autoNodeMaxBottom)
          throw new Error(`Incomplete full-page native paint: ${JSON.stringify(fullPagePaintAudit)}`);
      }
      const fullPng = await page.screenshot({ path: fullPath, fullPage: true, animations: "disabled", ...(bounded ? { clip: { x: 0, y: 0, width, height: dom.pageImageBottom } } : {}) });
      if (fullPagePaintAudit) { await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0)); }
      const failures = [];
      if (gateFindings.some((finding) => finding.route === surface.route)) failures.push("validate:email-aliases");
      if (response?.status() !== 200 || !dom.siteCssLoaded || !dom.header || !dom.footer) failures.push("shared site shell/stylesheet");
      if (dom.panels !== surface.panels || !dom.sponsoredLabel || dom.panelLocalStyles) failures.push("sponsored panel contract");
      if (!dom.panelOutsideResults || !dom.panelBeforeResults || !dom.panelAfterFilters) failures.push("panel placement");
      if (surface.route.startsWith("/sponsors/") && !/noindex/.test(dom.robots)) failures.push("noindex");
      if (surface.route.startsWith("/sponsors/") && (dom.readerPriceAlertCta || dom.prefooterAliases.some((href) => href !== "mailto:partners@glpclinicscout.com"))) failures.push("sponsor page ends in a reader price-alert CTA");
      if (dom.directoryControls && (!dom.directoryControls.search || dom.directoryControls.sort || dom.directoryControls.state || !dom.directoryControls.extendedFiltersCollapsed || dom.directoryControls.nativeStateCount !== 1 || dom.directoryControls.customStateCount !== 0 || dom.directoryControls.filterHeight > 64)) failures.push("directory clutter regression");
      if (name === "mobile") {
        if (surface.key === "providers-sponsored-panel" && (dom.directoryControls.panelTop > 220 || dom.fold.cta.bottom > 500)) failures.push("directory first-screen hierarchy");
        if (surface.key === "rate-card" && (dom.fold.price.top > 180 || dom.fold.cta.bottom > 460)) failures.push("rate-card first-screen hierarchy");
        if (surface.key === "paid-promo" && dom.fold.cta.bottom > 340) failures.push("promo first-screen hierarchy");
      }
      if (pageErrors.length) failures.push("browser page error");
      for (const [key, r] of Object.entries(dom.fold)) if (!r.visible) failures.push(`fold: ${key} not fully visible`);
      if (!dom.h1.length || dom.h1.some((h) => h.fontSize > maxH1)) failures.push(`h1 larger than ${maxH1}px`);
      if (dom.scrollWidth > width + 1) failures.push("horizontal overflow");
      if (dom.fella) failures.push("excluded provider name");
      if (dom.unresolvedTokens.length) failures.push("unresolved build token");
      if (a11y.length) failures.push("axe serious/critical");
      if (blocked.length) failures.push("unexpected external request");
      const { interactions, expandedImages } = await checkControls({ page, browser, width, height, name, surface, origin: base, out, root, axe });
      if (interactions.status !== "PASS") failures.push(`controls: ${interactions.error}`);
      checks.push({ surface: surface.key, route: surface.route, viewport: name, width, height, status: failures.length ? "FAIL" : "PASS", failures, interactions, expandedImages, ...(fullPagePaintAudit ? { fullPagePaintAudit } : {}),
        viewportImage: viewportPath.replace(root + sep, ""), viewportImageSha256: sha(viewportPng), pageImage: fullPath.replace(root + sep, ""), pageImageSha256: sha(fullPng),
        pageImageScope: bounded ? `top-anchored, 0-${dom.pageImageBottom}px of ${dom.documentHeight}px (through the first independent results row)` : `full page${expanded.length ? `, secondary terms expanded (${expanded.join(", ")})` : ""}`,
        viewportImageScope: "unscrolled first viewport, accordions collapsed",
        dom, a11y, blockedOrigins: [...new Set(blocked)], pageErrors });
      await context.close();
    }
  }
} catch (e) { checks.push({ status: "EXECUTION_ERROR", error: String(e), stack: e.stack }); }
finally { if (browser) await browser.close(); await new Promise((ok) => server.close(ok)); if (tempRoot) await rm(tempRoot, { recursive: true, force: true }); }

const result = {
  status: checks.length === SURFACES.length * VIEWPORTS.length && checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL",
  source,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sourceHashes: Object.fromEntries(["src/sponsor-pricing.mjs", "data/sponsor-pricing.json", "src/paid-promo.mjs", "src/phase3-page-graph.mjs", "src/sponsor-placement-candidate.mjs", "assets/css-src/11-phase3.css", "assets/site.js", "scripts/build-staging.mjs", "scripts/glp327-capture.mjs", "scripts/glp327-check-controls.mjs", "assets/site-p3.css"].map(f => [f, sha(readFileSync(resolve(root, f)))])),
  scope: source === "scoped-render" ? "Site renderers + shared shell + assembled assets/ in a mirror where the registered build halts on absent host-only inputs; copy tokens finalized through deriveLiveProviders + resolveDerivedCounts (with the assertTalliesDerived gate), other write-time finalizers not applied. Not a release build." : "Registered build output in public/.",
  ...(source === "scoped-render" ? { finalizedTallies: { ...tallies, derivation: "deriveLiveProviders(data/program-registry.json, projected data/program-content-ledger.json) -> resolveDerivedCounts" } } : {}),
  // Repo release gates evaluated on these exact bytes; any finding fails its frames.
  gateFindings,
  checks,
};
await writeFile(resolve(out, "CAPTURE.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ status: result.status, source, gateFindings, checks: checks.map((c) => ({ surface: c.surface, viewport: c.viewport, status: c.status, failures: c.failures, viewportImage: c.viewportImage })) }));
if (result.status !== "PASS") process.exitCode = 1;
