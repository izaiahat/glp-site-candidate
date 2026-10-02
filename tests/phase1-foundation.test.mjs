import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, ROOT), "utf8");

const [build, runtime, motionLoader, motion, primitives, shell, home, servedHome, servedRuntime, servedMotionLoader, servedMotion, servedHomeCss] = await Promise.all([
  read("scripts/build-staging.mjs"),
  read("assets/site.js"),
  read("assets/motion-loader.js"),
  read("assets/motion.js"),
  read("assets/css-src/01-primitives.css"),
  read("assets/css-src/02-shell.css"),
  read("assets/css-src/10-home.css"),
  read("public/index.html"),
  read("public/assets/site.js"),
  read("public/assets/motion-loader.js"),
  read("public/assets/motion.js"),
  read("public/assets/site-home.css"),
]);

const sharedStart = build.indexOf("function addSharedRuntime(html)");
const sharedEnd = build.indexOf("function addMoneyHero", sharedStart);
const shared = build.slice(sharedStart, sharedEnd);
const navStart = build.indexOf("const NAV_GROUPS = [");
const navEnd = build.indexOf("// The Price Index", navStart);
const navContract = build.slice(navStart, navEnd);

test("W2/W18: header search keeps desktop expansion and promotes mobile to a modal sheet", () => {
  assert.match(shared, />Search providers<\/span>/);
  assert.match(shared, /placeholder=\"Search providers or pharmacies\"/);
  assert.match(shared, /const searchControl = `<div class=\"cs-search\">[\s\S]*class=\"cs-search-toggle\"[\s\S]*\$\{searchPanel\}<\/div>`/);
  assert.match(shared, /class=\"cs-search-back\"/);
  const searchMarkup = shared.slice(shared.indexOf("const searchPanel"), shared.indexOf("const searchControl"));
  assert.doesNotMatch(searchMarkup, /aria-modal=\"true\"/);
  assert.match(shell, /W18 mobile interaction shell[\s\S]*\.cs-search-panel \{[\s\S]*height: 100dvh/);
  assert.match(runtime, /document\.body\.classList\.add\('cs-search-open'\)/);
  assert.match(runtime, /window\.CS_MOTION\.stop\(\)/);
  assert.match(runtime, /if \(motionStopped\) window\.CS_MOTION\?\.start\(\)/);
  assert.match(servedHome, />Search providers<\/span>/);
  assert.match(servedHome, /placeholder=\"Search providers or pharmacies\"/);
  assert.match(servedHome, /class=\"cs-search-back\"/);
  assert.match(servedRuntime, /document\.body\.classList\.add\('cs-search-open'\)/);
  assert.match(servedHomeCss, /\.cs-search-panel/);
});

test("W2/W18: search has real measured states without fake loading motion and a fail-closed mobile modal boundary", () => {
  assert.match(runtime, /Searching Clinic Scout/);
  assert.doesNotMatch(runtime, /cs-search-swarm/);
  assert.match(runtime, /cs-search-type/);
  assert.match(runtime, /No match yet/);
  assert.match(runtime, /const desktop = window\.matchMedia\('\(min-width: 901px\)'\)/);
  assert.match(runtime, /panel\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(runtime, /if \(window\.CS_MOTION\)/);
  for (const hook of [/Searching Clinic Scout/, /cs-search-type/, /No match yet/]) assert.match(servedRuntime, hook);
  assert.doesNotMatch(servedRuntime, /cs-search-swarm/);
});

test("Pass 3 Lane A: desktop shell declares the parent renderer's primary IA without styling utility routes", () => {
  const contractStart = shell.indexOf("Pass 3 desktop shared-shell contract");
  const contractEnd = shell.indexOf("*/", contractStart);
  assert.ok(contractStart >= 0 && contractEnd > contractStart, "desktop shell contract comment missing");
  const contract = shell.slice(contractStart, contractEnd);
  // 2026-08-27 nav spec F8: the destination did not change; the more explicit
  // label is pinned in desktop and drawer chrome.
  for (const label of ["Insights", "Bulk", "Telehealth Providers", "Compounding Pharmacies", "Reviews", "Find your fit"]) {
    assert.ok(contract.includes(label), `primary IA contract missing: ${label}`);
  }
  assert.match(contract, /Quiz and Calculator remain utility destinations, not primary-nav styling\s+assumptions/);
  assert.doesNotMatch(shell, /href=["'][^"']*(?:quiz|calculator)/i);
});

test("Pass 3 Lane A: 1440px desktop shell uses near-full width and a larger search surface", () => {
  assert.match(shell, /\.gcs-nav-inner\s*\{[\s\S]*?width:\s*100%;\s*max-width:\s*1840px;[\s\S]*?padding:\s*0 clamp\(18px, 2vw, 36px\)/);
  assert.match(shell, /\.gcs-nav-inner\s*\{[\s\S]*?min-height:\s*72px/);
  assert.match(shell, /\.cs-search\s*\{[^}]*flex:\s*0 0 220px/);
  assert.match(shell, /\.cs-search-toggle\s*\{[^}]*inline-size:\s*220px[^}]*min-height:\s*46px/);
  assert.match(shell, /@media \(min-width: 1181px\) and \(max-width: 1320px\)/);
  assert.match(shell, /@media \(min-width: 901px\) and \(max-width: 1180px\)/);
});

test("Pass 3 Lane A: non-CTA nav color motion is hover-only while open/current states stay static", () => {
  assert.match(shell, /\.gcs-links > li > a:not\(\.cta\), \.cs-navgroup > button \{[\s\S]*?background-image:\s*none;[\s\S]*?transition:[^}]*transform/);
  assert.match(shell, /\.cs-navgroup > button\[aria-expanded="true"\]\s*\{[^}]*background-image:\s*none/);
  assert.match(shell, /\.gcs-links > li > a:not\(\.cta\):hover, \.cs-navgroup > button:hover\s*\{[^}]*background-image:\s*var\(--cs-accent-gradient\)/);
  assert.doesNotMatch(shell, /\.gcs-links > li > a:not\(\.cta\)[^{]*\{[^}]*animation\s*:/);
  assert.doesNotMatch(shell, /\.cs-navgroup > button\[aria-expanded="true"\][^{]*\{[^}]*var\(--cs-accent-gradient\)/);
  assert.match(runtime, /addEventListener\('pointerenter'/);
  assert.match(runtime, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(runtime, /cs-navmenu-open/);
  assert.match(shell, /backdrop-filter:\s*blur\(26px\) saturate\(1\.5\)/);
  assert.match(shell, /\.cs-navmenu a:nth-child\(even\)/);
  assert.match(shell, /\.cs-navmenu a:hover::after\s*\{\s*transform:\s*scaleX\(1\)/);
  assert.match(shell, /body\.cs-scrolled \.gcs-nav[\s\S]*rgba\(8, 20, 16, 0\.6\)/);
  assert.match(shell, /body\[data-cs-template="home"\]:not\(\.cs-scrolled\) \.gcs-nav[\s\S]*background-color:\s*transparent/);
  // 2026-08-27 PHASE-2 ADOPTION CONTRACT (reports/glp-clinic-scout/rebuild/
  // LIBRARY-MENU-20260827/FABLE-SELECTIONS.md, selection #2): Fable's selection
  // doc states verbatim "Matches nav spec F7 — coordinate with the census lane
  // which owns F7: THIS spec supersedes". The dropdown therefore pins to the
  // selection's timing — fade+rise+scale-98%, 170ms open / 120ms close
  // asymmetry — not F7's symmetric 150ms/scale-95. Census lane: please do not
  // re-revert; raise to Fable (final design authority) if F7 should win.
  assert.match(shell, /\.cs-navmenu[\s\S]*translateY\(-8px\) scale\(0\.98\)[\s\S]*opacity 120ms[\s\S]*transform 120ms/);
  assert.match(shell, /button\[aria-expanded="true"\] \+ \.cs-navmenu[\s\S]*opacity 170ms[\s\S]*transform 170ms/);
  assert.match(shell, /transition:\s*transform 200ms/);
  assert.match(shared, />Compounding Pharmacies<\/a>/);
});

test("Pass 3 Lane A: dropdown, search, and mobile drawer closure/focus contracts stay wired", () => {
  assert.match(runtime, /if \(event\.key === 'Escape' && open\) close\(\{ returnFocus: true \}\)/);
  assert.match(runtime, /if \(open && !event\.target\.closest\('\.cs-navgroup'\)\) close\(\)/);
  assert.match(runtime, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(runtime, /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); closePanel\(\{ returnFocus: true \}\)/);
  assert.match(runtime, /panel\.classList\.contains\('is-open'\) && root && !root\.contains\(event\.target\)/);
  assert.match(runtime, /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); close\(\{ returnFocus: true \}\)/);
  assert.match(runtime, /if \(!drawer\.contains\(event\.target\) && !toggle\.contains\(event\.target\)\) close\(\)/);
  assert.match(runtime, /window\.matchMedia\('\(min-width: 901px\)'\)\.addEventListener\('change'/);
});

test("W3: every temporary foundation destination resolves to a built route", async () => {
  const literalHrefs = [...navContract.matchAll(/\[\"(\/[^"]+)\",\s*\"/g)].map((match) => match[1]);
  const destinationBlock = build.slice(
    build.indexOf("const PASS5_MEDICATION_DESTINATIONS = Object.freeze({"),
    build.indexOf("});", build.indexOf("const PASS5_MEDICATION_DESTINATIONS = Object.freeze({")),
  );
  const destinations = new Map(
    [...destinationBlock.matchAll(/(\w+):\s*"(\/[^"]+)"/g)].map((match) => [match[1], match[2]]),
  );
  const mappedHrefs = [...navContract.matchAll(/PASS5_MEDICATION_DESTINATIONS\.(\w+)/g)]
    .map((match) => destinations.get(match[1]));
  assert.ok(mappedHrefs.every(Boolean), "every mapped navigation destination must resolve from the Pass 5 route map");
  const hrefs = [...literalHrefs, ...mappedHrefs];
  assert.ok(hrefs.length >= 11);
  for (const href of hrefs) {
    const pathname = new URL(href, "https://glpclinicscout.com").pathname;
    const routeFile = new URL(`public${pathname}index.html`, ROOT);
    await stat(routeFile).catch(() => assert.fail(`dead foundation route: ${href}`));
  }
});

test("W4: shared palette utility covers semantic palette buttons without decorative GSAP motion", () => {
  assert.match(primitives, /Shared palette-action utility \(W4\)/);
  for (const selector of [".cs-palette-action", ".cta.primary", ".cta.affiliate", ".cs-btn--primary", ".cs-btn--gradient", ".cs-btn--animated"]) {
    assert.ok(primitives.includes(selector), `palette alias absent: ${selector}`);
  }
  assert.doesNotMatch(motion, /backgroundPosition:\s*\"200% 50%\"/);
  assert.match(shared, /class=\"cta primary cs-palette-action\"/);
  assert.match(servedHomeCss, /\.cs-palette-action/);
  assert.doesNotMatch(servedMotion, /backgroundPosition:\s*\"200% 50%\"/);
  assert.match(servedHome, /class=\"cta primary cs-palette-action\"/);
});

test("W4: hero CTA keeps a static perimeter line and arrow without decorative loops", () => {
  assert.match(build, /cs-btn__orbit-track/);
  assert.match(build, /cs-btn__arrow/);
  assert.match(home, /stroke-dasharray:\s*20 80/);
  assert.doesNotMatch(motion, /strokeDashoffset:\s*-100/);
  assert.doesNotMatch(motion, /gatedLoop/);
  assert.match(servedHome, /cs-btn__orbit-track/);
  assert.match(servedHome, /cs-btn__arrow/);
  assert.match(servedHomeCss, /stroke-dasharray:\s*20 80/);
  assert.doesNotMatch(servedMotion, /strokeDashoffset:\s*-100/);
  assert.doesNotMatch(servedMotion, /gatedLoop/);
});

test("motion runtime admits non-reduced touch but Lenis owns only fine-pointer desktop scroll", () => {
  // Source-shape guard only; actual desktop/touch scroll and keyboard/no-JS effects:
  // browser/motion-mobile-contracts-regression.spec.mjs: "fine-pointer Lenis versus native touch scroll".
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #8): SplitText and
  // Flip were removed from the shared shell — loaded on ~249 pages, used by
  // nothing (12.7KB gz dead weight). The vendored files stay on disk for
  // future use; the shipped binding order no longer includes them.
  const ordered = [
    "/assets/vendor/gsap/gsap.min.js",
    "/assets/vendor/gsap/ScrollTrigger.min.js",
    "/assets/vendor/lenis/lenis.min.js",
    "/assets/motion.js",
  ];
  let cursor = -1;
  for (const path of ordered) {
    const next = motionLoader.indexOf(path);
    assert.ok(next > cursor, `${path} missing or out of order`);
    cursor = next;
  }
  assert.match(motionLoader, /prefers-reduced-motion: reduce/);
  assert.match(motionLoader, /if \(loaded \|\| preference\.matches\) return/);
  assert.doesNotMatch(motionLoader, /\(pointer: fine\) and \(min-width: 901px\)/);
  assert.match(motion, /smoothPointer = pointerPreference\.matches/);
  assert.match(motion, /if \(!reduced && !lenis && smoothPointer && window\.Lenis && gsap && ST\)/);
  assert.match(motion, /syncTouch: false/);
  assert.match(motion, /if \(!smoothPointer \|\| reduced\) stopScroll\(\)/);
  assert.match(motionLoader, /script\.async = false/);
  assert.equal(servedMotionLoader, motionLoader);
  assert.doesNotMatch(servedHome, /<script src="\/assets\/vendor\/(?:gsap|lenis)\//);
  assert.doesNotMatch(servedHome, /<script src="\/assets\/motion\.js/);
  const loaderIndex = servedHome.indexOf("/assets/motion-loader.js");
  const siteIndex = servedHome.indexOf("/assets/site.js");
  assert.ok(loaderIndex >= 0 && siteIndex > loaderIndex, "conditional motion loader must precede site.js");
});

test("W18 foundation: 390px header/search/drawer geometry matches measured mobile contract", () => {
  assert.match(shell, /@media \(max-width: 900px\)[\s\S]*\.gcs-nav \{ position: fixed; inset: 0 0 auto; min-height: 72px; \}/);
  assert.match(shell, /W18 mobile interaction shell[\s\S]*height: 100dvh/);
  assert.match(shell, /width: min\(280px, calc\(100vw - 48px\)\)/);
  assert.match(shell, /transition: transform 240ms cubic-bezier\(0\.32, 0\.72, 0, 1\)/);
  assert.match(shell, /background: rgba\(0, 0, 0, 0\.4\)/);
  assert.match(servedHomeCss, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.gcs-nav\s*\{position:\s*fixed;inset:\s*0 0 auto;min-height:\s*72px/);
  assert.match(servedHomeCss, /height:\s*100dvh/);
  assert.match(servedHomeCss, /width:\s*min\(280px,calc\(100vw - 48px\)\)/);
});
