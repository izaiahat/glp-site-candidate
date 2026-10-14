import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Execute only the maintained decision-input block with a recording reader.
// No private approval contents, rendered output or motion authority are supplied.
const source = readFileSync(new URL('./pass2-late-audit-static-output.test.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  const privateRoot =') >= 0
  ? source.indexOf('  const privateRoot =') : source.indexOf('  const motionDecision =');
const end = source.indexOf('  assert.match(motionDecision,', start);
assert.ok(start >= 0 && end > start, 'maintained motion decision input must exist');
const bind = new Function('root', 'process', 'path', 'assert', 'readFile',
  'return (async () => {' + source.slice(start, end) + '\nreturn motionDecision; })();');

test('motion decision binds explicit private custody, never checkout ancestry', async () => {
  const relative = 'ops/linear/approvals/KAEL-DECISION-20260922-motion-mobile-contracts.md';
  for (const [checkout, evidence] of [
    ['/home/operator/.worktrees/site/', '/private/evidence'],
    ['/relocated/source/', '/private/evidence with spaces'],
  ]) {
    const reads = [];
    const result = await bind(checkout, {env:{GLP_PRIVATE_EVIDENCE_ROOT:evidence}}, path, assert,
      async (file, encoding) => { reads.push([file, encoding]); return 'recording-only bytes'; });
    assert.deepEqual(reads, [[path.join(evidence, relative), 'utf8']]);
    assert.equal(result, 'recording-only bytes');
  }
  for (const value of [undefined, '', '   ', 'relative/evidence']) {
    let reads = 0;
    await assert.rejects(bind('/relocated/source/', {env:{GLP_PRIVATE_EVIDENCE_ROOT:value}}, path, assert,
      async () => { reads++; return ''; }), /GLP_PRIVATE_EVIDENCE_ROOT must be an absolute path/);
    assert.equal(reads, 0, 'invalid custody refuses before any decision read');
  }
});
