#!/usr/bin/env node
// Source-only materialization through the same projection owners as the build.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {projectMoneyPagesFromRegistry,projectQuizFromRegistry} from '../src/program-registry.mjs';
const root=new URL('../',import.meta.url),read=async f=>JSON.parse(await readFile(new URL('data/'+f,root),'utf8'));
const [registry,money,quiz]=await Promise.all(['program-registry.json','money-page-specs.json','quiz-config.json'].map(read));
const pages=projectMoneyPagesFromRegistry(registry,'glp-clinic-scout',money.pages);
const projectedQuiz=projectQuizFromRegistry(registry,'glp-clinic-scout',quiz);
const removedMoney=money.pages.flatMap((p,i)=>p.rows.filter(r=>!pages[i].rows.some(x=>x.program_id===r.program_id)).map(r=>({route:p.path,program_id:r.program_id})));
const removedQuiz=quiz.candidates.filter(r=>!projectedQuiz.candidates.some(x=>x.program_id===r.program_id)).map(r=>r.program_id);
// Refuse destructive source reconciliation before either output is written.
// A held source row is evidence custody, not a member of the live projection.
// Protect both registry IDs and their already-declared render slugs; never
// invent a new alias or infer activation authority from a projection result.
const heldIds=new Set(registry.programs.filter(p=>p.commercial_state==='held').flatMap(p=>[p.program_id,p.review_slug].filter(Boolean)));
const heldMoneyRemovals=removedMoney.filter(r=>heldIds.has(r.program_id));
const heldQuizRemovals=removedQuiz.filter(id=>heldIds.has(id));
if(heldMoneyRemovals.length || heldQuizRemovals.length)throw Error('receipted_held_source_row_removal_refused:'+JSON.stringify({money:heldMoneyRemovals,quiz:heldQuizRemovals}));
const outputs={'money-page-specs.json':{...money,pages},'quiz-config.json':projectedQuiz};
const check=process.argv.includes('--check');
for(const [name,value] of Object.entries(outputs)){
 const target=new URL('data/'+name,root),text=JSON.stringify(value,null,2)+'\n';
 if(check){if(await readFile(target,'utf8')!==text)throw Error('source_surface_projection_stale:'+name);}
 else await writeFile(target,text);
}
console.log(JSON.stringify({status:check?'PASS_CHECKED':'PASS_OWNER_PROJECTED_SOURCE_ONLY',root:fileURLToPath(root),removed_money:removedMoney,removed_quiz:removedQuiz,quiz_candidates:projectedQuiz.candidates.length,money_pages:pages.length,public_generated:false}));
