import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCarrierArticle, loadCarrierArticles, assertCarrierArticleBytes, renderedCarrierArticle, assertCarrierArticleOutput } from '../src/carrier-article-retention.mjs';
import { candidateExportShellFindings } from '../src/candidate-export-policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'data/carrier-articles/ezra-glp-1-reviews/manifest.json';
const manifest = JSON.parse(readFileSync(path.join(root, manifestPath)));
test('both current live articles retain exact bytes and disabled export shells', () => {
  const articles = loadCarrierArticles(root);
  assert.equal(articles.size, 2);
  for (const retained of articles.values()) {
    assert.deepEqual(candidateExportShellFindings(retained.bytes.toString(), {stage:'candidate'}), []);
    assert.ok(candidateExportShellFindings(retained.bytes.toString(), {stage:'production-seal'}).length > 0);
    assert.throws(() => assertCarrierArticleBytes(retained, Buffer.concat([retained.bytes, Buffer.from('changed')])), /carrier_article_output_drift/);
  }
});
test('production seal re-seals only the consent shells of both pinned articles', () => {
  for (const retained of loadCarrierArticles(root).values()) {
    const original = retained.bytes.toString();
    const rendered = renderedCarrierArticle(retained, 'production-seal');
    const html = rendered.toString();
    assert.deepEqual(candidateExportShellFindings(html, {stage:'production-seal'}), []);
    assert.equal(html.match(/<main\b[\s\S]*?<\/main>/)?.[0], original.match(/<main\b[\s\S]*?<\/main>/)?.[0]);
    assertCarrierArticleOutput(retained, rendered, 'production-seal');
    assert.throws(() => assertCarrierArticleOutput(retained, Buffer.concat([rendered, Buffer.from('changed')]), 'production-seal'), /carrier_article_output_drift/);
    assertCarrierArticleBytes(retained, retained.bytes);
  }
});
function fixture(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'd2s-carrier-'));
  try {
    // The mandatory registered rebind proof is an input too, not a mocked pass.
    const rebindPath = 'artifacts/ultracode/article-image-REBIND-abfcc41435f896df-7f3b9b7eca877071.json';
    const rebind = JSON.parse(readFileSync(path.join(root, rebindPath)));
    const preimagePath = `artifacts/ultracode/article-image-manifest-before-${rebind.before_manifest_sha256}.json`;
    const successorFiles = [
      'artifacts/ultracode/article-image-REBIND-7f3b9b7eca877071-12aa0e7c539a090e.json',
      'artifacts/ultracode/article-image-manifest-before-7f3b9b7eca877071039a48caeedcf9fb7778478f38956976300a4f35560f8663.json',
    ];
    for (const rel of new Set([manifestPath, manifest.snapshot, ...manifest.files.map(x => x.path), ...manifest.bindings.map(x => x.path), rebindPath, preimagePath, ...successorFiles, ...rebind.after_source_files.map(x => x.path)])) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      copyFileSync(path.join(root, rel), path.join(dir, rel));
      // A sealed input is read-only. Only the independent temporary fixture
      // copy must be writable to exercise the actual tamper rejection.
      chmodSync(path.join(dir, rel), 0o600);
    }
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('exact carrier HTML and metadata are source-bound', () => fixture(dir => {
  const retained = loadCarrierArticle(dir);
  assert.equal(retained.manifest.route, '/guides/ezra-glp-1-reviews/');
  assert.equal(retained.bytes.length, 80305);
  assertCarrierArticleBytes(retained, retained.bytes);
  assert.throws(() => assertCarrierArticleBytes(retained, Buffer.from('rewritten')), /carrier_article_output_drift/);
}));
for (const rel of [manifestPath, manifest.snapshot, manifest.files[0].path, 'data/blog/content-batch.json']) {
  test(`tamper rejected: ${rel}`, () => fixture(dir => {
    const p = path.join(dir, rel);
    if (rel === 'data/blog/content-batch.json') {
      const data = JSON.parse(readFileSync(p));
      data.articles.find(a => a.canonical_path === manifest.route).h1 = 'unapproved rewrite';
      writeFileSync(p, JSON.stringify(data));
    } else writeFileSync(p, 'tampered');
    assert.throws(() => loadCarrierArticle(dir), /carrier_article_/);
  }));
}
