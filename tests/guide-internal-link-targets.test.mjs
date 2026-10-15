import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse as parseHtml} from 'parse5';
import {renderBlogPost} from '../src/blog-system.mjs';
import {upgradeInsightsArticle} from '../src/phase3-page-graph.mjs';
import {selectBuildArticles} from './helpers/article-selection-seam.mjs';

const root = new URL('../', import.meta.url);
const read = relative => JSON.parse(readFileSync(new URL(relative, root), 'utf8'));
const build = readFileSync(new URL('scripts/build-staging.mjs', root), 'utf8');
const oldRoute = '/guides/glp-1-rx-online/';
const target = '/guides/how-to-get-glp-1-prescription-online/';

function finalGuideLinks(html, routes) {
  const start = build.indexOf('function resolveGuideInternalAnchors(');
  const end = build.indexOf('\nfunction addGuideFunnel(', start);
  const helper = start < 0 ? '' : build.slice(start, end);
  const loop = build.slice(build.indexOf('  for (const article of allArticles) {'));
  const statement = loop.match(/    const rendered = [^\n]+;/)?.[0];
  assert(statement, 'actual final article rendering statement is required');
  return vm.runInNewContext(`${helper}\n${statement}\nrendered`, {
    articleGraph: html, article: {canonical_path: '/guides/gobymeds-discount-code/'},
    acceptedGuides: [], publishedGuideRoutes: new Set(routes), parseHtml,
    addSharedRuntime: value => value,
    addAcceptedInboundLinks: value => value,
  });
}

test('accepted guide pipeline resolves all three declared prescribing links without changing accepted source', () => {
  const article = read('data/blog/accepted-guides/gobymeds-discount-code/article.json');
  const targetArticle = read('data/blog/content-batch.json').articles.find(row => row.canonical_path === target);
  assert(targetArticle, 'the canonical prescribing guide is a maintained publication input');
  assert.match(targetArticle.title, /prescription online/i);
  const before = JSON.stringify(article);
  const author = read('data/blog/author-registry.json').authors.find(a => a.author_id === 'clinic-scout-editorial-team');
  const html = upgradeInsightsArticle(renderBlogPost(article, null, {...author, id: author.author_id}, []), {...article, author}, []);
  assert.equal(html.split(`href="${oldRoute}"`).length - 1, 3);
  const selected = selectBuildArticles(build, root.pathname, read('data/blog/content-batch.json'), read('data/blog/content-national-wow-additions.json').articles);
  const routes = selected.map(row => row.canonical_path);
  assert(routes.includes(target));
  assert(!routes.includes(oldRoute));
  const result = finalGuideLinks(html, routes);
  assert.equal(result, html.replaceAll(`href="${oldRoute}"`, `href="${target}"`));
  assert.equal(JSON.stringify(article), before);
});

test('guide link resolution never invents a missing destination or overwrites a published route', () => {
  const html = `<a href="${oldRoute}">Declared label</a><a href="https://outside.invalid${oldRoute}">External</a><a href="/go/held?s=starter.pc1&amp;v=a">GO</a><a data-href="${oldRoute}" href="/unchanged/">Data attribute</a><script>const sample = '<a href="${oldRoute}">not DOM</a>';</script><!-- <a href="${oldRoute}">comment</a> -->`;
  assert.throws(() => finalGuideLinks(html, []), /guide_internal_target_unpublished/);
  assert.equal(finalGuideLinks(html, [oldRoute, target]), html);
  assert.equal(finalGuideLinks(html, [target]), html.replace(`href="${oldRoute}"`, `href="${target}"`));
});
