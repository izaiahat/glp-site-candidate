// Staging bootstrap only. No consumer source or live SDK transport is eligible.
const installedLoaders=new WeakMap();
export function installAdvertisingLoaders({adapter,consent,window:win=globalThis.window,document:doc=win.document}={}) {
 if(typeof consent?.purposes!=='function')return;
 if(installedLoaders.has(doc))return installedLoaders.get(doc);
 let state='denied',frame=null,generation=0,controller=null,activeKey=null,expiry=null;
 const context=()=>({url:win.location.href,title:doc.title,referrer:doc.referrer,gpc:win.navigator.globalPrivacyControl===true,advertising:consent?.purposes?.().advertising});
 const key=view=>JSON.stringify(view);
 function stop(){generation++;controller?.abort();controller=null;frame?.remove();frame=null;win.clearTimeout(expiry);activeKey=null;state='denied'}
 async function update(){
  const initial=adapter?.readCurrent?.();
  if(!eligibleAdvertisingProjection(initial,context())){stop();return}
  if(activeKey===key(initial)&&state!=='denied')return;
  stop();const ticket=generation;activeKey=key(initial);state='loading';controller=new AbortController();
  const valid=()=>ticket===generation&&eligibleAdvertisingProjection(adapter?.readCurrent?.(),context())&&key(adapter.readCurrent())===activeKey;
  try{
   await adapter.refresh();
   const view=adapter.readCurrent();if(!valid()){if(ticket===generation)stop();return}
   expiry=win.setTimeout(stop,Math.max(0,Math.min(view.scope.expires_at_ms,view.receipt.expires_at_ms)-Date.now()));
   const platform=view.scope.platform,url=platform==='meta'?'https://connect.facebook.net/en_US/fbevents.js':'https://bat.bing.com/bat.js';
   const response=await win.fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error'});
   if(!response.ok)throw new Error('sdk_unavailable');
   const code=await response.text();
   if(!valid()){if(ticket===generation)stop();return}
   await adapter.refresh();
   if(!valid()){if(ticket===generation)stop();return}
   const prelude=platform==='meta'?`window.fbq=function(){var args=Array.from(arguments);if(fbq.callMethod)fbq.callMethod.apply(fbq,args);else fbq.queue.push(args)};fbq.queue=[];fbq.loaded=true;fbq.version='2.0';window._fbq=fbq;fbq('set','autoConfig',false,'586886932687286');fbq('consent','grant');`:`window.uetq=[['consent','default',{ad_storage:'granted'}]];`;
   const init=platform==='meta'?`fbq('init','586886932687286');`:`window.uetq=new UET({ti:'187271853',q:window.uetq,enableAutoSpaTracking:false});`;
   frame=doc.createElement('iframe');frame.hidden=true;frame.title='Contained advertising bootstrap';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
   const bytes=new TextEncoder().encode(prelude+'\n'+code+'\n'+init),encoded=win.btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
   frame.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; connect-src 'none'; img-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><title>Contained bootstrap</title><script src="data:text/javascript;base64,${encoded}"></script>`;
   doc.body.appendChild(frame);state='contained_sdk_automatic_transport_held';
  }catch{if(ticket===generation)stop()}
 }
 const api=Object.freeze({update,stop,status:()=>state});installedLoaders.set(doc,api);
 win.addEventListener('gcs:consent',update);
 // Guard SDK lifetime against SPA URL/title changes and newly observed GPC.
 // Automatic SDK networking is CSP-held even between these bounded checks.
 const watcher=win.setInterval(()=>{if(frame&&!eligibleAdvertisingProjection(adapter?.readCurrent?.(),context()))stop()},50);
 win.addEventListener('pagehide',()=>{win.clearInterval(watcher);stop()},{once:true});
 void update();return api;
}
export function eligibleAdvertisingProjection(view,context,now=Date.now()) {
 try {
  const s=view?.scope,r=view?.receipt;
  if(!s||!r||context.gpc!==false||context.advertising!=='granted')return false;
  const platform=s.platform;
  if(!['meta','microsoft'].includes(platform)||s.origin!==`https://a17-${platform}.invalid`||s.source_path!=='/test/administrative/'||s.source_title!=='TEST administrative fixture'||s.allowed_referrer!=='')return false;
  if(context.url!==s.origin+s.source_path||context.title!==s.source_title||context.referrer!=='')return false;
  if(s.transport!==(platform==='meta'?'meta_pixel':'microsoft_uet')||s.target_id!==(platform==='meta'?'586886932687286':'187271853'))return false;
  if(!['id','notice','notice_version','source_ref','source_revision'].every(k=>typeof s[k]==='string'&&s[k])||!/^TEST_/.test(s.id)||!/^TEST_/.test(s.source_ref)||!/^TEST_/.test(s.source_revision)||!/^[a-f0-9]{64}$/.test(s.permission_sha256))return false;
  if(s.purpose!=='ad_measurement'||!['eligible','containment','notice_approved','retention_approved'].every(k=>s[k]===true)||!Number.isInteger(s.revision)||s.revision<1)return false;
  return Number.isSafeInteger(s.expires_at_ms)&&s.expires_at_ms>now&&r.scope_id===s.id&&r.scope_revision===s.revision&&r.notice_version===s.notice_version&&r.choice==='explicit_opt_in'&&r.ad_storage==='granted'&&r.ad_user_data==='granted'&&r.ad_personalization==='denied'&&r.gpc===false&&r.withdrawn===false&&Number.isSafeInteger(r.expires_at_ms)&&r.expires_at_ms>now&&r.expires_at_ms<=s.expires_at_ms;
 }catch{return false}
}
