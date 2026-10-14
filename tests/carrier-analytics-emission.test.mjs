import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderedCarrierArticle, assertCarrierArticleOutput } from '../src/carrier-article-retention.mjs';
import { candidateExportShellFindings } from '../src/candidate-export-policy.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url));
const analytics = read('assets/analytics.js');
const filename = `analytics.${createHash('sha256').update(analytics).digest('hex').slice(0, 16)}.js`;
const currentUrl = `/assets/${filename}`;
const scriptSource = /(<script\b[^>]*\bsrc=")\/assets\/analytics(?:\.[a-f0-9]{16})?\.js(?:\?v=[a-f0-9]{16})?("[^>]*>)/g;

for (const slug of ['ezra-glp-1-reviews', 'top-rated-glp-1-providers']) {
  test(`${slug}: real carrier emitter binds one analytics load to current raw asset in both stages`, () => {
    // Frozen registered snapshots, not generated public files or synthetic HTML.
    // The full loader's metadata/image pins remain covered by the owning retention tests.
    const manifest = JSON.parse(read(`data/carrier-articles/${slug}/manifest.json`));
    const bytes = read(manifest.snapshot);
    const retained = { manifest, bytes };
    const original = bytes.toString();
    assert.equal([...original.matchAll(scriptSource)].length, 1);
    const candidate = renderedCarrierArticle(retained, 'candidate').toString();
    assert.equal([...candidate.matchAll(scriptSource)].length, 1);
    assert.equal([...candidate.matchAll(scriptSource)][0][0].includes(currentUrl), true,
      'emitted analytics ref must resolve to current content-addressed bytes, not absent d73 asset');
    // Compare ALL bytes outside this one src, including prose, clinical evidence,
    // schema, dates, prices, consent ordering/attributes, and disabled export shells.
    const mask = html => html.replace(scriptSource, '$1CURRENT_ANALYTICS$2');
    assert.equal(mask(candidate), mask(original));
    assert.deepEqual(candidateExportShellFindings(candidate, { stage: 'candidate' }), []);
    const sealed = renderedCarrierArticle(retained, 'production-seal').toString();
    assert.equal([...sealed.matchAll(scriptSource)][0][0].includes(currentUrl), true);
    assert.deepEqual(candidateExportShellFindings(sealed, { stage: 'production-seal' }), []);
    assert.equal(sealed.match(/<main\b[\s\S]*?<\/main>/)?.[0], original.match(/<main\b[\s\S]*?<\/main>/)?.[0]);
    assertCarrierArticleOutput(retained, Buffer.from(candidate), 'candidate');
    assertCarrierArticleOutput(retained, Buffer.from(sealed), 'production-seal');
    assert.throws(() => assertCarrierArticleOutput(retained, bytes, 'candidate'), /carrier_article_output_drift/);
    assert.throws(() => assertCarrierArticleOutput(retained, Buffer.from(candidate.replace(currentUrl, '/assets/analytics.0000000000000000.js')), 'candidate'), /carrier_article_output_drift/);
    assert.throws(() => renderedCarrierArticle({ manifest, bytes: Buffer.concat([bytes, Buffer.from('tamper')]) }, 'candidate'), /carrier_article_output_drift/);
  });
}

test('real header emitter: bare analytics alias is non-cacheable; content-addressed asset remains immutable', () => {
  const build = read('scripts/build-staging.mjs').toString();
  // Exercise only the actual standalone header declaration, never the build/gate.
  const declaration = build.match(/  const assetCacheHeaders = [\s\S]*?;\n(?=  const networkVerificationHeaders)/)?.[0];
  assert.ok(declaration, 'owning header declaration must remain testable');
  const headers = vm.runInNewContext(`${declaration}\nassetCacheHeaders;`, { ANALYTICS_ASSET_FILENAME: filename });
  const block = route => headers.split(`${route}\n`)[1]?.split(/\n(?=\/|#)/)[0].trim();
  assert.equal(block('/assets/analytics.js'), 'Cache-Control: no-store');
  assert.equal(block(currentUrl), 'Cache-Control: public, max-age=31536000, immutable');
  assert.equal(block('/assets/site-*.css'), 'Cache-Control: public, max-age=31536000, immutable');
  assert.equal(block('/assets/fonts/*'), 'Cache-Control: public, max-age=31536000, immutable');
  assert.match(build, /await write\("assets\/analytics\.js", ANALYTICS_ASSET_SOURCE\)/);
  assert.match(build, /await write\(`assets\/\$\{ANALYTICS_ASSET_FILENAME\}`, ANALYTICS_ASSET_SOURCE\)/);
});
