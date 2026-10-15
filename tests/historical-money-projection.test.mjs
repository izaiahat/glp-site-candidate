import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalMoneyContext } from './fixtures/historical-money-projection.mjs';

// Keep the complete authentic original callback, including its exact four raw
// target identities, one-pause partition and ten selected-member assertions.
function callback(values) {
  const title = 'money programs render approved GLP-1 anchors and withhold network-unapproved rows';
  const start = values.source.indexOf(`test(${JSON.stringify(title)},`), end = values.source.indexOf('\ntest(', start + 1);
  const declarations = values.source.slice(values.source.indexOf('const NETWORK_HOSTS ='), values.source.indexOf('\ntest('));
  assert.ok(start > 0 && end > start && declarations.startsWith('const NETWORK_HOSTS'));
  const inputs = {...values, assert, selectedIds:new Set(values.selection.programs.map(p => p.program_id))};
  let run;
  new Function('test', ...Object.keys(inputs), declarations + '\n' + values.source.slice(start,end))((_title, body) => {run=body;}, ...Object.values(inputs));
  return run;
}

test('historical money oracle retains authentic raw Shed alias and ten-member one-pause generation without granting current authority', async () => {
  const values = await historicalMoneyContext();
  callback(values)();
  for (const mutate of [
    v => {v.money.pages.forEach(p => {p.rows=p.rows.filter(r => r.program_id !== 'shed');});},
    v => {v.promotion['try-ageless'].status='VERIFIED';},
    v => {v.money.pages.forEach(p => {p.rows=p.rows.filter(r => r.program_id !== 'enhance-md');});},
  ]) {
    const changed = {...values, money:structuredClone(values.money), promotion:structuredClone(values.promotion)};
    mutate(changed);
    assert.throws(() => callback(changed)(), error => error.name === 'AssertionError' || error.message === 'comparison_row_count_invalid');
  }
});
