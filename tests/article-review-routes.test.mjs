import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { addP1ContentUpgradeSurface } from '../src/wave2-p1-surfaces.mjs';
import { resolveContentUpgradeTemplate } from '../src/content-upgrade.mjs';

// Execute the actual maintained metadata function without launching a full build.
const source = readFileSync(new URL('../scripts/build-staging.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function addGuideMetadata(');
const fn = source.slice(start, source.indexOf('\n}\n', start) + 3);
function metadata(route) {
  const context = { existsSync: () => false, path: {join: (...x) => x.join('/')}, ROOT: '.', escHtml: x => x,
    buildSchemaGraph: x => ({jsonLd: x}) };
  vm.createContext(context); vm.runInContext(fn, context);
  return context.addGuideMetadata('<html><head></head><body><main></main></body></html>', {
    article_id: 'fixture', canonical_path: route, title: 'Reported provider information', h1: 'Source review', updated_at: '2026-10-07', sources: []
  }, {});
}
test('provider-review article routes render canonical metadata and a live parent breadcrumb', () => {
  const html = metadata('/reviews/example-provider-cost/');
  assert.match(html, /https:\/\/glpclinicscout.com\/reviews\/example-provider-cost\//);
  assert.match(html, /"name":"Reviews","path":"\/reviews\/"/);
});
test('cost/tools, nested and unsafe routes remain rejected', () => {
  for (const route of ['/cost/example/', '/tools/example/', '/reviews/a/b/', '/reviews/../', '/reviews/a?b/'])
    assert.throws(() => metadata(route), /article_canonical_path_invalid/);
});
test('review articles use editorial styles while provider profiles keep review styles', () => {
  const begin = source.indexOf('function addSharedRuntime(html) {');
  const end = source.indexOf('  const editorialHero =', begin);
  const context = {}; vm.createContext(context);
  vm.runInContext(source.slice(begin, end) + 'return {stylesheet, template};}', context);
  const article = context.addSharedRuntime(metadata('/reviews/example-provider-cost/'));
  assert.equal(article.stylesheet, 'site-editorial.css');
  assert.equal(article.template, 'guide');
  const profile = context.addSharedRuntime('<link rel="canonical" href="https://glpclinicscout.com/reviews/example-provider/">');
  assert.equal(profile.stylesheet, 'site-review.css');
  assert.equal(profile.template, 'review');
});

test('review articles cannot replace provider profiles or duplicate catalog routes', async () => {
  const { assertArticleReviewRoutes } = await import('../src/article-review-routes.mjs');
  const article = {canonical_path: '/reviews/provider-a/'};
  assert.throws(() => assertArticleReviewRoutes([article], ['/reviews/provider-a/']), /article_review_route_collision/);
  assert.throws(() => assertArticleReviewRoutes([article, article], []), /article_review_route_collision/);
  assert.throws(() => assertArticleReviewRoutes([{canonical_path: '/reviews/submit/'}], []), /article_review_route_collision/);
  assert.doesNotThrow(() => assertArticleReviewRoutes([{canonical_path: '/reviews/provider-a-cost/'}], ['/reviews/provider-a/']));
  const call = source.match(/assertArticleReviewRoutes\(allArticles, \[[\s\S]*?\n  \]\);/)[0];
  assert.throws(() => vm.runInNewContext(call, {assertArticleReviewRoutes,
    allArticles:[article], reader:{providerReviews:[]}, ready6Editorial:{pages:[{route:article.canonical_path}]},
    READY6_LEGACY_REDIRECTS:[], RETIRED_PROGRAM_ROUTES:[]}), /article_review_route_collision/);
});

test('review capture promises a deliverable the resolver actually supports', () => {
  // Deliverable contract on an already approved capture identity. A synthetic
  // new article route must not acquire marketing consent from directory scope.
  const html = addP1ContentUpgradeSurface(metadata('/reviews/gobymeds/'));
  assert.match(html, /Email me the checklist/);
  assert.doesNotMatch(html, /Email me the source-checked guide/);
  const key = html.match(/name="lead_magnet_key" value="([^"]+)"/)[1];
  assert.equal(resolveContentUpgradeTemplate(key).templateKey, 'terms-checklist');
});
