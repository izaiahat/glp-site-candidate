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
