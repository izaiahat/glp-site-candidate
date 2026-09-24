import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const packets=Object.freeze({drhouse:'d2e72a173e42af6a8323a2dc3fae54c66d4c6c784f6e70be4fcb1435215dfc89','trt-nation':'1ac853c351a8df5ff0e67547e1d802feab9b80db136317c5e594478e02b700e9','bodybuilding-com-glp-1-longevity-review':'99f54b4b2b6f1c956927f098fba359e30746cc3c3c207ea055f5a63a43649ebf'});
export function sourceDisplayPacket(id, readBytes=readFileSync){
 if(!Object.hasOwn(packets,id))return null;
 const b=readBytes(new URL('../data/d2w-s9-'+id+'-research.json',import.meta.url));
 if(sha(b)!==packets[id])throw Error('source_display_packet_hash_mismatch:'+id);
 const p=JSON.parse(b);if(p.program_id!==id || p.schema!=='program-deep-research-v1')throw Error('source_display_packet_identity_invalid');
 return p;
}
function cancellation(id,field){
 if(id!=='drhouse')return field.value;
 if(!field.quote.includes('Refunds may take 5-10 business days to settle.'))throw Error('source_display_refund_quote_missing');
 return field.value+' Refunds requested through support may take 5-10 business days to settle.';
}
// Read-only presentation view, deliberately NOT a new price or authority ledger.
// The original ledger, raw backfill, frozen oracle, dates and quotations stay on
// disk unchanged. Only named current packet facts may replace display fields.
export function projectProviderDisplayLedger(entry,readBytes=readFileSync){
 const p=sourceDisplayPacket(entry?.program_id,readBytes);if(!p)return entry;
 const r=structuredClone(entry),f=p.fields;
 const keys=['shipping_wait','cancellation','consultation_fee','first_month_price'];
 for(const key of keys){const field=f[key];r['research_'+key]={state:'source_reported',value:key==='cancellation'?cancellation(p.program_id,field):field.value,source_url:field.source_url,verified_as_of:field.verified_as_of,quote:field.quote};}
 r.average_wait=f.shipping_wait.value;
 r.limitations=(r.limitations||[]).filter(s=>p.program_id==='drhouse'?!s.includes('Delivery in as little as 1 hour'):!s.includes('Weight-loss blood work is an additional $129'));
 return r;
}
export function projectProviderDisplayFacts(entry,readBytes=readFileSync){
 const p=sourceDisplayPacket(entry?.program_id,readBytes);if(!p)return entry;
 const r=structuredClone(entry);
 const map={shipping:'shipping_wait',cancellation:'cancellation',included_costs:'consultation_fee',total_monthly_cost:'first_month_price'};
 for(const [key,fieldName] of Object.entries(map)){
  const field=p.fields[fieldName];r.facts[key]={status:'SOURCE_REPORTED',value:fieldName==='cancellation'?cancellation(p.program_id,field):field.value,source_url:field.source_url,capture_date:field.verified_as_of,exact_quote:field.quote,provenance_tag:'SOURCE-REPORTED',numeric_provenance:'SOURCE-REPORTED'};
 }
 return r;
}
