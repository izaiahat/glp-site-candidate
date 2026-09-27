// Exact pinned-SDK contract. No wildcard protocol fields or newly observed auto-approval.
import assert from 'node:assert/strict';
export const origin='https://glpclinicscout.com';
export const sdkUrl='https://www.googletagmanager.com/gtag/js?id=G-2WQ42JY0WK&l=gcsGa4Layer';
// Existing retained pinned-SDK request fields (PR11/PR13); identifiers here are
// protocol evidence, not anonymity or permission for receiver uses.
const protocol=new Set('v tid gtm _p gcs gcd npa dma dma_cps cid ul sr uaa uab uafvl uamb uap uaw are frm pscdl _eu _s tag_exp sid sct seg dl dt dr en _fv _nsi _ss _ee _et _tu gaf ir ngs rcb tfd tt'.split(' '));
const custom=new Set('ep.ads_data_redaction ep.url_passthrough ep.ae_block_form ep.ae_block_history ep.ae_block_video ep.ae_block_scroll ep.ae_block_outbound_click ep.ae_block_downloads ep.outbound epn.percent_scrolled'.split(' '));
export function classifyGARequest(row,documentUrl) {
 const u=new URL(row.url);
 if(row.method==='GET'&&row.url===origin+'/consent.js')return 'consent';
 if(row.method==='GET'&&row.type==='document'&&row.url===documentUrl)return 'document';
 if(row.method==='GET'&&row.url===sdkUrl)return 'sdk';
 if(['GET','POST'].includes(row.method)&&['https://www.google-analytics.com','https://www.google.com'].includes(u.origin)&&u.pathname==='/g/collect'&&!u.hash&&!u.username&&!u.password)return 'collect';
 return 'unknown';
}
// Same recording/decision path in actual context routing and pure counterexample.
export function recordGARequest(request,documentUrl,phase,requests,rows,unknown) {
 const row={url:request.url(),method:request.method(),type:request.resourceType(),body:request.postData(),headers:request.headers(),phase,forwarded:false};
 row.category=classifyGARequest(row,documentUrl);row.collect=row.category==='collect';requests.push(row);
 if(!['consent','document'].includes(row.category))rows.push(row);
 if(row.category==='unknown')unknown.push(row);
 return row;
}
export function decode(rows) {
 return rows.filter(r=>r.collect).flatMap(row=>{
  assert.equal(classifyGARequest(row,null),'collect','GA method/origin/path');
  const query=[...new URL(row.url).searchParams];
  const lines=row.body?row.body.split('\n'):[''];
  return lines.map(line=>{
   const entries=[...query,...new URLSearchParams(line)],keys=entries.map(([k])=>k);
   assert.equal(new Set(keys).size,keys.length,'GA duplicate protocol field');
   // Only collapse after lossless duplicate rejection; raw URL/body stays retained.
   return Object.fromEntries(entries);
  });
 });
}
export function safe(rows,pagePath) {
 const events=decode(rows);assert.ok(events.length>0,'GA positive event required');
 for(const e of events){
  for(const key of Object.keys(e))assert.ok(protocol.has(key)||custom.has(key),'GA unapproved field: '+key);
  assert.ok(['page_view','scroll','click','file_download','user_engagement'].includes(e.en),'GA event');
  assert.equal(e.v,'2');assert.equal(e.tid,'G-2WQ42JY0WK');assert.equal(e.dl,origin+pagePath);assert.equal(e.dt,'Clinic Scout');assert.equal(e.dr||'','');assert.equal(e.npa,'1');
  for(const [k,v] of Object.entries(e).filter(([k])=>k.startsWith('ep.ae_block_')))assert.equal(v,'true',k);
  if(e['ep.ads_data_redaction']!==undefined)assert.equal(e['ep.ads_data_redaction'],'true');
  if(e['ep.url_passthrough']!==undefined)assert.equal(e['ep.url_passthrough'],'false');
  if(e['ep.outbound']!==undefined){assert.equal(e.en,'click');assert.equal(e['ep.outbound'],'true');}
  if(e['epn.percent_scrolled']!==undefined){assert.equal(e.en,'scroll');assert.equal(e['epn.percent_scrolled'],'90');}
 }
 assert.doesNotMatch(decodeURIComponent(JSON.stringify(rows)),/PRIVATE_CANARY|gclid=|quiz_answers|health_condition|form_contents|medication_selection/);
 return events;
}
