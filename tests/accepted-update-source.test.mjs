import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAcceptedUpdates, objectSha } from '../src/accepted-update-source.mjs';

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
