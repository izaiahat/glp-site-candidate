// Visitor intent transport only. Eligibility and durable readback remain server-owned.
export function createAdvertisingConsentAdapter({fetchImpl=globalThis.fetch}={}) {
 let current=null,csrf=null,generation=0;
 const options=method=>({method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})}});
 async function read(ticket){
  const response=await fetchImpl('/api/advertising-consent',options('GET'));
  if(!response.ok)throw new Error('issuer_unavailable');
  const value=await response.json();
  if(ticket!==generation)throw new Error('stale_issuer_response');
  csrf=typeof value.csrf==='string'?value.csrf:null;
  current={scope:value.scope??null,receipt:value.receipt??null};
  return current;
 }
 async function refresh(){current=null;return read(++generation)}
 async function choose(choice){
  if(!choice||Object.keys(choice).sort().join(',')!=='choice,scope_id'||choice.choice!=='explicit_opt_in'||!csrf||choice.scope_id!==current?.scope?.id)throw new Error('invalid_offered_choice');
  const ticket=++generation,body=JSON.stringify({...choice,csrf});current=null;
  const response=await fetchImpl('/api/advertising-consent',{...options('POST'),body});
  if(ticket!==generation)throw new Error('stale_issuance_response');
  if(!response.ok)throw new Error('issuance_unconfirmed');
  return read(ticket);
 }
 async function revoke(){
  const ticket=++generation,body=JSON.stringify({csrf});current=null;
  if(!csrf)throw new Error('revocation_unconfirmed');
  const response=await fetchImpl('/api/advertising-consent/revoke',{...options('POST'),body});
  if(!response.ok||(await response.json()).acknowledged!==true)throw new Error('revocation_unconfirmed');
  const view=await read(ticket);
  if(view.receipt&&!view.receipt.withdrawn) {current=null;throw new Error('revocation_readback_failed')}
  return {acknowledged:true};
 }
 return Object.freeze({readCurrent:()=>current,refresh,choose,revoke});
}
