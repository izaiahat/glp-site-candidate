import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { reviewRows, reviewOptionNames } from './helpers/d2w-s9-contracts.mjs';

import { renderReviewDirectoryPage, renderReviewHubPage, renderReviewSubmissionPage } from "../src/pass2-review-hub.mjs";

const registry = JSON.parse(await readFile(new URL("../data/program-registry.json", import.meta.url), "utf8"));
const pharmacyInput = JSON.parse(await readFile(new URL("../data/phase3-pharmacy-render-input.json", import.meta.url), "utf8"));
const programs = registry.programs;

test("review hub renders a governed card for every supplied review route", () => {
  const html = renderReviewHubPage({ programs });
  const expected = programs.filter((row) => /^\/reviews\/[a-z0-9-]+\/$/.test(row.review_path || ""));
  assert.equal((html.match(/data-review-card(?:\s|>)/g) || []).length, expected.length);
  assert.match(html, /data-review-filter/);
  assert.match(html, /data-review-empty hidden/);
  assert.match(html, /\/reviews\/submit\//);
  assert.doesNotMatch(html, /customer rating|verified customer|testimonials?/i);
  for (const row of expected) {
    assert.match(html, new RegExp(`href="${row.review_path.replaceAll("/", "\\/")}"`));
  }
});

test("submission page uses exact entity lookup, accessible rating radios, and optional evidence", () => {
  const html = renderReviewSubmissionPage({ programs, pharmacies: pharmacyInput });
  assert.match(html, /name="robots" content="noindex,follow,noarchive,nosnippet"/);
  assert.match(html, /name="subject_name"[^>]+data-review-entity="primary"/);
  assert.match(html, /<datalist id="review-provider-options">/);
  assert.match(html, /src="\/assets\/review-intake\.js" data-review-intake-runtime/);
  assert.equal((html.match(/<option value="/g) || []).length, new Set([...reviewOptionNames(programs), ...pharmacyInput.entries.map((row) => row.display_name)]).size);
  assert.equal((html.match(/data-review-entity-type="provider"/g) || []).length, reviewOptionNames(programs).length);
  assert.equal((html.match(/data-review-entity-type="pharmacy"/g) || []).length, pharmacyInput.entries.length);
  assert.equal((html.match(/type="radio" name="experience_type"/g) || []).length, 2);
  assert.equal((html.match(/type="radio" name="rating"/g) || []).length, 5);
  assert.match(html, /type="file" name="evidence"[^>]+accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
  assert.match(html, /data-review-page-status role="status" aria-live="polite"/);
  // 2026-08-26: one required checkbox carries all three attestation substances;
  // the payload still asserts truthful/privacy/review consent individually.
  assert.match(html, /name="combined_attestation" required/);
  assert.match(html, /truthful experience/i);
  assert.match(html, /review this submission and contact me to verify it before publication/i);
  assert.doesNotMatch(html, /held for manual moderation/i);
  assert.doesNotMatch(html, /published automatically[^<]*yes/i);
});

test("review directory exposes governed entity filters, deterministic pagination, and zero approved submissions", () => {
  const html = renderReviewDirectoryPage({ programs, pharmacies: pharmacyInput });
  assert.match(html, /name="robots" content="index,follow,max-image-preview:large"/);
  const expected = reviewRows(programs).length + pharmacyInput.entries.length;
  assert.equal((html.match(/data-review-card/g) || []).length, expected);
  assert.equal((html.match(/data-review-type="provider"/g) || []).length, reviewRows(programs).length);
  assert.equal((html.match(/data-review-type="pharmacy"/g) || []).length, pharmacyInput.entries.length);
  assert.match(html, /data-review-type-filter="all"/);
  assert.match(html, /data-review-type-filter="provider"/);
  assert.match(html, /data-review-type-filter="pharmacy"/);
  assert.match(html, /data-review-load-more/);
  assert.doesNotMatch(html, /Approved submitted reviews/);
  assert.match(html, /Submitted experiences are checked before they can appear here/);
});

test("duplicate governed review paths fail closed", () => {
  const duplicate = [{ ...programs[0] }, { ...programs[0], program_id: "duplicate-id" }];
  assert.throws(() => renderReviewHubPage({ programs: duplicate }), /duplicate/);
});
