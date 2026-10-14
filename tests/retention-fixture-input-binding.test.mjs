import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';

// Execute the maintained fixture's setup, not the pricing oracle. The recorder
// performs no reads/writes and cannot authenticate a deployed receipt or price.
test('R2 retention tamper fixture binds current source dependencies without linking mutable S30 packets', () => {
  const source = readFileSync(new URL('./d2w-release2-price-state.test.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("  const historical=path.join(temp,'data/predecessors/");
  const end = source.indexOf('  assert.doesNotThrow(()=>validateAttestedRetention(temp,matrix,baseline));', start);
  assert.ok(start > 0 && end > start, 'maintained fixture setup boundaries missing');
  const calls = [];
  const fs = Object.fromEntries(['mkdirSync','copyFileSync','cpSync','symlinkSync'].map(name => [name, (...args) => calls.push([name,...args])]));
  const root = '/source checkout';
  const temp = '/isolated scratch fixture/candidates/fixture';
  const baselinePath = '/authenticated baseline binding';
  const matrix = {};
  const validate = actual => { assert.equal(actual, matrix); return {baseline_matrix_path:baselinePath}; };
  new Function('fs','path','root','temp','validate','matrix', source.slice(start,end))(fs,path,root,temp,validate,matrix);

  const dependencyPaths = ['data/program-registry.json','data/price-refresh-ledger.json','data/affiliate-activation-selection.json','data/pricing-evidence'];
  assert.deepEqual(calls.filter(([name]) => name === 'symlinkSync'), dependencyPaths.map(relative => ['symlinkSync',path.join(root,relative),path.join(temp,relative)]));
  assert.deepEqual(calls.filter(([name]) => name === 'copyFileSync'), [
    ['copyFileSync',baselinePath,path.join(temp,'data/predecessors/glp-price-index-weekly-20260910t190246z/provider-pricing-matrix.json')],
    ['copyFileSync',path.join(root,'data/price-state-retention.json'),path.join(temp,'data/price-state-retention.json')],
    ['copyFileSync',path.join(root,'data/price-state-retention-v3.json'),path.join(temp,'data/price-state-retention-v3.json')],
  ]);
  assert.deepEqual(calls.filter(([name]) => name === 'cpSync'), [
    ['cpSync',path.join(root,'data/price-state-evidence'),path.join(temp,'data/price-state-evidence'),{recursive:true}],
  ], 'the directory containing the tamper target must remain a distinct copy');
  assert.ok(source.slice(end).includes("fs.writeFileSync(path.join(temp,contract.bindings[0].packet_path),'{}');\n  assert.throws(()=>validateAttestedRetention(temp,matrix,baseline),/source_hash/);"), 'native tamper/refusal sequence must remain intact');
});
