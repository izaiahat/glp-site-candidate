import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
const sha=b=>createHash('sha256').update(b).digest('hex');
const descriptor='b2e9629aa08210dc9db91797733b838ffbd7d92a8a52ebef2bbe94b796dedd48';
// Exact Care source-only successor: independently reviewed data at 74d4c6b
// (review sha256 46214dae14f320eaf3f3e51dc1db408311060ddc556d86926c3d6449d19b50c6),
// coordinator grant sha256 4c16c5924ad1ed4aaa515f3dc6ed0ca608e79e35ed18377caa181d33c5fc30c2.
// Neither receipt authorizes a new historical pin or a different-field projection.
const careCurrent='e298a9d9a81313d8b05536c903776dbca24511463f80b265d486b5a14c80fd72';
const careParent='88f1ec3e3d8c543e64caaa83ef5baab517e410cd180ee54ca2263eb2b1bbc95d';
const careId='care-bare-rx-glp1-review';
const careBefore='Semaglutide and tirzepatide; injectable and oral options are described, including compounded options and Mounjaro by name';
const careAfter='Semaglutide and tirzepatide; injectable and oral options are described, including compounded options';
export function s32CareCurrentToParent(bytes){
 if(sha(bytes)!==careCurrent)throw Error('s32_care_current_drift');
 const current=JSON.parse(bytes);
 const rows=current.programs.filter(row=>row.program_id===careId);
 if(rows.length!==1||rows[0].meds_offered!==careAfter)throw Error('s32_care_identity_or_field_drift');
 // Reverse the sole JSON string span in the authenticated complete document.
 // The predecessor SHA authenticates the entire restored byte stream, including
 // order, whitespace, prices and all fields outside this one Care leaf.
 const text=bytes.toString('utf8'),after=JSON.stringify(careAfter),before=JSON.stringify(careBefore);
 if(text.split(after).length!==2)throw Error('s32_care_field_span_drift');
 const parent=Buffer.from(text.replace(after,before));
 if(sha(parent)!==careParent)throw Error('s32_care_parent_drift');
 rows[0].meds_offered=careBefore;
 if(!isDeepStrictEqual(current,JSON.parse(parent)))throw Error('s32_care_only_one_leaf_required');
 return parent;
}
export function s32LedgerPredecessor(bytes,binding,readBytes=readFileSync){
 const read=ref=>{const b=readBytes(new URL('../'+ref.path,import.meta.url));if(sha(b)!==ref.sha256)throw Error('s32_binding_source_hash');return b;};
 const pinned=JSON.parse(read({path:'data/price-index-nonprice-binding-v5-policy.json',sha256:descriptor}));
 if(!isDeepStrictEqual(binding?.research_binding,pinned.research_binding))throw Error('price_nonprice_research_binding_invalid');
 if(!isDeepStrictEqual(binding?.nonprice_fields,pinned.nonprice_fields))throw Error('price_nonprice_binding_scope_invalid');
 if(!isDeepStrictEqual(binding,pinned))throw Error('s32_binding_descriptor_drift');
 read(binding.supersedes);
 const proof=JSON.parse(read(binding.successor)),prior=JSON.parse(read(binding.predecessor_binding));
 if(sha(bytes)===careCurrent)bytes=s32CareCurrentToParent(bytes);
 if(proof.schema!=='glp-s32-exact-ledger-successor-v1'||sha(bytes)!==proof.current_sha256)throw Error('s32_binding_current_drift');
 const old=read(proof.predecessor),current=JSON.parse(bytes),seen=new Set();
 for(const op of proof.changes){
  if(seen.has(op.pointer))throw Error('s32_binding_duplicate');seen.add(op.pointer);
  const keys=op.pointer.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'));let node=current;
  for(const key of keys.slice(0,-1))node=node[key];const key=keys.at(-1);
  if(!isDeepStrictEqual(node[key],op.value))throw Error('s32_binding_price_or_authority_drift');
  node[key]=op.before;
 }
 if(!isDeepStrictEqual(current,JSON.parse(old))||sha(old)!==prior.current_sha256)throw Error('s32_binding_price_or_authority_drift');
 return {bytes:old,binding:prior};
}
