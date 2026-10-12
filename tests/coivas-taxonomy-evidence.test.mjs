import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { reconcileTherapeuticTaxonomyWireIn } from '../src/therapeutic-taxonomy.mjs';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const registry = JSON.parse(read('data/program-registry.json'));
const row = registry.therapeutic_taxonomy.programs.coivas;
const authority = registry.therapeutic_taxonomy.authorities[row.evidence_bindings[0].authority];
const proof = JSON.parse(read(authority.path));
const sha = value => createHash('sha256').update(value).digest('hex');
const normalized = text => text.replaceAll('*', '').replaceAll('#', '').replace(/\s+/g, ' ').trim().toLowerCase();
const pages = JSON.parse(read('data/money-page-specs.json')).pages;
const quizConfig = JSON.parse(read('data/quiz-config.json'));
const asOf = new Date(`${row.verified_as_of}T12:00:00Z`);

test('Coivas renewed by maintained producer with exact official raw response and ledger', () => {
  assert.equal(sha(read(authority.path)), authority.sha256);
  const receipt = JSON.parse(read(proof.capture_path));
  const raw = read(proof.capture_path.replace(/\.json$/, '.raw.json'));
  assert.equal(sha(raw), receipt.raw_response_sha256);
  assert.deepEqual(JSON.parse(raw), receipt.response);
  assert.equal(receipt.request.url, 'https://www.coivas.com/challenge');
  assert.equal(receipt.request.maxAge, 0);
  assert.equal(receipt.response.success, true);
  assert.equal(receipt.response.data.metadata.statusCode, 200);
  assert.equal(sha(read(proof.capture_path)), proof.capture_sha256);
  assert.equal(proof.verified_as_of, receipt.received_at.slice(0, 10));
  assert.equal(row.verified_as_of, proof.verified_as_of);
  assert.equal(row.evidence_bindings[0].evidence_sha256, proof.capture_sha256);
  for (const field of ['molecule_tags', 'brand_name_tags', 'delivery_form_tags', 'treatment_type_tags']) {
    assert.deepEqual(row[field], proof.previous_row[field]);
    for (const tag of row[field]) {
      assert.ok(normalized(receipt.response.data.markdown).includes(normalized(proof.assertions[field][tag].quote)));
    }
  }
  assert.deepEqual(row.commercial_link_state, proof.previous_row.commercial_link_state);
  const ledger = read(proof.capture_path.replace(/[^/]+$/, 'firecrawl-ledger.jsonl')).toString().trim().split('\n').map(JSON.parse);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].operation_id, ledger[1].operation_id);
  assert.equal(ledger[0].outcome, 'started');
  assert.equal(ledger[1].outcome, 'success');
  assert.equal(ledger[1].http_status, 200);
  assert.equal(ledger[1].caller, 'refresh-therapeutic-taxonomy');
  assert.equal(registry.therapeutic_taxonomy.freshness_max_days, 31);
});

test('strict CLI passes fresh source while exact predecessor still refuses stale Coivas', () => {
  const result = spawnSync(process.execPath, ['scripts/reconcile-therapeutic-wire-in.mjs', '--release', '.', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'PASS_CHECKED');
  const stale = structuredClone(registry);
  stale.therapeutic_taxonomy.programs.coivas = proof.previous_row;
  assert.throws(() => reconcileTherapeuticTaxonomyWireIn({registry: stale, profileId: 'glp-clinic-scout', pages, quizConfig, asOf}), /therapeutic_taxonomy_evidence_stale:coivas/);
  const expired = structuredClone(registry);
  const later = new Date(asOf.getTime() + 32 * 86400000);
  assert.throws(() => reconcileTherapeuticTaxonomyWireIn({registry: expired, profileId: 'glp-clinic-scout', pages, quizConfig, asOf: later}), /therapeutic_taxonomy_evidence_stale/);
});
