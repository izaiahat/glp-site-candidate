import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// Historical assertions use exact 9cd63e73d743d69104fa0a281ce42113743faf4a
// data/program-page-eligibility.json bytes, not a current authority substitute.
export function historicalReviewEligibility(bytes = gunzipSync(readFileSync(new URL('../fixtures/eligibility-pre-retaclinic.json.gz', import.meta.url)))) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '751f063a70d26ab8f2b420f9d4f433fb7786cbfc59db82e7a3d21c1d03fc9d8b');
  return JSON.parse(bytes);
}
export function assertHistoricalHeldEligibility(eligibility = historicalReviewEligibility()) {
  const inputs = {eligibility};
  // Unchanged original five assertions; historical scope only.
  const heldEligibility = inputs.eligibility.programs.filter(p => !p.live_link_allowed && !p.promotion_authorized);
  assert.deepEqual(heldEligibility.map(p => p.program_id), ['telos-rx']);
  assert.equal(heldEligibility[0].status, 'paused_network_program_paused');
  assert.equal(heldEligibility[0].go_route_wired, false);
  assert.equal(heldEligibility[0].tracking, null);
}

export function assertPausedTrimiReview({html, review, selection, registry, promotion}) {
  const id = 'trimi-glp-1';
  assert.equal(review.program_id, id);
  assert.equal(selection.program_count, 10);
  assert.equal(selection.programs.length, selection.program_count);
  assert.equal(new Set(selection.programs.map(p => p.program_id)).size, selection.program_count);
  const selected = selection.programs.filter(p => p.program_id === id);
  assert.equal(selected.length, 1, 'historical selected Trimi must remain accounted for');
  const rows = registry.programs.filter(p => p.program_id === id);
  assert.equal(rows.length, 1);
  const snapshot = rows[0].affiliate_relationship_snapshot;
  assert.equal(snapshot?.promotion_denied, true);
  assert.equal(snapshot.lifecycle, 'paused');
  assert.equal(snapshot.relationship_status, 'paused_network_program_paused');
  assert.equal(snapshot.network, selected[0].network.toLowerCase());
  assert.equal(snapshot.network_program_id, selected[0].network_program_id);
  assert.equal(snapshot.sheet_row, selected[0].sheet_row);
  assert.equal(snapshot.reported_information, true);
  assert.match(snapshot.source_checked_at, /^\d{4}-\d{2}-\d{2}T/);
  const authority = promotion[id];
  assert.equal(authority?.status, 'WITHHELD');
  assert.equal(authority.promotion_authorized, false);
  assert.equal(authority.reason, 'sole_writer_relationship_paused');
  assert.deepEqual(authority.relationship_snapshot, {program_id: id, render_id: id, ...snapshot});
  assert.match(html, /data-link-dark="true"/);
  assert.match(html, /data-affiliate-state="unavailable"/);
  assert.doesNotMatch(html, /data-link-mode="(?:transparent-direct|server-redirect)"/);
  assert.doesNotMatch(html, /data-affiliate-state="active"/);
  assert.doesNotMatch(html, /href="(?:https?:\/\/(?:track\.revoffers\.com|www\.awin1\.com)\/|\/go\/trimi-glp-1(?:[?"/]))/);
}

export function assertCurrentHeldEligibility(inputs) {
  const held = inputs.eligibility.programs.filter(p => !p.live_link_allowed && !p.promotion_authorized);
  assert.deepEqual(held.map(p => p.program_id).sort(), ['retaclinic-review', 'telos-rx']);
  const telos = held.find(p => p.program_id === 'telos-rx');
  assert.equal(telos.status, 'paused_network_program_paused');
  assert.equal(telos.go_route_wired, false);
  assert.equal(telos.tracking, null);
  const reta = held.find(p => p.program_id === 'retaclinic-review');
  assert.equal(reta.status, 'held_editorial_only');
  assert.equal(reta.affiliate_link_mode, 'held_editorial_only');
  assert.equal(reta.tracking, null);
  assert.equal(reta.tracking_material_included, false);
  assert.equal(reta.go_route_wired, false);
  const registry = inputs.programRegistry.programs.find(p => p.program_id === reta.program_id);
  const snapshot = registry?.affiliate_relationship_snapshot;
  assert.equal(snapshot?.promotion_denied, true);
  assert.equal(snapshot.source_kind, 'explicit_editorial_only_source_authority');
  assert.equal(snapshot.reason, 'Operator RV-Q13: campaign landing lists retatrutide; prescription-plan editorial review only, no commercial link.');
  assert.equal(registry.go.entry_state, 'held');
  const profile = registry.profiles['glp-clinic-scout'];
  assert.equal(profile.surface_membership, 'review_only');
  for (const surface of ['review', 'sitemap']) assert.equal(profile.surfaces[surface], true);
  for (const surface of ['compare', 'quiz', 'calculator', 'go']) {
    assert.equal(profile.surfaces[surface], false, `retaclinic ${surface} must remain denied`);
    assert.deepEqual(profile.exceptions[surface], {enabled: true, reason: snapshot.reason, surface_restriction_basis: 'editorial_only_hold'});
  }
  const contract = inputs.providerContracts.providers.find(p => p.program_id === reta.program_id);
  assert.equal(contract?.row_contract.live_link_allowed, false);
  assert.equal(contract.row_contract.promotion_authorized, false);
  assert.equal(contract.row_contract.affiliate_href, null);
  assert.equal(contract.network_contract.promotion_authorized_in_this_artifact, false);
  assert.equal(contract.network_contract.tracking_url, null);
  assert.equal(contract.network_contract.activation_blocker, snapshot.reason);
  const fastpath = inputs.providerFastpath.providers.find(p => p.program_id === reta.program_id);
  assert.equal(fastpath?.affiliate_cta_state, 'HOLD_EDITORIAL_ONLY');
  assert.equal(fastpath.route_state, 'READY_EDITORIAL_LINK_DARK');
  const ledger = inputs.contentLedger.programs.find(p => p.program_id === reta.program_id);
  assert.equal(ledger?.live_link_allowed, false);
  assert.equal(ledger.promotion_authorized, false);
  // Complete maintained identity equality is also asserted by the owning TRT
  // callback. Neither a healthy member's loss nor another denied row is allowed.
  assert.deepEqual(inputs.eligibility.programs.map(p => p.program_id).sort(), inputs.contentLedger.programs.map(p => p.program_id).sort());
}
