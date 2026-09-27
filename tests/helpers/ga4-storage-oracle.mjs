import assert from 'node:assert/strict';
// Exact owners for the isolated GA SDK fixture, NOT D1's zero-Google contract.
const COOKIE=['_ga','_ga_2WQ42JY0WK','gcs_analytics_consent'];
const LOCAL=['gcs_tracking_consent_v1'];
export function assertGAPositiveStorage(snapshot,writes) {
 assert.deepEqual(snapshot.cookie.map(c=>c.name).sort(),COOKIE,'GA positive cookie jar (exact names, including duplicates)');
 assert.deepEqual(snapshot.local.map(r=>r.key).sort(),LOCAL,'GA positive localStorage');
 assert.deepEqual(snapshot.session,[],'GA positive sessionStorage');
 for(const row of writes){
  const allowed={cookie:COOKIE,local:LOCAL,session:[]}[row.area];
  assert.ok(allowed?.includes(row.key),'GA unapproved storage write: '+row.area+':'+row.key);
 }
 return snapshot;
}
// Delegates every operation to real browser storage. Observes transient writes
// as well as the actual jar/key census; never clears or filters unknown keys.
export function installGAStorageObserver() {
 const notify=row=>{void window.__gaStorageWrite(row)};
 const local=window.localStorage,session=window.sessionStorage;
 for(const method of ['setItem','removeItem']){
  const original=Storage.prototype[method];
  Storage.prototype[method]=function(key,...args){notify({area:this===local?'local':'session',operation:method,key:String(key)});return original.call(this,key,...args)};
 }
 for(const [name,target,area] of [['localStorage',local,'local'],['sessionStorage',session,'session']]){
  const proxy=new Proxy(target,{
   get(object,key){const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value},
   set(object,key,value){notify({area,operation:'set',key:String(key)});return Reflect.set(object,key,value,object)},
   defineProperty(object,key,descriptor){notify({area,operation:'define',key:String(key)});return Reflect.defineProperty(object,key,descriptor)}
  });
  Object.defineProperty(window,name,{configurable:true,get:()=>proxy});
 }
 let proto=document,descriptor;
 while(proto&&!(descriptor=Object.getOwnPropertyDescriptor(proto,'cookie')))proto=Object.getPrototypeOf(proto);
 Object.defineProperty(document,'cookie',{configurable:true,get(){return descriptor.get.call(document)},set(value){notify({area:'cookie',operation:'set',key:String(value).split('=',1)[0].trim()});return descriptor.set.call(document,value)}});
}
export async function readGAStorage(context,page,label) {
 const stores=await page.evaluate(()=>({local:Object.keys(localStorage).map(key=>({key})),session:Object.keys(sessionStorage).map(key=>({key}))}));
 return {label,cookie:(await context.cookies()).map(({name,domain,path,secure,httpOnly,sameSite})=>({name,domain,path,secure,httpOnly,sameSite})),...stores};
}
