import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {historicalAffiliateRegistry} from './affiliate-relationship-sync.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')}}`:JSON.stringify(x);
const digest=x=>sha(canonical(x));
// Non-price append reconstruction only. Every caller's original historical
// whole-body/ledger oracle still runs on the returned predecessor.
export function makeProviderPriceAppend(beforeBytes, currentBytes, kind, addedIds) {
 if(!['registry','ledger'].includes(kind)||!Array.isArray(addedIds)||!addedIds.length||new Set(addedIds).size!==addedIds.length||addedIds.some(id=>typeof id!=='string'||/fella/i.test(id)))throw Error('append_scope');
 const before=JSON.parse(beforeBytes), current=JSON.parse(currentBytes);
 const oldIds=before.programs.map(p=>p.program_id), ids=current.programs.map(p=>p.program_id);
 if(new Set(oldIds).size!==oldIds.length||new Set(ids).size!==ids.length||addedIds.some(id=>oldIds.includes(id))||canonical(ids)!==canonical([...oldIds,...addedIds]))throw Error('append_scope');
 const expected=structuredClone(before);
 expected.programs.push(...current.programs.slice(oldIds.length));
 if(kind==='registry') {
  expected.site_profiles['glp-clinic-scout'].expected_sitemap_routes+=addedIds.length;
  // These evidence attachments are explicitly excluded by the original frozen
  // price body. Never use this restored copy for display or commercial authority.
  for(const key of ['therapeutic_taxonomy','provider_dynamic_profiles','consumer_therapeutic_authorities']) {
   if(Object.hasOwn(current,key))expected[key]=current[key]; else delete expected[key];
  }
  if(before.therapeutic_taxonomy?.price_index_registry_frozen_source_sha256!==current.therapeutic_taxonomy?.price_index_registry_frozen_source_sha256)throw Error('append_scope');
 } else if(Object.hasOwn(current,'research_enrichment'))expected.research_enrichment=current.research_enrichment;
 if(canonical(expected)!==canonical(current))throw Error('append_scope');
 return {schema:'glp.provider-price-append.v1',kind,added_ids:addedIds,predecessor_base64:Buffer.from(beforeBytes).toString('base64'),predecessor_sha256:sha(beforeBytes),predecessor_semantic_sha256:digest(before),current_semantic_sha256:digest(current),current_bytes_sha256:kind==='ledger'?sha(currentBytes):null};
}
export function projectProviderPriceAppend(currentBytes,binding,kind) {
 const keys=['schema','kind','added_ids','predecessor_base64','predecessor_sha256','predecessor_semantic_sha256','current_semantic_sha256','current_bytes_sha256'];
 if(!binding||binding.schema!=='glp.provider-price-append.v1'||binding.kind!==kind||canonical(Object.keys(binding).sort())!==canonical(keys.sort()))throw Error('append_binding_invalid');
 const beforeBytes=Buffer.from(binding.predecessor_base64,'base64'), before=JSON.parse(beforeBytes), current=JSON.parse(currentBytes);
 if(sha(beforeBytes)!==binding.predecessor_sha256||digest(before)!==binding.predecessor_semantic_sha256)throw Error('append_predecessor_drift');
 if(digest(current)===binding.predecessor_semantic_sha256) {
  if(kind==='ledger'&&sha(currentBytes)!==binding.predecessor_sha256)throw Error('append_predecessor_bytes_drift');
  return beforeBytes;
 }
 if(digest(current)!==binding.current_semantic_sha256)throw Error('append_current_drift');
 if(kind==='ledger'&&sha(currentBytes)!==binding.current_bytes_sha256)throw Error('append_current_bytes_drift');
 const checked=makeProviderPriceAppend(beforeBytes,currentBytes,kind,binding.added_ids);
 if(canonical(checked)!==canonical(binding))throw Error('append_binding_invalid');
 return beforeBytes;
}
export function providerPricePredecessorBytes(bytes,kind,readBytes=readFileSync) {
 const ids=['rightwell-review','willow-review','ivim-health-review','tyde-wellness-review','feelgood-review','instarx-review','retaclinic-review'];
 if(!JSON.parse(bytes).programs.some(p=>ids.includes(p.program_id)))return bytes;
 let binding;
 try {binding=JSON.parse(readBytes(new URL('../data/provider-price-append.json',import.meta.url)));}
 catch(error){throw Error('append_pair_unreadable',{cause:error});}
 if(binding.schema!=='glp.provider-price-append-pair.v1'||canonical(Object.keys(binding).sort())!==canonical(['ledger','registry','schema'])||!['ledger','registry'].every(k=>canonical([...binding[k].added_ids].sort())===canonical([...ids].sort())))throw Error('append_pair_invalid');
 return projectProviderPriceAppend(bytes,binding[kind],kind);
}
export function providerPricePredecessorRegistry(registry,readBytes=readFileSync) {
 return JSON.parse(providerPricePredecessorBytes(Buffer.from(JSON.stringify(historicalAffiliateRegistry(registry))),'registry',readBytes));
}
