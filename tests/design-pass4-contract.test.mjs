import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const html = (route = "") => read(path.join("public", route, "index.html"));

function walkHtml(directory, output = []) {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) walkHtml(absolute, output);
    else if (entry.endsWith(".html")) output.push(absolute);
  }
  return output;
}

test("Pass 4 action aurora is the final shared layer in every route bundle", () => {
  const primitive = read("assets/css-src/01-primitives.css");
  const aurora = read("assets/css-src/99-action-aurora.css");
  const assembler = read("artifacts/ultracode/tools/assemble-css.mjs");

  assert.match(primitive, /@property --cs-button-aurora-angle/);
  assert.match(primitive, /@keyframes cs-button-aurora-orbit/);
  assert.match(aurora, /\.gcs-home-actions > \.cs-btn\.cs-btn--orbit\s*\{[\s\S]*?animation:\s*cs-button-aurora-orbit 5s linear infinite/);
  assert.match(aurora, /animation:\s*none/);
  assert.match(aurora, /animation:\s*cs-button-aurora-orbit 5s linear infinite/);
  assert.match(aurora, /animation:\s*cs-button-aurora-orbit 8s linear infinite/);
  assert.match(aurora, /\.gcs-home-actions > \.cs-btn--quiet/);
  for (const selector of [
    ".cta.lead",
    ".gcs-nav-action",
    ".gcs-button:not(.secondary)",
    ".gcs-button.secondary",
    ".gcs-cta-primary",
    ".gcs-cta-secondary",
    ".qz-next",
    ".qz-back",
    ".cs-revhub-band__cta",
    "[data-explore-providers]",
    ".inline-capture button[type=\"submit\"]",
  ]) assert.ok(aurora.includes(selector), `missing aurora alias ${selector}`);
  assert.match(aurora, /:is\(\[aria-disabled="true"\], \[disabled\]\)[^{]*\{[\s\S]*?animation:\s*none/);
  assert.match(assembler, /const ACTION_AURORA = "99-action-aurora\.css"/);
  assert.equal((assembler.match(/ACTION_AURORA\]/g) || []).length, 7);
});

test("reduced motion replaces ambient aurora and disables action orbit", () => {
  const foundation = read("assets/css-src/00-foundation.css");
  assert.match(foundation, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none !important/);
  assert.match(foundation, /\.cs-aurora-field \{ display: none; \}/);
  assert.match(foundation, /\.cs-aurora-static \{ display: block; \}/);
});

test("home contract pins the repaired rails, pricing, merged review intake, and copy cleanup", () => {
  const page = html();
  const style = read("assets/css-src/10-home.css");
  const runtime = read("assets/site.js");

  assert.equal((page.match(/class="cs-home-quick"/g) || []).length, 7);
  assert.equal((page.match(/class="cs-home2-marquee__track"/g) || []).length, 1);
  const marquee = page.match(/class="cs-home2-marquee__track">([\s\S]*?)<\/div><\/div><\/section>/)?.[1] || "";
  assert.equal((marquee.match(/<a /g) || []).length, 12);
  assert.equal((page.match(/data-med-card/g) || []).length, 7);
  assert.match(page, /Wegovy pill[\s\S]{0,1200}Starts at \$149\/mo/);
  assert.match(page, /data-counter/);
  assert.doesNotMatch(page, /wall starts at zero/i);
  assert.match(page, /Browse all \d+ guides/);
  assert.match(page, /data-review-sheet/);
  assert.match(page, /data-review-intake/);
  assert.match(page, /data-review-compact/);
  assert.match(page, />Submit for review<\/button>/);
  const homeReview = page.match(/<form[^>]*data-review-intake[^>]*data-review-compact[\s\S]*?<\/form>/)?.[0] || "";
  assert.doesNotMatch(homeReview, /type="file" name="evidence"|data-review-step="counterpart"/);
  assert.match(style, /cs-home2-marquee__track[\s\S]*?30s linear infinite/);
  assert.match(style, /cs-home2-verdict-track[\s\S]*?56s linear infinite/);
  assert.match(runtime, /setInterval\(\(\) => move\(1\), 3000\)/);
});

test("honeypots are visually hidden and removed trust copy stays removed", () => {
  const hiddenCss = [
    read("assets/css-src/10-home.css"),
    read("assets/css-src/31-review-intake.css"),
    read("assets/css-src/40-editorial.css"),
    read("assets/css-src/90-compat.css"),
  ].join("\n");
  assert.match(hiddenCss, /capture-honeypot[\s\S]{0,500}(position:\s*absolute|display:\s*none|clip-path:\s*inset)/);

  const files = walkHtml(path.join(ROOT, "public"));
  let honeypots = 0;
  for (const file of files) {
    const page = readFileSync(file, "utf8");
    for (const match of page.matchAll(/<input\b[^>]*name=["']company["'][^>]*>/gi)) {
      honeypots += 1;
      const context = page.slice(Math.max(0, match.index - 260), match.index + match[0].length + 120);
      assert.match(context, /(capture-honeypot|visually-hidden|sr-only|hidden)/i, `visible honeypot in ${path.relative(ROOT, file)}`);
    }
  }
  assert.ok(honeypots > 0, "expected rendered anti-bot fields");
  assert.doesNotMatch(html("insights"), /never sell or share your email/i);
});

test("menu is viewport-bounded and outside the sticky header containing block", () => {
  const shell = read("assets/css-src/02-shell.css");
  const builder = read("scripts/build-staging.mjs");
  const runtime = read("assets/site.js");
  assert.match(shell, /\.cs-drawer \{[\s\S]*?position:\s*fixed;[\s\S]*?width:\s*min\(280px, calc\(100vw - 48px\)\)[\s\S]*?z-index:\s*140/);
  assert.match(shell, /\.cs-drawer[\s\S]*?overflow:\s*auto/);
  assert.match(shell, /body\.cs-drawer-open \{ overflow: hidden; \}/);
  assert.match(builder, /drawer remains a sibling of the sticky header/);
  assert.match(runtime, /focusout[\s\S]{0,360}!entry\.group\.contains\(event\.relatedTarget\)\) close\(\)/);
});

test("mobile header and consent controls keep touch targets clear of the paid-LP sticky action", () => {
  const shell = read("assets/css-src/02-shell.css");
  const quiz = read("assets/css-src/55-quiz.css");
  const consent = read("src/consent-runtime.mjs");
  const landing = read("src/ads-landing.mjs");
  assert.match(shell, /\.cs-search\s*\{\s*flex:\s*0 0 44px/);
  assert.match(shell, /\.cs-search-toggle\s*\{\s*inline-size:\s*44px;\s*min-height:\s*44px/);
  assert.match(shell, /\.cs-search-back\s*\{\s*inline-size:\s*44px;\s*block-size:\s*44px/);
  assert.match(shell, /\.cs-menu-toggle\s*\{[\s\S]*?block-size:\s*44px/);
  assert.match(shell, /section#gcs-consent \.gcs-consent-actions button \{ min-height: 44px/);
  assert.match(quiz, /body\[data-page="quiz-provider-fit"\] main#main\.qz-shell \{[\s\S]*?min-height:\s*100dvh;[\s\S]*?padding-block:\s*95px calc\(48px \+ var\(--consent-clearance, 0px\)\) !important/);
  assert.match(consent, /bottom:calc\(20px \+ var\(--sticky-clearance,0px\)\)/);
  assert.match(consent, /const reserved=height===null\?320:Math\.ceil\(height\+bottom\+8\)/);
  assert.match(consent, /window\.innerWidth<=920\|\|document\.body\?\.dataset\?\.page==='quiz-provider-fit'/);
  assert.match(consent, /entry\?\.borderBoxSize/);
  assert.match(landing, /body:has\(\.sticky\)\{--sticky-clearance:96px\}/);
});

test("synthetic analytics guard blocks the inline GTM loader without changing the four-script pin", () => {
  const builder = read("scripts/build-staging.mjs");
  assert.equal((builder.match(/if\(!window\.GCS_ANALYTICS_SUPPRESSED\)\(function\(w,d,s,l,i\)/g) || []).length, 2);
  assert.match(builder, /navigator\.webdriver===true/);
  assert.match(builder, /\['localhost','127\.0\.0\.1','::1'\]\.includes\(location\.hostname\)/);
});

test("Insights-reference route families render the clean-room template anatomy", () => {
  const representatives = [
    ["insights", /p3-insights-hero|cs-ins-index/],
    ["bulk", /p3-index-hero/],
    ["3-month", /listing__intro--bulk-visual[^>]*>[\s\S]*?data-product-visual="bulk-/],
    ["6-month", /listing__intro--bulk-visual[^>]*>[\s\S]*?data-product-visual="bulk-/],
    ["mounjaro", /p3-product-hero/],
    ["wegovy", /p3-product-hero/],
    ["wegovy-pill", /p3-product-hero/],
    ["zepbound", /p3-product-hero/],
    ["ozempic", /p3-product-hero/],
    ["lp/best-providers/compounded-semaglutide", /p3-category-hero/],
    ["lp/best-providers/compounded-tirzepatide", /p3-category-hero/],
    ["providers", /p3-provider|p3-index-hero/],
    ["pharmacies", /p3-pharm/],
  ];
  for (const [route, marker] of representatives) {
    const page = html(route);
    assert.match(page, marker, `missing emulated anatomy on /${route}/`);
    assert.doesNotMatch(page, /glpwinner/i, `clean-room leak on /${route}/`);
  }
});

test("every shipped HTML, CSS, and JS byte preserves the clean-room boundary", () => {
  const publicRoot = path.join(ROOT, "public");
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (/\.(?:html|css|js)$/i.test(entry)) files.push(absolute);
    }
  };
  walk(publicRoot);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /glpwinner/i, `clean-room marker leaked into ${path.relative(ROOT, file)}`);
  }
});

test("every first-party public HTML footer carries the exact legal entity stamp", () => {
  const stamp = "Entity: Tilton Group LLC · California entity B20260317552 · Principal and mailing address: 2108 N St, Ste N, Sacramento, CA 95816.";
  const files = walkHtml(path.join(ROOT, "public"));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(readFileSync(file, "utf8").includes(stamp), `missing entity stamp in ${path.relative(ROOT, file)}`);
  }
});

test("calculator and quiz retain explicit capture and state contracts", () => {
  const calculator = html("tools/glp-1-cost-calculator");
  const quiz = html("quiz/provider-fit");
  const quizRuntime = read("assets/quiz-page.js");
  assert.match(calculator, /data-cs-template="calculator"/);
  assert.match(calculator, /data-content-upgrade-form-inline/);
  assert.match(calculator, /affiliate/i);
  assert.doesNotMatch(calculator, /No health answers are collected/i);
  assert.match(calculator, /class="cost-anchor"><span class="sr-only">[\s\S]{0,100}dollars a month/);
  assert.doesNotMatch(calculator, /class="cost-anchor" aria-label=/);
  assert.match(quiz, /data-phase4-questions/);
  assert.match(quiz, /data-explore-providers/);
  assert.match(quiz, /document\.documentElement\.classList\.add\("js"\)/);
  assert.match(read("assets/css-src/55-quiz.css"), /html\.js \[data-phase4-quiz\]:not\(\.qz-enhanced\)[\s\S]*\.qz-position:not\(:first-of-type\)/);
  assert.match(quizRuntime, /function hydrateProgress\(\) \{\s*clearSavedQuiz\(\);\s*return 0;/);
  assert.match(quizRuntime, /function saveProgress\(\) \{[\s\S]*?root\.phase4State = answers;/);
  assert.doesNotMatch(quizRuntime, /localStorage\.setItem/);
  assert.match(quizRuntime, /location\.assign\(`\/matches\/customized\/\?\$\{query\.toString\(\)\}`\)/);
  assert.match(quizRuntime, /Comparing providers…/);
  assert.match(quizRuntime, /Checking your answers…/);
  assert.match(quizRuntime, /Finding your best match…/);
  assert.match(quizRuntime, /newsletter_endpoint/);
});

test("home price choices tween numeric changes for 600ms with a reduced-motion fallback", () => {
  const runtime = read("assets/site.js");
  assert.match(runtime, /duration:\s*0\.6/);
  assert.match(runtime, /querySelectorAll\('\[data-price-card\]'\)/);
  assert.match(runtime, /querySelector\('\[data-price-roll\]'\)/);
  assert.match(runtime, /amount\.dataset\.priceNumeric/);
  assert.match(runtime, /prefers-reduced-motion:\s*reduce/);
  assert.match(runtime, /Math\.round\(proxy\.value\)/);
});

test("category and directory routes progressively disclose long evidence inventories", () => {
  const phase3 = read("src/phase3-page-graph.mjs");
  const runtime = read("assets/site.js");
  assert.match(phase3, /data-provider-load-more/);
  assert.match(phase3, /data-provider-card-contract="option-c"/);
  assert.match(phase3, /data-pharmacy-load-more/);
  assert.match(phase3, /class="p3-pharmacy-facts"/);
  assert.match(phase3, /renderPhase3RelatedInsightsShelf\(\{ slug: "pharmacies" \}/);
  assert.match(runtime, /const batchSize = 12/);
  assert.match(runtime, /const batchSize = 18/);
  assert.match(runtime, /desiredOrder\.splice\(Math\.min\(2, desiredOrder\.length\), 0, interstitial\)/);
});
