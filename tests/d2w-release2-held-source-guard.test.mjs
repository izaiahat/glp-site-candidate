import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('../scripts/reconcile-source-surface-membership.mjs',import.meta.url);
function fixture(mode){
 const root=mkdtempSync(path.join(tmpdir(),'r2-held-guard-'));
 for(const d of ['src','scripts','data'])mkdirSync(path.join(root,d));
 copyFileSync(script,path.join(root,'scripts/reconcile-source-surface-membership.mjs'));
 writeFileSync(path.join(root,'src/program-registry.mjs'),`export const projectMoneyPagesFromRegistry=(r,p,pages)=>pages.map(x=>({...x,rows:r.removeMoney?[]:x.rows}));export const projectQuizFromRegistry=(r,p,q)=>({...q,candidates:r.removeQuiz?[]:q.candidates});`);
 const write=(name,x)=>writeFileSync(path.join(root,'data',name),JSON.stringify(x,null,2)+'\n');
 write('program-registry.json',{programs:[{program_id:'held-network',review_slug:'held-render',commercial_state:'held'}],removeMoney:mode.includes('money'),removeQuiz:mode.includes('quiz')});
 write('money-page-specs.json',{pages:[{path:'/compare/',rows:[{program_id:'held-render',note:'receipted dark row'}]}]});
 write('quiz-config.json',{candidates:[{program_id:'held-network',note:'receipted dark row'}]});
 return root;
}
for(const mode of ['money','quiz','money-quiz'])for(const check of [false,true])test(`refuses ${mode} removal before either write (check=${check})`,()=>{
 const root=fixture(mode),names=['money-page-specs.json','quiz-config.json'];
 try{
  const before=names.map(n=>readFileSync(path.join(root,'data',n)));
  const result=spawnSync(process.execPath,[path.join(root,'scripts/reconcile-source-surface-membership.mjs'),...(check?['--check']:[])],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/receipted_held_source_row_removal_refused/);
  names.forEach((n,i)=>assert.deepEqual(readFileSync(path.join(root,'data',n)),before[i]));
 }finally{rmSync(root,{recursive:true});}
});
test('legitimate source-only --check passes without mutation',()=>{
 const root=fixture('none');try{
  const names=['money-page-specs.json','quiz-config.json'],before=names.map(n=>readFileSync(path.join(root,'data',n)));
  const result=spawnSync(process.execPath,[path.join(root,'scripts/reconcile-source-surface-membership.mjs'),'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'PASS_CHECKED');
  names.forEach((n,i)=>assert.deepEqual(readFileSync(path.join(root,'data',n)),before[i]));
 }finally{rmSync(root,{recursive:true});}
});
