import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadAcceptedGuides} from '../src/accepted-guide-source.mjs';
import {loadAcceptedUpdates, applyAcceptedUpdates} from '../src/accepted-update-source.mjs';
import {reviewBrief} from '../src/blog-system.mjs';
import {selectBuildArticles} from './helpers/article-selection-seam.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const json = name => JSON.parse(read(name));

// Genuine committed catalog and accepted-source loaders; no public artifacts,
// private registry, replacement admission policy, or build execution.
test('maintained article-selection seam binds accepted additions, updates and national content without changing held admission', () => {
  const build = read('scripts/build-staging.mjs');
  const blogBatch = json('data/blog/content-batch.json');
  const nationalArticles = json('data/blog/content-national-wow-additions.json').articles;
  const before = structuredClone({blogBatch, nationalArticles});
  const additions = loadAcceptedGuides(root);
  const updates = loadAcceptedUpdates(root);
  assert.ok(additions.length > 0 && updates.length > 0 && nationalArticles.length > 0);
  const selected = selectBuildArticles(build, root, blogBatch, nationalArticles);
  const routes = selected.map(article => article.canonical_path);
  assert.equal(routes.includes('/guides/healthrx-vs-agelessrx/'), false);
  const acceptedRoutes = new Set([...additions, ...updates.map(update => update.article)].map(article => article.canonical_path));
  const expectedAccepted = applyAcceptedUpdates([...blogBatch.articles, ...nationalArticles, ...additions], updates)
    .filter(article => acceptedRoutes.has(article.canonical_path));
  assert.equal(expectedAccepted.length, acceptedRoutes.size, 'accepted replacements supersede, never duplicate additions');
  for (const article of expectedAccepted) {
    const matches = selected.filter(row => row.canonical_path === article.canonical_path);
    assert.equal(matches.length, 1, article.canonical_path);
    assert.equal(matches[0].article_id, article.article_id);
    assert.equal(matches[0].operator_release_receipt, article.operator_release_receipt);
    assert.deepEqual(JSON.parse(JSON.stringify(matches[0].sections)), article.sections.map(section => ({...section, heading: section.heading || section.h2})));
  }
  for (const article of nationalArticles) {
    assert.ok(routes.includes(article.canonical_path), article.canonical_path);
  }
  const held = blogBatch.articles.find(article => article.canonical_path === '/guides/healthrx-vs-agelessrx/');
  const unreviewed = {...held, article_id: 'unreviewed-negative', canonical_path: '/guides/unreviewed-negative/'};
  const negative = selectBuildArticles(build, root, {...blogBatch, articles: [...blogBatch.articles, unreviewed]}, nationalArticles);
  assert.ok(negative.some(article => article.article_id === unreviewed.article_id));
  assert.deepEqual(reviewBrief(unreviewed, held.author), {status: 'HELD', reason: 'evidence_review_receipt_missing'});
  assert.match(build, /if \(articleReview.status !== "PASS"\) throw new Error\(`blog_article_gate:/);
  // The seam must call the real update guard: stale predecessors and forged
  // accepted input cannot become selected articles just because the VM runs.
  const updateRoute = updates[0].article.canonical_path;
  const tampered = structuredClone(blogBatch);
  const target = tampered.articles.find(article => article.canonical_path === updateRoute);
  assert.ok(target, 'accepted update has a genuine base-catalog predecessor');
  target.title += ' unauthenticated change';
  assert.throws(() => selectBuildArticles(build, root, tampered, nationalArticles), /accepted_update_predecessor_changed/);
  const forged = structuredClone(updates);
  forged[0].before_sha256 = '0'.repeat(64);
  assert.throws(() => applyAcceptedUpdates([...blogBatch.articles, ...nationalArticles, ...additions], forged), /accepted_update_predecessor_changed/);
  assert.deepEqual({blogBatch, nationalArticles}, before);
});
