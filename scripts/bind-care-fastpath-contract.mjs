// Narrow candidate-local counterpart of the paired provider contract / fastpath
// write in glp_affiliate_wire_backlog_worker.py (_recover_already_live,
// _activate_existing, _ensure_attested_page_copy). No worker or live effects.
import {createHash} from 'node:crypto';
import {readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
export function bindCareFastpath(rootPath=root){
 const contracts=readFileSync(join(rootPath,'data/provider-page-contracts.json'));
 const accepted='edcbabb72522b0884f6d6ac97a813b6bf7afc2bb63bf4302c42162a0d03ffef6';
 if(sha(contracts)!==accepted)throw Error('care_fastpath_contract_not_accepted');
 const care=JSON.parse(contracts).providers.filter(row=>row.program_id==='care-bare-rx-glp1-review');
 if(care.length!==1||care[0].row_contract.medications!==
   'Semaglutide and tirzepatide; injectable and oral options are described, including compounded options')
   throw Error('care_fastpath_contract_identity_drift');
 const path=join(rootPath,'data/provider-fastpath-contract.json');
 const original=readFileSync(path,'utf8');
 const before='6f64b4de008cfd9808f1007d9eb80a64f5eb7b6c7444b5ea2de2eaaff777db55';
 const parsed=JSON.parse(original);
 if(parsed.current_contract_sha256===accepted)return {status:'ALREADY_BOUND',sha256:sha(Buffer.from(original))};
 if(parsed.current_contract_sha256!==before)throw Error('care_fastpath_prior_binding_drift');
 // Preserve all fastpath fields and formatting; replace only the owning hash
 // leaf after authenticating the complete corrected provider contract bytes.
 const span=`"current_contract_sha256": "${before}"`;
 if(original.split(span).length!==2)throw Error('care_fastpath_binding_span_drift');
 const next=original.replace(span,`"current_contract_sha256": "${accepted}"`);
 const expected=structuredClone(parsed);expected.current_contract_sha256=accepted;
 if(JSON.stringify(JSON.parse(next))!==JSON.stringify(expected))throw Error('care_fastpath_unexpected_delta');
 const temp=path+'.care-binding-'+process.pid;
 try{writeFileSync(temp,next,{flag:'wx',mode:0o644});renameSync(temp,path);}
 catch(error){try{unlinkSync(temp);}catch{}throw error;}
 return {status:'BOUND',from:before,to:accepted,sha256:sha(Buffer.from(next))};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
 console.log(JSON.stringify(bindCareFastpath()));
