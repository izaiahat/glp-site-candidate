import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCarrierArticle, loadCarrierArticles, loadHistoricalCarrierArticles } from '../src/carrier-article-retention.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = x => createHash('sha256').update(x).digest('hex');
const imagePath = 'artifacts/ultracode/article-image-manifest.json';
const oldReceipt = 'artifacts/ultracode/article-image-REBIND-abfcc41435f896df-7f3b9b7eca877071.json';
const receiptPath = 'artifacts/ultracode/article-image-REBIND-7f3b9b7eca877071-12aa0e7c539a090e.json';
const json = (dir, rel) => JSON.parse(readFileSync(path.join(dir, rel)));
const receipt = json(root, receiptPath);
const old = json(root, oldReceipt);
const preimages = [old, receipt].map(r => `artifacts/ultracode/article-image-manifest-before-${r.before_manifest_sha256}.json`);
const slugs = ['ezra-glp-1-reviews', 'top-rated-glp-1-providers'];
function fixture(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'glp234-successor-'));
  try {
    const files = new Set([imagePath, oldReceipt, receiptPath, ...preimages, ...receipt.after_source_files.map(s => s.path)]);
    for (const slug of slugs) {
      const p = `data/carrier-articles/${slug}/manifest.json`, m = json(root, p);
      for (const rel of [p, m.snapshot, ...m.files.map(f => f.path), ...m.bindings.map(b => b.path)]) files.add(rel);
    }
    for (const p of files) { mkdirSync(path.dirname(path.join(dir, p)), {recursive:true}); copyFileSync(path.join(root,p),path.join(dir,p)); }
    fn(dir);
  } finally { rmSync(dir, {recursive:true,force:true}); }
}
test('exact combined-source successor loads both carriers without accepting the WARN article for publication', () => fixture(dir => {
  assert.equal(loadCarrierArticles(dir).size, 2);
  assert.deepEqual(receipt.inputs_stale_routes, ['/guides/healthrx-vs-agelessrx/']);
  assert.equal(receipt.new_image_generation, 0);
  assert.equal(receipt.before_manifest_sha256, old.after_manifest_sha256);
  assert.deepEqual(receipt.before_source_files, old.after_source_files);
  assert.throws(() => loadHistoricalCarrierArticles(dir), /carrier_article_metadata_drift/);
}));
test('exact prior PR6 current contract remains independently usable without successor files', () => fixture(dir => {
  copyFileSync(path.join(dir, preimages[1]), path.join(dir, imagePath));
  for (const source of old.after_source_files) {
    const bytes = execFileSync('git', ['show', `e62afa5e91afe5338f5d364413c4f2d6cde77c85:${source.path}`], {cwd:root, maxBuffer:8*1024*1024});
    assert.equal(sha(bytes), source.sha256);
    writeFileSync(path.join(dir, source.path), bytes);
  }
  unlinkSync(path.join(dir, receiptPath));
  unlinkSync(path.join(dir, preimages[1]));
  assert.equal(loadCarrierArticles(dir).size, 2);
  assert.throws(() => loadHistoricalCarrierArticles(dir), /carrier_article_metadata_drift/);
}));
for (const slug of slugs) {
  const p = `data/carrier-articles/${slug}/manifest.json`, pin = sha(readFileSync(path.join(root,p)));
  const load = dir => loadCarrierArticle(dir,p,pin);
  for (const rel of [oldReceipt, receiptPath, ...preimages]) {
    test(`${slug}: successor still requires exact bytes of ${path.basename(rel)}`, () => fixture(dir => {
      writeFileSync(path.join(dir,rel), Buffer.concat([readFileSync(path.join(dir,rel)),Buffer.from(' ')]));
      assert.throws(() => load(dir), /carrier_article_image_binding_(receipt_drift|manifest_lineage|successor_)/);
    }));
    test(`${slug}: missing ${path.basename(rel)} never falls back`, () => fixture(dir => {
      unlinkSync(path.join(dir,rel));
      assert.throws(() => load(dir), /ENOENT/);
    }));
  }
  for (const source of receipt.after_source_files) test(`${slug}: unrelated whole-catalog drift at ${source.path} fails`, () => fixture(dir => {
    writeFileSync(path.join(dir,source.path), Buffer.concat([readFileSync(path.join(dir,source.path)), Buffer.from(' ')]));
    assert.throws(() => load(dir), /carrier_article_image_binding_current_source/);
  }));
  test(`${slug}: unregistered future manifest/receipt cannot extend the exact successor`, () => fixture(dir => {
    const m = json(dir,imagePath); m.unapproved_successor = true;
    writeFileSync(path.join(dir,imagePath),JSON.stringify(m));
    const r = json(dir,receiptPath); r.after_manifest_sha256 = sha(readFileSync(path.join(dir,imagePath)));
    writeFileSync(path.join(dir,receiptPath),JSON.stringify(r));
    assert.throws(() => load(dir), /carrier_article_image_binding_manifest_lineage/);
  }));
  test(`${slug}: prior manifest cannot borrow combined catalog or new receipt`, () => fixture(dir => {
    copyFileSync(path.join(dir,preimages[1]),path.join(dir,imagePath));
    assert.throws(() => load(dir), /carrier_article_image_binding_current_source/);
  }));
}
