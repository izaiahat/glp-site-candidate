import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderBlogPost } from '../src/blog-system.mjs';
import { renderConfiguredListing } from '../src/phase3-page-graph.mjs';
import { createHash } from 'node:crypto';

// GLP-75 operator assignment: new additive tests only; existing oracles unchanged.
const BASE = 'e52b7cb903ceaa77ff8d16f958a986398cf3abda';
const root = new URL('../', import.meta.url);
const read = file => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
const base = file => JSON.parse(execFileSync('git', ['show', `${BASE}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
const route = '/guides/wegovy-pills-oral-semaglutide-cost/';
const description = 'Reported oral/tablet Wegovy information dated August 2, 2026. Current prices and terms are unconfirmed; recheck sources before relying on an offer.';

test('oral guide renders only a dated description successor, without a price or approval assertion', () => {
  const current = read('data/blog/content-batch.json');
  const previous = base('data/blog/content-batch.json');
  const article = current.articles.find(a => a.canonical_path === route);
  const old = previous.articles.find(a => a.canonical_path === route);
  assert.equal(article.description, description);
  assert.doesNotMatch(article.description, /\$|\b\d+(?:\.\d+)?\s*mg\b|FDA|approved|current official|available now/i);
  const html = renderBlogPost(article, null, article.author);
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
  assert.ok(html.includes(`<meta name="description" content="${description}">`));
  const oldHtml = renderBlogPost(old, null, old.author);
  assert.equal(html, oldHtml.replaceAll(old.description, description), 'no body, title, source date, link, hold or authority changes');
  article.description = old.description;
  assert.deepEqual(current, previous, 'exactly one maintained description field changes');
});

test('pharmacy scope note renders once before filters, without changing the grid or asserting approval', () => {
  const html = renderConfiguredListing('D', { route: '/pharmacies/', slug: 'pharmacies', name: 'Compare compounding pharmacies' }, {
    pharmacyInput: read('data/phase3-pharmacy-render-input.json'), registry: read('data/program-registry.json'), articles: [],
  });
  const notes = [...html.matchAll(/<aside\b[^>]*data-pharmacy-evidence-scope[^>]*>([\s\S]*?)<\/aside>/g)];
  assert.equal(notes.length, 1, 'one visible scope note, not an additional pathway explanation');
  const note = notes[0][0];
  assert.ok(html.indexOf(note) < html.indexOf('<details open data-native-pharmacy-filters>'));
  assert.match(note, /Reported information — how to read this directory/);
  assert.match(note, /This grid is a source-coverage subset, not a current licensure or availability list\./);
  assert.match(note, /Directory inclusion alone does not establish current licensure, stock or product approval\./);
  assert.match(note, /state licensure, NPI identity, facility registration and product regulatory status as separate checks/);
  assert.doesNotMatch(note, /\$|\b(?:75|15)\b|FDA-approved|licensed pharmacies|certified|guaranteed/i);
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(html.match(/<div class="listing-grid p3-pharmacy-grid"[\s\S]*?<\/div><\/section>/)[0]), 'f63434b92f7722f67ac143d9f6a8d272c937174d60ac313e43292bf339f9591a');
  assert.equal(hash(html.match(/<details open data-native-pharmacy-filters>[\s\S]*?<\/details>/)[0]), 'b0789c1cf2787affae12218732b5d4a95e7f5d7813e4d5d248c1da48cfde917e');
  assert.equal((html.match(/503 pathway labels describe oversight, not quality\./g) || []).length, 1);
});

test('Wellmedr already consolidates unknown charges and policy conflict; protected inputs are unchanged', () => {
  const contracts = read('data/provider-page-contracts.json');
  const wellmedr = contracts.providers.find(p => p.program_id === 'wellmedr-review');
  assert.match(wellmedr.page_copy.bottom_line, /UNKNOWN exact first-month charge and initial checkout total/);
  assert.match(wellmedr.page_copy.bottom_line, /UNKNOWN exact recurring charge for a selected treatment and plan/);
  assert.match(wellmedr.page_copy.bottom_line, /Terms-of-use wording about intake-stage consultation refunds conflicts and is retained separately, not resolved here/);
  for (const file of ['data/provider-page-contracts.json', 'data/phase3-pharmacy-render-input.json', 'data/program-registry.json', 'data/affiliate-activation-selection.json', 'data/go-runtime-promotion-authority.json']) {
    assert.deepEqual(read(file), base(file), `GLP-75 must not rewrite ${file}`);
  }
});
