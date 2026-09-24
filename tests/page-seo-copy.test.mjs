import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { pageSeoCopy, pageSeoRoutes } from '../src/page-seo-copy.mjs';
import { normalizeReviewMetadata } from '../scripts/wave2-repairs.mjs';
const esc = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
test('page SEO: exact 85-route source cohort and frozen values', () => {
  assert.equal(pageSeoRoutes.length, 85);
  assert.equal(new Set(pageSeoRoutes).size, 85);
  assert.equal(pageSeoCopy('/reviews/submit/'), null);
  assert.equal(pageSeoCopy('__proto__'), null);
  for (const route of pageSeoRoutes) assert.ok(Object.isFrozen(pageSeoCopy(route)));
});
test('Wave2 uses distinct title/H1/meta and is idempotent for all mapped review details', () => {
  const routes = pageSeoRoutes.filter(route => /^\/reviews\/[^/]+\/$/.test(route));
  assert.equal(routes.length, 58);
  for (const route of routes) {
    const copy = pageSeoCopy(route);
    const input = '<title>old</title><meta name="description" content="old"><h1 class="kept" id="hero">old</h1><a href="/same/">preserved</a>';
    const output = normalizeReviewMetadata(input, {route, provider: 'Identity unchanged'});
    assert.ok(output.includes(`<title>${esc(copy.title)}</title>`), route);
    assert.ok(output.includes(`<h1 class="kept" id="hero">${esc(copy.h1)}</h1>`), route);
    assert.ok(output.includes(`content="${esc(copy.meta)}"`), route);
    assert.ok(output.includes('<a href="/same/">preserved</a>'), route);
    assert.equal(normalizeReviewMetadata(output, {route, provider: 'Identity unchanged'}), output);
  }
});
test('unmapped review keeps legacy title fallback and description', () => {
  const html = normalizeReviewMetadata('<title>old</title><meta name="description" content="same"><h1>old</h1>', {route:'/reviews/future-provider/', provider:'Future'});
  assert.ok(html.includes('<title>Future Review 2026: Costs, Terms &amp; Evidence</title>'));
  assert.ok(html.includes('content="same"'));
});
test('built final bytes satisfy the complete source cohort', () => {
  const result = spawnSync('python3', ['scripts/validate-page-seo.py'], {cwd:new URL('../', import.meta.url), encoding:'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.passed, 85);
});
