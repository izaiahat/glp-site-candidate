import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertApprovedProgramsPublishable,
  loadApprovedProgramCoverage,
  validateApprovedProgramCoverage,
} from "../src/approved-program-coverage.mjs";

const root = new URL("../", import.meta.url);
const cloneInputs = (inputs) => structuredClone(inputs);
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

test("exactly 53 provider-approved programs have exact IDs, briefs, and fail-closed provider-issued evidence", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const result = validateApprovedProgramCoverage(inputs);
  assert.equal(result.status, "PASS_SCAFFOLD");
  assert.equal(result.approved_programs, 53);
  assert.equal(result.exact_program_keys, 53);
  assert.equal(result.review_briefs, 53);
  // The historical denominator stays fixed; the exact Telos pause removes wiring.
  assert.equal(result.receipted_network_program_paused, 1);
  assert.equal(result.candidate_registry_wired + result.receipted_network_program_paused, 52);
  assert.equal(result.content_fit_held_non_glp_destination, 0);
  assert.equal(result.content_fit_lifted_provider_issued, 1);
  assert.equal(result.unwired_missing_provider_issued_url, 0);
  assert.deepEqual(result.provider_counts, {
    Awin: 21,
    "CJ Affiliate": 7,
    Katalys: 23,
    Partnerize: 2,
  });
});

test("coverage gate retains the existing4 editorial cohort with TRT Nation content-fit lifted", async () => {
  const result = validateApprovedProgramCoverage(await loadApprovedProgramCoverage(root));
  assert.equal(result.coverage_gate.status, "BLOCKED");
  // 50 -> 49: the lifted program carries its own recorded bridge acceptance.
  assert.equal(result.bridge_review_pending, 49);
  assert.equal(result.editorial_approval_pending, 49);
  assert.equal(result.public_go_surfaces_added + result.receipted_network_program_paused, 4);
  assert.equal(result.existing4_active_unchanged, 3);
  assert.equal(result.existing4_editorial_link_dark_content_fit_hold, 0);
  assert.equal(result.existing4_content_fit_lifted_qa_verified, 1);
  assert.equal(result.ready6_production_review_indexable, 6);
  assert.equal(result.candidate_local_transparent_direct_ctas, 6);
  assert.equal(result.scaffold_pending_evidence_review, 43);
  assert.deepEqual(new Set(Object.values(result.external_effects)), new Set([0]));
  assert.throws(
    () => assertApprovedProgramsPublishable(result),
    /approved_60_publication_gate_blocked:0:49/,
  );
});

test("the content-fit lift cannot be claimed without a receipted, attributing, 200 link-click QA", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const lifted = inputs.registry.programs.find((program) => program.tracking.state === "content_fit_lifted_provider_issued");
  assert.equal(lifted.program_key, "CJ Affiliate:7538517");

  // A bare boolean is a claim, not evidence. Strip the receipt and it fails.
  const naked = cloneInputs(inputs);
  delete naked.registry.programs.find((p) => p.program_key === lifted.program_key).tracking.link_click_qa;
  assert.throws(() => validateApprovedProgramCoverage(naked), /approved_60_tracking_safety_invalid/);

  // A QA that did not attribute is a click that would never have paid.
  const unattributed = cloneInputs(inputs);
  unattributed.registry.programs.find((p) => p.program_key === lifted.program_key)
    .tracking.link_click_qa.attribution_stamp_present = false;
  assert.throws(() => validateApprovedProgramCoverage(unattributed), /approved_60_tracking_safety_invalid/);

  // A QA that never reached the destination is not a QA.
  const notOk = cloneInputs(inputs);
  notOk.registry.programs.find((p) => p.program_key === lifted.program_key)
    .tracking.link_click_qa.observed_final_status = 403;
  assert.throws(() => validateApprovedProgramCoverage(notOk), /approved_60_tracking_safety_invalid/);

  // A tracking host outside the network allowlist can never be installed.
  const badHost = cloneInputs(inputs);
  const target = badHost.registry.programs.find((p) => p.program_key === lifted.program_key);
  target.tracking.provider_issued_url = "https://example.com/invented";
  target.tracking.tracking_host = "example.com";
  assert.throws(() => validateApprovedProgramCoverage(badHost), /approved_60_tracking_url_not_provider_issued/);

  // The frozen 2026-08-02 snapshot is never rewritten; the lift must still name
  // the exact URL hash it superseded.
  const erasedHistory = cloneInputs(inputs);
  erasedHistory.registry.programs.find((p) => p.program_key === lifted.program_key)
    .tracking.superseded_evidence_snapshot_url_sha256 = "0".repeat(64);
  assert.throws(() => validateApprovedProgramCoverage(erasedHistory), /approved_60_content_fit_lift_evidence_mismatch/);

  // A lifted tracking row whose brief never recorded the editorial acceptance
  // would publish a live link nobody approved.
  const orphan = cloneInputs(inputs);
  orphan.briefs.get(lifted.registry_id).cta.link_click_qa_performed = false;
  assert.throws(() => validateApprovedProgramCoverage(orphan), /approved_60_review_brief_gate_invalid/);
});

test("no other program may borrow the lifted brief shape to enable its own CTA", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const smuggle = cloneInputs(inputs);
  const source = smuggle.briefs.get("cj-affiliate-7538517");
  const victimId = smuggle.registry.programs.find((p) => p.registry_id !== "cj-affiliate-7538517"
    && !["awin-128761", "katalys-1286", "katalys-647", "katalys-1304", "katalys-1516", "katalys-1518"].includes(p.registry_id)).registry_id;
  const target = smuggle.briefs.get(victimId);
  target.editorial = structuredClone(source.editorial);
  target.cta = structuredClone(source.cta);
  target.coverage_gate = structuredClone(source.coverage_gate);
  assert.throws(() => validateApprovedProgramCoverage(smuggle), new RegExp(`approved_60_review_brief_gate_invalid:${victimId}`));
});

test("only the exact ready6 IDs may enter the source-cited indexable production-review state", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const readyIds = [...inputs.briefs.values()]
    .filter((brief) => brief.editorial.state === "ready6_production_review_indexable_source_cited_candidate")
    .map((brief) => brief.registry_id)
    .sort();
  assert.deepEqual(readyIds, ["awin-128761", "katalys-1286", "katalys-1304", "katalys-1516", "katalys-1518", "katalys-647"]);
  const smuggle = cloneInputs(inputs);
  const source = smuggle.briefs.get("awin-128761");
  const target = smuggle.briefs.get("awin-100131");
  target.editorial = structuredClone(source.editorial);
  target.cta = structuredClone(source.cta);
  target.coverage_gate = structuredClone(source.coverage_gate);
  assert.throws(() => validateApprovedProgramCoverage(smuggle), /approved_60_review_brief_gate_invalid:awin-100131/);
});

test("provider tracking authorities are allowlisted or explicitly content-fit held/lifted", async () => {
  const { registry } = await loadApprovedProgramCoverage(root);
  let held = 0;
  let lifted = 0;
  let networkPaused = 0;
  for (const program of registry.programs) {
    const tracking = program.tracking;
    if (tracking.state === "content_fit_hold_non_glp_destination") {
      held += 1;
      assert.equal(program.program_key, "CJ Affiliate:7538517");
      assert.equal(tracking.provider_issued_url, null);
      assert.equal(tracking.candidate_registry_wired, false);
      assert.equal(tracking.tracking_host, null);
      assert.match(tracking.content_fit_blocker, /testosterone replacement/i);
      assert.match(tracking.evidence_only_provider_issued_url_sha256, /^[a-f0-9]{64}$/);
      continue;
    }
    if (tracking.state === "content_fit_lifted_provider_issued") {
      lifted += 1;
      assert.equal(program.program_key, "CJ Affiliate:7538517");
      assert.equal(tracking.candidate_registry_wired, true);
      assert.equal(tracking.click_qa_performed, true);
      assert.match(tracking.superseded_evidence_snapshot_url_sha256, /^[a-f0-9]{64}$/);
      assert.match(tracking.superseded_content_fit_blocker, /testosterone/i);
      // The superseded testosterone creative may never be what we ship.
      assert.doesNotMatch(tracking.provider_issued_url, /17100444|dpbolvw/);
      assert.match(tracking.provider_issued_url, /trtnation\.com%2Fweight-loss-therapy/);
    }
    if (tracking.state === "link_retired_network_program_paused") {
      networkPaused += 1;
      assert.equal(program.program_key, "Katalys:1612");
      assert.equal(tracking.candidate_registry_wired, false);
      assert.equal(tracking.public_go_surface, false);
      assert.equal(tracking.click_qa_performed, false);
      assert.equal(program.research_hold_receipt.sha256, "f18426e9dea271a1c8ae5b234324ddbb57c3c524e61c1494dd8c281174c9c585");
    }
    assert.notEqual(tracking.provider_issued_url, null);
    const url = new URL(tracking.provider_issued_url);
    assert.equal(url.protocol, "https:");
    assert.ok(registry.allowed_provider_tracking_hosts[program.network].includes(url.hostname));
    assert.ok([
      "candidate_registry_wired_provider_issued",
      "content_fit_lifted_provider_issued",
      // Written by apply_first_party_go_route_provision when this release stages
      // the provider's own approved URL behind our first-party /go redirect.
      "candidate_registry_wired_first_party_go_staged",
      // A relationship approved AFTER the frozen 2026-08-02 evidence snapshot, so
      // it can never appear in that snapshot and is its own partition.
      "post_snapshot_operator_rescinded_provider_issued",
      "link_retired_network_program_paused",
    ].includes(tracking.state), `${program.program_key}:${tracking.state}`);
    assert.equal(tracking.source_ref.length > 0, true);
  }
  assert.equal(held, 0);
  assert.equal(lifted, 1);
  assert.equal(networkPaused, 1);
});

test("canonical local evidence still matches every frozen source hash", async () => {
  const { registry } = await loadApprovedProgramCoverage(root);
  for (const [sourceId, source] of Object.entries(registry.source_manifest)) {
    assert.equal(await sha256(source.path), source.sha256, sourceId);
  }
});

test("normalized evidence snapshot is a 53-key bijection with zero effects", async () => {
  const [{ registry }, snapshot] = await Promise.all([
    loadApprovedProgramCoverage(root),
    readFile(new URL("data/approved-program-evidence-snapshot.json", root), "utf8").then(JSON.parse),
  ]);
  assert.equal(snapshot.schema, "approved-program-evidence-snapshot-v1");
  assert.equal(snapshot.reconciled_counts.approved_programs_total, 53);
  assert.deepEqual(snapshot.program_keys, registry.programs.map((program) => program.program_key));
  assert.equal(new Set(snapshot.program_keys).size, 53);
  assert.deepEqual(new Set(Object.values(snapshot.effects)), new Set([0]));
});

test("hostile duplicate or exact-ID drift fails closed", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const duplicate = cloneInputs(inputs);
  duplicate.registry.programs[1] = structuredClone(duplicate.registry.programs[0]);
  assert.throws(() => validateApprovedProgramCoverage(duplicate), /approved_60_exact_set_mismatch/);

  const drift = cloneInputs(inputs);
  drift.registry.programs[0].provider_program_id = "invented-999";
  assert.throws(() => validateApprovedProgramCoverage(drift), /approved_60_exact_identity_invalid/);
});

test("hostile approved-set snapshot or canonical source drift fails closed", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const snapshot = cloneInputs(inputs);
  snapshot.evidenceSnapshot.program_keys[0] = "Awin:invented";
  assert.throws(() => validateApprovedProgramCoverage(snapshot), /approved_60_exact_set_mismatch/);

  const source = cloneInputs(inputs);
  source.sourceHashResults.core = "0".repeat(64);
  assert.throws(() => validateApprovedProgramCoverage(source), /approved_60_source_hash_mismatch:core/);
});

test("hostile missing brief and brief identity drift fail closed", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const missing = cloneInputs(inputs);
  missing.briefs.delete(missing.registry.programs[0].registry_id);
  assert.throws(() => validateApprovedProgramCoverage(missing), /approved_60_review_brief_missing/);

  const drift = cloneInputs(inputs);
  const id = drift.registry.programs[0].registry_id;
  drift.briefs.get(id).exact_identity.provider_program_id = "wrong";
  assert.throws(() => validateApprovedProgramCoverage(drift), /approved_60_review_brief_identity_mismatch/);
});

test("hostile fabricated host, public go surface, and false missing-link state fail closed", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const wired = inputs.registry.programs.find((program) => program.tracking.candidate_registry_wired);


  const badHost = cloneInputs(inputs);
  badHost.registry.programs.find((program) => program.program_key === wired.program_key)
    .tracking.provider_issued_url = "https://example.com/invented";
  badHost.evidenceSnapshot.tracking_by_program[wired.program_key].provider_issued_url = "https://example.com/invented";
  assert.throws(() => validateApprovedProgramCoverage(badHost), /approved_60_tracking_url_not_provider_issued/);

  const publicGo = cloneInputs(inputs);
  publicGo.registry.programs.find((program) => program.program_key === wired.program_key)
    .tracking.public_go_surface = true;
  assert.throws(() => validateApprovedProgramCoverage(publicGo), /approved_60_tracking_safety_invalid/);

  const missing = cloneInputs(inputs);
  missing.registry.programs.find((program) => program.program_key === wired.program_key)
    .tracking.provider_issued_url = null;
  missing.evidenceSnapshot.tracking_by_program[wired.program_key].provider_issued_url = null;
  assert.throws(() => validateApprovedProgramCoverage(missing), /approved_60_unwired_state_invalid/);
});

test("review briefs cannot smuggle claims, CTA enablement, or Bridge acceptance", async () => {
  const inputs = await loadApprovedProgramCoverage(root);
  const id = inputs.registry.programs[0].registry_id;

  const claim = cloneInputs(inputs);
  claim.briefs.get(id).editorial.approved_claims.push("invented claim");
  assert.throws(() => validateApprovedProgramCoverage(claim), /approved_60_review_brief_gate_invalid/);

  const cta = cloneInputs(inputs);
  cta.briefs.get(id).cta.enabled = true;
  assert.throws(() => validateApprovedProgramCoverage(cta), /approved_60_review_brief_gate_invalid/);

  const bridge = cloneInputs(inputs);
  bridge.briefs.get(id).coverage_gate.bridge_review_state = "PASS";
  assert.throws(() => validateApprovedProgramCoverage(bridge), /approved_60_review_brief_gate_invalid/);
});
