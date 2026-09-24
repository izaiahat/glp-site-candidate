import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('D2j parsed data-attribute gate has active positive and negative controls',()=>{
 const result=spawnSync('python3',['-B','tests/test_data_attribute_invariants.py'],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const source=readFileSync(new URL('../scripts/build-staging.mjs',import.meta.url),'utf8');
 assert.match(source,/execFileSync\('python3',[^\n]+validate-data-attributes\.py/);
});
test('D2j exact generated HTML has zero undefined/null/NaN data-attribute tokens',()=>{
 const result=spawnSync('python3',['-B','scripts/validate-data-attributes.py','--root','public'],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 const report=JSON.parse(result.stdout);assert.ok(report.html_files>0);assert.equal(report.invalid_tokens,0);
});
