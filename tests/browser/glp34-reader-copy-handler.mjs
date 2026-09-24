import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const execution='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/K10/EXECUTION/K10-007-D';
export const check=(name,pass,detail)=>({name,status:pass?'PASS':'FAIL',detail});
export const gap=(name,detail)=>({name,status:'NOT_EXERCISED',detail});
export function records(className,ids){
 const h=JSON.parse(fs.readFileSync(path.join(execution,'histogram.json'))),s=JSON.parse(fs.readFileSync(path.join(execution,'before/source-inventory.json')));
 const expected=h.primary_histogram.find(r=>r.class===className).occurrence_ids;
 assert.deepEqual([...ids].sort(),[...expected].sort());
 return expected.map(id=>({...h.occurrences.find(r=>r.id===id),literal_requirement:s.notes.find(r=>r.id===id).literal_requirement}));
}
export function finish(viewport,className,suffix,rows,evidence){
 if(evidence.sourceScope)for(const r of rows)r.checks.unshift(evidence.sourceScope);
 for(const r of rows)for(const compound of r.compound_effects||[])if(!(r.verified_compounds||[]).includes(compound.effect))r.checks.push(gap('Compound: '+compound.effect,'No complete secondary-obligation proof is attached; primary checks alone do not resolve this occurrence.'));
 const resolved=rows.filter(r=>r.checks.length&&r.checks.every(c=>c.status==='PASS')).map(r=>r.id);
 for(const r of rows)r.status=resolved.includes(r.id)?'RESOLVED':'UNRESOLVED';
 const output=path.join(execution,className==='reader-language-copy'?'reader':'after');
 fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,`${viewport}-${suffix}-class.json`),JSON.stringify({viewport,class:className,denominator:rows.length,resolved_count:resolved.length,resolved,rows,evidence},null,2)+'\n');return resolved;
}
export function local(origin){assert(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname));}
export async function allOutput(page,origin){
 local(origin);const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.html'))files.push(f);}};walk(path.join(root,'public'));assert(files.length);
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});const rows=[];
 for(let i=0;i<files.length;i+=15){const batch=files.slice(i,i+15).map(f=>{const html=fs.readFileSync(f,'utf8'),src=html.match(/data-provider-card-payloads\s+data-src="([^"]+)"/)?.[1];assert(!src||/^\/assets\/[\w.-]+\.json$/.test(src));return {route:'/'+path.relative(path.join(root,'public'),f).replace(/index\.html$/,''),html,payload:src?JSON.parse(fs.readFileSync(path.join(root,'public',src))):null};});
 rows.push(...await page.evaluate(batch=>batch.map(({route,html,payload})=>{const d=new DOMParser().parseFromString(html,'text/html');for(const t of [...d.querySelectorAll('template')])t.replaceWith(t.content.cloneNode(true));const bodies=payload||JSON.parse(d.querySelector('[data-provider-card-payloads]')?.textContent||'[]');for(const c of d.querySelectorAll('[data-provider-lazy-index]')){const body=bodies[Number(c.dataset.providerLazyIndex)];if(typeof body!=='string')throw Error('missing payload '+route);c.innerHTML=body;}d.querySelectorAll('script,style').forEach(n=>n.remove());return {route,text:d.body.textContent.replace(/\s+/g,' ').trim(),h1:d.querySelector('h1')?.textContent.trim(),listing:!!d.querySelector('[data-provider-filters]'),pharmacy:!!d.querySelector('[data-pharmacy-filters]'),sticky:!!d.querySelector('.p3-provider-sticky'),auroras:d.querySelectorAll('.p3-card-aurora').length,motion:[...d.querySelectorAll('[data-motion]')].map(n=>({tag:n.tagName,once:n.dataset.motionOnce,kind:n.dataset.motion})),priceNotes:[...d.querySelectorAll('.p3-price-note,[data-price-evidence]')].map(n=>n.textContent.trim())};}),batch));}
 const graph=JSON.parse(fs.readFileSync(path.join(root,'data/phase3-page-graph.json')));
 const pharmacies=JSON.parse(fs.readFileSync(path.join(root,'data/phase3-pharmacy-render-input.json'))).entries;
 const registry=JSON.parse(fs.readFileSync(path.join(root,'data/program-registry.json'))).programs;
 const expected=[...new Set(['/', '/providers/', '/pharmacies/', '/reviews/', ...['brand_pages','compounded_pages','organic_compounded_pages','bulk_pages'].flatMap(k=>(graph[k]||[]).map(p=>p.route)),...pharmacies.map(p=>p.route),...registry.filter(p=>p.review_path&&p.commercial_state==='live'&&Object.values(p.profiles||{}).some(profile=>profile.vertical_fit&&profile.wired&&profile.surfaces?.review&&profile.canonical_identity?.role!=='alias')).map(p=>p.review_path)])];
 rows.sourceScope=check('independent source-configured route denominator exists before instance checks',expected.every(route=>rows.some(p=>p.route===route)),{expected,missing:expected.filter(route=>!rows.some(p=>p.route===route))});
 return rows;
}
const requirements={
 'RN-00109':['moderation'], 'RN-00112':['counterpart'], 'RN-00202':['providerJargon'],'RN-00203':['providerJargon'],'RN-00204':['providerJargon'],'RN-00205':['allJargon','counts and dated-price preservation'],
 'RN-00431':['search'],'RN-00432':['search'],'RN-00466':['trust trio plain language and third-card capture'], 'RN-00555':['priceNotes','source-price truth'], 'RN-00568':['kill'], 'RN-01047':['categoryJargon','presentation independent review'], 'RN-01301':['review retargeting provenance'], 'RN-01829':['allJargon','source and unknown preservation'], 'RN-01865':['intro'], 'RN-01867':['second','registry reachability'], 'RN-01878':['attribution','every fact source/date'], 'RN-EXTRA-3755':['related'], 'RN-EXTRA-3797':['selfDeprecation'], 'RN-EXTRA-3823':['kill'], 'RN-EXTRA-3834':['kill','legacy capture aside and footer exact replacement'], 'RN-EXTRA-3839':['accordion scope decision'], 'RN-EXTRA-3840':['global scope decision'], 'RN-EXTRA-3854':['categoryJargon','both category introductions source-price truth']};
export async function readerCopyClass(page,origin,viewport){
 const rows=records('reader-language-copy',Object.keys(requirements)),output=await allOutput(page,origin);
 const sweep=(name,regex,scope=output)=>{const hits=scope.flatMap(p=>[...p.text.matchAll(regex)].map(m=>({route:p.route,match:m[0],context:p.text.slice(Math.max(0,m.index-70),m.index+140)})));return check(name,scope.length>0&&!hits.length,{routes:scope.map(p=>p.route),hits});};
 const jargon=/\b(?:governed(?: provider)? records?|canonical provider records?|evidence-qualified card contract|registry scope|capture hashed|in our capture|the dated evidence)\b/gi;
 const provider=output.filter(p=>p.route==='/providers/'),categories=output.filter(p=>['/semaglutide/','/tirzepatide/'].includes(p.route));
 const predicates={providerJargon:()=>sweep('provider prose has no named engineering phrases',jargon,provider),allJargon:()=>sweep('all HTML including deferred content named jargon sweep',jargon),categoryJargon:()=>sweep('both category introductions jargon sweep',jargon,categories),counterpart:()=>sweep('optional action has no incomprehensible counterpart label',/Continue to optional counterpart/gi),moderation:()=>sweep('no customer moderation-plumbing string',/held for manual moderation/gi),related:()=>sweep('all Related coverage headings removed',/Related coverage/gi),selfDeprecation:()=>sweep('no review self-deprecation',/we do not publish patient reviews|we have no (?:patient )?reviews/gi),kill:()=>sweep('whole public output named kill strings',/capture hashed|\bhashed\b|we do not publish patient reviews|in our capture|Updated August 2026|lowest verified price|stays on your device|the dated evidence|Related coverage/gi),intro:()=>check('providers introduction describes all three facts',provider.length===1&&/published medications, monthly cost and cancellation terms/.test(provider[0].text),provider),second:()=>check('live-count paragraph retains confirmation and reachability',provider.length===1&&/We track \d+ providers in total\. A provider only appears in this grid once we've confirmed all three of those details; the rest have their own pages, linked from search and from our reviews\./.test(provider[0].text),provider),attribution:()=>check('exact first-party attribution paragraph',provider.length===1&&provider[0].text.includes("Where this comes from. Provider names, prices and program details are taken from each provider's own published pages, with the date we checked shown next to every fact. We don't estimate availability, guess whether a program suits you, or invent ratings or review counts."),provider),priceNotes:()=>{const notes=categories.flatMap(p=>p.priceNotes.map(text=>({route:p.route,text,sentences:text.split(/(?<=[.!?])\s+/).length})));return check('every category per-row note at most two sentences',categories.length===2&&notes.length>0&&notes.every(n=>n.sentences<=2),notes);}};
 await page.goto(origin+'/providers/',{waitUntil:'domcontentloaded'});
 const search=await page.evaluate(()=>({buttons:[...document.querySelectorAll('button')].filter(n=>/Search providers/.test(n.textContent)).map(n=>({text:n.textContent.trim(),attrs:n.outerHTML})),inputs:[...document.querySelectorAll('input[type=search]')].map(n=>({placeholder:n.placeholder,visible:!!n.getClientRects().length}))}));
 const {searchProbe}=await import('./glp34-filters-handler.mjs');
 const searchTransition=await searchProbe(page);
 predicates.search=()=>check('real collapsed-to-expanded exact search labels and Escape close',!searchTransition.missing&&searchTransition.collapsed.trim()==='Search providers'&&searchTransition.expanded.placeholder==='Search providers or pharmacies'&&searchTransition.closed,searchTransition);
 const rulingPath='/home/ubuntu/business/reports/ops/rulings/GLP-34-reader-20260913.md';
 const ruling=fs.readFileSync(rulingPath,'utf8');
 predicates['global scope decision']=()=>check('operator explicitly commissioned global copy scope',ruling.includes('## DO NOW')&&ruling.includes('global copy/scope · **6**'),{path:rulingPath,decision:'Global copy is in scope; no claim of completed implementation.'});
 const {probe}=await import(path.join(execution,'reader/intake-search/probe.mjs'));
 const intakeProof=await probe(page,origin);
 const {retainedCopyProofs}=await import(path.join(execution,'reader/retained-copy-proofs.mjs'));
 const copyProof=retainedCopyProofs();
 predicates['source and unknown preservation']=()=>copyProof.source;
 predicates['counts and dated-price preservation']=()=>copyProof.source;
 predicates.priceNotes=()=>copyProof.category;
 predicates['source-price truth']=()=>copyProof.category;
 predicates['both category introductions source-price truth']=()=>copyProof.intros;
 predicates['presentation independent review']=()=>copyProof.review;
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 const footer=await page.evaluate(()=>({text:[...document.querySelectorAll('footer')].map(n=>n.textContent.trim()),legacyAside:[...document.querySelectorAll('aside.inline-capture')].map(n=>n.textContent.trim())}));
 predicates['legacy capture aside and footer exact replacement']=()=>check('S5 actual homepage footer and legacy aside no longer carry the three named survivors',footer.text.length>0&&!/Every price on this site shows the date we verified it|Every price dated|cancellation, and evidence dates before choosing/i.test([...footer.text,...footer.legacyAside].join(' ')),{source:'OPUS-VERIFY-FINAL-20260822.md:223-230',...footer});
 const {accordionDecision}=await import(path.join(execution,'reader/accordion-decision.mjs'));
 const accordion=await accordionDecision(page,origin);
 predicates['accordion scope decision']=()=>accordion;
 return finish(viewport,'reader-language-copy','reader-copy',rows.map(r=>{
  const measured=intakeProof.rows.find(p=>p.id===r.id);
  const checks=measured?.checks??requirements[r.id].map(k=>predicates[k]?predicates[k]():gap(k,'Mechanical/source comparison not exercised by this handler; no substitute signature gate.'));
  const decisionVerified=['RN-EXTRA-3840','RN-EXTRA-3839'].includes(r.id)&&checks.every(c=>c.status==='PASS');
  const copyVerified=['RN-00555','RN-EXTRA-3854','RN-01829','RN-00568','RN-EXTRA-3823','RN-EXTRA-3834'].includes(r.id)&&checks.every(c=>c.status==='PASS')&&copyProof.source.status==='PASS';
  return {...r,checks,verified_compounds:measured?.verified_compounds??(decisionVerified||copyVerified?(r.compound_effects||[]).map(c=>c.effect):[])};
 }),{sourceScope:output.sourceScope,pages:output.length,search,intakeReference:intakeProof.reference,accordion});
}
