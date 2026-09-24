import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
test('fresh build derives tracking hosts before source loads and rechecks after rendering',()=>{
 const text=readFileSync(path.join(root,'scripts/build-staging.mjs'),'utf8');
 const main=text.slice(text.indexOf('async function main()'));
 const generate=main.indexOf("'scripts/emit-tracking-allowed-hosts.py'), '--root', ROOT]");
 assert.ok(generate>=0 && generate<main.indexOf('await readJson('));
 assert.ok(main.includes("'scripts/emit-tracking-allowed-hosts.py'), '--root', ROOT, '--check']"));
 assert.ok(main.indexOf('resetTrackingAllowedHostsCache()')>generate);
});
test('real emitter detects stale bytes, regenerates, and excludes authentic held Telos',()=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'s9-tracking-'));const out=path.join(tmp,'tracking.json');
 const run=args=>spawnSync('python3',['-B','scripts/emit-tracking-allowed-hosts.py','--root',root,'--output',out,...args],{encoding:'utf8'});
 try{
  writeFileSync(out,'{}\n');assert.equal(run(['--check']).status,1);
  const emitted=run([]);assert.equal(emitted.status,0,emitted.stderr);assert.equal(run(['--check']).status,0);
  const doc=JSON.parse(readFileSync(out));assert.equal(doc.program_count,Object.keys(doc.programs).length);
  assert.equal(doc.programs['telos-rx'],undefined);assert.equal(doc.programs['telos-rx-review'],undefined);
  doc.programs['telos-rx']={allowed_hosts:['track.revoffers.com']};writeFileSync(out,JSON.stringify(doc));
  assert.equal(run(['--check']).status,1,'held host reinsertion must fail');
 }finally{rmSync(tmp,{recursive:true,force:true});}
});
