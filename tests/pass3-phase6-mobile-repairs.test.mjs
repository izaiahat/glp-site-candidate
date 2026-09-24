import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [site, reviewIntake, phase3Css, providerCss, reviewCss, intakeCss, editorialCss, shellCss, quizCss, compatCss, moneyCss, allRoutesAudit] = await Promise.all([
  read("assets/site.js"),
  read("assets/review-intake.js"),
  read("assets/css-src/11-phase3.css"),
  read("assets/css-src/30-provider-detail.css"),
  read("assets/css-src/30-review.css"),
  read("assets/css-src/31-review-intake.css"),
  read("assets/css-src/40-editorial.css"),
  read("assets/css-src/02-shell.css"),
  read("assets/css-src/55-quiz.css"),
  read("assets/css-src/90-compat.css"),
  read("assets/css-src/20-money.css"),
  read("scripts/pass3-phase6-all-routes-mobile-audit.mjs"),
]);

test("Phase 6 layered dialogs trap links and dismiss only the nested state picker", () => {
  assert.match(site, /event\.stopPropagation\(\);\s*closeState\(\{ returnFocus: true \}\);\s*return;/s);
  assert.match(site, /popover\.scrollIntoView\(\{ behavior: 'auto', block: 'nearest', inline: 'nearest' \}\);/);
  assert.match(site, /querySelectorAll\('a\[href\],button:not\(\[disabled\]\),input:not\(\[disabled\]\),select:not\(\[disabled\]\)/);
  assert.match(phase3Css, /\.p3-state-popover \{\s+position: static;/);
  assert.match(phase3Css, /\.p3-state-popover button \{\s+min-height: 44px;/);
});

test("Phase 6 provider action bar releases before footer without scroll-direction state", () => {
  assert.match(site, /querySelector\('\.cs-prefooter, \.gcs-footer'\)/);
  assert.match(site, /footer\.getBoundingClientRect\(\)\.top <= window\.innerHeight/);
  assert.match(site, /classList\.toggle\(\s+'is-released'/);
  assert.match(phase3Css, /\.p3-provider-sticky\.is-released \{\s+position: absolute;\s+bottom: 0;/);
  assert.doesNotMatch(phase3Css, /data-scroll-direction/);
});

test("Phase 6 review step restores visible focus context without smooth motion", () => {
  assert.match(reviewIntake, /heading\.focus\(\{ preventScroll: true \}\);\s+heading\.scrollIntoView\(\{ behavior: "auto", block: "start", inline: "nearest" \}\);/);
});

test("Phase 6 mobile contrast and repeated touch-target repairs are source-bound", () => {
  // Quiz v2 (operator 2026-08-26): result cards moved to the dark surface, so
  // the contrast pairing is bright-on-dark. Pin BOTH sides of the pairing.
  assert.match(quizCss, /\.qz-card \{[^}]*background: var\(--color-surface\);/s);
  assert.match(quizCss, /\.qz-card-name \{[^}]*color: var\(--text-primary\);/s);
  assert.match(reviewCss, /body:has\(\.ready6-review-hero\) main > \.panel:not\(\.inline-capture\) \{[^}]*--text-primary: var\(--cs-ink-on-paper, #14201b\);/s);
  assert.match(reviewCss, /table\.cs-mobile-card-table tbody tr \{[^}]*color: var\(--cs-ink-on-paper, #14201b\);[^}]*background: var\(--cs-paper-card, #fffdf7\);/s);
  assert.match(reviewCss, /\.citation a,[\s\S]*min-width: 44px;[\s\S]*min-height: 44px;/);
  assert.match(reviewCss, /\.jump-nav a,\s*body:has\(#bottom-line\) \.ready6-jump-nav a \{[^}]*min-height: 44px;/s);
  assert.match(intakeCss, /\.p5-check \{[^}]*min-height: 44px;/s);
  assert.match(editorialCss, /sup\.inline-citation a \{[^}]*min-inline-size: 44px;[^}]*min-block-size: 44px;/s);
  assert.match(editorialCss, /\.ready6-jump-nav a \{[^}]*min-height: 44px;/s);
  assert.match(editorialCss, /main\.guide-shell \.table-controls button \{\s*min-height: 44px;/s);
  assert.match(providerCss, /\.ready6-jump-nav a \{[^}]*min-height: 44px;/s);
  assert.match(compatCss, /\.table-wrap\.responsive-table td \.inline-citation a \{[^}]*min-width: 44px; min-height: 44px;/s);
  assert.match(shellCss, /\.cs-footer-legal a \{[^}]*min-width: 44px;[^}]*min-height: 44px;/s);
  assert.match(phase3Css, /\.p3-source-price > details summary \{[^}]*min-height: 44px;/s);
  assert.match(phase3Css, /\.p3-filter-empty button,[^}]*\[data-pharmacy-reverse-reset\] \{\s*min-height: 44px;/s);
  assert.match(moneyCss, /\.table-controls button \{\s*min-height: 44px;/s);
  assert.match(moneyCss, /\.inline-citation > a \{[^}]*min-width: 44px;[^}]*min-height: 44px;/s);
  assert.match(reviewCss, /\.sources li > \.source-nolink \{[^}]*overflow-wrap: anywhere;/s);
  assert.match(allRoutesAudit, /style\.position === "sticky" && \(box\.bottom <= 0 \|\| box\.top >= innerHeight\)/);
});
