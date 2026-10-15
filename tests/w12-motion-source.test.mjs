import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {withReviewFixture} from './helpers/owned-review-fixture.mjs';
function normalizeColor(value){
 const match=value.trim().match(/^(rgba?|color)\((.*)\)$/i);
 assert.ok(match,`Unsupported computed color: ${value}`);
 const srgb=match[1].toLowerCase()==='color';
 const body=srgb?match[2].replace(/^srgb\s+/i,''):match[2];
 if(srgb)assert.match(match[2],/^srgb\s+/i);
 const tokens=body.trim().split(/[\s,\/]+/);
 assert.ok(tokens.length===3||tokens.length===4,`Invalid computed color: ${value}`);
 const channel=(token,divisor)=>{const n=Number(token.endsWith('%')?token.slice(0,-1):token)/(token.endsWith('%')?100:divisor);assert.ok(Number.isFinite(n)&&n>=0&&n<=1,`Invalid channel: ${token}`);return n;};
 return [...tokens.slice(0,3).map(t=>channel(t,srgb?1:255)),tokens.length===4?channel(tokens[3],1):1];
}
function composite(foreground,background){
 const alpha=foreground[3]+background[3]*(1-foreground[3]);
 return [...foreground.slice(0,3).map((v,i)=>alpha?(v*foreground[3]+background[i]*background[3]*(1-foreground[3]))/alpha:0),alpha];
}
function surfaceLuminance(sample){
 // Chromium's default canvas is white; ancestors are recorded nearest first.
 let base=[1,1,1,1];
 for(const color of [...sample.base].reverse())base=composite(normalizeColor(color),base);
 const rgb=composite(normalizeColor(sample.bg),base).slice(0,3);
 const linear=rgb.map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 return linear.reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
}
function isLighter(initial,active){return surfaceLuminance(active)>surfaceLuminance(initial)+1e-10;}
function sampleSurface(e){
 const style=getComputedStyle(e),base=[];
 for(let parent=e.parentElement;parent;parent=parent.parentElement)base.push(getComputedStyle(parent).backgroundColor);
 return {bg:style.backgroundColor,scale:new DOMMatrix(style.transform).a,base};
}
const surface=(bg,base=['rgb(20, 30, 40)'])=>({bg,base});
 test('color helper rejects identical colors across rgba and color(srgb)',()=>{
  assert.equal(isLighter(surface('rgba(255, 255, 255, 0.08)'),surface('color(srgb 1 1 1 / 0.08)')),false);
  assert.equal(isLighter(surface('rgb(51, 102, 153)'),surface('color(srgb 0.2 0.4 0.6)')),false);
 });
 test('color helper rejects darker colors',()=>{
  assert.equal(isLighter(surface('rgba(255, 255, 255, 0.2)'),surface('color(srgb 1 1 1 / 0.08)')),false);
  assert.equal(isLighter(surface('rgb(120, 120, 120)'),surface('rgb(60, 60, 60)')),false);
 });
 test('color helper composites alpha over the rendered ancestor base',()=>{
  assert.equal(isLighter(surface('rgba(255, 255, 255, 0.08)'),surface('color(srgb 1 1 1 / 0.2)')),true);
  assert.equal(isLighter(surface('rgba(255, 255, 255, 0.08)',['rgb(255, 255, 255)']),surface('color(srgb 1 1 1 / 0.2)',['rgb(255, 255, 255)'])),false);
  assert.ok(Math.abs(surfaceLuminance(surface('rgba(255, 255, 255, 0.5)',['rgba(255, 255, 255, 0.5)','rgb(0, 0, 0)']))-surfaceLuminance(surface('color(srgb 0.75 0.75 0.75)')))<1e-12);
 });
 test('color helper fails closed on unsupported color syntax',()=>{
  assert.throws(()=>normalizeColor('color(display-p3 1 1 1)'));
  assert.throws(()=>normalizeColor('rgba(NaN, 0, 0, 1)'));
 });
// Keep collection lazy so --test-name-pattern='color helper' runs without a browser.
async function collectRows(){
return withReviewFixture(async origin=>{
const root=process.cwd(),css=new Map();
const assembler=fs.readFileSync('artifacts/ultracode/tools/assemble-css.mjs','utf8').replace(/^import .*;$/gm,'');
new Function('readFileSync','readdirSync','writeFileSync','path','process','console',assembler)(fs.readFileSync,fs.readdirSync,(f,s)=>css.set(path.basename(f),s),path,{cwd:()=>root},{log:()=>{}});
const rows=[],browser=await chromium.launch();
try{for(const mobile of [false,true])for(const name of ['wegovy-pill','wegovy','ozempic','mounjaro','zepbound']){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin||r.request().method()!=='GET'||/^\/(api|go|out|track)\//.test(u.pathname))return r.abort();if(css.has(path.basename(u.pathname)))return r.fulfill({contentType:'text/css',body:css.get(path.basename(u.pathname))});if(u.pathname==='/assets/site.js')return r.fulfill({contentType:'text/javascript',body:fs.readFileSync('assets/site.js','utf8')});return r.continue();});
 const p=await ctx.newPage();await p.goto(origin+'/'+name+'/',{waitUntil:'networkidle'});const reject=p.getByRole('button',{name:'Reject optional',exact:true});if(await reject.isVisible())await reject.click();const f=p.locator('.listing__drug-summary > figure.p3-product-visual');await f.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));await p.waitForTimeout(300);const before=await f.evaluate(e=>getComputedStyle(e).transform);await p.waitForTimeout(900);const after=await f.evaluate(e=>getComputedStyle(e).transform);const row={name,mobile,before,after,shelf:[]};
 for(const a of await p.locator('.p3-product-related-card').all()){await a.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));await p.mouse.move(0,0);await p.evaluate(()=>document.activeElement?.blur());await p.waitForTimeout(250);const sample=()=>a.evaluate(sampleSurface);const initial=await sample();if(mobile){await p.keyboard.press('Tab');await a.focus();}else await a.hover();await p.waitForTimeout(300);row.shelf.push({initial,active:await sample()});}
 await p.emulateMedia({reducedMotion:'reduce'});row.reduced=await f.evaluate(e=>getComputedStyle(e).animationName);rows.push(row);await ctx.close();
}}finally{await browser.close();}
console.log(JSON.stringify({source_fixture:true,rows}));
return rows;
});
}
let collection;
const getRows=()=>collection??=collectRows();
test('five brand renders float in both viewports and respect reduced motion',async()=>{const rows=await getRows();assert.equal(rows.length,10);assert.ok(rows.every(r=>r.before!==r.after&&r.reduced==='none'));});
test('all related product cards grow and lighten on hover or mobile focus',async()=>{const rows=await getRows();assert.equal(rows.reduce((n,r)=>n+r.shelf.length,0),30);assert.ok(rows.every(r=>r.shelf.every(x=>x.active.scale>x.initial.scale&&isLighter(x.initial,x.active))));});
