import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {s32LedgerPredecessor} from './price-index-s32-basis.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const successor='6997142b551e1b89d1c01cf7dfee61e3d7257b4e9d54d5462d051890ada694e3';
const descriptor='40be01be56b02ca266555fcec892a0b6a6929bbecf0b938ec7659c07adbd54bf';
export function release2PriceLedgerBasis(bytes,readBytes=readFileSync){
 const raw=readBytes(new URL('../data/d2w-release2-price-basis.json',import.meta.url));
 if(sha(raw)!==descriptor)throw Error('release2_price_basis_descriptor_drift');
 const proof=JSON.parse(raw);
 if(proof.schema!=='d2w-release2-exact-editorial-price-basis-v1'||proof.successor_sha256!==successor)throw Error('release2_price_basis_contract_invalid');
 const oldBytes=readBytes(new URL('../'+proof.predecessor.path,import.meta.url));
 if(sha(oldBytes)!==proof.predecessor.sha256)throw Error('release2_price_basis_predecessor_drift');
 // Only the exact attested S32 successor uses its additional proof. Other
 // inputs still face the original whole-document R2 projection below.
 if(sha(bytes)==='88f1ec3e3d8c543e64caaa83ef5baab517e410cd180ee54ca2263eb2b1bbc95d'){
  const binding=JSON.parse(readBytes(new URL('../data/price-index-nonprice-binding.json',import.meta.url)));
  bytes=s32LedgerPredecessor(bytes,binding,readBytes).bytes;
 }
 const current=JSON.parse(bytes),old=JSON.parse(oldBytes),seen=new Set();
 for(const op of proof.changes){
  const key=op.index+':'+op.key;
  if(seen.has(key))throw Error('release2_price_basis_duplicate');seen.add(key);
  const row=current.programs[op.index];
  if(row?.program_id!==op.program_id||canonical(old.programs[op.index]?.[op.key])!==canonical(op.before))throw Error('price_nonprice_price_or_authority_drift');
  const nonprice=['shedrx','enhance-md','wellorithm','gala-health','found-health','try-ageless'].includes(op.program_id)&&['meds_offered','meds_offered_evidence'].includes(op.key);
  if(!nonprice&&canonical(row[op.key])!==canonical(op.after))throw Error('price_nonprice_price_or_authority_drift');
  row[op.key]=op.before;
 }
 for(const id of ['shedrx','enhance-md','wellorithm','gala-health','found-health','try-ageless'])for(const key of ['meds_offered','meds_offered_evidence']){
  const a=current.programs.find(p=>p.program_id===id),b=old.programs.find(p=>p.program_id===id);
  if(!a||!b)throw Error('price_nonprice_missing_identity');
  a[key]=b[key];
 }
 if(canonical(current)!==canonical(old))throw Error('price_nonprice_price_or_authority_drift');
 return oldBytes;
}
