import {records,finish,check,gap,allOutput,local} from './glp34-reader-copy-handler.mjs';
const ids=['RN-00058','RN-00486','RN-00565','RN-EXTRA-3632','RN-EXTRA-3671','RN-EXTRA-3677','RN-EXTRA-3724','RN-EXTRA-3725','RN-EXTRA-3727','RN-EXTRA-3729','RN-EXTRA-3730','RN-EXTRA-3731','RN-EXTRA-3732','RN-EXTRA-3733','RN-EXTRA-3734','RN-EXTRA-3735','RN-EXTRA-3831','RN-EXTRA-3841'];

// Native scroll does not wait for Playwright's stable bounding box: looping
// transforms never become stable. Hidden targets fail immediately, not by polling.
export async function scrollMotionTarget(target){
 return target.evaluate(n=>{
  if(!n.getClientRects().length||getComputedStyle(n).visibility==='hidden')throw new Error('Motion target is not rendered');
  window.CS_MOTION?.stop();n.scrollIntoView({block:'center',behavior:'instant'});
  window.ScrollTrigger?.update();
 });
}

// Two rendering boundaries deliver scroll/IntersectionObserver work; elapsed
// animation time comes from WAAPI, never a visibility predicate or a sleep.
export async function measureMotion(target,{loop=false,timeout=1500}={}){
 return target.evaluate(async(n,{loop,timeout})=>{
  let timer;const cleanup=[];
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Motion lifecycle timeout')),timeout);});
  const sample=async()=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const animations=n.getAnimations({subtree:true});
   const evidence=[];
   const cssMotion=Promise.all(animations.map(async a=>{
    await a.ready;
    const timing=a.effect.getComputedTiming();
    const start={startTime:a.startTime,currentTime:a.currentTime};
    if(timing.iterations===Infinity){
     if(!loop)return {kind:'loop',...start,duration:timing.duration,completed:false};
     // Infinite loops have no finish event: sample the animation's own clock.
     await new Promise((resolve,reject)=>{
      let frame;const tick=()=>{
       if(a.playState!=='running')return reject(new Error('Motion loop is not running'));
       if(a.currentTime-start.currentTime>=100)return resolve();
       frame=requestAnimationFrame(tick);
      };cleanup.push(()=>cancelAnimationFrame(frame));tick();
     });
    }else await a.finished;
    return {kind:timing.iterations===Infinity?'loop':'finite',...start,endTime:a.currentTime,duration:timing.duration,completed:a.playState==='finished'};
   }));
   // assets/motion.js uses GSAP, which exposes neither CSS events nor WAAPI.
   // Preserve its callbacks and observe the actual tween lifecycle instead.
   const tweens=window.gsap?.getTweensOf([n,...n.querySelectorAll('*')]).filter(t=>t.isActive())||[];
   const gsapMotion=Promise.all(tweens.map(t=>new Promise((resolve,reject)=>{
    const start=t.totalTime(),complete=t.eventCallback('onComplete'),interrupt=t.eventCallback('onInterrupt');
    const restore=()=>{t.eventCallback('onComplete',complete);t.eventCallback('onInterrupt',interrupt);};cleanup.push(restore);
    t.eventCallback('onComplete',function(...args){try{complete?.apply(this,args);evidence.push({kind:'gsap',startTime:start,endTime:t.totalTime(),duration:t.totalDuration(),completed:true});resolve();}catch(e){reject(e);}finally{restore();}});
    t.eventCallback('onInterrupt',function(...args){try{interrupt?.apply(this,args);}finally{restore();reject(new Error('Motion tween interrupted'));}});
   })));
   const [cssEvidence]=await Promise.all([cssMotion,gsapMotion]);
   return [...cssEvidence,...evidence];
  };
  try{return await Promise.race([sample(),deadline]);}finally{clearTimeout(timer);cleanup.forEach(fn=>fn());}
 },{loop,timeout});
}

export async function probeAuroraCard(card,page){
 const id=await card.evaluate(n=>n.dataset.program||null);
 if(!await card.isVisible())return {id,status:'NOT_EXERCISED',error:'Card is not visible'};
 try{
  await scrollMotionTarget(card);await page.mouse.move(0,0);
  const idleMotion=await measureMotion(card,{loop:true});
  const read=()=>card.evaluate(n=>{const a=n.querySelector('.p3-card-aurora'),s=getComputedStyle(a);return {id:n.dataset.program,animation:s.animationName,duration:s.animationDuration,transform:getComputedStyle(n).transform,dose:[...n.querySelectorAll('[data-dose-row][data-selected=true]')].map(n=>({text:n.textContent,weight:getComputedStyle(n).fontWeight}))};});
  const idle=await read();
  const box=await card.boundingBox();if(!box)throw new Error('Motion target is not rendered');
  await page.mouse.move(box.x+box.width/2,box.y+Math.min(box.height/2,20));
  const hoverMotion=await measureMotion(card,{loop:true});const hover=await read();
  await page.mouse.move(0,0);return {id,status:'PASS',idle,hover,idleMotion,hoverMotion};
 }catch(error){return {id,status:'FAIL',error:`${error.name}: ${error.message}`};}
}
export async function motionClass(page,origin,viewport){
 local(origin);const rows=records('motion-state-machines',ids),inventory=await allOutput(page,origin),sticky=[],aurora=[],reentry=[];
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(const p of inventory.filter(p=>p.sticky)){
  await page.goto(origin+p.route,{waitUntil:'domcontentloaded'});const states=[];
  for(const [state,y] of [['top',0],['down',2500],['up',1400],['end',1e8]]){
   await page.evaluate(y=>{window.CS_MOTION?.stop();window.scrollTo({top:y,behavior:'instant'});},y);
   const motion=await measureMotion(page.locator('.p3-provider-sticky'));
   states.push({...await page.evaluate(state=>{const n=document.querySelector('.p3-provider-sticky'),r=n.getBoundingClientRect(),f=document.querySelector('.cs-prefooter,.gcs-footer')?.getBoundingClientRect();return {state,y:scrollY,top:r.top,bottom:r.bottom,height:r.height,direction:n.dataset.scrollDirection,transform:getComputedStyle(n).transform,released:n.classList.contains('is-released'),footerTop:f?.top,display:getComputedStyle(n).display,position:getComputedStyle(n).position,viewport:innerHeight};},state),motion});
  }sticky.push({route:p.route,states});
 }
 for(const p of inventory.filter(p=>p.auroras)){
  await page.goto(origin+p.route,{waitUntil:'domcontentloaded'});
  const cards=page.locator('.p3-provider-card:has(.p3-card-aurora)');const count=await cards.count();const samples=[];
  for(let i=0;i<count;i++)samples.push(await probeAuroraCard(cards.nth(i),page));aurora.push({route:p.route,expected:p.auroras,observed:count,samples});
 }
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});await page.mouse.move(0,0);
 const track=page.locator('.cs-home2-marquee__track');let marquee=null;
 if(await track.count()){
  const before=await track.evaluate(n=>n.getBoundingClientRect().x),motion=await measureMotion(track,{loop:true});
  marquee={before,motion,...await track.evaluate(n=>({after:n.getBoundingClientRect().x,overflow:getComputedStyle(n.parentElement).overflow,links:[...n.querySelectorAll('a')].map(a=>({text:a.textContent.trim(),href:a.getAttribute('href')})),images:n.querySelectorAll('img').length}))};
 }
 const flips=[];const risk=page.locator('[data-risk-card]');for(let i=0;i<await risk.count();i++){
  const n=risk.nth(i);await scrollMotionTarget(n);await page.mouse.move(0,0);await measureMotion(n);
  const read=()=>n.evaluate(n=>({pressed:n.getAttribute('aria-pressed'),front:n.querySelector('.cs-riskcard__front')?.textContent.trim(),back:n.querySelector('.cs-riskcard__back')?.textContent.trim(),backOpacity:n.querySelector('.cs-riskcard__back')?getComputedStyle(n.querySelector('.cs-riskcard__back')).opacity:null}));
  const initial=await read();await n.click({timeout:1500});const motion=await measureMotion(n);const clicked=await read();await n.focus({timeout:1500});await measureMotion(n);const focused=await read();flips.push({initial,clicked,focused,motion});
 }
 for(const p of inventory.filter(p=>p.motion.length&&(['/', '/providers/','/semaglutide/','/tirzepatide/'].includes(p.route)||p.route.startsWith('/lp/best-providers/')))){
  await page.goto(origin+p.route,{waitUntil:'domcontentloaded'});const nodes=page.locator('[data-motion]');const transitions=[];
  for(let i=0;i<await nodes.count();i++){
   const n=nodes.nth(i);try{
    await scrollMotionTarget(n);const entryMotion=await measureMotion(n);
    const before=await n.evaluate(n=>({once:n.dataset.motionOnce,opacity:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform}));
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await measureMotion(n);
    await scrollMotionTarget(n);const replayMotion=await measureMotion(n);
    transitions.push({before,entryMotion,replayMotion,after:await n.evaluate(n=>({opacity:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform}))});
   }catch(error){transitions.push({index:i,status:'FAIL',error:`${error.name}: ${error.message}`});}
  }reentry.push({route:p.route,expected:p.motion,transitions});
 }
 await page.emulateMedia({reducedMotion:'reduce'});const reduced=await page.evaluate(()=>[...document.querySelectorAll('[data-motion],.p3-card-aurora')].map(n=>({opacity:getComputedStyle(n).opacity,animation:getComputedStyle(n).animationName})));await page.emulateMedia({reducedMotion:'no-preference'});
 const directional=check('all source-emitted sticky instances: top/down/up/end with retained footer release',sticky.length>0&&sticky.every(p=>{const [t,d,u,e]=p.states;return viewport==='mobile'?t.height>0&&d.direction==='down'&&d.top>=d.viewport&&u.direction==='up'&&u.bottom<=u.viewport+2&&e.released&&e.bottom<=e.footerTop+2:t.display==='none'||t.height===0;}),sticky);
 const pulse=check('every provider card aurora idle and accelerated hover pulse',aurora.length>0&&aurora.every(p=>p.expected===p.observed&&p.samples.length===p.expected&&p.samples.every(s=>s.status==='PASS'&&s.idle.animation!=='none'&&s.hover.animation!=='none'&&parseFloat(s.hover.duration)<parseFloat(s.idle.duration)&&s.hover.transform!==s.idle.transform)),aurora);
 const checksFor=id=>{
 if(['RN-00058','RN-00486'].includes(id))return [pulse,gap('all selected dose/price bold and provider features source parity','No sourced dose-feature all-instance comparison')];
 if(id==='RN-00565')return [check('all named sections permit repeated entry',reentry.length>0&&reentry.every(p=>p.expected.every(n=>n.once==='false')&&p.transitions.length===p.expected.length&&p.transitions.every(t=>!t.error)),reentry),gap('frame-sampled re-entry replay and desktop before/after screenshot','Collected computed before/after only; animation replay not established')];
 if(id==='RN-EXTRA-3671')return [check('marquee drift and clipped real-name local review links',!!marquee&&Math.abs(marquee.after-marquee.before)>1&&/hidden|clip/.test(marquee.overflow)&&marquee.links.length>0&&marquee.links.every(a=>/^\/reviews\//.test(a.href))&&marquee.images===0,marquee),gap('registry name parity and controlled loop','Identity and pause-control verification not exercised')];
 if(id==='RN-EXTRA-3677')return [check('all six distinct flip fronts/backs and click reveal',flips.length===6&&new Set(flips.map(f=>f.initial.front)).size===6&&new Set(flips.map(f=>f.initial.back)).size===6&&flips.every(f=>f.initial.backOpacity==='0'&&f.clicked.backOpacity==='1'&&f.clicked.pressed==='true'),flips),gap('independent Tab and hover plus danger/trust content','Focus follows click; not an independent focus transition')];
 if(id==='RN-EXTRA-3841')return [gap('literal slider palette disposition','Operator/Fable decision awaits Izaiah; no mechanical substitution')];
 return [directional];};
 return finish(viewport,'motion-state-machines','motion',rows.map(r=>({...r,checks:checksFor(r.id)})),{sourceScope:inventory.sourceScope,inventory:inventory.map(p=>({route:p.route,sticky:p.sticky,auroras:p.auroras})),reduced});
}
