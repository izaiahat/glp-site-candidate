import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicProviderNames } from '../src/public-provider-names.mjs';

// GLP-233: scan emitted bytes, not only DOM text. This includes metadata,
// JSON-LD, options, noscript, deferred cards, search and taxonomy payloads.
// An explicit root permits replay against the immutable predecessor artifact.
const root = process.env.GLP_PUBLIC_NAME_TEST_ROOT || fileURLToPath(new URL('../public/', import.meta.url));
const claim = /SkinnyRx\s*[-–—]\s*#\s*1\s+GLP\s+Weight\s+Loss\s+Provider/gi;
const decode = text => text.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, hex, decimal) => String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10))).replace(/&(?:nbsp|amp|quot);/g, value => ({'&nbsp;':' ', '&amp;':'&', '&quot;':'"'})[value]);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'public output must not contain symlinks');
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
function strings(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => [key, ...strings(child)]);
  return [];
}

test('GLP-233 all emitted public names omit the unsupported SkinnyRx superlative', () => {
  const legacy = 'SkinnyRx - #1 GLP Weight Loss Provider';
  const record = { display_name: legacy, render_display_name: legacy, provider: legacy,
    alt: `${legacy} logo`, why_match: `${legacy} publishes reported information.`,
    program_id: 'skinnyrx-1-glp-weight-loss-provider-review', price: 99,
    source_url: 'https://skinnyrx.com/', exact_quote: legacy, live_link_allowed: false };
  const original = structuredClone(record);
  const projected = publicProviderNames(record);
  assert.deepEqual(record, original, 'projection must not mutate evidence inputs');
  assert.deepEqual(projected, { ...record, display_name: 'SkinnyRx', render_display_name: 'SkinnyRx',
    provider: 'SkinnyRx', alt: 'SkinnyRx logo', why_match: 'SkinnyRx publishes reported information.' });
  assert.deepEqual(publicProviderNames(projected), projected, 'projection must be idempotent');
  const all = files(root), hits = [], html = [], json = [];
  for (const file of all) {
    const relative = path.relative(root, file);
    if (file.endsWith('.html')) html.push(relative);
    if (file.endsWith('.json')) json.push(relative);
    // Scan every emitted file, including extensionless and unfamiliar payloads.
    // Binary bytes are decoded only for a literal UTF-8 claim search; images
    // are not OCR evidence. JSON additionally exposes escaped string values.
    const raw = readFileSync(file, 'utf8');
    const text = file.endsWith('.json') ? strings(JSON.parse(raw)).join('\n') : raw;
    const occurrences = [...decode(text).matchAll(claim)].length;
    if (occurrences) hits.push({ file: relative, occurrences });
  }
  for (const file of ['index.html', 'compare/index.html', 'providers/index.html', 'providers/skinnyrx-1-glp-weight-loss-provider-review/index.html', 'reviews/index.html', 'reviews/submit/index.html', 'reviews/skinnyrx-1-glp-weight-loss-provider-review/index.html', 'quiz/provider-fit/index.html', 'matches/customized/index.html']) {
    assert.ok(html.includes(file), `missing required emitted route: ${file}`);
    assert.match(readFileSync(path.join(root, file), 'utf8'), /SkinnyRx/, `missing plain identity: ${file}`);
  }
  for (const file of ['assets/search-index.json', 'data/therapeutic-taxonomy.json', 'assets/provider-logos/manifest.json', 'assets/provider-logos/pass2-lp-atlas.json']) assert.ok(json.includes(file), `missing required emitted payload: ${file}`);
  assert.ok(json.some(file => /^assets\/provider-card-payloads\.[a-f0-9]+\.json$/.test(file)), 'missing deferred provider cards');
  assert.match(readFileSync(path.join(root, 'reviews/skinnyrx-1-glp-weight-loss-provider-review/index.html'), 'utf8'), /SkinnyRx/);
  console.log(JSON.stringify({ root, files: all.length, html: html.length, json: json.length, affected_files: hits.length, occurrences: hits.reduce((sum, hit) => sum + hit.occurrences, 0), hits }));
  assert.deepEqual(hits, [], 'unsupported public-name claim remains in emitted output');
});
