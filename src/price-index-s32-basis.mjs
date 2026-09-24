import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
const sha=b=>createHash('sha256').update(b).digest('hex');
const descriptor='b2e9629aa08210dc9db91797733b838ffbd7d92a8a52ebef2bbe94b796dedd48';
export function s32LedgerPredecessor(bytes,binding,readBytes=readFileSync){
 const read=ref=>{const b=readBytes(new URL('../'+ref.path,import.meta.url));if(sha(b)!==ref.sha256)throw Error('s32_binding_source_hash');return b;};
 const pinned=JSON.parse(read({path:'data/price-index-nonprice-binding-v5-policy.json',sha256:descriptor}));
 if(!isDeepStrictEqual(binding?.research_binding,pinned.research_binding))throw Error('price_nonprice_research_binding_invalid');
 if(!isDeepStrictEqual(binding?.nonprice_fields,pinned.nonprice_fields))throw Error('price_nonprice_binding_scope_invalid');
 if(!isDeepStrictEqual(binding,pinned))throw Error('s32_binding_descriptor_drift');
 read(binding.supersedes);
 const proof=JSON.parse(read(binding.successor)),prior=JSON.parse(read(binding.predecessor_binding));
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
