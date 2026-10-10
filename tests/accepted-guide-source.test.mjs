import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadAcceptedGuides, acceptedGuideOwnership, addAcceptedInboundLinks} from '../src/accepted-guide-source.mjs';
import {reviewBrief, renderBlogPost, validateKeywordOwnership} from '../src/blog-system.mjs';
import {addP1ContentUpgradeSurface} from '../src/wave2-p1-surfaces.mjs';
const root = new URL('../', import.meta.url).pathname;
const author = JSON.parse(readFileSync(path.join(root,'data/blog/author-registry.json'))).authors.find(a=>a.author_id==='clinic-scout-editorial-team');
author.id=author.author_id;
test('accepted packets retain original four identities and render every additive guide',()=>{
  const articles=loadAcceptedGuides(root); assert.ok(articles.length>=4);
  for(const route of ['/guides/is-valhalla-vitality-legit/','/guides/how-to-order-at-restaurants-on-a-glp-1-a-practical-guide/','/guides/gobymeds-discount-code/','/guides/glp-1-match/']) assert.ok(articles.some(a=>a.canonical_path===route));
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
test('fifth accepted guide is additive without rewriting frozen catalogs or image lineage',()=>{
  const temp=mkdtempSync(path.join(os.tmpdir(),'accepted-additive-'));
  try {
    cpSync(path.join(root,'data/blog/accepted-guides'),path.join(temp,'data/blog/accepted-guides'),{recursive:true});
    const mp=path.join(temp,'data/blog/accepted-guides/manifest.json'), m=JSON.parse(readFileSync(mp)); m.entries=m.entries.slice(0,4);
    const row=structuredClone(m.entries[1]); row.entry_id='fixture-fifth'; row.route='/guides/additive-test/';
    for(const key of ['article','qa','review']) row[key].path=row[key].path.replace('how-to-order-at-restaurants-on-a-glp-1-a-practical-guide','additive-test');
    cpSync(path.join(temp,'data/blog/accepted-guides/how-to-order-at-restaurants-on-a-glp-1-a-practical-guide'),path.join(temp,'data/blog/accepted-guides/additive-test'),{recursive:true});
    const article=JSON.parse(readFileSync(path.join(temp,row.article.path))); article.canonical_path=row.route; article.article_id='fixture-additive';
    writeFileSync(path.join(temp,row.article.path),JSON.stringify(article)); row.article.sha256=createHash('sha256').update(readFileSync(path.join(temp,row.article.path))).digest('hex');
    const qa=JSON.parse(readFileSync(path.join(temp,row.qa.path))); qa.artifacts['06-article.json'].sha256=row.article.sha256;
    writeFileSync(path.join(temp,row.qa.path),JSON.stringify(qa)); row.qa.sha256=createHash('sha256').update(readFileSync(path.join(temp,row.qa.path))).digest('hex');
    const review=JSON.parse(readFileSync(path.join(temp,row.review.path))); review.authority.selection_binding.target_route=row.route;
    writeFileSync(path.join(temp,row.review.path),JSON.stringify(review)); row.review.sha256=createHash('sha256').update(readFileSync(path.join(temp,row.review.path))).digest('hex');
    m.entries.push(row); writeFileSync(mp,JSON.stringify(m));
    const guides=loadAcceptedGuides(temp); assert.equal(guides.length,5); assert.equal(guides[4].canonical_path,row.route);
    assert.deepEqual(guides.slice(0,4),loadAcceptedGuides(root).slice(0,4));
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('on-page variant refuses contradictory email form',()=>assert.throws(()=>addP1ContentUpgradeSurface('<html data-article-capture="none"><form></form></html>'),/contract_conflict/));

test('accepted-update regressions trigger the exact-head portable workflow', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/mirror-ci.yml'), 'utf8');
  const triggers = workflow.slice(workflow.indexOf('  pull_request:'), workflow.indexOf('  workflow_dispatch:'));
  assert.match(triggers, /^\s+- "tests\/accepted-update-source\.test\.mjs"\s*$/m,
    'accepted-update-only source repair must receive exact-head CI');
  assert.match(workflow, /node --test tests\/accepted-guide-source\.test\.mjs tests\/accepted-update-source\.test\.mjs/);
  assert.match(workflow, /ref: \$\{\{ env\.EXPECTED_SHA \}\}/);
});
