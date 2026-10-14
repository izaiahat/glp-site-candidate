import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectBuildArticles} from './helpers/article-selection-seam.mjs';
import {reviewBrief} from '../src/blog-system.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const route = '/guides/healthrx-vs-agelessrx/';

test('GLP-234 existing consolidated-route exclusion keeps the held article out of a successful build and every public link', () => {
  const blogBatch = json('data/blog/content-batch.json');
  const nationalArticles = json('data/blog/content-national-wow-additions.json').articles;
  const held = blogBatch.articles.find(article => article.canonical_path === route);
  assert.equal(held.article_id, 'phase2-batch2-low-healthrx-vs-agelessrx-20260723');
  assert.equal(held.status, 'HELD_SOURCE_REVIEW_IDENTITY_CORRECTION');
  assert.equal(held.evidence_review.status, 'STALE_AFTER_IDENTITY_CORRECTION_REVIEW_REQUIRED');
  assert.deepEqual(reviewBrief(held, held.author), {status: 'HELD', reason: 'evidence_review_receipt_missing'});

  // Execute the maintained catalog-selection seam, not a second test-only filter.
  const build = read('scripts/build-staging.mjs');
  const selected = selectBuildArticles(build, root, blogBatch, nationalArticles);
  assert.equal(selected.some(article => article.canonical_path === route), false);
  // A new, non-consolidated article with a missing receipt is NOT silently dropped.
  const unreviewed = {...held, article_id: 'unreviewed-negative', canonical_path: '/guides/unreviewed-negative/'};
  const negative = selectBuildArticles(build, root, {...blogBatch, articles: [...blogBatch.articles, unreviewed]}, nationalArticles);
  assert.ok(negative.some(article => article.article_id === unreviewed.article_id));
  assert.deepEqual(reviewBrief(unreviewed, held.author), {status: 'HELD', reason: 'evidence_review_receipt_missing'});
  assert.match(build, /if \(articleReview.status !== "PASS"\) throw new Error\(`blog_article_gate:/);

  const report = json('artifacts/ops/build-report.json');
  assert.equal(report.status, 'PASS_PRODUCT_READY_PROVIDER_DEPLOY_HELD');
  assert.equal(existsSync(join(root, 'public', route, 'index.html')), false);
  let checked = 0;
  function walk(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(html|json|xml)$/.test(entry.name)) {
        checked++;
        assert.equal(readFileSync(file, 'utf8').includes(route), false, file);
      }
    }
  }
  walk(join(root, 'public'));
  assert.ok(checked > 100, 'a complete public artifact must be scanned');
  assert.ok(existsSync(join(root, 'public/providers/index.html')), 'existing replacement destination must exist');
  assert.match(read('public/_redirects'), /^\/guides\/healthrx-vs-agelessrx\/ \/providers\/ 301$/m);
});
