import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderBlogPost, reviewBrief, acceptedRenderContract, renderContractProse, plainContractText } from '../src/blog-system.mjs';
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
    subheadings: [{ heading: 'How the receptor mechanism and blood-sugar evidence differ', before_paragraph: 1, order: 2 }],
    tables: [{ headers: ['Product', 'What the label establishes'], rows: [['Wegovy tablets', 'Indicated. **Page 3.** [S15]']], after_paragraph: 1, order: 1 }] }];
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

test('render contract dates: Updated=dateModified, prices=pricesCheckedDate only', () => {
  const a = fixture();
  a.updated_at = '2026-10-13'; a.prices_checked_date = '2026-10-09'; a.source_checked_through = '2026-10-09';
  a.sources = a.sources.map((s, i) => ({ ...s, verified_as_of: i ? '2026-10-13' : '2026-10-09' }));
  const html = renderBlogPost(a, null, author, []);
  assert.match(html, /· Updated 2026-10-13</);
  assert.doesNotMatch(html, /Prices checked <span data-prices-checked-date>[^<]*–/);
  if (/data-prices-checked-date/.test(html)) assert.match(html, /data-prices-checked-date>2026-10-09</);
});

test('real reviewed oral GLP-1 successor update applies over the accepted addition and renders the contract', async () => {
  const { loadAcceptedUpdates, applyAcceptedUpdates } = await import('../src/accepted-update-source.mjs');
  const additions = loadAcceptedGuides(root);
  const updates = loadAcceptedUpdates(root).filter((u) => u.article.canonical_path === '/guides/how-to-get-oral-glp-1/');
  assert.equal(updates.length, 1);
  const article = applyAcceptedUpdates(additions, updates).find((a) => a.canonical_path === '/guides/how-to-get-oral-glp-1/');
  assert.equal(article.render_contract.schema, 'glp-accepted-guide-render-v1');
  assert.equal(reviewBrief(article, author).status, 'PASS');
  const html = renderBlogPost(article, null, author, []);
  assert.match(html, /data-release="release-ready"/);
  assert.doesNotMatch(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''), /\[S\d+\]|\*\*|facts-to-compare/);
  assert.match(html, /<nav class="guide-toc" data-render-contract="automatic-sections"/);
  assert.equal((html.match(/<h3 id="section-/g) || []).length, 4);
  assert.match(html, /<meta name="description" content="Learn how to get oral GLP-1 medicines with five checks/);
  assert.doesNotMatch(html, /captured competitor/i);
});

test('postbuild AEO citation-label pass relabels render-contract source-id ledger rows (no "Open source" anchors)', async () => {
  const { newState, remediatePage } = await import('../scripts/codemod-aeo-citation-schema.mjs');
  const article = fixture();
  const html = upgradeInsightsArticle(renderBlogPost(article, null, author, []), article, []);
  assert.ok(html.includes('<li id="guide-source-s4">') && html.includes('>Open source</a>'), 'renderer emits source-id rows with the generic anchor');
  const state = newState();
  const out = remediatePage(html, state);
  assert.equal(out.includes('>Open source<'), false);
  assert.equal(state.citationAnchors, 3);
  assert.ok(out.includes('>Novo Nordisk — published page, 2026-10</a>'));
  assert.ok(out.includes('>Novo Nordisk — PDF document, 2026-10</a>'));
  assert.ok(out.includes('<strong><span class="guide-source-id">S4</span> Novo Nordisk</strong>'), 'visible source-id chip unchanged');
  // Legacy numeric rows keep their previous behaviour.
  const legacy = '<li id="guide-source-1"><strong>FDA</strong><span>x</span><a href="https://www.fda.gov/a" rel="nofollow noopener" data-citation="guide_source_ledger">Open source</a><small>Checked 2026-09-01</small></li>';
  assert.ok(remediatePage(legacy, newState()).includes('>FDA — regulatory document, 2026-09</a>'));
});

const render = (brief) => upgradeInsightsArticle(renderBlogPost(brief, null, author, []), { ...brief, author }, []);

test('CR-04: unknown or misplaced [S#] tokens fail closed across every published contract field', () => {
  const cases = [
    [(b) => { b.sections[0].heading = 'Check 1 [S99]'; }, /citation_outside_slot:.*sections\[0\]\.heading/],
    [(b) => { b.sections[0].heading = ''; b.sections[0].h2 = 'Claim [S99]'; }, /citation_outside_slot:.*sections\[0\]\.h2/],
    [(b) => { b.sections[0].heading = ''; delete b.sections[0].h2; }, /heading_empty:.*sections\[0\]/],
    [(b) => { b.sections[0].subheadings[0].heading = 'Mechanism [S99]'; }, /citation_outside_slot:.*subheadings\[0\]\.heading/],
    [(b) => { b.sections[0].subheadings[0].heading = 'Mechanism [S15]'; }, /citation_outside_slot/],
    [(b) => { b.faqs[0].q = 'Same? [S99]'; }, /citation_outside_slot:.*faqs\[0\]\.q/],
    [(b) => { b.h1 = `${b.h1} [S15]`; }, /citation_outside_slot:.*:h1:/],
    [(b) => { b.sources[0].publisher = 'Novo Nordisk [S99]'; }, /citation_outside_slot:.*sources\[0\]\.publisher/],
    [(b) => { b.medical_advice_disclaimer = 'Not advice. [S99]'; }, /citation_outside_slot:.*medical_advice_disclaimer/],
    [(b) => { b.internal_links = [{ label: 'More [S99]', path: '/guides/' }]; }, /citation_outside_slot:.*internal_links\[0\]\.label/],
    [(b) => { b.claims[0].statement = 'Unbacked statement. [S99]'; }, /citation_unmapped:.*claims\[0\]\.statement:S99/],
    [(b) => { b.claims[0].source_ids = ['S15', 'S99']; }, /citation_unmapped:.*source_ids:S99/],
    [(b) => { b.faqs[0].a = 'No. [S99]'; }, /citation_unmapped:.*faqs\[0\]\.a/],
    [(b) => { b.sections[0].tables[0].rows[0][1] = 'x [S99]'; }, /citation_unmapped:.*tables\[0\]/],
    [(b) => { b.direct_answer = 'Start. [S99]'; }, /citation_unmapped:.*direct_answer/],
  ];
  for (const [mutate, expected] of cases) {
    const brief = fixture(); mutate(brief);
    assert.throws(() => render(brief), expected);
  }
  // A known token in a claim is still stripped from the plain projection, never an unknown one.
  assert.equal(plainContractText('Known. [S15]', fixture()), 'Known.');
  assert.throws(() => plainContractText('Unknown. [S99]', fixture()), /citation_unmapped/);
  assert.doesNotThrow(() => render(fixture()));
});

function orderedBrief(blocks) {
  const brief = fixture();
  brief.sections = [{ heading: 'Check 1', paragraphs: ['Intro prose. [S15]', 'Second prose. [S4]'], bullets: [], ordered_items: [], ...blocks }];
  return brief;
}
const table = { headers: ['Product', 'What the label establishes'], rows: [['Wegovy tablets', 'Indicated. [S15]']], after_paragraph: 1 };

test('CR-05: a table authored before an H3 renders before it; a table authored under an H3 renders under it', () => {
  const before = render(orderedBrief({ tables: [{ ...table, order: 1 }], subheadings: [{ heading: 'Sub heading', before_paragraph: 1, order: 2 }] }));
  assert.ok(before.indexOf('<table') < before.indexOf('>Sub heading</h3>'));
  assert.ok(before.indexOf('>Sub heading</h3>') < before.indexOf('Second prose.'));
  const after = render(orderedBrief({ tables: [{ ...table, order: 2 }], subheadings: [{ heading: 'Sub heading', before_paragraph: 1, order: 1 }] }));
  assert.ok(after.indexOf('>Sub heading</h3>') < after.indexOf('<table'));
  assert.ok(after.indexOf('<table') < after.indexOf('Second prose.'));
});

test('CR-05: missing, duplicate or offset-inconsistent block order fails closed', () => {
  for (const blocks of [
    { tables: [{ ...table }], subheadings: [{ heading: 'Sub', before_paragraph: 1, order: 2 }] },
    { tables: [{ ...table, order: 1 }], subheadings: [{ heading: 'Sub', before_paragraph: 1, order: 1 }] },
    { tables: [{ ...table, order: 0 }], subheadings: [{ heading: 'Sub', before_paragraph: 1, order: 2 }] },
    { tables: [{ ...table, after_paragraph: 2, order: 1 }], subheadings: [{ heading: 'Sub', before_paragraph: 1, order: 2 }] },
  ]) assert.throws(() => render(orderedBrief(blocks)), /structure_order_invalid/);
});
