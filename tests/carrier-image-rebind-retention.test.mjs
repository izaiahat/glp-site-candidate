import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCarrierArticle, loadCarrierArticles, assertCarrierArticleOutput } from '../src/carrier-article-retention.mjs';
import * as retention from '../src/carrier-article-retention.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagePath = 'artifacts/ultracode/article-image-manifest.json';
const beforePath = 'artifacts/ultracode/article-image-manifest-before-abfcc41435f896df48c68452c59c797c430841a2154149d673b5097e3f6b9af5.json';
const receiptPath = 'artifacts/ultracode/article-image-REBIND-abfcc41435f896df-7f3b9b7eca877071.json';
const keys = ['image_inputs', 'image_inputs_sha256', 'current_image_inputs', 'current_image_inputs_sha256', 'image_input_diff', 'inputs_stale'];
const slugs = ['ezra-glp-1-reviews', 'top-rated-glp-1-providers'];
const sha = x => createHash('sha256').update(x).digest('hex');
const sorted = x => Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
const digest = x => sha(JSON.stringify(sorted(x)));
const json = (dir, rel) => JSON.parse(readFileSync(path.join(dir, rel)));
const save = (dir, rel, data) => writeFileSync(path.join(dir, rel), JSON.stringify(data));
function fixture(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'carrier-image-rebind-'));
  try {
    const files = new Set([beforePath, receiptPath,
      'artifacts/ultracode/article-image-REBIND-7f3b9b7eca877071-12aa0e7c539a090e.json',
      'artifacts/ultracode/article-image-manifest-before-7f3b9b7eca877071039a48caeedcf9fb7778478f38956976300a4f35560f8663.json',
      ...json(root, receiptPath).after_source_files.map(x => x.path)]);
    for (const slug of slugs) {
      const rel = `data/carrier-articles/${slug}/manifest.json`;
      const m = json(root, rel);
      for (const p of [rel, m.snapshot, ...m.files.map(x => x.path), ...m.bindings.map(x => x.path)]) files.add(p);
    }
    for (const rel of files) {
      mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true});
      copyFileSync(path.join(root, rel), path.join(dir, rel));
    }
    fn(dir);
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
test('registered two-carrier rebind retains frozen pins, exact held bytes and all original record fields', () => fixture(dir => {
  const retained = loadCarrierArticles(dir);
  assert.equal(retained.size, 2);
  const before = json(dir, beforePath);
  const current = json(dir, imagePath);
  for (const row of retained.values()) {
    const original = before.records.find(x => x.route === row.manifest.route);
    const record = current.records.find(x => x.route === row.manifest.route);
    assert.deepEqual(Object.keys(record).filter(k => !(k in original)).sort(), [...keys].sort());
    assert.deepEqual(Object.fromEntries(Object.entries(record).filter(([k]) => !keys.includes(k))), original);
    assert.equal(digest(original), row.manifest.bindings.find(b => b.path === imagePath).sha256);
    assertCarrierArticleOutput(row, readFileSync(path.join(dir, row.manifest.snapshot)), 'candidate');
  }
}));

// Always invoke the actual mandatory loader; never run a repairing producer.
for (const slug of slugs) {
  const manifestPath = `data/carrier-articles/${slug}/manifest.json`;
  const manifest = json(root, manifestPath);
  const manifestSha = sha(readFileSync(path.join(root, manifestPath)));
  const load = dir => loadCarrierArticle(dir, manifestPath, manifestSha);
  const record = json(root, imagePath).records.find(r => r.route === manifest.route);
  function mutateRecord(dir, fn) {
    const data = json(dir, imagePath);
    fn(data.records.find(r => r.route === manifest.route));
    save(dir, imagePath, data);
  }
  for (const key of Object.keys(record).filter(k => !keys.includes(k))) {
    test(`${slug}: changing historical field ${key} fails its unchanged pin`, () => fixture(dir => {
      mutateRecord(dir, r => { r[key] = 'UNAUTHENTICATED'; });
      assert.throws(() => load(dir), /carrier_article_metadata_drift/);
    }));
  }
  for (const key of keys) {
    test(`${slug}: unauthenticated ${key} fails mandatory binding validation`, () => fixture(dir => {
      mutateRecord(dir, r => { r[key] = 'UNAUTHENTICATED'; });
      assert.throws(() => load(dir), /carrier_article_image_binding_unauthenticated/);
    }));
    test(`${slug}: missing ${key} cannot downgrade binding coverage`, () => fixture(dir => {
      mutateRecord(dir, r => { delete r[key]; });
      assert.throws(() => load(dir), /carrier_article_image_binding_unauthenticated/);
    }));
  }
  test(`${slug}: removing all six fields cannot restore an unbound pass`, () => fixture(dir => {
    mutateRecord(dir, r => keys.forEach(k => delete r[k]));
    assert.throws(() => load(dir), /carrier_article_image_binding_unauthenticated/);
  }));
  test(`${slug}: coherent forged original keyword fails historical-origin authentication`, () => fixture(dir => {
    mutateRecord(dir, r => {
      r.image_inputs.primary_keyword = 'forged historical keyword';
      r.image_inputs_sha256 = digest(r.image_inputs);
      r.image_input_diff = {primary_keyword: {before: r.image_inputs.primary_keyword, after: r.current_image_inputs.primary_keyword}};
      r.inputs_stale = true;
    });
    assert.throws(() => load(dir), /carrier_article_image_binding_unauthenticated_image_inputs:/);
  }));
  test(`${slug}: coherent original and current forgery cannot self-certify`, () => fixture(dir => {
    mutateRecord(dir, r => {
      r.image_inputs.primary_keyword = 'forged keyword';
      r.current_image_inputs.primary_keyword = 'forged keyword';
      r.image_inputs_sha256 = digest(r.image_inputs);
      r.current_image_inputs_sha256 = digest(r.current_image_inputs);
      r.image_input_diff = {}; r.inputs_stale = false;
    });
    assert.throws(() => load(dir), /carrier_article_image_binding_unauthenticated_image_inputs:/);
  }));
  for (const [label, fn] of [
    ['unknown seventh field', r => { r.unapproved_binding = {}; }],
    ['nested old value', r => { r.outputs[0].sha256 = '0'.repeat(64); }],
    ['array order', r => { r.outputs.reverse(); }],
    ['nested binding-key exemption', r => { r.outputs[0].image_inputs = {}; }],
  ]) test(`${slug}: ${label} remains inside historical hash`, () => fixture(dir => {
    mutateRecord(dir, fn);
    assert.throws(() => load(dir), /carrier_article_metadata_drift/);
  }));
  for (const rel of [manifest.snapshot, ...manifest.files.map(x => x.path)]) {
    test(`${slug}: held bytes reject tamper at ${rel}`, () => fixture(dir => {
      writeFileSync(path.join(dir, rel), 'changed held byte');
      assert.throws(() => load(dir), /carrier_article_(asset|output)_drift/);
    }));
  }
  for (const rel of [beforePath, receiptPath]) {
    test(`${slug}: independently authenticated ${path.basename(rel)} rejects tamper`, () => fixture(dir => {
      const data = json(dir, rel); data.unapproved = true; save(dir, rel, data);
      assert.throws(() => load(dir), /carrier_article_image_binding_(receipt_drift|manifest_lineage)/);
    }));
  }
  test(`${slug}: a copied receipt with recomputed forged manifest hashes is not authority`, () => fixture(dir => {
    mutateRecord(dir, r => { r.image_inputs.primary_keyword = 'forged'; r.image_inputs_sha256 = digest(r.image_inputs); });
    const receipt = json(dir, receiptPath);
    receipt.after_manifest_sha256 = sha(readFileSync(path.join(dir, imagePath)));
    save(dir, receiptPath, receipt);
    assert.throws(() => load(dir), /carrier_article_image_binding_unauthenticated_image_inputs:/);
  }));
  test(`${slug}: non-image article binding cannot borrow the six-field exclusion`, () => fixture(dir => {
    const data = json(dir, 'data/blog/content-batch.json');
    data.articles.find(a => a.canonical_path === manifest.route).image_inputs = {};
    save(dir, 'data/blog/content-batch.json', data);
    assert.throws(() => load(dir), /carrier_article_metadata_drift:data\/blog\/content-batch.json/);
  }));
}
test('all 75 other image records retain whole-record hashing (positive controls and forbidden projections)', () => fixture(dir => {
  const template = json(dir, 'data/carrier-articles/ezra-glp-1-reviews/manifest.json');
  const records = json(dir, imagePath).records.filter(r => !slugs.some(s => r.route === `/guides/${s}/`));
  assert.equal(records.length, 75);
  for (const record of records) {
    const manifest = {...template, route: record.route, files: [], bindings: [{path: imagePath, key: 'records', identity: 'route', sha256: digest(record)}]};
    const manifestPath = 'other-carrier.json';
    save(dir, manifestPath, manifest);
    const load = () => loadCarrierArticle(dir, manifestPath, sha(readFileSync(path.join(dir, manifestPath))));
    assert.doesNotThrow(load, `${record.route}: full-record positive control`);
    manifest.bindings[0].sha256 = digest(Object.fromEntries(Object.entries(record).filter(([k]) => !keys.includes(k))));
    save(dir, manifestPath, manifest);
    assert.throws(load, /carrier_article_metadata_drift/, `${record.route}: exclusion forbidden`);
  }
}));
test('historical comparison keeps the original whole-record contract; current build cannot downgrade to it', () => fixture(dir => {
  // Reconstruct only a historical fixture from the authenticated preimage.
  // No producer, current input rebinding or stored predecessor edits occur.
  copyFileSync(path.join(dir, beforePath), path.join(dir, imagePath));
  assert.equal(retention.loadHistoricalCarrierArticles(dir).size, 2);
  assert.throws(() => loadCarrierArticles(dir), /carrier_article_image_binding_unauthenticated/);
  for (const slug of slugs) {
    for (const key of keys) {
      const old = json(dir, beforePath);
      old.records.find(r => r.route === `/guides/${slug}/`)[key] = key === 'inputs_stale' ? false : {};
      save(dir, imagePath, old);
      assert.throws(() => retention.loadHistoricalCarrierArticles(dir), /carrier_article_metadata_drift/);
    }
  }
}));
test('historical comparison cannot accept the current six-field projection', () => fixture(dir => {
  assert.throws(() => retention.loadHistoricalCarrierArticles(dir), /carrier_article_metadata_drift/);
}));
test('even a matching route cannot obtain the exemption under a different carrier authority/path', () => fixture(dir => {
  const manifest = json(dir, 'data/carrier-articles/ezra-glp-1-reviews/manifest.json');
  save(dir, 'other-carrier.json', manifest);
  assert.throws(() => loadCarrierArticle(dir, 'other-carrier.json', sha(readFileSync(path.join(dir, 'other-carrier.json')))), /carrier_article_metadata_drift/);
}));
