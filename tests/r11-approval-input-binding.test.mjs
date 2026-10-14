import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Execute only the native test's maintained approval-input expressions, not its
// private report reader, paid-page output assertions or any production writer.
const source = readFileSync(new URL('./funnel-v2-instrumentation.test.mjs', import.meta.url), 'utf8');
const start = source.indexOf('test("operator-approved R11 paid /lp/ routes order eligible source-backed EPC and disclose it last", () => {');
const body = source.indexOf('\n', start);
const end = source.indexOf('  assert.equal(decision.id,', body);
assert.ok(start >= 0 && body > start && end > body, 'maintained R11 approval seam must exist');
const bind = new Function('ROOT', 'process', 'pathToFileURL', 'path', 'assert', 'requireText', source.slice(body, end));

test('R11 approval inputs bind the explicit private evidence root, not checkout ancestry', () => {
  const decision = 'ops/linear/approvals/OPERATOR-DECISION-20260918-paid-page-payout-order.json';
  const ruling = 'reports/ops/glp38-20260915/p19-rulings/R11-RESTORE.json';
  for (const [checkout, evidence] of [
    ['/workspace/repo/', '/private/evidence'],
    ['/home/operator/.worktrees/site/', '/private/evidence with spaces'],
  ]) {
    const reads = [];
    bind(pathToFileURL(checkout), { env: { GLP_PRIVATE_EVIDENCE_ROOT: evidence } }, pathToFileURL, path, assert,
      url => { reads.push(url.href); return '{}'; });
    assert.deepEqual(reads, [decision, ruling].map(relative => pathToFileURL(path.join(evidence, relative)).href));
  }
  for (const value of [undefined, '', 'relative/evidence']) {
    let reads = 0;
    assert.throws(() => bind(pathToFileURL('/workspace/repo/'), { env: { GLP_PRIVATE_EVIDENCE_ROOT: value } }, pathToFileURL, path, assert,
      () => { reads++; return '{}'; }), /GLP_PRIVATE_EVIDENCE_ROOT must be an absolute path/);
    assert.equal(reads, 0, 'missing/relative input must not read an inferred approval');
  }
});
