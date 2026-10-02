import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {loadGoSelection, loadGoPromotionAuthority} from '../src/go-runtime-selection.mjs';
import {loadAffiliateLinkMap} from '../src/affiliate-link-map.mjs';
import {deriveGoEntriesFromRegistry} from '../src/program-registry.mjs';
import {goCommercialLabels} from '../src/go-commercial-labels.mjs';
import {assertCurrentHoldGoSuccessor} from '../src/go-runtime-manifest.mjs';
const read = name => JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
const decisionFile = 'OPERATOR-DECISION-20261001-all-pipelines-live.md';

test('F06 current XenTraffic hold overrides old ADOPT and VERIFIED without changing other authority', () => {
  const legacy = read('go-runtime-promotion-authority.json');
  const selected = loadGoSelection();
  const before = {...legacy.programs,...selected.programs};
  const actual = loadGoPromotionAuthority().programs;
  const xen = Object.keys(before).filter(id => [legacy.programs[id]?.network,selected.programs[id]?.network].some(n => String(n).toLowerCase()==='xentraffic'));
  assert.equal(xen.length,15);
  assert.equal(selected.programs['eden-xentraffic-offer-3051'].disposition,'ADOPT','historical selection remains historical');
  for (const id of Object.keys(before)) {
    if (xen.includes(id)) {
      assert.equal(actual[id].status,'WITHHELD',id);
      assert.equal(actual[id].promotion_authorized,false,id);
      assert.equal(actual[id].current_hold_decision.sha256,'147069fc66b2f66639321828e723dc2859d37a4b2c205f2239369724ab1b74ad');
    } else assert.deepEqual(actual[id],before[id],id);
  }
  const registry = read('program-registry.json');
  for (const surface of ['compare','quiz']) {
    const links = loadAffiliateLinkMap(surface);
    for (const id of xen) assert.notEqual(links[id]?.live,true,`${surface}:${id}`);
    assert.equal(links['orderlymeds'].live,true,'unaffected direct-network control');
    const entries = deriveGoEntriesFromRegistry(registry,'glp-clinic-scout',read('program-content-ledger.json').programs,links,{programs:actual},goCommercialLabels(read('affiliate-held-link-manifest.json')));
    for (const row of entries.filter(row => xen.includes(row.program_id))) {
      assert.equal(row.live_link_allowed,false,row.program_id);
      assert.equal(row.promotion_authorized,false,row.program_id);
      assert.equal(row.tracking,undefined,row.program_id);
    }
  }
});

test('F06 narrow manifest producer uses effective holds with unchanged strict non-hold refusal', () => {
  const source = fs.readFileSync(new URL('../scripts/regenerate-go-runtime-manifest.mjs',import.meta.url),'utf8');
  const initializer = source.match(/^  const held = .+;$/m)?.[0];
  assert.ok(initializer);
  const held = new Function('goPromotionAuthority','loadGoSelection','ROOT',`${initializer}\nreturn held;`)(loadGoPromotionAuthority(),loadGoSelection,new URL('../',import.meta.url));
  const id = 'eden-xentraffic-offer-3051';
  assert.ok(held.has(id),'current operator hold must reach the existing narrow producer');
  const row = {program_id:id,display_name:'Eden',route:`/go/${id}`,entry_state:'transparent_direct',commercial_state:'live'};
  const before = {programs:{[id]:{...row,live_link_allowed:true}}};
  const after = {programs:[{...row,live_link_allowed:false,promotion_authorized:false,candidate_gate:'No complete live attribution and promotion receipt; entry remains held.'}]};
  assertCurrentHoldGoSuccessor(before,after,held);
  assert.throws(() => assertCurrentHoldGoSuccessor(before,after,new Set()),/go_non_hold_manifest_drift/);
  for (const mutation of [r => {r.live_link_allowed=true;}, r => {r.display_name='Changed identity';}, r => {r.route='/go/unrelated';}]) {
    const bad = structuredClone(after); mutation(bad.programs[0]);
    assert.throws(() => assertCurrentHoldGoSuccessor(before,bad,held),/go_non_hold_manifest_drift/);
  }
});

test('F06 email holds-only producer includes current denial without admitting unrelated removals', () => {
  const source = fs.readFileSync(new URL('../scripts/migrate-cost-affiliate-email-manifest.mjs',import.meta.url),'utf8');
  const initializer = source.match(/^  const held = .+;$/m)?.[0];
  assert.ok(initializer);
  const held = new Function('loadGoSelection','loadGoPromotionAuthority',`${initializer}\nreturn held;`)(loadGoSelection,loadGoPromotionAuthority);
  assert.ok(held.has('eden-xentraffic-offer-3051'),'current held Eden must be an allowed removal');
  for (const row of Object.values(loadGoSelection().programs).filter(row=>row.disposition==='HOLD')) assert.ok(held.has(row.render_id));
  assert.ok(!held.has('orderlymeds'),'non-held direct control remains protected');
  assert.ok(!held.has('unrelated-fixture'),'arbitrary removals remain forbidden');
});

test('F06 exact current hold source is authentic and missing or drifted bytes refuse', () => {
  const actualRead = fs.readFileSync;
  const target = new URL('../data/'+decisionFile,import.meta.url);
  assert.equal(hash(actualRead(target)),'147069fc66b2f66639321828e723dc2859d37a4b2c205f2239369724ab1b74ad');
  for (const missing of [false,true]) {
    let intercepted = 0;
    fs.readFileSync = function(file,...args) {
      if (String(file).endsWith(decisionFile)) {
        intercepted++;
        if (missing) throw Object.assign(new Error('synthetic missing current hold'),{code:'ENOENT'});
        return Buffer.concat([actualRead(file),Buffer.from('\nsynthetic unauthorized drift')]);
      }
      return actualRead(file,...args);
    };
    syncBuiltinESMExports();
    try {
      assert.throws(() => loadGoPromotionAuthority(),missing ? /synthetic missing current hold/ : /go_current_hold_authority_invalid/);
      assert.equal(intercepted,1);
    } finally {fs.readFileSync=actualRead;syncBuiltinESMExports();}
  }
});
