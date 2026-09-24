// PROPOSAL: not imported by any shipped page; no automatic collection.
// Call only from a separately reviewed non-health navigation handler after
// an explicit advertising choice. The server independently resolves grants.
export async function handoffNavigation({landingUrl,goUrl,consent,healthContext,send=fetch}) {
  if(globalThis.navigator?.globalPrivacyControl===true)return {state:'HELD'};
  if(healthContext!==false||consent?.ad_storage!=='granted'||consent?.ad_user_data!=='granted')return {state:'HELD'};
  let landing,go;
  try {landing=new URL(landingUrl);go=new URL(goUrl);}catch{return {state:'HELD'};}
  if(landing.protocol!=='https:'||landing.origin!==go.origin||go.username||go.password||go.hash||!/^\/go\/[a-z0-9-]+$/.test(go.pathname))return {state:'HELD'};
  if(go.searchParams.getAll('cs_click_id').length!==1)return {state:'HELD'};
  const identifiers={};
  for(const name of ['gclid','gbraid','wbraid','msclkid','fbclid']){
    const values=landing.searchParams.getAll(name);
    if(values.length>1)return {state:'HELD'};
    if(values.length){if(!/^[A-Za-z0-9_.~-]{1,512}$/.test(values[0]))return {state:'HELD'};identifiers[name]=values[0];}
  }
  if(!Object.keys(identifiers).length)return {state:'NO_OBSERVED_IDS'};
  // No full landing URL, referrer, email, quiz answers or other query params.
  // Opaque HttpOnly first-party cookie, never identifiers appended to /go.
  try {
    const response=await send(landing.origin+'/api/platform-click-handoff',{
      method:'POST',credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({go_path:go.pathname+go.search,identifiers})
    });
    return {state:response.status===201?'HANDOFF_STORED':'HELD',retry:false};
  }catch{return {state:'AMBIGUOUS_HANDOFF',retry:false};}
}
