import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadCarrierArticles, assertCarrierArticleOutput} from '../src/carrier-article-retention.mjs';
import {loadAffiliateLinkMap} from '../src/affiliate-link-map.mjs';
import {assertCurrentHoldManifestSuccessor} from '../src/cost-calculator-affiliate.mjs';
import {COST_AFFILIATE_EMAIL_MANIFEST} from '../src/cost-affiliate-email-manifest.generated.mjs';
import {checkDispositions} from '../scripts/ci-release-gate.mjs';
import {JSDOM} from 'jsdom';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertCurrentHoldGoSuccessor} from '../src/go-runtime-manifest.mjs';
import {loadGoPromotionAuthority, loadGoSelection, applyGoSelectionToLinkMap} from '../src/go-runtime-selection.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(new URL('../'+path, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('D1 every original requirement has exactly one reviewed disposition', () => {
  const manifest = JSON.parse(read('ops/release-dispositions.json'));
  const quarantine = JSON.parse(read('ops/test-quarantine.json'));
  assert.equal(checkDispositions(manifest, quarantine).rows, 26);
  assert.throws(() => checkDispositions({...manifest, rows:manifest.rows.slice(1)}, quarantine), /disposition_denominator/);
  const duplicate = structuredClone(manifest); duplicate.rows[1] = duplicate.rows[0];
  assert.throws(() => checkDispositions(duplicate, quarantine), /disposition_duplicate/);
});

test('D1 a material repair cannot be silently moved to quarantine', () => {
  const manifest = JSON.parse(read('ops/release-dispositions.json'));
  const quarantine = JSON.parse(read('ops/test-quarantine.json'));
  const changed = structuredClone(manifest); changed.rows.find(row => row.id === 'F25').bucket = 'c';
  assert.throws(() => checkDispositions(changed, quarantine), /disposition_missing_or_changed/);
  quarantine.diagnostics.push({id:'F25', reason:'Pretend price evidence is cosmetic'});
  assert.throws(() => checkDispositions(manifest, quarantine), /material_quarantine:F25/);
});

test('F17 approved registry successor binds exact prior and current bytes', () => {
  const pins = JSON.parse(read('tests/fixtures/glp41-approved-input-successor.json'));
  assert.deepEqual(Object.keys(pins.inputs), ['data/program-registry.json']);
  const pin = pins.inputs['data/program-registry.json'];
  assert.equal(pin.before_sha256, 'bd74cce7b25ccc1b754f26b70be51a8f96afb8356e8a53c3e919985c9d8500b6');
  assert.equal(sha(read('data/program-registry.json')), pin.after_sha256);
  assert.notEqual(pin.before_sha256, pin.after_sha256);
  const predecessor = JSON.parse(read('data/program-registry.json'));
  const pallas = predecessor.programs.filter(p => p.program_id === 'pallas-health-review');
  assert.equal(pallas.length, 1);
  assert.equal(pallas[0].affiliate_relationship_snapshot.promotion_denied, true);
  assert.equal(pallas[0].affiliate_relationship_snapshot.lifecycle, 'ended');
  pallas[0].affiliate_relationship_snapshot = {network:'katalys',network_program_id:'1622',sheet_row:776,
    relationship_status:'live_wired_verified',source_checked_at:'2026-08-25T02:52:30Z',
    promotion_denied:false,lifecycle:'reported',reported_information:true};
  assert.equal(sha(Buffer.from(JSON.stringify(predecessor,null,2)+'\n')),
    '87b578d60e4803f0ab28e39d01a33cec478d26e0c3c333d0373dccb2a61dc887');
  assert.notEqual(sha(Buffer.concat([read('data/program-registry.json'), Buffer.from('tampered')])), pin.after_sha256);
});

test('F34 final emitted carrier articles retain the exact authenticated body and stage bytes', () => {
  const retained = loadCarrierArticles(root);
  assert.equal(retained.size, 2);
  for (const [path, article] of retained) {
    const bytes = read('public/'+path);
    // The registered release policy owns stage; this does not change any
    // consent assertion or permit changing frozen article/source bytes.
    assertCarrierArticleOutput(article, bytes);
    assert.throws(() => assertCarrierArticleOutput(article, Buffer.concat([bytes, Buffer.from('tampered')])), /carrier_article_output_drift/);
  }
});

test('F35 generated email manifest includes every approved link independently of calculator price eligibility', () => {
  const expected = Object.values(loadAffiliateLinkMap('calculator')).filter(row => row.live && row.affiliate_href);
  const actual = COST_AFFILIATE_EMAIL_MANIFEST.programs;
  const held = new Set(JSON.parse(read('data/go-selection-receipt.json')).programs.filter(row => row.disposition === 'HOLD').map(row => row.render_id));
  assert.ok(actual.every(row => !held.has(row.program_id)), 'email manifest must not resurrect a raw HOLD');
  // Isolated predecessor fixture: only the named current HOLD may be removed.
  const after = COST_AFFILIATE_EMAIL_MANIFEST;
  const before = {...after, programs:[...actual, {...actual[0], program_id:[...held][0]}]};
  assertCurrentHoldManifestSuccessor(before, after, held);
  for (const mutate of [
    value => value.programs.pop(),
    value => value.programs.push({...value.programs[0], program_id:'unapproved-fixture'}),
    value => { value.programs[0].affiliate_href = 'https://changed.invalid/'; },
  ]) {
    const changed = structuredClone(after); mutate(changed);
    assert.throws(() => assertCurrentHoldManifestSuccessor(before, changed, held), /cost_email_non_hold_manifest_drift/);
  }
  assert.ok(expected.length > 0);
  assert.deepEqual(actual.map(row => row.program_id).sort(), expected.map(row => row.program_id).sort());
  for (const row of expected) assert.equal(actual.find(item => item.program_id === row.program_id).affiliate_href, row.affiliate_href);
  const matrix = JSON.parse(read('data/provider-pricing-matrix.json')).providers;
  assert.ok(expected.some(row => !matrix[row.program_id]?.medications.some(price => Number.isFinite(price.month_1_usd) && Number.isFinite(price.ongoing_usd))), 'approved display-only or unpriced links cannot be omitted from email manifest');
});

function assertCashLabels(document) {
  const matrix = JSON.parse(read('data/provider-pricing-matrix.json')).providers;
  const cards = [...document.querySelectorAll('#provider-results article[data-program]')];
  let multi = 0;
  for (const card of cards) {
    const prices = [...card.querySelectorAll('.p3-source-price')];
    if (prices.length > 1) multi++;
    for (const price of prices) {
      const rows = matrix[card.dataset.program].medications.filter(row => row.medication_id === price.dataset.medication);
      assert.ok(rows.length > 0, 'cash_medication_missing');
      assert.ok(rows.some(row => price.querySelector('.p3-price-medication')?.textContent === (row.display_label || row.label)
        && price.querySelector('strong')?.textContent === '$'+row.ongoing_usd.toLocaleString('en-US')), 'cash_label_amount_mismatch');
    }
  }
  assert.ok(multi > 0, 'multi_medication_cohort_empty');
}
test('F25 directory cash labels bind every amount to medication; unlabeled negative fails', () => {
  const dom = new JSDOM(read('public/providers/index.html'));
  assertCashLabels(dom.window.document);
  const snag = dom.window.document.querySelector('article[data-program="snagrx"]');
  assert.ok(snag);
  snag.querySelector('.p3-price-medication').remove();
  assert.throws(() => assertCashLabels(dom.window.document), /cash_label_amount_mismatch/);
  dom.window.close();
});

test('R1 native matcher form never serializes email alongside health filters', () => {
  const dom = new JSDOM(read('public/matches/customized/index.html'));
  const form = dom.window.document.querySelector('[data-matches-form]');
  const email = form.querySelector('[data-matches-email]');
  email.value = 'synthetic@example.invalid';
  form.querySelector('[data-matches-state]').value = 'CA';
  const check = () => {
    const params = new URLSearchParams(new dom.window.FormData(form));
    assert.equal(params.has('email'), false, 'email_in_health_query');
    assert.equal(params.get('state'), 'CA');
  };
  check(); email.name = 'email';
  assert.throws(check, /email_in_health_query/);
  dom.window.close();
});

test('R2 current holds beat conflicting legacy approvals and block link-map resurrection', () => {
  const temp = mkdtempSync(join(tmpdir(), 'glp41-authority-'));
  const write = (name, value) => writeFileSync(join(temp, 'data', name), JSON.stringify(value));
  try {
    mkdirSync(join(temp, 'data'));
    const selection = JSON.parse(read('data/go-selection-receipt.json'));
    const legacy = JSON.parse(read('data/go-runtime-promotion-authority.json'));
    const terms = JSON.parse(read('data/go-terms-review-ledger.json'));
    const held = selection.programs.filter(p => p.disposition === 'HOLD');
    const persist = () => {
      write('go-selection-receipt.json', selection);
      terms.selection_sha256 = sha(readFileSync(join(temp, 'data/go-selection-receipt.json')));
      // Isolated fixture only: keep the internally linked selection/terms proof coherent.
      for (const risk of Object.values(terms.programs)) risk.operator_selection_receipt_sha256 = terms.selection_sha256;
      write('go-terms-review-ledger.json', terms);
      write('go-runtime-promotion-authority.json', legacy);
    };
    persist();
    // Raw exact-offer creative-approval HOLDs are unresolved. The old blanket
    // ruling is retained evidence, not permission to override these rows.
    for (const row of held) {
      assert.equal(row.promotion_authorized, false);
      assert.match(row.required_artifact, /approval.*(?:3277|5141d0e3)/i);
      assert.equal(loadGoPromotionAuthority(temp).programs[row.program_id].status, 'WITHHELD');
      assert.equal(loadGoPromotionAuthority(temp).programs[row.program_id].promotion_authorized, false);
    }
    for (const row of held) row.hold_reason = 'CURRENT network pause: not approved for promotion';
    selection.at_utc = '2026-09-26T00:00:00Z';
    persist();
    const authority = loadGoPromotionAuthority(temp);
    for (const row of held) {
      assert.ok(legacy.programs[row.program_id].operator_approved_live_decision);
      assert.equal(authority.programs[row.program_id].status, 'WITHHELD');
      assert.equal(authority.programs[row.program_id].promotion_authorized, false);
    }
    const registry = JSON.parse(read('data/program-registry.json'));
    const links = Object.fromEntries(held.map(row => [row.render_id, {live:true, affiliate_href:'https://example.invalid'}]));
    applyGoSelectionToLinkMap(links, registry, 'compare', 'glp-clinic-scout', loadGoSelection(temp), authority);
    for (const row of held) assert.equal(links[row.render_id].live, false);
    const predecessor = {schema:'fixture', programs:{held:{program_id:'held', display_name:'Held', route:'/go/held', entry_state:'transparent_direct', commercial_state:'live', tracking:{base_url:'https://fixture.invalid'}}}};
    const successor = {schema:'fixture', programs:[{program_id:'held', display_name:'Held', route:'/go/held', entry_state:'transparent_direct', commercial_state:'live', live_link_allowed:false, promotion_authorized:false, candidate_gate:'No complete live attribution and promotion receipt; entry remains held.'}]};
    assertCurrentHoldGoSuccessor(predecessor, successor, new Set(['held']));
    assert.throws(() => assertCurrentHoldGoSuccessor(predecessor, successor, new Set()), /go_non_hold_manifest_drift/);
    for (const mutate of [
      row => { row.live_link_allowed = true; },
      row => { row.tracking = {base_url:'https://fixture.invalid'}; },
      row => { row.route = '/go/other'; },
    ]) {
      const changed = structuredClone(successor); mutate(changed.programs[0]);
      assert.throws(() => assertCurrentHoldGoSuccessor(predecessor, changed, new Set(['held'])), /go_non_hold_manifest_drift/);
    }
  } finally { rmSync(temp, {recursive:true, force:true}); }
});

test('R2 Fella Telos and network-paused offers remain nonpromotable', () => {
  const programs = loadGoPromotionAuthority().programs;
  const links = loadAffiliateLinkMap('compare');
  for (const id of ['fella-health','telos','try-ageless','altrx-glp1-us-cps','futurhealth-wegovy-pillform']) {
    assert.notEqual(programs[id]?.promotion_authorized, true, id);
    assert.notEqual(links[id]?.live, true, id);
  }
  const paused = Object.entries(programs).filter(([id]) => /ageless|altrx|futurhealth.*(?:oral|pill)/i.test(id));
  assert.equal(paused.length, 3);
  for (const [id, row] of paused) assert.equal(row.status, 'WITHHELD', id);
});
