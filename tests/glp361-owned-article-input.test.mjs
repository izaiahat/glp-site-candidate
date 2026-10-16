import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedArticles } from './fixtures/owned-phase3-articles.mjs';
import { upgradeInsightsArticle } from '../src/phase3-page-graph.mjs';

// This is a synthetic commercial-card template, not an accepted guide packet.
test('GLP361 card fixture declares commercial scope while unknown, medical and suppressed guides stay contextual-only', () => {
  const [article, ...related] = ownedArticles(5);
  assert.equal(article.surface_taxonomy, 'commercial');
  assert.equal(new Set([article, ...related].map(a => a.canonical_path)).size, 5);
  const frame = '<main><section class="guide-hero"><h1>Fixture</h1></section></main>';
  const cards = html => (html.match(/data-wrap-card/g) || []).length;
  assert.equal(cards(upgradeInsightsArticle(frame, article, related)), 3);
  const {surface_taxonomy, ...unknown} = article;
  for (const subject of [unknown, {...article, surface_taxonomy:'medical'}, {...article, suppress_cta:true}]) {
    const out = upgradeInsightsArticle(frame, subject, related);
    assert.equal(cards(out), 0);
    assert.doesNotMatch(out, /Clinic Scout owned guide [2-5]|Source-checked owned description [2-5]/);
    const link = {path:'/guides/contextual-owned/',label:'Declared contextual source'};
    const contextual = upgradeInsightsArticle(frame, {...subject, internal_links:[link]}, related);
    assert.match(contextual, /href="\/guides\/contextual-owned\/">Declared contextual source<\/a>/);
    assert.equal(cards(contextual), 0);
  }
});
