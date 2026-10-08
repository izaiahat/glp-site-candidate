import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredNodeCounts, requiredNodeCountsPass } from '../scripts/ci-release-gate.mjs';
const log = (n,p=n,f=0,s=0) => `# tests ${n}\n# pass ${p}\n# fail ${f}\n# skipped ${s}\n`;
test('registered host bootstrap includes the real ended-Pallas raw-hold case', () => {
 assert.equal(requiredNodeCounts['host-bootstrap'], 388);
 assert.equal(requiredNodeCountsPass('host-bootstrap',log(388)),true);
 for (const text of [log(387),log(389),log(388,387,1),log(388,387,0,1),'']) assert.equal(requiredNodeCountsPass('host-bootstrap',text),false);
});
test('registered material contracts require complete passing inventory', () => {
 assert.equal(requiredNodeCounts['material-contracts'],44);
 assert.equal(requiredNodeCountsPass('material-contracts',log(44)),true);
 assert.equal(requiredNodeCountsPass('material-contracts',log(44,43,1)),false);
});
