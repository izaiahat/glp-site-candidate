import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readGLP234HistoricalCommercial, GLP234_COMMERCIAL_REF, GLP234_COMMERCIAL_PINS} from './helpers/glp234-historical-commercial.mjs';
import {assertGLP234CurrentGo} from './helpers/glp234-current-go.mjs';
import {loadGoPromotionAuthority} from '../src/go-runtime-selection.mjs';
import {loadAffiliateLinkMap} from '../src/affiliate-link-map.mjs';
import {goCommercialLabels} from '../src/go-commercial-labels.mjs';
import {GO_RUNTIME_MANIFEST} from '../functions/go/program-manifest.js';

const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => `${file === 'program-manifest.js' ? 'functions/go' : 'data'}/${file}`;
const json = file => JSON.parse(readFileSync(new URL(`data/${file}`, root)));
const currentInputs = () => ({registry:json('program-registry.json'), ledger:json('program-content-ledger.json'),
  eligibility:json('program-page-eligibility.json'), selection:json('affiliate-activation-selection.json'),
  links:loadAffiliateLinkMap('compare'), authority:loadGoPromotionAuthority(),
  labels:goCommercialLabels(json('affiliate-held-link-manifest.json')), manifest:GO_RUNTIME_MANIFEST});

test('GLP234 current eligibility refuses count-preserving loss of any native tracked identity', () => {
  const current = currentInputs();
  const raw = structuredClone(current);
  assertGLP234CurrentGo(current);
  assert.deepEqual(current, raw, 'current validation must not mutate raw commercial inputs');
  // Witness both actual non-live populations, not just a synthetic live row.
  for (const [id, status] of [['telos-rx', 'paused_network_program_paused'], ['retaclinic-review', 'held_editorial_only']]) {
    const row = current.eligibility.programs.find(row => row.program_id === id);
    assert.equal(row?.status, status, id);
    assert.equal(row.live_link_allowed, false, id);
    assert.equal(row.promotion_authorized, false, id);
  }
  const accepted = [];
  for (const row of current.eligibility.programs) {
    const invalid = structuredClone(current);
    invalid.eligibility.programs = invalid.eligibility.programs.filter(item => item.program_id !== row.program_id);
    invalid.eligibility.program_count--;
    assert.equal(invalid.eligibility.program_count, invalid.eligibility.programs.length);
    try { assertGLP234CurrentGo(invalid); accepted.push(row.program_id); }
    catch (error) {
      assert.match(error.message, /glp234_current_eligibility_native_identity_drift|relationship_build_identity|surface_parity_violation/);
    }
  }
  assert.deepEqual(accepted, [], 'count-preserving deletions accepted by the actual current oracle');
  const swapped = structuredClone(current);
  swapped.eligibility.programs.find(row => row.program_id === 'telos-rx').program_id = 'unregistered-held';
  assert.throws(() => assertGLP234CurrentGo(swapped), /glp234_current_eligibility_native_identity_drift/);
  const reordered = structuredClone(current);
  reordered.eligibility.programs.reverse();
  assertGLP234CurrentGo(reordered); // Identity, not a frozen row order or byte hash.
});

test('GLP234 temporal custody keeps historical pins exact and current complete GO and eligibility native', () => {
  const source = readFileSync(new URL('./glp234-try-ageless-identity.test.mjs', import.meta.url), 'utf8');
  const block = source.match(/  for \(const \[file, expected\] of \[\n    \['affiliate-activation-selection\.json'[\s\S]*?\]\) assert\.equal\(sha\(readGLP234HistoricalCommercial\(file\)\), expected, file\);/)?.[0];
  assert.ok(block, 'execute maintained native hash assertions, not a copied success predicate');
  const run = new Function('assert', 'sha', 'readGLP234HistoricalCommercial', block);
  const original = Object.fromEntries(Object.keys(GLP234_COMMERCIAL_PINS).map(file => [file,
    execFileSync('git', ['show', `${GLP234_COMMERCIAL_REF}:${relative(file)}`], {cwd: root})]));
  run(assert, hash, readGLP234HistoricalCommercial);
  const changed = [];
  for (const file of Object.keys(original)) {
    const current = readFileSync(new URL(relative(file), root));
    const invalids = [Buffer.concat([original[file], Buffer.from(' ')])];
    if (!current.equals(original[file])) {changed.push(file); invalids.push(current);}
    for (const invalid of invalids) {
      assert.throws(() => readGLP234HistoricalCommercial(file, () => invalid), {code:'ERR_ASSERTION'}, file);
      if (block.includes(`['${file}'`)) {
        const reader = target => readGLP234HistoricalCommercial(target,
          name => name === file ? invalid : original[name]);
        assert.throws(() => run(assert, hash, reader), {code:'ERR_ASSERTION'}, file);
      }
    }
    assert.throws(() => readGLP234HistoricalCommercial(file, () => {
      throw Object.assign(new Error('missing historical source'), {code:'ENOENT'});
    }), {code:'ENOENT'}, file);
  }
  for (const file of ['affiliate-activation-selection.json', 'go-runtime-promotion-authority.json',
    'program-manifest.js', 'program-page-eligibility.json']) {
    assert.ok(changed.includes(file), `${file}: witness actual temporal mismatch without freezing future current membership`);
  }
  let reads = 0;
  assert.throws(() => readGLP234HistoricalCommercial('../program-registry.json', () => {reads++;}),
    /glp234_historical_commercial_scope/);
  assert.equal(reads, 0, 'scope refuses before any reader runs');

  const current = currentInputs();
  assertGLP234CurrentGo(current);
  for (const mutate of [
    value => {delete value.manifest.programs['instarx-review'];},
    value => {value.manifest.programs.unapproved_key = value.manifest.programs['instarx-review']; delete value.manifest.programs['instarx-review'];},
    value => {value.manifest.manifest_sha256 = '0'.repeat(64);},
    value => {value.manifest.programs['instarx-review'].route = '/go/unapproved';},
    value => {value.manifest.programs['eden-xentraffic-offer-3051'].live_link_allowed = true;},
    value => {value.manifest.programs['eden-xentraffic-offer-3051'].promotion_authorized = true;},
    value => {value.manifest.programs['unapproved'] = {...value.manifest.programs['instarx-review'], program_id:'unapproved'};},
    value => {value.eligibility.programs.pop();},
    value => {value.eligibility.program_count++;},
    value => {value.selection.live_program_count++;},
  ]) {
    const invalid = structuredClone(current); mutate(invalid);
    assert.throws(() => assertGLP234CurrentGo(invalid),
      /glp234_current_go_native_source_drift|glp234_current_eligibility_native_identity_drift|relationship_build_raw_count|surface_parity_violation/);
  }
  // Frozen price bytes remain current, untouched and under the native test's
  // original hash: historical commercial custody cannot read or replace them.
  assert.throws(() => readGLP234HistoricalCommercial('price-index-frozen-content-ledger.json'),
    /glp234_historical_commercial_scope/);
});
