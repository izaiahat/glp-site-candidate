import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApprovedProgramCoverage, validateApprovedProgramCoverage, assertApprovedProgramsPublishable } from '../src/approved-program-coverage.mjs';

const root = new URL('../', import.meta.url);
test('authentic Telos RECEIPTED HOLD preserves frozen evidence without wiring or publication authority', async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const before = structuredClone(inputs);
  const result = validateApprovedProgramCoverage(inputs);
  assert.equal(result.status, 'PASS_SCAFFOLD');
  assert.equal(result.approved_programs, 53); // historical exact-set denominator
  assert.equal(result.candidate_registry_wired, 51);
  assert.equal(result.receipted_network_program_paused, 1);
  assert.equal(result.content_fit_lifted_provider_issued, 1);
  assert.equal(result.content_fit_held_non_glp_destination, 0);
  assert.equal(result.existing4_active_unchanged, 3); // historical editorial cohort
  assert.equal(result.scaffold_pending_evidence_review, 43);
  assert.equal(result.public_go_surfaces_added, 3);
  assert.equal(result.coverage_gate.status, 'BLOCKED');
  assert.throws(() => assertApprovedProgramsPublishable(result), /publication_gate_blocked/);
  assert.deepEqual(inputs, before, 'validation never rewrites historical evidence or inputs');
});

const telos = (inputs) => inputs.registry.programs.find((row) => row.program_key === 'Katalys:1612');
const siteRow = (inputs, id = 'telos-rx') => inputs.networkHoldProof.siteRegistry.programs.find((row) => row.program_id === id);
const profile = (inputs, id) => siteRow(inputs, id).profiles['glp-clinic-scout'];
const negatives = [
  ['missing proof', (i) => { delete i.networkHoldProof; }, /receipt_hash_invalid/],
  ['forged proof boolean', (i) => { i.networkHoldProof = { exempt: true }; }, /receipt_hash_invalid/],
  ['missing receipt binding', (i) => { delete telos(i).research_hold_receipt; }, /binding_invalid/],
  ['wrong receipt path', (i) => { telos(i).research_hold_receipt.path += '.other'; }, /binding_invalid/],
  ['wrong receipt hash', (i) => { telos(i).research_hold_receipt.sha256 = '0'.repeat(64); }, /binding_invalid/],
  ['altered receipt bytes', (i) => { i.networkHoldProof.receiptBytes += ' '; }, /receipt_hash_invalid/],
  ['altered ACK bytes', (i) => { i.networkHoldProof.ackBytes += ' '; }, /operator_ack_hash_invalid/],
  ['altered row bytes', (i) => { i.networkHoldProof.rowBytes += ' '; }, /row_readback_hash_invalid/],
  ['wrong canonical alias', (i) => { telos(i).existing_release_alias = 'telos-rx-review'; }, /hold_identity_invalid/],
  ['wrong Sheet identity', (i) => { telos(i).canonical_sheet_row = 94; }, /hold_identity_invalid/],
  ['wrong network ID', (i) => { telos(i).provider_program_id = '01612'; }, /exact_identity_invalid/],
  ['held row promoted', (i) => { telos(i).tracking.candidate_registry_wired = true; }, /activation_present/],
  ['retired state promoted', (i) => { telos(i).tracking.state = 'candidate_registry_wired_provider_issued'; }, /activation_present/],
  ['held public go enabled', (i) => { telos(i).tracking.public_go_surface = true; }, /activation_present/],
  ['held click QA enabled', (i) => { telos(i).tracking.click_qa_performed = true; }, /activation_present/],
  ['generic hold flag not authority', (i) => { delete i.networkHoldProof; delete telos(i).research_hold_receipt; telos(i).is_held = true; }, /binding_invalid/],
  ['borrowed hold on live program', (i) => { i.registry.programs[0].research_hold_receipt = structuredClone(telos(i).research_hold_receipt); }, /hold_identity_invalid/],
  ['mutated URL', (i) => { telos(i).tracking.provider_issued_url += '&extra=1'; }, /tracking_evidence_mismatch|hold_evidence_invalid/],
  ['reencoded URL', (i) => { telos(i).tracking.provider_issued_url = telos(i).tracking.provider_issued_url.replace('offer_id=1612','offer_id=%31%36%31%32'); }, /tracking_evidence_mismatch|hold_evidence_invalid/],
  ['mutated URL in both historical and current rows', (i) => { telos(i).tracking.provider_issued_url += '&extra=1'; i.evidenceSnapshot.tracking_by_program['Katalys:1612'].provider_issued_url = telos(i).tracking.provider_issued_url; }, /hold_evidence_invalid/],
  ['mutated source ref in both rows', (i) => { telos(i).tracking.source_ref += '/invented'; i.evidenceSnapshot.tracking_by_program['Katalys:1612'].source_ref = telos(i).tracking.source_ref; }, /hold_evidence_invalid/],
  ['null evidence URL', (i) => { telos(i).tracking.provider_issued_url = null; }, /unwired_state_invalid|hold_evidence_invalid/],
  ['erased frozen state', (i) => { i.evidenceSnapshot.tracking_by_program['Katalys:1612'].state = telos(i).tracking.state; }, /hold_evidence_invalid/],
  ['historical brief rewritten', (i) => { i.briefs.get('katalys-1612').cta.enabled = false; }, /historical_brief_invalid/],
  ['historical brief raw bytes rewritten', (i) => { i.networkHoldProof.briefBytes += ' '; }, /historical_brief_invalid/],
  ['site canonical identity drift', (i) => { profile(i).canonical_identity.canonical_program_id = 'other'; }, /alias_invalid/],
  ['alias becomes canonical', (i) => { profile(i, 'telos-rx-review').canonical_identity.role = 'canonical'; }, /alias_invalid/],
  ['alias public review', (i) => { profile(i, 'telos-rx-review').surfaces.review = true; }, /registry_activation_present/],
  ['canonical live', (i) => { siteRow(i).commercial_state = 'live'; }, /registry_activation_present/],
  ['canonical wired', (i) => { profile(i).wired = true; }, /registry_activation_present/],
  ['canonical compare surface', (i) => { profile(i).surfaces.compare = true; }, /registry_activation_present/],
  ['canonical go surface', (i) => { profile(i).surfaces.go = true; }, /registry_activation_present/],
  ['canonical go redirect', (i) => { siteRow(i).go.entry_state = 'server_redirect'; }, /registry_activation_present/],
  ['canonical binding absent', (i) => { delete siteRow(i).research_hold_receipt; }, /registry_binding_invalid/],
  ['duplicate alias', (i) => { i.networkHoldProof.siteRegistry.programs.push(structuredClone(siteRow(i, 'telos-rx-review'))); }, /registry_identity_invalid/],
  ['frozen source hash mismatch', (i) => { i.sourceHashResults.core = '0'.repeat(64); }, /source_hash_mismatch/],
  ['live tracking safety unchanged', (i) => { i.registry.programs[0].tracking.public_go_surface = true; }, /tracking_safety_invalid/],
  ['live tracking host unchanged', (i) => { i.registry.programs[0].tracking.provider_issued_url = 'https://example.invalid/no'; }, /tracking_url_not_provider_issued/],
  ['live brief approval unchanged', (i) => { i.briefs.get(i.registry.programs[0].registry_id).coverage_gate.bridge_review_state = 'APPROVED'; }, /review_brief_gate_invalid/],
  ['TRT lift still requires QA', (i) => { delete i.registry.programs.find((row) => row.program_key === 'CJ Affiliate:7538517').tracking.link_click_qa; }, /tracking_safety_invalid/],
];
for (const [name, mutate, expected] of negatives) {
  test(`RECEIPTED HOLD refuses ${name}`, async () => {
    const inputs = await loadApprovedProgramCoverage(root);
    mutate(inputs);
    assert.throws(() => validateApprovedProgramCoverage(inputs), expected);
  });
}
