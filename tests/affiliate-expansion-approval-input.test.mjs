import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Compile only the maintained native approval-input prelude. The recording
// reader never opens private approvals, produces site output or grants custody.
const source = readFileSync(new URL('./affiliate-expansion-13.test.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const privateRoot =') >= 0
  ? source.indexOf('const privateRoot =') : source.indexOf('const operatorDecision =');
const end = source.indexOf('const selectedIds =', start);
assert.ok(start >= 0 && end > start, 'maintained affiliate approval input must exist');
const bind = new Function('moduleUrl', 'process', 'path', 'pathToFileURL', 'assert', 'readFile',
  'return (async () => {' + source.slice(start, end).replaceAll('import.meta.url', 'moduleUrl') + '\nreturn operatorDecision; })();');

test('affiliate expansion approval binds explicit private custody, never checkout ancestry', async () => {
  const relative = 'ops/linear/approvals/OPERATOR-DECISION-20260924-all-approved-providers-live.md';
  for (const [checkout, evidence] of [
    ['/home/operator/.worktrees/site/', '/private/evidence'],
    ['/relocated/source/', '/private/evidence with spaces'],
  ]) {
    // Resolve the unchanged maintained new URL calls exactly as in that module.
    const moduleUrl = pathToFileURL(path.join(checkout, 'tests/affiliate-expansion-13.test.mjs'));
    const reads = [];
    const result = await bind(moduleUrl, {env:{GLP_PRIVATE_EVIDENCE_ROOT:evidence}}, path, pathToFileURL, assert,
      async (url, encoding) => { reads.push([url.href, encoding]); return 'recording-only approval bytes'; });
    assert.deepEqual(reads, [[pathToFileURL(path.join(evidence, relative)).href, 'utf8']]);
    assert.equal(result, 'recording-only approval bytes');
  }
  for (const value of [undefined, '', 'relative/evidence']) {
    let reads = 0;
    await assert.rejects(bind(pathToFileURL('/relocated/source/tests/affiliate-expansion-13.test.mjs'), {env:{GLP_PRIVATE_EVIDENCE_ROOT:value}}, path, pathToFileURL, assert,
      async () => { reads++; return ''; }), /GLP_PRIVATE_EVIDENCE_ROOT must be an absolute path/);
    assert.equal(reads, 0, 'missing/relative custody refuses before any approval read');
  }
});
