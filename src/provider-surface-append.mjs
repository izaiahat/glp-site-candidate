import {isDeepStrictEqual as equal} from 'node:util';
export function appendManualPricing(matrix,registry,ids) {
 const result=structuredClone(matrix);
 for(const id of ids){
  if(result.providers[id])throw Error('manual_scope:already_present');
  const p=registry.programs.filter(p=>p.program_id===id), profile=registry.provider_dynamic_profiles?.profiles?.[id];
  const calc=profile?.calculator;
  if(p.length!==1||calc?.mode!=='manual'||['first_month_base_usd','recurring_month_base_usd','one_time_fee_usd'].some(k=>calc[k]!==null)||typeof calc.evidence_gap_copy!=='string'||calc.evidence_gap_copy.length<20)throw Error('manual_scope');
  result.providers[id]={program_id:id,provider:p[0].display_name,medications:[],unavailable_reason:calc.evidence_gap_copy,pricing_state:'not_attested'};
 }
 result.coverage.providers_total=Object.keys(result.providers).length;
 result.coverage.providers_pricing_unavailable=Object.values(result.providers).filter(p=>!p.medications.length).length;
 return result;
}
export function retainedManualPricingBasis(matrix,registry,ids) {
 const result=structuredClone(matrix);
 const present=ids.filter(id=>Object.hasOwn(result.providers,id));
 for(const id of present)delete result.providers[id];
 const expected=appendManualPricing(result,registry,present);
 for(const id of present)if(!equal(matrix.providers[id],expected.providers[id]))throw Error('manual_projection_drift');
 return result;
}

export function appendGoldenVectors(config,audit,addedIds,retiredIds) {
 if(audit.findings.some(f=>f.severity==='defect'&&f.code!=='golden_vector_drift'))throw Error('golden_other_defect');
 const result=structuredClone(config), retired=new Set(retiredIds), added=new Set(addedIds);
 if(audit.golden_vectors.length!==result.golden_vectors.length)throw Error('golden_vector_identity');
 for(const vector of result.golden_vectors){
  const rows=audit.golden_vectors.filter(v=>v.vector_id===vector.vector_id);
  if(rows.length!==1)throw Error('golden_vector_identity');
  const row=rows[0], old=vector.expected_program_ids;
  if(!equal(row.expected,old.filter(id=>!retired.has(id)))||!equal(row.actual.filter(id=>!added.has(id)),row.expected)||new Set(row.actual).size!==row.actual.length||old.some(id=>added.has(id)))throw Error('golden_retained_drift');
  for(let i=0;i<row.actual.length;i++){
   const id=row.actual[i]; if(!added.has(id))continue;
   const next=row.actual.slice(i+1).find(id=>!added.has(id));
   old.splice(next===undefined?old.length:old.indexOf(next),0,id);
  }
  if(!equal(old.filter(id=>!retired.has(id)),row.actual))throw Error('golden_projection_drift');
 }
 return result;
}
