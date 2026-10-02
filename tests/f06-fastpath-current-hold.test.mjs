import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Replay the maintained branch selector without running unrelated file writers.
test('F06 fastpath validator applies current hold before historical VERIFIED and retains active controls', async () => {
  const source=fs.readFileSync(new URL('../scripts/validate-provider-fastpath-plus5.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const selected = currentSelection?.programs?.[provider.program_id];');
  const end=source.indexOf('  // 2026-08-06 cluster 1:',start);
  assert.ok(start>0 && end>start);
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('assert','provider','currentSelection','promotionAuthority','GO_RUNTIME_MANIFEST','html',`let activeAffiliateCtas=0; const commerciallyActive=false; ${source.slice(start,end)}; return activeAffiliateCtas;`);
  const id='held-fixture'; const provider={program_id:id};
  const selected={status:'VERIFIED',render_id:id,route:'/go/held-fixture',issued_link:'https://fixture.invalid/issued'};
  const selection={selection_sha256:'fixture-receipt',programs:{[id]:selected}};
  const authority={programs:{[id]:{status:'WITHHELD',promotion_authorized:false}}};
  const manifest={programs:{[id]:{live_link_allowed:false,promotion_authorized:false}}};
  const held='<main data-link-dark="true" data-affiliate-state="held"></main>';
  assert.equal(await run(assert,provider,selection,authority.programs,manifest,held),0);
  await assert.rejects(run(assert,provider,selection,authority.programs,manifest,held+'<a href="/go/held-fixture" data-affiliate-state="active"></a>'),assert.AssertionError);
  authority.programs[id]={status:'VERIFIED',promotion_authorized:true};
  manifest.programs[id]={status:'live_operator_approved',link_mode:'server_redirect',operator_selection_receipt_sha256:'fixture-receipt',tracking:{base_url:selected.issued_link}};
  const active='This page contains one active affiliate link <a data-affiliate-state="active" data-link-mode="server-redirect" href="/go/held-fixture?s=reviews.rv2&amp;v=a">Enroll</a>';
  assert.equal(await run(assert,provider,selection,authority.programs,manifest,active),1);
  await assert.rejects(run(assert,provider,selection,authority.programs,manifest,held),assert.AssertionError);
});
