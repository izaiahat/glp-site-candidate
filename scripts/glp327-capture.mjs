// GLP-327: unauthenticated desktop (1440px) and mobile (390px) captures of the
// three sponsor surfaces, rendered by the site's own renderers and shared shell.
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
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import axe from "axe-core";

const root = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const scoped = args.includes("--scoped");
const out = resolve(args.find((a) => !a.startsWith("--")) || "reports/glp327/captures");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const SURFACES = [
  { key: "rate-card", route: "/sponsors/rates/", file: "sponsors/rates/index.html", panels: 0 },
  { key: "providers-sponsored-panel", route: "/providers/", file: "providers/index.html", panels: 1 },
  { key: "paid-promo", route: "/sponsors/example-provider/", file: "sponsors/example-provider/index.html", panels: 1 },
];
const VIEWPORTS = [["desktop", 1440, 1000], ["mobile", 390, 844]];

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
  if (!readFileSync(join(root, "assets", "site-p3.css"), "utf8").includes("[data-sponsored-placement]")) throw new Error("stale_site_css: run npm run assemble:css before --scoped captures");
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
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.GLP327_CHROMIUM ? { executablePath: process.env.GLP327_CHROMIUM } : {}) });
  for (const surface of SURFACES) for (const [name, width, height] of VIEWPORTS) {
    // Unauthenticated, no service workers, no network beyond the local server.
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", reducedMotion: "reduce" });
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
    const dom = await page.evaluate(() => {
      const panel = [...document.querySelectorAll("[data-sponsor-placement-candidate]")];
      const results = document.querySelector("#provider-results");
      const firstCard = results?.querySelector("article[data-phase3-provider]");
      return {
        robots: document.querySelector('meta[name="robots"]')?.content || "",
        stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => new URL(l.href).pathname),
        siteCssLoaded: [...document.styleSheets].some((s) => /\/assets\/site-p3\.css$/.test(new URL(s.href || "http://x/").pathname) && s.cssRules.length > 100),
        header: !!document.querySelector("nav.gcs-nav .gcs-brand"), footer: !!document.querySelector("footer.gcs-footer"),
        panels: panel.length,
        sponsoredLabel: panel.every((p) => /^Sponsored$/.test(p.querySelector(".p3-chip")?.textContent.trim() || "")),
        panelOutsideResults: panel.every((p) => !results || !results.contains(p)),
        panelBeforeResults: !results || panel.every((p) => !!(p.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING)),
        panelAfterFilters: !results || panel.every((p) => { const f = document.querySelector(".p3-filterbar"); return !f || !!(f.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING); }),
        panelLocalStyles: panel.some((p) => p.querySelector("style,[style]")),
        clipBottom: firstCard ? Math.ceil(firstCard.getBoundingClientRect().bottom + scrollY + 32) : null,
        scrollWidth: document.documentElement.scrollWidth,
        fella: /fella/i.test(document.body.innerText),
        unresolvedTokens: document.documentElement.outerHTML.match(/\{\{[A-Z_]+\}\}/g) || [],
      };
    });
    // Same Axe tags and serious/critical threshold as tests/browser/pass5-standalone-a11y.spec.mjs.
    // Sponsor pages are audited whole; on /providers/ the audit is scoped to the
    // new panel so pre-existing listing findings are not attributed to it.
    await page.addScriptTag({ content: axe.source });
    const a11y = await page.evaluate(async (context) => (await window.axe.run(context, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] } }))
      .violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => ({ rule: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) })),
      surface.route === "/providers/" ? { include: [["[data-sponsor-placement-candidate]"]] } : { include: [["body"]] });
    const path = resolve(out, `${surface.key}-${name}-${width}.png`);
    // /providers/ lists every organic card; capture through the first result card
    // so the panel's position between filters and independent results is visible.
    const png = dom.clipBottom
      ? await page.screenshot({ path, fullPage: true, animations: "disabled", clip: { x: 0, y: 0, width, height: dom.clipBottom } })
      : await page.screenshot({ path, fullPage: true, animations: "disabled" });
    const failures = [];
    if (response?.status() !== 200 || !dom.siteCssLoaded || !dom.header || !dom.footer) failures.push("shared site shell/stylesheet");
    if (dom.panels !== surface.panels || !dom.sponsoredLabel || dom.panelLocalStyles) failures.push("sponsored panel contract");
    if (!dom.panelOutsideResults || !dom.panelBeforeResults || !dom.panelAfterFilters) failures.push("panel placement");
    if (surface.route.startsWith("/sponsors/") && !/noindex/.test(dom.robots)) failures.push("noindex");
    if (dom.scrollWidth > width + 1) failures.push("horizontal overflow");
    if (dom.fella) failures.push("excluded provider name");
    if (dom.unresolvedTokens.length) failures.push("unresolved build token");
    if (a11y.length) failures.push("axe serious/critical");
    if (blocked.length) failures.push("unexpected external request");
    checks.push({ surface: surface.key, route: surface.route, viewport: name, width, status: failures.length ? "FAIL" : "PASS", failures, image: path.replace(root + sep, ""), imageSha256: sha(png), dom: { ...dom, clipBottom: undefined }, a11y, blockedOrigins: [...new Set(blocked)], pageErrors });
    await context.close();
  }
} catch (e) { checks.push({ status: "EXECUTION_ERROR", error: String(e) }); }
finally { if (browser) await browser.close(); await new Promise((ok) => server.close(ok)); if (tempRoot) await rm(tempRoot, { recursive: true, force: true }); }

const result = {
  status: checks.length === SURFACES.length * VIEWPORTS.length && checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL",
  source,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  scope: source === "scoped-render" ? "Site renderers + shared shell + assembled assets/ in a mirror where the registered build halts on absent host-only inputs; copy tokens finalized through deriveLiveProviders + resolveDerivedCounts (with the assertTalliesDerived gate), other write-time finalizers not applied. Not a release build." : "Registered build output in public/.",
  ...(source === "scoped-render" ? { finalizedTallies: { ...tallies, derivation: "deriveLiveProviders(data/program-registry.json, projected data/program-content-ledger.json) -> resolveDerivedCounts" } } : {}),
  checks,
};
await writeFile(resolve(out, "CAPTURE.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ status: result.status, source, checks: checks.map((c) => ({ surface: c.surface, viewport: c.viewport, status: c.status, failures: c.failures, image: c.image })) }));
if (result.status !== "PASS") process.exitCode = 1;
