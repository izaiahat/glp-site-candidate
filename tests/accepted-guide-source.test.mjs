import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadAcceptedGuides, acceptedGuideOwnership, addAcceptedInboundLinks} from '../src/accepted-guide-source.mjs';
import {reviewBrief, renderBlogPost, validateKeywordOwnership} from '../src/blog-system.mjs';
import {addP1ContentUpgradeSurface} from '../src/wave2-p1-surfaces.mjs';
const root = new URL('../', import.meta.url).pathname;
const author = JSON.parse(readFileSync(path.join(root,'data/blog/author-registry.json'))).authors.find(a=>a.author_id==='clinic-scout-editorial-team');
author.id=author.author_id;
test('four exact accepted packets render titles, clean links and capture variants',()=>{
  const articles=loadAcceptedGuides(root); assert.equal(articles.length,4);
  validateKeywordOwnership([...JSON.parse(readFileSync(path.join(root,'data/blog/keyword-ownership-map.json'))).entries,...acceptedGuideOwnership(articles)]);
  for(const a of articles){
    assert.equal(reviewBrief(a,author).status,'PASS');
    const html=renderBlogPost(a,null,author,[]);assert.ok(html.includes(`<title>${a.title}</title>`));
    assert.match(html,/data-release="release-ready"/);
    if(a.capture_surface.status==='ON_PAGE_ONLY') {assert.doesNotMatch(html,/<form\b|type="email"/);assert.equal(addP1ContentUpgradeSurface(html),html);}
    assert.equal(a.has_affiliate_cta,false);
    for(const link of a.inbound_link_plan) assert.ok(addAcceptedInboundLinks('<main></main>',link.source_route,articles).includes(a.canonical_path));
  }
  assert.equal(articles[0].title,'Is Valhalla Vitality Legit? Verification Guide (2026)');
});
test('long-form acceptance cannot authorize altered prose or invented article',()=>{
  const a=loadAcceptedGuides(root).find(a=>a.word_count<1500||a.word_count>3600);assert.ok(a);
  const changed=structuredClone(a);changed.sections[0].paragraphs.push('Unreviewed assertion');
  assert.equal(reviewBrief(changed,author).reason,'word_count_outside_blueprint');
  assert.equal(reviewBrief({...a,article_id:'forged'},author).reason,'word_count_outside_blueprint');
});
test('byte mutations, missing acceptance and duplicate source routes fail closed',()=>{
  const temp=mkdtempSync(path.join(os.tmpdir(),'accepted-source-'));
  try{
    cpSync(path.join(root,'data/blog/accepted-guides'),path.join(temp,'data/blog/accepted-guides'),{recursive:true});
    const mpath=path.join(temp,'data/blog/accepted-guides/manifest.json');let m=JSON.parse(readFileSync(mpath));
    const article=path.join(temp,m.entries[0].article.path);const original=readFileSync(article);writeFileSync(article,Buffer.concat([original,Buffer.from(' ')]));
    assert.throws(()=>loadAcceptedGuides(temp),/source_drift/);writeFileSync(article,original);
    m.entries.push(m.entries[0]);writeFileSync(mpath,JSON.stringify(m));assert.throws(()=>loadAcceptedGuides(temp),/identity_invalid/);
  }finally{rmSync(temp,{recursive:true,force:true});}
});
test('on-page variant refuses contradictory email form',()=>assert.throws(()=>addP1ContentUpgradeSurface('<html data-article-capture="none"><form></form></html>'),/contract_conflict/));
