import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAcceptedUpdates, objectSha } from '../src/accepted-update-source.mjs';
import * as updatesSource from '../src/accepted-update-source.mjs';
import { readFileSync } from 'node:fs';
import { validateKeywordOwnership, reviewBrief, renderBlogPost } from '../src/blog-system.mjs';
import { buildSchemaGraph } from '../src/schema.mjs';
import path from 'node:path';

test('replacement keeps identity and provider/risk guards, not a second article', () => {
  const before = {article_id:'a', canonical_path:'/guides/a/', risk_tier:'HIGH', suppress_cta:true, sections:[{heading:'Old'}]};
  const after = {...before, sections:[{heading:'New answer'}]};
  const proof = {article:after, before_sha256:objectSha(before)};
  assert.deepEqual(applyAcceptedUpdates([before], [proof]), [after]);
  assert.throws(() => applyAcceptedUpdates([before], [{...proof, before_sha256:'0'.repeat(64)}]), /predecessor/);
  assert.throws(() => applyAcceptedUpdates([before], [{...proof, article:{...after, risk_tier:'LOW'}}]), /governance/);
  assert.throws(() => applyAcceptedUpdates([], [proof]), /identity/);
});

const neutral = before => ({...before, surface_taxonomy:'medical', suppress_cta:true,
  has_affiliate_cta:false, inline_ftc_disclosure:false, comparison_required:false,
  commercial_link_taxonomy:'medical_claims', exact_services:[], sections:[{heading:'New answer'}]});

test('neutral exact review projects only authenticated inactive legacy governance', () => {
  const before={article_id:'a',canonical_path:'/guides/a/',risk_tier:'MEDIUM',comparison_required:false,
    comparison_spec:null,has_affiliate_cta:true,inline_ftc_disclosure:true,inline_ftc_disclosure_text:'Original inactive disclosure'};
  const article=neutral(before);
  delete article.comparison_spec;
  delete article.inline_ftc_disclosure_text;
  const original=JSON.stringify(article);
  const [result]=applyAcceptedUpdates([before],[{article,before_sha256:objectSha(before)}]);
  assert.equal(result.has_affiliate_cta,false);
  assert.equal(result.inline_ftc_disclosure,true);
  assert.equal(result.inline_ftc_disclosure_text,before.inline_ftc_disclosure_text);
  assert.equal('surface_taxonomy' in result,false);
  assert.equal(result.suppress_cta,true);
  assert.equal(result.comparison_spec,null);
  assert.deepEqual(result.sections,article.sections);
  assert.equal(JSON.stringify(article),original);
  for (const invalid of [{...article,risk_tier:'LOW'}, {...article,exact_services:[{id:'new'}]},
    {...article,commercial_link_taxonomy:'affiliate'}, {...article,affiliate_link:'https://invalid.test/new'}]) {
    assert.throws(()=>applyAcceptedUpdates([before],[{article:invalid,before_sha256:objectSha(before)}]),/governance/);
  }
  const active={...before,affiliate_link:'https://invalid.test/old'};
  assert.throws(()=>applyAcceptedUpdates([active],[{article,before_sha256:objectSha(active)}]),/governance/);
});

test('authenticated shortage update replaces ownership keyword without changing frozen source or gates', () => {
  const root = new URL('../', import.meta.url).pathname;
  const read = rel => JSON.parse(readFileSync(new URL('../' + rel, import.meta.url)));
  const articles = read('data/blog/content-batch.json').articles;
  const owners = read('data/blog/keyword-ownership-map.json').entries;
  // Scope to updates whose predecessor lives in this catalog (the real build
  // passes every catalog, including accepted-guide additions).
  const updates = updatesSource.loadAcceptedUpdates(root).filter(u => articles.some(a => a.canonical_path === u.article.canonical_path));
  const original = JSON.stringify({articles, owners, updates});
  const projected = updatesSource.applyAcceptedUpdateOwnership(owners, articles, updates);
  const update = updates[0].article;
  const matches = projected.filter(x => x.url === update.canonical_path && x.primary_keyword === update.primary_keyword);
  assert.equal(matches.length, 1, `blog_article_owner_missing:${update.article_id}`);
  const before = owners.find(x => x.url === update.canonical_path);
  assert.deepEqual(matches[0], {...before, primary_keyword: update.primary_keyword});
  assert.equal(projected.length, owners.length);
  validateKeywordOwnership(projected);
  assert.equal(JSON.stringify({articles, owners, updates}), original);
  const wrongOwner = owners.map(x => x === before ? {...x, owner:'foreign'} : x);
  assert.throws(() => updatesSource.applyAcceptedUpdateOwnership(wrongOwner, articles, updates), /ownership/);
  assert.throws(() => updatesSource.applyAcceptedUpdateOwnership([...owners, before], articles, updates), /ownership/);
  assert.throws(() => updatesSource.applyAcceptedUpdateOwnership(owners, articles, [{...updates[0], before_sha256:'0'.repeat(64)}]), /predecessor/);
  const collision = [...projected, {...matches[0], url:'/guides/different/'}];
  assert.throws(() => validateKeywordOwnership(collision), /keyword/);
});

test('real neutral accepted update passes unchanged editorial gate without reviving an inactive CTA', () => {
  const articles = JSON.parse(readFileSync(new URL('../data/blog/content-batch.json', import.meta.url))).articles;
  const updates = updatesSource.loadAcceptedUpdates(new URL('../', import.meta.url).pathname).filter(u => articles.some(a => a.canonical_path === u.article.canonical_path));
  const article = applyAcceptedUpdates(articles, updates).find(a => a.article_id === updates[0].article.article_id);
  const author = {status:'verified_organization', clinical_credentials_claimed:false};
  assert.equal(reviewBrief(article, author).status, 'PASS');
  assert.equal(article.has_affiliate_cta, false);
  assert.equal(article.suppress_cta, true);
  assert.equal(reviewBrief({...article, has_affiliate_cta:true}, author).reason, 'editorial_affiliate_contract_incomplete');
});

test('accepted material update retains original publication date in rendered Article schema', () => {
  const articles = JSON.parse(readFileSync(new URL('../data/blog/content-batch.json', import.meta.url))).articles;
  const updates = updatesSource.loadAcceptedUpdates(new URL('../', import.meta.url).pathname).filter(u => articles.some(a => a.canonical_path === u.article.canonical_path));
  const article = applyAcceptedUpdates(articles, updates).find(a => a.article_id === updates[0].article.article_id);
  const author = {status:'verified_organization', clinical_credentials_claimed:false,
    entity_type:'Organization', display_name:'GLP Clinic Scout Editorial Team', bio_path:'/authors/clinic-scout-editorial-team/'};
  const html = renderBlogPost(article, null, author);
  assert.equal(article.title, 'GLP-1 Availability: FDA Status vs Local Stock (2026)');
  for (const heading of ['Restart an FDA search without guessing a product URL',
    'Keep national statements separate from the pharmacy answer',
    'A prescription and a stock check answer different questions']) {
    assert.ok(html.includes(heading), `reviewed shortage section missing: ${heading}`);
  }
  assert.match(html, /"datePublished":"2026-07-23"/);
  assert.match(html, /"dateModified":"2026-10-09"/);
  // Execute the actual final metadata writer without invoking main/build.
  // Only the unrelated optional hero-asset probe is substituted.
  const builder = readFileSync(new URL('../scripts/build-staging.mjs', import.meta.url), 'utf8');
  const start = builder.indexOf('function addGuideMetadata(');
  const end = builder.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start);
  const metadata = new Function('buildSchemaGraph','existsSync','path','ROOT','escHtml',
    `return (${builder.slice(start, end)});`)(buildSchemaGraph, () => false, path, '.', String);
  assert.match(metadata('<html><head></head><body></body></html>', article, author), /"datePublished":"2026-07-23"/);
});
