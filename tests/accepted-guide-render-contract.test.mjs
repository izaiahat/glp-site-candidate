import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderBlogPost, acceptedRenderContract, renderContractProse, plainContractText } from '../src/blog-system.mjs';
import { upgradeInsightsArticle } from '../src/phase3-page-graph.mjs';
import { loadAcceptedGuides } from '../src/accepted-guide-source.mjs';

const root = new URL('../', import.meta.url).pathname;
const author = JSON.parse(readFileSync(path.join(root, 'data/blog/author-registry.json'))).authors.find((a) => a.author_id === 'clinic-scout-editorial-team');
author.id = author.author_id;
const CONTRACT = { schema: 'glp-accepted-guide-render-v1', subheadings: 'h3', toc: 'automatic-sections', inline_emphasis: true, citations: 'source-id', facts_recap: false };

function fixture() {
  const base = structuredClone(loadAcceptedGuides(root).find((a) => a.canonical_path === '/guides/how-to-get-oral-glp-1/'));
  base.render_contract = CONTRACT;
  base.meta_description = 'Learn how to get oral GLP-1 medicines with five checks: exact label, clinician evaluation, coverage or self-pay, pharmacy handoff and daily-use follow-up.';
  base.sources = [{ source_id: 'S4', publisher: 'Novo Nordisk', url: 'https://www.wegovy.com/obesity/how-to-get-wegovy.html', source_class: 'primary', verified_as_of: '2026-10-09', claim_ids: ['C1'] },
    { source_id: 'S10', publisher: 'Novo Nordisk', url: 'https://cdn.clinicaltrials.gov/large-docs/17/NCT05564117/Prot_000.pdf', source_class: 'primary', verified_as_of: '2026-10-09', claim_ids: [] },
    { source_id: 'S15', publisher: 'Novo Nordisk', url: 'https://www.novo-pi.com/wegovy.pdf', source_class: 'primary', verified_as_of: '2026-10-13', claim_ids: ['C1'] }];
  base.claims = [{ claim_id: 'C1', statement: '| Wegovy tablets | **Label.** Indicated text. [S15][S4] |', source_ids: ['S15', 'S4'] }];
  base.sections = [{ heading: 'Check 1', paragraphs: ['Intro **bold** text. [S15]', 'Mechanism prose. [S4]'], bullets: [], ordered_items: [],
    subheadings: [{ heading: 'How the receptor mechanism and blood-sugar evidence differ', before_paragraph: 1 }],
    tables: [{ headers: ['Product', 'What the label establishes'], rows: [['Wegovy tablets', 'Indicated. **Page 3.** [S15]']], after_paragraph: 1 }] }];
  base.faqs = [{ q: 'Same?', a: 'No. **Section 1.** [S15][S4]' }];
  base.direct_answer = 'Start with a clinician and confirm the exact product. [S15][S4]';
  base.word_count = 1600; // outside accepted long-form equality is irrelevant to rendering
  return base;
}

test('render contract: H3, TOC, emphasis, S-id citations, no 3-column recap', () => {
  const brief = fixture();
  const html = upgradeInsightsArticle(renderBlogPost(brief, null, author, []), { ...brief, author }, []);
  const body = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  assert.match(body, /<h3 id="section-1-check-1-how-the-receptor-mechanism-and-blood-sugar-evidence-differ">How the receptor mechanism and blood-sugar evidence differ<\/h3>/);
  assert.ok(body.indexOf('<h3 id="section-1-check-1-how') < body.indexOf('Mechanism prose.'));
  assert.match(body, /<nav class="guide-toc" data-render-contract="automatic-sections"[^>]*>[\s\S]*href="#section-1-check-1"/);
  assert.doesNotMatch(body, /\*\*|\[S\d+\]/);
  assert.match(body, /<strong>bold<\/strong>/);
  assert.match(body, /<a href="#guide-source-s15" aria-label="Source S15">S15<\/a>/);
  assert.match(body, /<li id="guide-source-s15"><strong><span class="guide-source-id">S15<\/span>/);
  assert.ok(body.indexOf('id="guide-source-s4"') < body.indexOf('id="guide-source-s10"'));
  assert.doesNotMatch(body, /facts-to-compare|<th scope="col">Question<\/th>/);
  for (const table of body.match(/<table[\s\S]*?<\/table>/g)) assert.equal((table.match(/<th scope="col"/g) || []).length, 2);
  assert.match(html, /<meta name="description" content="Learn how to get oral GLP-1 medicines with five checks/);
});

test('render contract fails closed on unknown citation, bad contract or bad structure', () => {
  const brief = fixture();
  assert.throws(() => renderContractProse('x [S99]', brief), /citation_unmapped/);
  assert.throws(() => acceptedRenderContract({ ...brief, render_contract: { ...CONTRACT, facts_recap: true } }), /render_contract_invalid/);
  const bad = fixture(); bad.sections[0].subheadings[0].before_paragraph = 9;
  assert.throws(() => renderBlogPost(bad, null, author, []), /structure_invalid/);
  assert.equal(plainContractText('> **Quick:** a [S1][S2]'), 'Quick: a');
});

test('legacy accepted guides without render_contract keep their previous output shape', () => {
  for (const a of loadAcceptedGuides(root)) {
    assert.equal(a.render_contract, undefined);
    const html = renderBlogPost(a, null, author, []);
    assert.doesNotMatch(html, /data-render-contract=/);
  }
});
