import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`:JSON.stringify(value);
export const COIVAS_RESEARCH_PRICE_BINDING=Object.freeze({path:'/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/D2w/RELEASE-1/CONTINUATION-1/COIVAS/INTEGRATION.json',sha256:'2862d82812d945907d052bd9d966a816774ce30fd2077cafb342a7528b88ed95'});
const scopes={ledger:{file:'program-content-ledger.json',id:'coivas',before:'e7c21807e9546e90c6680e693ffdc83425b14b5370556d8af21a4b6535aa74d9',fields:['research_cancellation','research_consultation_fee','research_first_month_price','research_legitscript','research_pharmacy_type','research_shipping_wait','research_states_served']},registry:{file:'program-registry.json',id:'awin-128761',before:'6a7a8f5fc6bbd2d651927d56b4c440d829a7bfe9fb2dd3de1910066c996f4600',fields:['research_dynamic_profile']}};
// PRICE-ONLY reconstruction of a witnessed historical input, never research
// rollback or authority promotion. The caller's complete frozen oracle remains
// mandatory: no generic field or provider ignore, no date rewrite on disk.
export function projectCoivasResearchPriceBasis(input,kind,readBytes=readFileSync){
 const scope=scopes[kind];if(!scope)throw Error('price_coivas_kind_invalid');
 const read=ref=>{let b;try{b=readBytes(ref.path);}catch{throw Error('price_coivas_receipt_unreadable');}if(sha(b)!==ref.sha256)throw Error('price_coivas_receipt_hash_mismatch');return JSON.parse(b);};
 const descriptor=read({path:new URL('../data/coivas-research-price-basis.json',import.meta.url),sha256:'6eacd6515df3b650d1e5970413b57287a0439f727943f03b0cacc8d3de6108df'});
 if(canonical(descriptor.integration)!==canonical(COIVAS_RESEARCH_PRICE_BINDING))throw Error('price_coivas_descriptor_invalid');
 const receipt=read(COIVAS_RESEARCH_PRICE_BINDING);
 if(receipt.status!=='PASS_OWNER_MERGE_ADOPTED'||receipt.full_build!==false||receipt.public_generated!==false)throw Error('price_coivas_receipt_authority_invalid');
 const admission=read(receipt.admission);
 const merger=read({path:COIVAS_RESEARCH_PRICE_BINDING.path.replace('INTEGRATION.json','MERGE-RUN.json'),sha256:'23211484e8971d84a241fafe3bc6a560af60702a3ef8b7aef348bddd9c332ed9'});
 // Non-JSON owner/log bytes are still authenticated, without pretending that
 // their transport success alone validates the successor's whole semantics.
 for(const ref of [merger.owner,merger.stdout,merger.stderr]){let bytes;try{bytes=readBytes(ref.path);}catch{throw Error('price_coivas_receipt_unreadable');}if(sha(bytes)!==ref.sha256)throw Error('price_coivas_receipt_hash_mismatch');}
 if(merger.returncode!==0)throw Error('price_coivas_merge_not_pass');
 for(const k of ['authority','slug_readback','producer_readback','packet','capture_index','validation'])read(admission[k]);
 if(admission.status!=='PASS_VALIDATED_PACKET_AND_EXACT_CAS'||admission.q57_terminal_required!==false)throw Error('price_coivas_admission_invalid');
 const entries=receipt.changes.filter(r=>r.program_id===scope.id&&r.target.endsWith('/data/'+scope.file));
 if(entries.length!==1||entries[0].before_sha256!==scope.before||canonical(Object.keys(entries[0].changes).sort())!==canonical(scope.fields))throw Error('price_coivas_scope_invalid');
 const entry=entries[0],before=read({path:COIVAS_RESEARCH_PRICE_BINDING.path.replace('INTEGRATION.json','BEFORE-'+scope.file),sha256:scope.before});
 const oldRows=before.programs.filter(r=>r.program_id===scope.id);if(oldRows.length!==1)throw Error('price_coivas_identity_invalid');
 const result=structuredClone(input),rows=result.programs.filter(r=>r.program_id===scope.id);if(rows.length!==1)throw Error('price_coivas_identity_invalid');
 const row=rows[0],old=oldRows[0];
 const isHistorical=scope.fields.every(key=>{const d=entry.changes[key];return Object.hasOwn(row,key)===d.before_present&&(!d.before_present||canonical(row[key])===canonical(d.before));});
 const isSuccessor=scope.fields.every(key=>Object.hasOwn(row,key)&&canonical(row[key])===canonical(entry.changes[key].after));
 if(!isSuccessor&&!(kind==='registry'&&isHistorical))throw Error('price_coivas_research_drift');
 for(const key of scope.fields){
  const delta=entry.changes[key];
  if(Object.hasOwn(old,key)!==delta.before_present||(delta.before_present&&canonical(old[key])!==canonical(delta.before)))throw Error('price_coivas_before_drift');
  // An exact historical input is valid too; partial or unknown field values
  // are not. Original caller oracle still rejects unrelated changes anywhere.
  const historical=Object.hasOwn(row,key)===delta.before_present&&(!delta.before_present||canonical(row[key])===canonical(delta.before));
  if(!historical&&(!Object.hasOwn(row,key)||canonical(row[key])!==canonical(delta.after)))throw Error('price_coivas_research_drift');
  if(delta.before_present)row[key]=structuredClone(delta.before);else delete row[key];
 }
 return result;
}
