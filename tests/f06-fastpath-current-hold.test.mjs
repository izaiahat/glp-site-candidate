import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { historicalEndedValidator } from './fixtures/historical-ended-review.mjs';

// Replay the maintained branch selector without running unrelated file writers.
test('F06 fastpath validator applies current hold before historical VERIFIED and retains active controls', async (t) => {
  const source=fs.readFileSync(new URL('../scripts/validate-provider-fastpath-plus5.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const selected = currentSelection?.programs?.[provider.program_id];');
  const end=source.indexOf('  // 2026-08-06 cluster 1:',start);
  assert.ok(start>0 && end>start);
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('assert','provider','currentSelection','promotionAuthority','GO_RUNTIME_MANIFEST','html','programRegistry',`let activeAffiliateCtas=0; const commerciallyActive=false; ${source.slice(start,end)}; return activeAffiliateCtas;`);
  const id='held-fixture'; const provider={program_id:id};
  const selected={status:'VERIFIED',render_id:id,route:'/go/held-fixture',issued_link:'https://fixture.invalid/issued'};
  const selection={selection_sha256:'fixture-receipt',programs:{[id]:selected}};
  const authority={programs:{[id]:{status:'WITHHELD',promotion_authorized:false}}};
  const manifest={programs:{[id]:{live_link_allowed:false,promotion_authorized:false}}};
  const programRegistry={programs:[{program_id:id}]};
  const held='<main data-link-dark="true" data-affiliate-state="held"></main>';
  assert.equal(await run(assert,provider,selection,authority.programs,manifest,held,programRegistry),0);
  await assert.rejects(run(assert,provider,selection,authority.programs,manifest,held+'<a href="/go/held-fixture" data-affiliate-state="active"></a>',programRegistry),assert.AssertionError);
  authority.programs[id]={status:'VERIFIED',promotion_authorized:true};
  manifest.programs[id]={status:'live_operator_approved',link_mode:'server_redirect',operator_selection_receipt_sha256:'fixture-receipt',tracking:{base_url:selected.issued_link}};
  const active='This page contains one active affiliate link <a data-affiliate-state="active" data-link-mode="server-redirect" href="/go/held-fixture?s=reviews.rv2&amp;v=a">Enroll</a>';
  assert.equal(await run(assert,provider,selection,authority.programs,manifest,active,programRegistry),1);
  await assert.rejects(run(assert,provider,selection,authority.programs,manifest,held,programRegistry),assert.AssertionError);

  await t.test('ended relationship requires retained editorial, valid date and visible disclosure while remaining link-dark', async () => {
    const relationship={lifecycle:'ended',promotion_denied:true,editorial_retained:true,ended_effective_at:'2026-10-01'};
    const endedRegistry={programs:[{program_id:id,affiliate_relationship_snapshot:relationship}]};
    const endedAuthority={[id]:{status:'WITHHELD',promotion_authorized:false}};
    const endedManifest={programs:{[id]:{live_link_allowed:false,promotion_authorized:false}}};
    const ended='<main data-link-dark="true">Our affiliate relationship with this provider ended on 2026-10-01. This editorial review is retained</main>';
    // Preserve every original pre-marker compatibility assertion and refusal
    // on the authenticated original validator. Native current rendering is
    // exercised separately, with stricter current-state mutations.
    const runHistorical = historicalEndedValidator();
    const runEnded=(registry=endedRegistry,html=ended) => runHistorical(assert,provider,selection,endedAuthority,endedManifest,html,registry);
    assert.equal(await runEnded(),0);
    for (const patch of [
      {promotion_denied:false},
      {editorial_retained:false},
      {ended_effective_at:'October 1, 2026'},
    ]) {
      await assert.rejects(runEnded({programs:[{program_id:id,affiliate_relationship_snapshot:{...relationship,...patch}}]}),assert.AssertionError);
    }
    await assert.rejects(runEnded(endedRegistry,ended.replace('2026-10-01','2026-09-30')),assert.AssertionError);
    await assert.rejects(runEnded(endedRegistry,ended.replace('This editorial review is retained','')),assert.AssertionError);
    await assert.rejects(runEnded(endedRegistry,ended.replace('data-link-dark="true"','')),assert.AssertionError);
    await assert.rejects(runEnded(endedRegistry,held+ended),assert.AssertionError);
    await assert.rejects(runEnded(endedRegistry,ended+'<a href="/go/held-fixture" data-affiliate-state="active"></a>'),assert.AssertionError);
  });
});
