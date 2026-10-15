import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertCurrentAnalyticsCache } from './helpers/analytics-cache-contract.mjs';
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
  assertCurrentAnalyticsCache(headers, analytics, analytics, analytics);
  // A pervasive security-only rule is harmless; CSS/font cache rules above
  // must also remain accepted. Cloudflare combines all matching rules.
  assertCurrentAnalyticsCache(`${headers}\n/*\n  X-Content-Type-Options: nosniff\n`, analytics, analytics, analytics);
  // Real emitter output is the positive. Refuse stale/missing/duplicate rules,
  // immutable mutable aliases, non-immutable addressed assets and byte drift.
  for (const mutate of [
    text => text.replace('/assets/analytics.js\n  Cache-Control: no-store', '/assets/analytics.js\n  Cache-Control: public, max-age=31536000, immutable'),
    text => text.replace(currentUrl, '/assets/analytics.0000000000000000.js'),
    text => text.replace(`${currentUrl}\n  Cache-Control: public, max-age=31536000, immutable`, `${currentUrl}\n  Cache-Control: no-store`),
    text => text.replace('/assets/analytics.js\n  Cache-Control: no-store', ''),
    text => `${text}\n/assets/analytics.js\n  Cache-Control: no-store\n`,
    text => `${text}\n/assets/analytics*.js\n  Cache-Control: public, max-age=31536000, immutable\n`,
    // RV113's exact counterexample, plus the same overlap via Pages splats,
    // named path placeholders and host-qualified rules (not filename prefixes).
    ...['/assets/*', '/*', '/*.js', '/assets/:file', '/:directory/:file',
      'https://glpclinicscout.com/assets/*'].map(route =>
      text => `${text}\n${route}\n  Cache-Control: public, max-age=31536000, immutable\n`),
    text => `${text}\n/assets/*\n  ! Cache-Control\n`,
  ]) {
    const mutated = mutate(headers);
    assert.notEqual(mutated, headers, 'negative must mutate actual emitter output');
    assert.throws(() => assertCurrentAnalyticsCache(mutated, analytics, analytics, analytics), assert.AssertionError);
  }
  const tampered = Buffer.concat([analytics, Buffer.from('\n// tamper')]);
  assert.throws(() => assertCurrentAnalyticsCache(headers, analytics, tampered, analytics), assert.AssertionError);
  assert.throws(() => assertCurrentAnalyticsCache(headers, analytics, analytics, tampered), assert.AssertionError);
  assert.match(build, /await write\("assets\/analytics\.js", ANALYTICS_ASSET_SOURCE\)/);
  assert.match(build, /await write\(`assets\/\$\{ANALYTICS_ASSET_FILENAME\}`, ANALYTICS_ASSET_SOURCE\)/);
});

test('historical product-ready cache assertion remains exact on authenticated retained headers, never current authority', () => {
  const bytes = execFileSync('git', ['show', '59adaddfa6800c3cd87592ad88829a081a35e3c3:artifacts/build4-preservation/_headers'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), maxBuffer: 64 * 1024,
  });
  const authenticate = raw => {
    assert.equal(createHash('sha256').update(raw).digest('hex'), '74fbd1c7d10c9331138bb732207c58ffb70cbaeae31e601065a588f66163c587');
    return raw.toString('utf8');
  };
  const headers = authenticate(bytes);
  // Original five-asset assertion, unchanged; its cache policy belongs only to
  // this immutable generation, predating content-addressed analytics emission.
  for (const asset of ["/assets/site.css", "/assets/site-*.css", "/assets/site.js", "/assets/consent.js", "/assets/analytics.js"]) {
    assert.ok(headers.includes(`${asset}\n  Cache-Control: public, max-age=31536000, immutable`), asset);
  }
  assert.throws(() => authenticate(Buffer.concat([bytes, Buffer.from('\n# tamper')])), assert.AssertionError);
  assert.throws(() => assertCurrentAnalyticsCache(headers, analytics, analytics, analytics), assert.AssertionError);
});
