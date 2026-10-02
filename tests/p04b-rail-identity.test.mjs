import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertServedGoIdentity } from '../src/served-affiliate-identity.mjs';
import { affiliateNetworkIdentity, subidAttributes } from '../src/affiliate-subid.mjs';
import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
const programs = JSON.parse(readFileSync(new URL('../data/tracking-allowed-hosts.json', import.meta.url))).programs;

test('every served /go anchor matches its program-bound authority (HTML and lazy JSON)', t => {
  const result = assertServedGoIdentity(fileURLToPath(new URL('../public/', import.meta.url)), programs);
  assert.ok(result.htmlFiles >= 334);
  // The old 141-anchor floor included currently held XenTraffic offers.
  // Require every eligible identity, not an output-derived smaller count.
  const historical=Object.values(loadGoSelection().programs).filter(row=>row.status==='VERIFIED');
  assert.equal(historical.length,17);
  const authority=loadGoPromotionAuthority().programs;
  const eligible=historical.filter(row=>authority[row.program_id]?.status==='VERIFIED');
  assert.equal(eligible.length,10);
  for (const row of historical.filter(row=>!eligible.includes(row))) {
    assert.equal(row.network.toLowerCase(),'xentraffic');
    assert.equal(authority[row.program_id].current_hold_decision.sha256,'147069fc66b2f66639321828e723dc2859d37a4b2c205f2239369724ab1b74ad');
  }
  const canonical=id=>historical.find(row=>row.program_id===id||row.render_id===id)?.program_id || id;
  assert.deepEqual([...new Set(result.anchors.map(row=>canonical(row.program)))].sort(),eligible.map(row=>row.program_id).sort(), 'no active identity may disappear and no held identity may render');
  assert.deepEqual(result.findings, []);
  t.diagnostic(JSON.stringify({ htmlFiles: result.htmlFiles, jsonFiles: result.jsonFiles, anchors: result.anchors.length }));
});

test('unknown rail/program and mismatched identity throw, never direct fallback', () => {
  assert.throws(() => affiliateNetworkIdentity('unknown-program', 'direct'), /underived/);
  assert.throws(() => affiliateNetworkIdentity('gobymeds', 'unrecognized-rail'), /network_drift/);
  assert.throws(() => subidAttributes({ programId: 'trt-nation', network: 'Katalys', position: 'review' }), /network_drift/);
  assert.throws(() => subidAttributes({ network: 'direct', position: 'review' }), /underived/);
});

test('Direct Meds current receipted Affiliati successor overrides historical Katalys identity', () => {
  const old = JSON.parse(readFileSync(new URL('../data/approved-program-registry.json', import.meta.url))).programs.find(p => p.registry_id === 'katalys-1304');
  assert.equal(old.network, 'Katalys');
  const current = loadGoSelection().programs['katalys-1304'];
  assert.equal(current.network, 'affiliati');
  assert.equal(current.network_offer_id, '40044');
  assert.equal(current.status, 'VERIFIED');
  assert.equal(programs['direct-meds'].network, 'Affiliati');
  assert.equal(affiliateNetworkIdentity('direct-meds', current.network), 'Affiliati');
  assert.throws(() => affiliateNetworkIdentity('direct-meds', old.network), /network_drift/);
});

test('served gate rejects a mismatched lazy anchor rather than just sampling HTML', () => {
  const root = mkdtempSync(join(tmpdir(), 'p04b-rail-'));
  try {
    writeFileSync(join(root, 'cards.json'), JSON.stringify(['<a href="/go/trt-nation" data-program="trt-nation" data-network="direct">Go</a>']));
    assert.throws(() => assertServedGoIdentity(root, programs), /served_go_identity_mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
