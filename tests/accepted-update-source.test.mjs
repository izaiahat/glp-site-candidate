import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAcceptedUpdates, objectSha } from '../src/accepted-update-source.mjs';
import * as updatesSource from '../src/accepted-update-source.mjs';
import { readFileSync } from 'node:fs';
import { validateKeywordOwnership } from '../src/blog-system.mjs';

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
  assert.equal(result.has_affiliate_cta,true);
  assert.equal(result.inline_ftc_disclosure,true);
  assert.equal(result.inline_ftc_disclosure_text,before.inline_ftc_disclosure_text);
  assert.equal('surface_taxonomy' in result,false);
  assert.equal('suppress_cta' in result,false);
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
  const updates = updatesSource.loadAcceptedUpdates(root);
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
