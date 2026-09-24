import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");
const [build, runtime, motion, css, reviewSource, servedHome, servedRuntime, servedMotion, servedCss] = await Promise.all([
  read("scripts/build-staging.mjs"),
  read("assets/site.js"),
  read("assets/motion.js"),
  read("assets/css-src/10-home.css"),
  read("src/review-capture.mjs"),
  read("public/index.html"),
  read("public/assets/site.js"),
  read("public/assets/motion.js"),
  read("public/assets/site-home.css"),
]);
const home = build.slice(build.indexOf("function renderHomePage("), build.indexOf("function renderHomePageLegacy("));
const rail = build.slice(build.indexOf("  const railSpec = [", build.indexOf("const homeSpec")), build.indexOf("  const railMeds = railSpec.map", build.indexOf("const homeSpec")));

test("D18-D25 hero is simple, animated, image-led, and free of the retired proof stack", () => {
  assert.match(home, /cs-home2-flow/);
  assert.match(home, /Find a GLP-1 plan that fits\./);
  assert.match(home, /data-home-value/);
  for (const image of ["home-hero-fruit", "home-hero-fridge", "home-hero-hand"]) assert.ok(home.includes(image));
  assert.match(home, /Wegovy pill/);
  assert.equal((home.match(/class=\"cs-home-quick\"/g) || []).length, 1, "quick-link markup should be emitted from one seven-row data map");
  // Design pass 2026-08-26 (fix #7): all seven medication chips incl. Wegovy.
  assert.match(home, /\["Wegovy", PASS5_MEDICATION_DESTINATIONS\.wegovy\]/);
  assert.doesNotMatch(home, /Updated \$\{updatedLabel\}|Lowest verified price|capture hashed|heroProof/);
  assert.match(home, /cs-btn__orbit-track/);
  for (const hook of [/cs-home2-flow/, /Find a GLP-1 plan that fits\./, /data-home-value/, /Wegovy pill/, /cs-btn__orbit-track/]) assert.match(servedHome, hook);
  assert.match(servedCss, /\.cs-home2-flow/);
  assert.match(servedCss, /\.cs-home-quick/);
});

test("D26-D29 use honest linked review names, dynamic counts, and seven medication slides", () => {
  assert.match(home, /Popular program reviews/);
  assert.match(home, /href=\"\$\{card\.href\}\"/);
  assert.match(home, /\$\{programCount\}<\/strong><span>programs tracked/);
  assert.match(home, /Nobody can buy a rank or a score/);
  assert.equal((rail.match(/ key: /g) || []).length, 7);
  for (const name of ["Compounded semaglutide", "Compounded tirzepatide", "Wegovy pill", "Ozempic", "Wegovy", "Mounjaro", "Zepbound"]) assert.ok(rail.includes(`name: \"${name}\"`));
  assert.match(runtime, /window\.setInterval\(\(\) => move\(1\), 3000\)/);
  assert.match(runtime, /index = \(index \+ delta \+ cards\.length\) % cards\.length/);
  assert.match(servedHome, /Popular program reviews/);
  assert.match(servedHome, /data-counter-to=\"\d+\"/);
  assert.match(servedHome, /Nobody can buy a rank or a score/);
  assert.match(servedRuntime, /window\.setInterval\(\(\) => move\(1\), 3000\)/);
  for (const selector of [/\.cs-home2-marquee/, /\.cs-home-med/, /\.cs-home2-med-track/, /\.cs-home2-dots/]) assert.match(servedCss, selector);
});

test("D31-D34 land lifestyle imagery, rolling price controls, simple trust cards, and six risk crossfades", () => {
  assert.match(home, /home-lifestyle-phone/);
  assert.match(home, /data-price-choice/);
  assert.match(home, /data-price-href/);
  assert.match(home, /data-price-destination/);
  assert.match(home, /data-price-roll/);
  assert.match(home, /Trusted providers/);
  assert.match(home, /Transparent sourcing/);
  assert.match(home, /Real patient reviews/);
  assert.equal((home.match(/class=\"cs-riskcard\"/g) || []).length, 1, "risk cards should be generated from one six-row array");
  assert.equal((home.match(/\[\"[^\"]+\", \"[^\"]+\", \"[^\"]+\"\]/g) || []).filter((row) => /pharmacy|Research-use|clinician|total cost|cancellation|Counterfeit/.test(row)).length, 6);
  assert.match(runtime, /data-price-card/);
  assert.match(runtime, /destination\.href = choice\.dataset\.priceHref/);
  assert.match(runtime, /data-risk-card/);
  assert.match(css, /\.cs-riskcard__back\{background:linear-gradient/);
  for (const hook of [/home-lifestyle-phone/, /data-price-choice/, /data-price-roll/, /Trusted providers/, /Transparent sourcing/, /Real patient reviews/, /data-risk-card/]) assert.match(servedHome, hook);
  assert.match(servedRuntime, /data-price-card/);
  assert.match(servedRuntime, /data-risk-card/);
  for (const selector of [/\.cs-home2-lifestyle/, /\.cs-home2-price/, /\.cs-home2-carecard/, /\.cs-riskcard__back\{background:linear-gradient/]) assert.match(servedCss, selector);
});

test("Motion v2 implements the data-motion vocabulary and H17 split entrance (operator 2026-08-26)", () => {
  assert.match(motion, /function initH17\(\)/);
  assert.match(motion, /function initVocabulary\(\)/);
  assert.match(motion, /defaults: \{ duration: 0\.7, ease: "power3\.out" \}/);
  assert.match(motion, /start: "top 80%"/);
  assert.match(motion, /once: true/);
  assert.match(motion, /var CLEAR = "opacity,transform"/);
  assert.doesNotMatch(motion, /toggleActions|repeat:\s*-1|data-motion-loop/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /animation:none!important/);
  assert.match(servedCss, /@media\(prefers-reduced-motion:reduce\)/);
});

test("Pass 3 retires decorative palette, orbit, arrow, and replay loops", () => {
  for (const retired of [
    "cs-palette-action",
    "cs-btn__orbit-track",
    "cs-btn__arrow",
    "data-motion-loop",
    "repeat: -1",
  ]) assert.ok(!motion.includes(retired), `decorative motion still includes ${retired}`);
});

test("Pass 3 desktop rail, pricing, care, logo-band, and wide-grid visual contracts are explicit", () => {
  // Design pass 2026-08-26 (fix #1): wide overlay cards with a real next-card
  // peek at the 1440px desktop acceptance viewport.
  assert.match(css, /\.cs-home-med\s*\{\s*flex:\s*0 0 clamp\(320px, 25vw, 384px\)/s);
  assert.match(css, /\.cs-home2-price\s*\{[\s\S]*?background:[\s\S]*?#07100d;[\s\S]*?color:\s*#f5fbf8/s);
  assert.match(css, /\.cs-home2-price > :is\(\.gcs-kicker, \.cs-home2-price__route\)/);
  assert.match(css, /\.cs-home2-info:focus-visible \+ \.cs-home2-info__tip/);
  assert.match(css, /\.cs-home2-info\[aria-expanded=\"true\"\] \+ \.cs-home2-info__tip/);
  assert.match(css, /> \.cs-home2-care\s*\{[\s\S]*?border-radius:\s*clamp\(30px, 4vw, 56px\)[\s\S]*?radial-gradient/s);
  assert.match(css, /\.cs-home2-pick > :first-child\s*\{[\s\S]*?min-height:\s*112px[\s\S]*?linear-gradient/s);
  assert.match(css, /> :is\([\s\S]*?\.cs-home2-editorial,[\s\S]*?\.cs-home2-news-section[\s\S]*?width: min\(1560px,/);
  assert.match(css, /\.cs-home2-article \.gcs-kicker \{ color: #07523b; \}/);
});

test("Pass 4 keeps content visible while restoring the two intentional home rails", () => {
  assert.doesNotMatch(css, /contain-intrinsic-size|content-visibility:\s*auto/);
  assert.match(css, /\.cs-home2-marquee__track \{ animation: cs-home2-popular-loop 30s linear infinite; \}/);
  assert.match(css, /\.cs-home2-verdict-track \{ animation: cs-home2-verdict-loop 56s linear infinite; \}/);
  assert.match(css, /@keyframes cs-home2-popular-loop/);
  assert.match(css, /@keyframes cs-home2-verdict-loop/);
  // Hover/focus pause is allowed only for the approved-reader wall and the two
  // directly-interactive duplicated-content rails. Nothing viewport-gates them.
  const playStateRules = css.match(/[^{}]+\{[^{}]*animation-play-state[^{}]*\}/g) || [];
  assert.ok(playStateRules.length >= 1, "review wall hover pause missing");
  for (const rule of playStateRules) assert.match(rule, /cs-home2-(?:wall|marquee|verdict)/);
  assert.doesNotMatch(motion, /IntersectionObserver|is-motion-visible/);
  assert.doesNotMatch(css, /\[data-motion(?:=|\])[^,{]*\{[^}]*opacity:\s*0(?:\s*[;!])/s);
});

test("H17 uses alternating house-style logistics art, layout, routing, and motion", async () => {
  const logistics = home.slice(home.indexOf("const logistics ="), home.indexOf("const verdictItems ="));
  assert.equal((logistics.match(/data-h17-card=/g) || []).length, 2);
  // Design pass 2026-08-26 (home spec fix #4): their REAL geometry is
  // text-first — panel 1 TEXT LEFT / IMAGE RIGHT (--reverse pushes the
  // DOM-first art right, so its entrance comes from +84), panel 2 mirrored.
  assert.match(logistics, /cs-home2-logistics__card--reverse" data-h17-card="shipping"[^>]*data-motion="slide-from-right"/);
  assert.match(logistics, /class="cs-home2-logistics__card" data-h17-card="schedule"[^>]*data-motion="slide-from-left"/);
  assert.equal((logistics.match(/cs-home2-logistics__divider/g) || []).length, 2);
  assert.match(css, /\.cs-home2-logistics__copy h2::after/);
  assert.match(css, /\.cs-home2-logistics__art::before/);
  assert.match(css, /\.cs-home2-logistics__card \{[^}]*grid-template-columns: 1fr 1fr;/s);
  assert.match(logistics, /pass3-h17-shipping/);
  assert.match(logistics, /pass3-h17-schedule/);
  assert.equal((logistics.match(/href="\$\{PASS5_MEDICATION_DESTINATIONS\.allProviders\}"/g) || []).length, 2);
  assert.doesNotMatch(logistics, /href="\/quiz\/provider-fit\/">Find a provider/);
  assert.match(css, /\.cs-home2-logistics__card--reverse > \.cs-home2-logistics__art \{ order: 2; \}/);
  // Operator 2026-08-26: no panel behind the pair, halves sit on the plain
  // ground, art carries no static x-offset (motion.js owns the entrance).
  assert.match(css, /\.cs-home2-logistics__card \{[^}]*background: none;/s);
  assert.doesNotMatch(css, /\.cs-home2-logistics__art\s*\{[^}]*transform: translateX/s);
  assert.match(motion, /artFrom = reverse \? 84 : -84/);
  assert.match(motion, /fromTo\(copy, \{ x: -artFrom/);
  assert.match(motion, /once: true/);
  assert.doesNotMatch(css, /\.cs-home2-logistics[^,{]*\{[^}]*opacity:\s*0(?:\s*[;!])/s);
  for (const stem of ["pass3-h17-shipping", "pass3-h17-schedule"]) {
    for (const width of [800, 1600]) {
      for (const ext of ["avif", "webp", "jpg"]) {
        await stat(new URL(`public/assets/images/${stem}-${width}.${ext}`, ROOT));
      }
    }
  }
});

test("D37-D44 include verdicts, dynamic top-three, calculator, honest review capture, positioning, editorial, centered help, and news subscribe", () => {
  // Design pass 2026-08-26 (fix #5/#8/#11): the news band merged into the
  // editorial panel (cs-home2-newsgrid retired) and the review wall module
  // (cs-home2-wall) took the capture band's place.
  for (const contract of ["Read every verdict", "See all ${programCount} programs", "Calculate your cost", "CAPTURED_HELD_MANUAL_REVIEW", "We do not sell medication", "cs-home2-articlegrid", "cs-home2-help", "cs-home2-wall", "data-newsletter-open"]) assert.ok(home.includes(contract) || runtime.includes(contract) || build.includes(contract) || reviewSource.includes(contract), `missing ${contract}`);
  assert.match(home, /contact you to verify it before publication/);
  assert.doesNotMatch(home, /held for manual moderation/i);
  assert.doesNotMatch(home, /we have none|we will not invent/i);
  for (const contract of [/Read every verdict/, /Calculate your cost/, /contact you to verify it before publication/, /cs-home2-articlegrid/, /cs-home2-help/, /cs-home2-editorial/, /data-newsletter-open/]) assert.match(servedHome, contract);
  assert.doesNotMatch(servedHome, /held for manual moderation/i);
  assert.match(servedRuntime, /closest\('\[data-subscribe-open\],\[data-newsletter-open\]'\)/);
  for (const selector of [/\.cs-home2-verdict/, /\.cs-home2-pick/, /\.cs-home2-position/, /\.cs-home2-article/, /\.cs-home2-news/, /\.cs-home2-help/, /\.cs-home2-centered/]) assert.match(servedCss, selector);
});

test("Phase 2 generated hero and lifestyle assets exist in all staged formats", async () => {
  for (const stem of ["home-hero-fruit", "home-hero-fridge", "home-hero-hand"]) {
    for (const width of [640, 1024]) for (const ext of ["avif", "webp", "jpg"]) await stat(new URL(`public/assets/images/${stem}-${width}.${ext}`, ROOT));
  }
  for (const width of [768, 1536]) for (const ext of ["avif", "webp", "jpg"]) await stat(new URL(`public/assets/images/home-lifestyle-phone-${width}.${ext}`, ROOT));
});
