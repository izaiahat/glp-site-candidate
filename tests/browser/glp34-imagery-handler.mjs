import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const execution='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
const specRoot='/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass7-spec-20260902/specs';
const prep='/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass7-prep/imagery';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const walk=(x,fn,p='$')=>{if(!x||typeof x!=='object')return;fn(x,p);for(const [k,v] of Object.entries(x))walk(v,fn,`${p}.${k}`);};
const every=(xs,fn)=>xs.length>0&&xs.every(fn);
const check=(name,pass,evidence)=>({name,status:pass?'PASS':'FAIL',evidence});
const gap=(name,evidence)=>({name,status:'NOT_EXERCISED',evidence});
const visual=name=>({name,status:'AWAITING_OPERATOR_SIGNATURE',witness:'Izaiah / independent design review',scope:'literal visual judgment only'});
const classes=['imagery-rendering','imagery-evidence-selection'];

/** Complete source-route census, with manifest SHA identity rather than filename guesses. */
export async function imageryClasses(page,origin,viewport){
  assert(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
  const label=typeof viewport==='string'?viewport:`${viewport.width}x${viewport.height}`;
  assert(/^[\w-]+$/.test(label));
  const histogram=read(execution+'/histogram.json'),inventory=read(execution+'/before/source-inventory.json');
  const ids=classes.flatMap(c=>histogram.primary_histogram.find(x=>x.class===c).occurrence_ids);
  assert.equal(ids.length,19);assert.equal(new Set(ids).size,19);
  const notes=new Map(inventory.notes.filter(n=>ids.includes(n.id)).map(n=>[n.id,n]));assert.equal(notes.size,19);
  const registry=read(root+'/data/program-registry.json').programs;
  const pharmacy=read(root+'/data/phase3-pharmacy-render-input.json').entries;
  const graph=read(root+'/data/phase3-page-graph.json');
  const ledger=read(root+'/data/program-content-ledger.json');
  const facts=read(root+'/data/provider-facts-backfill-20260830.json');
  const logos=read(root+'/assets/provider-logos/manifest.json');
  const atlas=read(root+'/assets/provider-logos/pass2-lp-atlas.json');
  const approved=read(prep+'/MANIFEST.json');
  const mappings=[...fs.readFileSync(specRoot+'/listing-template.md','utf8').matchAll(/^\| (\d{2}) \| `([^`]+)` \| ([ABCDE]) \| (.+) \|$/gm)].map(m=>({route:m[2],type:m[3]}));assert.equal(mappings.length,26);
  const canonical=registry.filter(r=>r.commercial_state==='live'&&Object.values(r.profiles||{}).some(p=>p.vertical_fit&&p.wired&&p.canonical_identity?.role!=='alias'));
  const expectedRoutes=[...new Set(['/', '/compare/','/providers/','/self-pay/','/pharmacies/','/reviews/',...mappings.map(m=>m.route),...graph.brand_pages.map(x=>x.route),...canonical.map(r=>`/providers/${r.program_id}/`),...canonical.filter(r=>Object.values(r.profiles||{}).some(p=>p.surfaces?.review)).map(r=>r.review_path).filter(Boolean),...pharmacy.map(p=>p.route)])];
  // Include every emitted generic router, never follow its outbound destination.
  const routerDir=root+'/public/lp/r';
  const addRoutes=dir=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())addRoutes(f);else if(e.name==='index.html')expectedRoutes.push('/'+path.relative(root+'/public',f).replace(/index\.html$/,''));}};addRoutes(routerDir);
  const routes=[...new Set(expectedRoutes)].sort();
  const expectedPharmacyCards=pharmacy.filter(e=>e.locations?.status==='source_backed'&&e.services?.status==='source_backed'&&e.locations.items?.some(i=>typeof i==='string'?i.trim():i?.address||i?.city||i?.state)&&e.services.items?.some(i=>String(i||'').trim())&&e.evidence_summary?.citation_count&&e.evidence_summary.source_classes?.length&&e.evidence_summary.last_researched_date).map(e=>e.route);
  const manifests=[];
  for(const rel of ['artifacts/ultracode/article-image-manifest.json','artifacts/ultracode/pass2-provider-review-image-manifest.json','artifacts/ultracode/pass2-product-comparison-image-manifest.json','artifacts/ultracode/pass2-review-system-image-manifest.json','artifacts/ultracode/pass2-image-derivative-manifest.json','artifacts/ultracode/phase3-product-renders/generated-image-lineage.json','artifacts/ultracode/phase2-home/generated-image-lineage.json','artifacts/ultracode/pass3-h17/generated-image-lineage.json','assets/provider-logos/manifest.json','assets/provider-logos/pass2-lp-atlas.json']){
    const f=path.join(root,rel);manifests.push({path:f,exists:fs.existsSync(f),data:fs.existsSync(f)?read(f):null});
  }
  const knownHashes=new Map();
  for(const m of manifests)walk(m.data,(x,p)=>{for(const key of ['sha256','output_sha256','master_sha256'])if(/^[a-f0-9]{64}$/.test(x[key]||'')){const a=knownHashes.get(x[key])||[];a.push({manifest:m.path,pointer:p,width:x.width,height:x.height,path:x.path||x.file||x.output_file||x.name,kind:key});knownHashes.set(x[key],a);}});
  const approvedHashes=new Map();
  for(const asset of [...approved.assets,...(approved.cutouts||[])])walk(asset,(x,p)=>{if(x.file?.startsWith('web/')&&x.sha256)approvedHashes.set(x.sha256,{asset:asset.asset,...x,pointer:p});});
  const assetCache=new Map();
  const assetInfo=url=>{
    if(!url)return {status:'NOT_EXERCISED',reason:'No requested/selected image URL'};
    const u=new URL(url,origin);if(u.origin!==origin)return {status:'FAIL',reason:'remote image',url:u.origin+u.pathname};
    const f=path.resolve(root,'public','.'+decodeURIComponent(u.pathname));
    if(!f.startsWith(path.resolve(root,'public')+'/'))return {status:'FAIL',reason:'outside public'};
    if(assetCache.has(f))return assetCache.get(f);
    const b=fs.existsSync(f)?fs.readFileSync(f):null,h=b?sha(b):null,a=h?approvedHashes.get(h):null;
    const result={url:u.pathname,exists:!!b,bytes:b?.length,sha256:h,approved_derivative:a||null,existing_lineage:h?knownHashes.get(h)||[]:[],master_or_raw:/\/(finals|raw)\//.test(u.pathname)};
    assetCache.set(f,result);return result;
  };
  const context=await page.context().browser().newContext({viewport:page.viewportSize(),deviceScaleFactor:1,javaScriptEnabled:false,serviceWorkers:'block',colorScheme:'dark'});
  await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin&&r.request().method()==='GET'&&!/^\/go(?:\/|$)/.test(u.pathname)?r.continue():r.abort();});
  const p=await context.newPage(),observations=[];
  try{for(const route of routes){
    let response;try{response=await p.goto(origin+route,{waitUntil:'load',timeout:30000});}catch(error){observations.push({route,status:'NOT_EXERCISED',error:error.message,images:[],cards:[],logos:[]});continue;}
    // No-JS exposes the real complete noscript card set; decode each actual image
    // after scrolling it into view, rather than treating loading=lazy as load proof.
    const before=await p.locator('main img').evaluateAll(ns=>ns.map(n=>({complete:n.complete,naturalWidth:n.naturalWidth,top:n.getBoundingClientRect().top,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
    const count=await p.locator('main img').count();
    for(let i=0;i<count;i++){
      const image=p.locator('main img').nth(i);
      await image.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
      await image.evaluate(n=>Promise.race([n.decode().then(()=>true,()=>false),new Promise(r=>setTimeout(()=>r(false),2500))]));
    }
    await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    const dom=await p.evaluate(()=>{
      const all=s=>[...document.querySelectorAll(s)];
      const rect=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y+scrollY,width:b.width,height:b.height};};
      const styles=n=>{const s=getComputedStyle(n);return {background:s.backgroundColor,backgroundImage:s.backgroundImage,color:s.color,objectFit:s.objectFit,filter:s.filter,animation:s.animationName,aspectRatio:s.aspectRatio,before:{background:getComputedStyle(n,'::before').backgroundImage,color:getComputedStyle(n,'::before').backgroundColor},after:{background:getComputedStyle(n,'::after').backgroundImage,color:getComputedStyle(n,'::after').backgroundColor}};};
      const url=n=>n.getAttribute('href')?new URL(n.getAttribute('href'),location.href).pathname:null;
      const images=all('main img').map((n,index)=>{const pic=n.closest('picture'),card=n.closest('[data-program],[data-pharmacy-card]'),slot=n.closest('figure,header,.p3-detail-rail,.review-logo,.review-logo--light')||pic||n.parentElement;return {index,src:n.getAttribute('src'),srcset:n.srcset,sizes:n.sizes,currentSrc:n.currentSrc,alt:n.getAttribute('alt'),width:n.getAttribute('width'),height:n.getAttribute('height'),naturalWidth:n.naturalWidth,naturalHeight:n.naturalHeight,loaded:n.complete&&n.naturalWidth>0,loading:n.loading,decoding:n.decoding,fetchPriority:n.fetchPriority,rect:rect(n),style:styles(n),slot:{tag:slot.tagName,class:slot.className,rect:rect(slot),style:styles(slot)},program:card?.dataset.program||pic?.dataset.providerVisual,pharmacy:card?.hasAttribute('data-pharmacy-card')?url(card):null,card:!!card,picture:pic?[...pic.querySelectorAll('source')].map(s=>({srcset:s.srcset,sizes:s.sizes,type:s.type,media:s.media,matches:!s.media||matchMedia(s.media).matches})):[]};});
      const cards=all('[data-phase3-provider]:not([data-provider-lazy-index]),[data-pharmacy-card]').map(n=>({program:n.dataset.program,pharmacy:n.hasAttribute('data-pharmacy-card')?url(n):null,tag:n.tagName,interactive:n.querySelectorAll('a,button,input,select,textarea').length,images:[...n.querySelectorAll('img')].map(i=>all('main img').indexOf(i)),logo:!!n.querySelector('.provider-logo:not(.provider-logo--wordmark),.review-logo img'),wordmark:!!n.querySelector('.provider-logo--wordmark,.p3-pharmacy-mark')}));
      const backgrounds=all('main *').flatMap(n=>['', '::before','::after'].map(pseudo=>({class:n.className,pseudo,background:getComputedStyle(n,pseudo||null).backgroundImage}))).filter(x=>x.background.includes('url('));
      const logos=all('.review-logo,.review-logo--light').map(n=>({class:n.className,rect:rect(n),style:styles(n)}));
      return {images,cards,backgrounds,logos,video:all('main video').length,headings:all('main h1').map(n=>({text:n.textContent,rect:rect(n)})),width:innerWidth,height:innerHeight};
    });
    for(const i of dom.images){i.initial=before[i.index];i.asset=assetInfo(i.currentSrc||i.src);i.sources=[...i.picture,{srcset:i.srcset||i.src,type:'img',sizes:i.sizes}].flatMap(s=>(s.srcset||'').split(',').map(x=>{const [url,descriptor]=x.trim().split(/\s+/);return {...s,srcset:undefined,url,descriptor,asset:assetInfo(url)};}));i.box_shift=i.initial?{width:i.rect.width-i.initial.width,height:i.rect.height-i.initial.height}:null;}
    // Measure the actual rendered composite, not luminance of a CSS color.
    // Text is temporarily transparent while its unchanged box/background is
    // captured; minimum contrast over the complete text rectangle is conservative.
    for(const image of dom.images.filter(i=>i.asset.approved_derivative?.asset.startsWith('scene-'))){
      const node=p.locator('main img').nth(image.index);
      const meta=await node.evaluate(n=>{
        const slot=n.closest('header,figure')||n.closest('picture')?.parentElement||n.parentElement;
        slot.scrollIntoView({block:'center',behavior:'instant'});
        const b=slot.getBoundingClientRect(),x=Math.max(0,b.x),y=Math.max(0,b.y),right=Math.min(innerWidth,b.right),bottom=Math.min(innerHeight,b.bottom);
        const texts=[...slot.querySelectorAll('*')].filter(t=>t.childNodes.length&&[...t.childNodes].some(v=>v.nodeType===3&&v.textContent.trim()));
        window.__glp34ContrastRestore=texts.map(t=>({n:t,style:t.getAttribute('style')}));
        const rows=texts.map(t=>{const r=t.getBoundingClientRect(),s=getComputedStyle(t);return {text:t.textContent.trim(),color:s.color,opacity:s.opacity,x:r.x-x,y:r.y-y,width:r.width,height:r.height};}).filter(t=>t.width>0&&t.height>0);
        texts.forEach(t=>{t.style.setProperty('color','transparent','important');t.style.setProperty('text-shadow','none','important');t.style.setProperty('-webkit-text-fill-color','transparent','important');});
        return {clip:{x,y,width:right-x,height:bottom-y},texts:rows};
      });
      try{
        if(meta.clip.width<=0||meta.clip.height<=0||!meta.texts.length){image.composite_contrast={status:'NOT_EXERCISED',reason:'No visible text overlaps the scene slot',meta};continue;}
        const png=await p.screenshot({clip:meta.clip,scale:'css'});
        image.composite_contrast=await p.evaluate(async ({png,texts})=>{
          const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
          const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
          const rows=texts.map(t=>{const color=t.color.match(/[\d.]+/g)?.map(Number);if(!color||color.length<3||Number(t.opacity)!==1||(color[3]??1)!==1)return {...t,status:'NOT_EXERCISED',reason:'nonopaque/unsupported text paint'};let minimum=Infinity,samples=0;const l=lum(color.slice(0,3));for(let y=Math.max(0,Math.ceil(t.y));y<Math.min(canvas.height,Math.floor(t.y+t.height));y++)for(let x=Math.max(0,Math.ceil(t.x));x<Math.min(canvas.width,Math.floor(t.x+t.width));x++){const off=(y*canvas.width+x)*4,v=lum([...pixels.slice(off,off+3)]);minimum=Math.min(minimum,(Math.max(l,v)+.05)/(Math.min(l,v)+.05));samples++;}return {...t,samples,minimum: samples?minimum:null,status:!samples?'NOT_EXERCISED':minimum>=4.5?'PASS':'FAIL'};});
          return {method:'actual-screenshot-background-under-transparent-text; every pixel in text rectangles',status:rows.length&&rows.every(r=>r.status==='PASS')?'PASS':rows.some(r=>r.status==='FAIL')?'FAIL':'NOT_EXERCISED',rows};
        },{png:png.toString('base64'),texts:meta.texts});
      }catch(error){image.composite_contrast={status:'NOT_EXERCISED',reason:error.message};}
      finally{await p.evaluate(()=>{for(const {n,style} of window.__glp34ContrastRestore||[])style===null?n.removeAttribute('style'):n.setAttribute('style',style);delete window.__glp34ContrastRestore;});}
    }
    for(const b of dom.backgrounds)b.assets=[...b.background.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m=>assetInfo(m[1]));
    observations.push({route,status:response?.status(),...dom});
  }}finally{await context.close();}
  const allImages=observations.flatMap(o=>o.images.map(i=>({...i,route:o.route})));
  const scenes=allImages.filter(i=>i.asset.approved_derivative?.asset.startsWith('scene-'));
  const listingScenes=scenes.filter(i=>i.card),detailScenes=scenes.filter(i=>!i.card);
  const cards=observations.flatMap(o=>o.cards.map(c=>({...c,route:o.route})));
  const pharmacyCards=cards.filter(c=>c.route==='/pharmacies/'&&c.pharmacy);
  const sourceComplete=check('Every source-declared route exercised, including every registry/provider and pharmacy detail',observations.length===routes.length&&every(observations,o=>o.status===200),{expected:routes,observed:observations.map(o=>({route:o.route,status:o.status}))});
  const cRoutes=mappings.filter(m=>m.type==='C').map(m=>m.route);
  const exclusion=check('Every C route contains no hero/panel asset or hero video',every(cRoutes,r=>{const o=observations.find(o=>o.route===r);return o?.status===200&&o.video===0&&!o.images.some(i=>/funnel-hero|med-|p3-product-visual|hero|panel/i.test((i.asset.approved_derivative?.asset||'')+' '+i.slot.class));}),{routes:cRoutes});
  const dimension=i=>Number(i.width)>0&&Number(i.height)>0&&i.loaded&&Math.abs(Number(i.width)/Number(i.height)-i.rect.width/i.rect.height)<.03;
  for(const image of allImages){
    const selected=image.asset.approved_derivative;
    image.mechanical_checks=[
      check('actual decode after scroll',image.loaded,{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,initial:image.initial}),
      check('explicit width/height reserve the rendered ratio',dimension(image),{width:image.width,height:image.height,rect:image.rect,box_shift:image.box_shift}),
      check('browser currentSrc belongs to declared source/fallback set',image.sources.some(s=>s.asset.url===image.asset.url),{currentSrc:image.currentSrc,candidates:image.sources.map(s=>({url:s.asset.url,descriptor:s.descriptor,type:s.type,media:s.media,matches:s.matches}))}),
      check('all width descriptors agree with SHA-matched manifest widths',image.sources.every(s=>!s.descriptor?.endsWith('w')||!s.asset.approved_derivative||parseInt(s.descriptor,10)===s.asset.approved_derivative.width),image.sources),
      selected?check('selected resource has decoded aspect ratio matching approved bytes',Math.abs(image.naturalWidth/image.naturalHeight-selected.width/selected.height)<.01,{selected,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}):gap('selected asset is not in approved Pass7 derivative manifest',{sha256:image.asset.sha256,existing_lineage:image.asset.existing_lineage})
    ];
    const original=observations.find(o=>o.route===image.route)?.images[image.index];if(original)original.mechanical_checks=image.mechanical_checks;
  }
  const formats=(i,width)=>i.sources.some(s=>s.type==='image/avif'&&s.asset.approved_derivative?.width===width)&&i.sources.some(s=>(s.type==='image/webp'||s.url?.endsWith('.webp'))&&s.asset.approved_derivative?.width===width);
  const sceneFormat=(xs,width)=>xs.length?[check(`Every expected scene uses exact ${width}w AVIF/WebP, reserved dimensions, async decoding, local approved hash`,every(xs,i=>formats(i,width)&&dimension(i)&&i.decoding==='async'&&i.sources.every(s=>s.asset.approved_derivative?.width===width&&!s.asset.master_or_raw)),xs),check('Every below-fold scene actually decodes after scroll and remains lazy with unchanged box',every(xs,i=>i.loaded&&(!i.initial||i.initial.top<observations.find(o=>o.route===i.route).height||i.loading==='lazy')&&i.box_shift?.width===0&&i.box_shift?.height===0),xs.map(i=>({route:i.route,index:i.index,loading:i.loading,initial:i.initial,box_shift:i.box_shift})))]:[gap(`No ${width}w approved scene instance was rendered; slot/format/loading not exercised`)];
  const sceneBindings=[];
  const neutralProvider='scene-provider-evidence-desk',neutralPharmacy='scene-pharmacy-facility';
  const predicatePatterns={'scene-provider-messaging':/asynchronous|async|messag/i,'scene-provider-consult':/video|phone|telephon/i,'scene-provider-coaching':/nutrition|coaching/i,'scene-provider-pharmacy-choice':/pharmacy choice|choose.{0,30}pharmac/i,'scene-provider-coldchain-arrival':/cold.chain|refrigerat|temperature.control/i,'scene-pharmacy-licensing':/licens/i,'scene-pharmacy-coldchain-outbound':/cold.chain|refrigerat|temperature.control/i};
  for(const image of scenes){
    const id=image.asset.approved_derivative.asset;
    const provider=image.program||registry.find(r=>`/providers/${r.program_id}/`===image.route||r.review_path===image.route)?.program_id;
    const pharm=pharmacy.find(p=>p.route===(image.pharmacy||image.route));
    const records=pharm?[pharm]:[...(ledger.programs||[]),...(facts.programs||[])].filter(r=>r.program_id===provider);
    const support=[];
    for(const record of records)walk(record,(x,pointer)=>{const quote=x.exact_quote||x.quote;const url=x.source_url||x.url;const date=x.capture_date||x.checked_date||x.accessed_date;if(quote&&/^https:\/\//.test(url||'')&&date&&predicatePatterns[id]?.test(quote)&&! /\b(no|not|unknown|unverified)\b/i.test(quote))support.push({pointer,id:x.id||null,quote,url,date});});
    const neutral=[neutralProvider,neutralPharmacy].includes(id);
    sceneBindings.push({route:image.route,index:image.index,id,provider,pharmacy:pharm?.slug,neutral,support,status:neutral?'PASS':support.length?'PASS':'NOT_EXERCISED',detail_only_valid:id!=='scene-pharmacy-coldchain-outbound'||(!image.card&&!!pharm)});
  }
  // Expected fallback slots come from all actual complete source cards AND all
  // source-declared detail identities, not only from the images that happened to load.
  const fallbackSlots=[...cards.filter(c=>!c.logo).map(c=>({route:c.route,program:c.program,pharmacy:c.pharmacy,slot:'card',width:480,expected:c.pharmacy?neutralPharmacy:neutralProvider})),...registry.map(r=>({route:`/providers/${r.program_id}/`,program:r.program_id,slot:'detail',width:768,expected:neutralProvider,logo:logos.logos.some(l=>l.program_id===r.program_id)})),...pharmacy.map(r=>({route:r.route,pharmacy:r.route,slot:'detail',width:768,expected:neutralPharmacy}))].filter(s=>!s.logo);
  for(const slot of fallbackSlots){slot.observed=sceneBindings.filter(b=>b.route===slot.route&&(slot.program?b.provider===slot.program:b.pharmacy===pharmacy.find(p=>p.route===slot.pharmacy)?.slug)).map(b=>({id:b.id,status:b.status,index:b.index}));slot.status=slot.observed.length&&slot.observed.every(b=>b.status==='PASS')?'PASS':'NOT_EXERCISED';}
  const bindingsCheck=(kind)=>{const slots=fallbackSlots.filter(s=>kind==='provider'?!!s.program:kind==='pharmacy'?!!s.pharmacy:true);const evidence={expected_slots:slots,actual_bindings:sceneBindings};return !slots.length||slots.some(s=>s.status==='NOT_EXERCISED')?gap('Every independently expected fallback slot must have its neutral or documented service scene',evidence):check('Every independently expected fallback slot has its neutral or documented service scene',every(slots,s=>s.status==='PASS')&&sceneBindings.every(s=>s.status==='PASS'&&s.detail_only_valid),evidence);};
  const pharmacySet=check('All source-eligible pharmacy cards represented exactly',JSON.stringify(pharmacyCards.map(c=>c.pharmacy).sort())===JSON.stringify([...expectedPharmacyCards].sort())&&expectedPharmacyCards.length>0,{expected:expectedPharmacyCards,observed:pharmacyCards.map(c=>c.pharmacy)});
  const hero=allImages.filter(i=>i.route==='/compare/'&&i.asset.approved_derivative?.asset===(page.viewportSize().width<768?'funnel-hero-alt':'funnel-hero'));
  const heroChecks=()=>[check('Compare source-specific desktop/mobile hero exists, exact approved derivative SHA',hero.length===1,hero),...(hero.length?[check('Hero width/ratio/source selection, reserved geometry, AVIF/WebP high/eager/async and no video',every(hero,i=>{const width=page.viewportSize().width<768?1200:page.viewportSize().width>=1600?2400:1600;return formats(i,width)&&i.asset.approved_derivative.width===width&&dimension(i)&&i.loading==='eager'&&i.fetchPriority==='high'&&i.decoding==='async'&&(page.viewportSize().width<768||Math.abs(i.rect.width/i.rect.height-3840/1629)<.02);})&&observations.find(o=>o.route==='/compare/')?.video===0,hero)]:[gap('Hero mechanical srcset/ratio/loading probe: approved hero absent')]),exclusion];
  const railIDs=approved.assets.filter(a=>a.asset.startsWith('med-')).map(a=>a.asset);
  const railChecks=()=>railIDs.map(id=>{const xs=allImages.filter(i=>i.route==='/'&&i.asset.approved_derivative?.asset===id+'-cutout');return xs.length?check(`Rail ${id}: approved cutout,480/768 only,384x539 dark cover tile, lazy, static restrained shadow`,every(xs,i=>i.loaded&&i.style.objectFit==='cover'&&Math.abs(i.slot.rect.width-384)<2&&Math.abs(i.slot.rect.height-539)<2&&i.sources.every(s=>[480,768].includes(s.asset.approved_derivative?.width))&&i.loading==='lazy'&&i.style.animation==='none'&&i.style.filter.startsWith('drop-shadow(')),xs):gap(`Expected rail cutout ${id} missing; dimensions/cover/shadow/lazy not exercised`);});
  const brandChecks=()=>graph.brand_pages.map(b=>{const xs=allImages.filter(i=>i.route===b.route&&i.asset.approved_derivative?.asset==='med-'+b.slug);return xs.length?check(`${b.route} baked brand panel1200w AVIF/WebP and explicit geometry`,every(xs,i=>formats(i,1200)&&dimension(i)&&i.loading==='lazy'),xs):gap(`${b.route} approved1200w baked brand panel absent`,{existing:allImages.filter(i=>i.route===b.route&&/product/.test(i.slot.class))});});
  const lineage=()=>[check('All selected listing scene sources match approved web derivative SHA, never masters/remote',every(listingScenes,i=>i.sources.every(s=>s.asset.approved_derivative&&!s.asset.master_or_raw)),listingScenes),bindingsCheck()];
  const contrast=()=>[...sceneFormat(listingScenes,480),...listingScenes.map(i=>i.composite_contrast?.status==='NOT_EXERCISED'||!i.composite_contrast?gap('Composite pixel contrast ≥4.5:1',{route:i.route,index:i.index,...i.composite_contrast}):check('Actual screenshot composite text contrast ≥4.5:1',i.composite_contrast.status==='PASS',{route:i.route,index:i.index,...i.composite_contrast})),...(!listingScenes.length?[gap('No approved header scene rendered for actual composite pixel contrast',{expected_slots:fallbackSlots.filter(s=>s.slot==='card')})]:[]),visual('No washed-out gray band over the rendered card grid')];
  const target=id=>sceneBindings.filter(b=>b.id===id);
  const probes={
    'RN-00207':()=>[...heroChecks(),visual('F3 best-looking comparison destination judgment')],
    'RN-00322':lineage,
    'RN-02332':()=>{const xs=observations.flatMap(o=>(o.logos||[]).map(l=>({...l,route:o.route})));return [xs.length?check('Every review-logo treatment computed on dark surface, no opaque pale logo panel',every(xs,l=>{const c=l.style.background.match(/[\d.]+/g)?.map(Number)||[];return c.length>=3&&((c[3]??1)===0||Math.max(...c.slice(0,3))<100);}),xs):gap('No source-scoped review-logo/review-logo--light rendered')];},
    'RN-02399':heroChecks,'RN-02415':()=>[...heroChecks(),gap('Headline bounds inside approved lit zone',{headings:observations.find(o=>o.route==='/compare/')?.headings,reason:'Manifest provides descriptive lit zone, not normalized coordinate boundary'})],
    'RN-02428':()=>[...railChecks(),...brandChecks(),exclusion,gap('All rail scrim/veil composites measured dark; no pale cs-veil token and restrained drop-shadow thresholds')],
    'RN-02431':()=>[bindingsCheck('provider'),...sceneFormat(listingScenes.filter(i=>i.asset.approved_derivative.asset.startsWith('scene-provider-')),480),...sceneFormat(detailScenes.filter(i=>i.asset.approved_derivative.asset.startsWith('scene-provider-')),768)],
    'RN-02435':()=>[target('scene-provider-pharmacy-choice').length?check('Every pharmacy-choice scene has a dated exact supporting quote',every(target('scene-provider-pharmacy-choice'),b=>b.support.length>0),target('scene-provider-pharmacy-choice')):gap('No pharmacy-choice scene to match to documented facts'),...sceneFormat(scenes.filter(i=>i.asset.approved_derivative.asset==='scene-provider-pharmacy-choice'&&i.card),480),gap('Off-white vial area pixel inspection not exercised')],
    'RN-02439':()=>[bindingsCheck('pharmacy')],
    'RN-02440':()=>[pharmacySet,bindingsCheck('pharmacy'),...sceneFormat(listingScenes.filter(i=>i.asset.approved_derivative.asset.startsWith('scene-pharmacy-')),480),...sceneFormat(detailScenes.filter(i=>i.asset.approved_derivative.asset.startsWith('scene-pharmacy-')),768)],
    'RN-02442':()=>[target('scene-pharmacy-coldchain-outbound').length?check('All coldchain outbound uses documented cold-chain quote and detail-only slot',every(target('scene-pharmacy-coldchain-outbound'),b=>b.support.length>0&&b.detail_only_valid),target('scene-pharmacy-coldchain-outbound')):gap('No cold-chain outbound placement: source predicate and detail slot not exercised')],
    'RN-02443':()=>[pharmacySet,check('Imagery adds no nested CTA to any pharmacy card',every(pharmacyCards,c=>c.tag==='A'&&c.interactive===0),pharmacyCards),bindingsCheck('pharmacy'),visual('Rendered pharmacy scenes imply no accreditation')],
    'RN-02466':()=>[exclusion,...observations.filter(o=>o.route.startsWith('/lp/r/')&&o.images.some(i=>i.asset.approved_derivative?.asset.startsWith('funnel-hero'))).map(o=>gap('Optional generic router hero requires route-specific permitted slot and speed measurement',{route:o.route}))],
    'RN-02467':()=>[bindingsCheck(),check('All nonneutral scenes use dated cited source predicate; coldchain detail-only',every(sceneBindings,b=>b.status==='PASS'&&b.detail_only_valid),sceneBindings)],
    'RN-02469':contrast,'RN-02754':contrast,
    'RN-02402':()=>[bindingsCheck(),visual('Neutral composites do not imply invented services/accreditation')],
    'RN-02493':()=>[gap('Two neutral facility variants are future commission backlog, not generated by this handler',{existing_approved_ids:approved.assets.filter(a=>a.asset.startsWith(neutralPharmacy)).map(a=>a.asset),source_disposition:'imagery.md:146 says no commission is blocking for Pass7; existing neutral defaults allowed'}),bindingsCheck('pharmacy')],
    'RN-EXTRA-3837':()=>[...brandChecks(),visual('Recorded operator/Fable product-render versus typographic-float disposition')]
  };
  const out=path.join(execution,'after');fs.mkdirSync(out,{recursive:true});
  const evidence=path.join(out,`${label}-imagery-observations.json`);
  fs.writeFileSync(evidence,JSON.stringify({viewport:label,mode:'real-browser-no-js-all-source-routes',expected_routes:routes,expected_pharmacy_cards:expectedPharmacyCards,expected_fallback_slots:fallbackSlots,source_assets:manifests.map(m=>({path:m.path,exists:m.exists,sha256:m.exists?sha(fs.readFileSync(m.path)):null})),approved_manifest:prep+'/MANIFEST.json',approved_manifest_sha256:sha(fs.readFileSync(prep+'/MANIFEST.json')),logo_atlas_entries:atlas.entries?.length,scene_bindings:sceneBindings,observations},null,2)+'\n');
  const result={};
  for(const c of classes){
    const expected=histogram.primary_histogram.find(x=>x.class===c).occurrence_ids;
    const rows=expected.map(id=>{const n=notes.get(id),occ=histogram.occurrences.find(o=>o.id===id);assert(n?.literal_requirement&&probes[id]);const checks=[sourceComplete,...probes[id]()];return {id,literal_requirement:n.literal_requirement,source_path:n.source_path,source_line:n.source_line,compound_effects:(occ.compound_effects||[]).map(effect=>({...effect,probe_names:checks.map(c=>c.name),status:checks.every(c=>c.status==='PASS')?'PASS':'NOT_EXERCISED'})),checks,evidence,status:checks.every(c=>c.status==='PASS')?'PASS':'UNRESOLVED'};});
    result[c]=rows.filter(r=>r.status==='PASS').map(r=>r.id);
    fs.writeFileSync(path.join(out,`${label}-${c}-class.json`),JSON.stringify({class:c,viewport:label,expected:expected.length,resolved:result[c],rows,evidence},null,2)+'\n');
    console.log(`GLP34_CLASS ${label} ${c} ${result[c].length}/${expected.length}`);
  }
  return result;
}
