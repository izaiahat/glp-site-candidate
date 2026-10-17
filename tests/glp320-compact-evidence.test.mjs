import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAcceptedGuides } from '../src/accepted-guide-source.mjs';
import { renderBlogPost } from '../src/blog-system.mjs';

const root = new URL('../', import.meta.url).pathname;
const author = JSON.parse(readFileSync(new URL('../data/blog/author-registry.json', import.meta.url))).authors.find(a => a.author_id === 'clinic-scout-editorial-team');
author.id = author.author_id;
const contract = { schema: 'glp-accepted-guide-render-v1', subheadings: 'h3', toc: 'automatic-sections', inline_emphasis: true, citations: 'source-id', facts_recap: false };
function fixture() {
  const article = structuredClone(loadAcceptedGuides(root).find(a => a.canonical_path === '/guides/glp-1-savings-cards-and-patient-assistance/'));
  article.render_contract = contract;
  article.direct_answer = 'A neutral test summary. [S1]';
  article.sections = [{ heading: 'Source-bound example', paragraphs: ['The authored statement appears once. [S1]'], tables: [] }];
  article.claims = [{ claim_id: 'C1', statement: 'The authored statement appears once. [S1]', source_ids: ['S1'] }];
  article.sources = [{ source_id: 'S1', publisher: 'CMS', url: 'https://www.cms.gov/', verified_as_of: '2026-10-09', source_class: 'primary', claim_ids: ['C1'] }];
  article.faqs = [];
  return article;
}

test('GLP320 D-01: contract public evidence is compact; full audit map stays in the input', () => {
  const article = fixture();
  const before = JSON.stringify(article);
  const html = renderBlogPost(article, null, author, []);
  assert.equal((html.match(/The authored statement appears once\./g) || []).length, 1, 'no claim appendix or source-row duplication');
  assert.doesNotMatch(html, /claim-evidence|claim-to-source map|Supports:/);
  assert.match(html, /<li id="guide-source-s1"><strong><span class="guide-source-id">S1<\/span> CMS<\/strong>/);
  assert.match(html, /href="https:\/\/www.cms.gov\/"/);
  assert.match(html, /Checked 2026-10-09/);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `dangling jump link ${m[1]}`);
  assert.equal(JSON.stringify(article), before, 'detailed evidence remains unchanged');
  const bad = structuredClone(article);
  bad.claims[0].source_ids = ['S999'];
  assert.throws(() => renderBlogPost(bad, null, author, []), /accepted_guide_citation_unmapped/,
    'hiding the public claim appendix must not weaken its evidence refusal');
});

test('GLP320 D-01: non-contract evidence keeps the legacy audit projection', () => {
  const article = fixture(); delete article.render_contract;
  const html = renderBlogPost(article, null, author, []);
  assert.match(html, /claim-evidence/);
  assert.match(html, /Supports:/);
  assert.match(html, /id="verified-claims"/);
});

const editorialCss = readFileSync(new URL('../assets/css-src/40-editorial.css', import.meta.url), 'utf8');
function editorialBlock(selector) {
  const start = editorialCss.indexOf(selector + ' {');
  assert.notEqual(start, -1, `missing ${selector}`);
  return editorialCss.slice(start, editorialCss.indexOf('}', start) + 1);
}

test('GLP320 repair: mobile paper rows own readable citation and popup tokens', () => {
  const row = editorialBlock('main.guide-shell :is(.table-scroll, .table-wrap):has(td[data-label]) tr');
  for (const declaration of ['--color-evidence: #0c6e51', '--color-surface-float: #ffffff', '--color-mist-100: rgba(20, 32, 27, 0.05)', '--color-accent-soft: #deeee5']) assert.ok(row.includes(declaration), declaration);
});

test('GLP320 repair: chips style only the trigger, not the popup source link', () => {
  assert.doesNotMatch(editorialCss, /main\.guide-shell sup\.inline-citation a(?=[\s:{])/);
  assert.match(editorialBlock('main.guide-shell sup.inline-citation > a'), /min-block-size: 44px/);
});

test('GLP320 repair: editorial bundle owns popup layout and readable line height', () => {
  assert.match(editorialBlock('main.guide-shell .cite-host'), /position: relative/);
  const pop = editorialBlock('main.guide-shell .cite-pop');
  for (const declaration of ['position: absolute', 'display: grid', 'line-height: 1.5', 'white-space: normal', 'background: var(--color-surface-float)']) assert.ok(pop.includes(declaration), declaration);
  assert.match(editorialBlock('main.guide-shell .cite-pop[hidden]'), /display: none/);
  for (const part of ['label', 'name', 'supports', 'date', 'link', 'close']) editorialBlock('main.guide-shell .cite-pop-' + part);
});
