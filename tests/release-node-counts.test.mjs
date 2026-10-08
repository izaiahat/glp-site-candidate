import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredNodeCounts, requiredNodeCountsPass } from '../scripts/ci-release-gate.mjs';
const log = (n,p=n,f=0,s=0) => `# tests ${n}\n# pass ${p}\n# fail ${f}\n# skipped ${s}\n`;
test('registered host bootstrap includes merged consent test without dropping coverage', () => {
 assert.equal(requiredNodeCounts['host-bootstrap'], 387);
 assert.equal(requiredNodeCountsPass('host-bootstrap',log(387)),true);
 for (const text of [log(386),log(388),log(387,386,1),log(387,386,0,1),'']) assert.equal(requiredNodeCountsPass('host-bootstrap',text),false);
});
test('registered material contracts require complete passing inventory', () => {
 assert.equal(requiredNodeCounts['material-contracts'],44);
 assert.equal(requiredNodeCountsPass('material-contracts',log(44)),true);
 assert.equal(requiredNodeCountsPass('material-contracts',log(44,43,1)),false);
});
