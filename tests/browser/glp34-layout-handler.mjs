import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const execution = '/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
const every = (rows, fn) => rows.length > 0 && rows.every(fn);
const near = (a,b) => Math.abs(a-b) <= 2;

// Returns only resolved occurrence IDs. Missing witnesses remain explicit rows.
export async function layoutClass(page, origin, viewport) {
  assert(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname));
  const histogram = JSON.parse(fs.readFileSync(path.join(execution,'histogram.json')));
  const source = JSON.parse(fs.readFileSync(path.join(execution,'before/source-inventory.json')));
  const expected = histogram.primary_histogram.find(x=>x.class==='responsive-layout-dark-surfaces').occurrence_ids;
  assert.equal(expected.length,33);
  const notes = new Map();
  const collect = x => { if(Array.isArray(x)) x.forEach(collect); else if(x && typeof x==='object') { if(expected.includes(x.id)) notes.set(x.id,x); else Object.values(x).forEach(collect); } };
  collect(source); assert.equal(notes.size,33);
  const files=[];
  const walk = dir => { for(const e of fs.readdirSync(dir,{withFileTypes:true})) { const f=path.join(dir,e.name); if(e.isDirectory()) walk(f); else if(e.name==='index.html') files.push(f); } };
  walk(path.join(root,'public'));
  const emitted=files.map(f=>'/'+path.relative(path.join(root,'public'),f).replace(/index\.html$/,''))
    .filter(r=>/^\/(?:providers|self-pay|pharmacies|reviews|lp\/best-providers)(?:\/|$)/.test(r)||r==='/');
  const mappingText=fs.readFileSync('/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass7-spec-20260902/specs/listing-template.md','utf8');
  const required=[...mappingText.matchAll(/^\| (\d{2}) \| `([^`]+)` \| ([ABCDE]) \| (.+) \|$/gm)].map(m=>m[2]);
  assert.equal(required.length,26);
  const routes=[...new Set([...required,'/self-pay/','/',...emitted])];
  assert(routes.length>0);
  const label=typeof viewport==='string'?viewport:`${viewport.width}x${viewport.height}`;
  assert(/^[\w-]+$/.test(label));
  const after=path.join(execution,'after');fs.mkdirSync(after,{recursive:true});
  const observations=[];
  for(const route of routes) {
    const response=await page.goto(origin+route,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>document.fonts.ready);
    const data=await page.evaluate(()=>{
      const rect=n=>{const b=n.getBoundingClientRect();const s=getComputedStyle(n);return {x:b.x,y:b.y+scrollY,width:b.width,height:b.height,bottom:b.bottom+scrollY,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,background:s.backgroundColor,image:s.backgroundImage,overflowX:s.overflowX,transform:s.transform};};
      const all=s=>[...document.querySelectorAll(s)].filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);
      const cards=all('.p3-pharmacy-card');
      const grid=document.querySelector('.p3-pharmacy-grid');
      const first=document.querySelector('.p3-provider-card,.p3-pharmacy-card');
      const lights=all('main, main *').filter(n=>{const s=getComputedStyle(n),b=n.getBoundingClientRect(),c=s.backgroundColor.match(/[\d.]+/g)?.map(Number)||[];return b.width*b.height>=10000&&c.length>=3&&(c[3]??1)>.8&&Math.min(...c.slice(0,3))>180;}).map(n=>({tag:n.tagName,class:n.className,...rect(n)}));
      return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
        first:first?{...rect(first),text:first.textContent.trim(),lazy:first.hasAttribute('data-provider-lazy-index'),actions:first.querySelectorAll('a,button').length}:null,
        sections:all('main > .p3-provider-grid,main > .p3-filterbar,main > .p3-pharmacy-grid').map(rect),
        grid:grid?{...rect(grid),gap:parseFloat(getComputedStyle(grid).gap),columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length}:null,
        cards:cards.map(n=>({...rect(n),pseudo:getComputedStyle(n,'::before').content,mark:n.querySelector('.p3-pharmacy-mark')?rect(n.querySelector('.p3-pharmacy-mark')):null,name:n.querySelector('h2,h3')?.textContent.trim()})),
        filters:all('.p3-pharmacy-filters,.p3-pharmacy-filters input,.p3-pharmacy-filters select').map(rect),lights,
        actions:all('.p3-card-actions').map(n=>({count:n.querySelectorAll('a,button').length,...rect(n),children:[...n.querySelectorAll('a,button')].map(rect)})),
        controls:all('header a,header button,.p3-provider-card a,.p3-provider-card button,.p3-story a,.p3-story button,.p3-pharmacy-card a,.p3-pharmacy-card button,.p3-pharmacy-filters input,.p3-pharmacy-filters select').map(rect),
        rails:all('.p3-med-tabs,.review-jump-nav,.review-rail,.p3-pharmacy-grid').map(rect)};
    });
    const screenshot=path.join(after,`${label}-layout-${route.replace(/[^a-z0-9]/gi,'_')||'home'}.png`);
    // All named index states receive current screenshots, never historical fixtures.
    if(['/','/providers/','/self-pay/','/pharmacies/','/reviews/'].includes(route)) await page.screenshot({path:screenshot,fullPage:true});
    observations.push({route,status:response?.status(),...data,screenshot:fs.existsSync(screenshot)?screenshot:null});
  }
  const pharmacy=observations.filter(x=>x.route==='/pharmacies/');
  const listings=observations.filter(x=>x.route==='/providers/'||x.route==='/self-pay/'||x.route.startsWith('/lp/best-providers/'));
  const cards=pharmacy.flatMap(x=>x.cards);
  const check=(name,pass,evidence)=>({name,status:pass?'PASS':'FAIL',evidence});
  const witness=name=>({name,status:'UNVERIFIED',witness_only:false,evidence:'NOT_EXERCISED: complete mechanical or reference-comparison evidence is missing. This is not itself a request for independent signature.'});
  const budget=(rows,desktop,mobile)=>every(rows,x=>x.status===200&&x.first&&x.first.y<=(x.width<=760?mobile:desktop)&&x.first.bottom<=x.height);
  const predicates={
    'RN-02613':()=>check('every emitted listing section is centered and bounded 1024 / viewport minus32',every(listings,x=>every(x.sections,s=>s.width<=1026&&near(s.x,(x.width-s.width)/2)&&(x.width>760||near(s.width,x.width-32)))) ,listings),
    'RN-02617':()=>check('pharmacy grid centered 960 desktop / viewport minus32 mobile',every(pharmacy,x=>x.grid&&near(x.grid.width,Math.min(960,x.width-32))&&near(x.grid.x,(x.width-x.grid.width)/2)),pharmacy),
    'RN-02618':()=>check('pharmacy grid16 gap and3 desktop/1 mobile columns',every(pharmacy,x=>x.grid&&near(x.grid.gap,16)&&x.grid.columns===(x.width<=760?1:3)),pharmacy),
    'RN-02627':()=>check('all C routes first card top400 desktop/380 mobile and fully visible',budget(listings.filter(x=>x.route.startsWith('/lp/')),400,380),listings.filter(x=>x.route.startsWith('/lp/'))),
    'RN-02629':()=>check('pharmacy first card top380 desktop/600 mobile and fully visible',budget(pharmacy,380,600),pharmacy),
    'RN-02630':()=>check('both E routes first real nonshell card top400/380 fully visible',budget(listings.filter(x=>!x.route.startsWith('/lp/')),400,380)&&every(listings.filter(x=>!x.route.startsWith('/lp/')),x=>x.first&&!x.first.lazy&&x.first.text.length>100&&x.first.actions>0),listings.filter(x=>!x.route.startsWith('/lp/'))),
    'RN-02644':()=>check('every pharmacy card desktop309.333 wide and400–620 high; row tops align',every(pharmacy,x=>x.width>760&&every(x.cards,c=>near(c.width,309.333)&&c.height>=400&&c.height<=620)&&x.cards.every((c,i)=>i%3===0||near(c.y,x.cards[i-i%3].y))),cards),
    'RN-02760':()=>check('listing spec section9: every pharmacy logo70x70 and name≤19 characters',every(cards,c=>c.mark&&near(c.mark.width,70)&&near(c.mark.height,70)&&c.name&&c.name.length<=19),cards),
    'RN-02812':()=>check('every pharmacy card has no blob/background image and no opaque gray inner panels',every(cards,c=>c.pseudo==='none'&&c.image==='none')&&every(pharmacy,x=>x.lights.length===0),pharmacy),
    'RN-02849':()=>check('replacement pharmacy panel/blob styling rendered on every card',every(cards,c=>c.pseudo==='none'&&c.image==='none'),cards),
    'RN-02848':()=>check('all pharmacy filter surfaces rendered dark, not translucent light',every(pharmacy,x=>every(x.filters,f=>{const c=f.background.match(/[\d.]+/g)?.map(Number)||[];return c.length>=3&&Math.max(...c.slice(0,3))<100&&(c[3]??1)>.8;})),pharmacy),
    'RN-02002':()=>check('all named review actions wrap inside card action group, ≤2 actions and no overlap',every(listings,x=>every(x.actions,a=>a.count>0&&a.count<=2&&a.scrollWidth<=a.clientWidth+1&&a.children.every((c,i)=>c.x>=a.x-1&&c.x+c.width<=a.x+a.width+1&&a.children.every((d,j)=>i===j||c.x+c.width<=d.x+1||d.x+d.width<=c.x+1||c.bottom<=d.y+1||d.bottom<=c.y+1))))&&every(listings,x=>x.documentWidth<=x.width),listings),
  };
  // These requirements include historical ownership, untouched surfaces, reference
  // design equivalence or control states not proven by a default-state DOM pass.
  const uncovered={
    'RN-00108':'Review-tab opened cards prioritized over submission form',
    'RN-00111':'Exact One honest confirmation text remains within its card',
    'RN-00130':'Every corresponding destination, animation, interactive defect and screenshot reference parity',
    'RN-00160':'Complete reference pharmacy-card anatomy and visual equivalence',
    'RN-00290':'All funnel responsive states and historical file-owner constraint',
    'RN-00292':'Provider-detail before-failure proof and conditional change history',
    'RN-01859':'F1/F2 history does not modify listing anatomy, palette or motion',
    'RN-01980':'375 and1440 post-copy geometry plus no padding and registry-owned counts',
    'RN-02351':'Complete funnel dark-surface scope',
    'RN-02621':'All listing CSS uses local tokens without scaling/fixed-width mechanisms',
    'RN-02639':'All A/C/E initial document heights at1920≤5000, including A routes',
    'RN-02808':'Focus, empty, error, skeleton, native listbox, FAQ and naturally deferred states all dark',
    'RN-02810':'Paper mechanism removed throughout listing descendant CSS, not tint overlays',
    'RN-02815':'Every listing stylesheet free of paper token invocation',
    'RN-02842':'Local1024/992 tokens and untouched global-container regression',
    'RN-02843':'Foundation paper mechanism prohibited in every listing state',
    'RN-02853':'Review jump-nav internal scroll plus preserved approved full-screen layout',
    'RN-02854':'Review rail internal scroll plus preserved approved full-screen layout',
    'RN-EXTRA-3765':'Exact legacy homepage capture aside current rendered disposition',
    'RN-EXTRA-3804':'All four named intentional overflow surfaces contained at390x844',
    'RN-EXTRA-3809':'All named header/CTA/sticky/provider/story/pharmacy targets44; sticky and filters48',
  };
  assert.deepEqual([...Object.keys(predicates),...Object.keys(uncovered)].sort(),[...expected].sort());
  const rows=expected.map(id=>{
    const occurrence=histogram.occurrences.find(x=>x.id===id);
    const checks=[predicates[id]?predicates[id]():witness(uncovered[id])];
    if (id==='RN-02812'||id==='RN-02849') checks.push(witness('Every inner pharmacy panel gray/background mechanism reviewed against reference, beyond outer card/pseudo-element measurements'));
    if (id==='RN-02002') checks.push(witness('375px all deferred long-name review labels naturally hydrated, individually screenshot-proven'));
    if (id==='RN-02613') checks.push(witness('All A/B listing sections beyond emitted C/D/E route census'));
    if (id==='RN-02630') checks.push(witness('Initial server card HTML has complete real content before JavaScript hydration'));
    if (id==='RN-02760') checks.push(witness('Compact pharmacy logo actually rendered image/content, not dimensions alone'));
    // Compounds are resolved by an explicit complete predicate only, never by class membership.
    const implementedCompounds=new Set(['RN-02002','RN-02630','RN-02760']);
    for(const c of occurrence.compound_effects||[]) if(!implementedCompounds.has(id)) checks.push(witness(c.effect));
    return {id,requirement:notes.get(id).literal_requirement,source_path:notes.get(id).source_path,source_line:notes.get(id).source_line,compound_effects:occurrence.compound_effects,predicates:checks,status:checks.every(c=>c.status==='PASS')?'PASS':checks.some(c=>c.status==='FAIL')?'FAIL':'UNVERIFIED'};
  });
  const passed=rows.filter(x=>x.status==='PASS').map(x=>x.id);
  fs.writeFileSync(path.join(after,`${label}-layout-class.json`),JSON.stringify({class:'responsive-layout-dark-surfaces',viewport:page.viewportSize(),generated_at:new Date().toISOString(),expected:33,resolved_count:passed.length,resolved_ids:passed,rows,observations},null,2)+'\n');
  return passed;
}
