import { loadGoSelection, loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
// FILENAME NOTE: this file is still called trt-nation-link-dark.test.mjs.
//
// On 2026-08-18 the bridge lifted the AFF-TRT-001 content-fit hold, so its
// subject is now the LIFT rather than the link-dark posture. The file was
// rewritten in place instead of renamed because the sealed-successor deployer
// refuses any release that deletes a predecessor path - that rail is what stops
// silent content loss, and it is not worth filing down for a filename.
//
// WHAT THIS FILE ACTUALLY PROTECTS, BEFORE AND AFTER
// --------------------------------------------------
// The 2026-08-08 incident was never "TRT Nation must have no link". It was: the
// only CJ creative we held resolved to the TESTOSTERONE vertical while our page
// reviews the GLP WEIGHT-LOSS program, so shipping it would have sent a reader
// who trusted a weight-loss review to a testosterone funnel. Every assertion
// that protects THAT is retained verbatim below and applies to more surfaces
// than before. What changed is only the posture the network itself authorised: a
// deep-link-enabled EvergreenLink now points at the reviewed weight-loss page,
// and a real, receipted, attributing click proved it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildAffiliateLinkMap } from "../src/affiliate-link-map.mjs";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const contractUrl = new URL(
  "../../../../reports/glp-clinic-scout/affiliate-reconciliation-20260808/trt-nation-content-fit-repair-contract-20260808.json",
  root,
);
const amendmentUrl = new URL(
  "../../../../reports/glp-clinic-scout/affiliate-reconciliation-20260808/trt-nation-content-fit-repair-contract-amendment-20260818.json",
  root,
);
const qaReceiptUrl = new URL(
  "../../../../reports/glp-clinic-scout/affiliate-machine/trt-nation-content-fit-lift-20260818/link-click-qa-20260818.json",
  root,
);
// The 2026-08-08 contract is SUPERSEDED, never edited. Pinning its original hash
// is how we prove the incident record was not quietly rewritten to fit the lift.
const originalContractSha256 = "bf1be7aa6d2573db60a6a448a11b01dd8159fa47c43582a3e3c0227428823b7d";
const RULING = "BRIDGE-20260818-AFF-TRT-001-CONTENT-FIT-LIFT";
const DEEP_LINK = "https://www.tkqlhce.com/click-101822575-17115008?url=https%3A%2F%2Ftrtnation.com%2Fweight-loss-therapy%2F";
// The superseded creative, banned everywhere, forever. Its click HOST
// (www.dpbolvw.net) is deliberately NOT in this list: it is one of four CJ hosts
// on the network allowlist in approved-program-registry.json, and banning a
// whole network's host would ban future CJ programs rather than this creative.
// What must never reappear is the creative ITSELF - its id, its exact URL, and
// the testosterone destination it resolved to.
const FORBIDDEN_TOKENS = ["17100444", "testosterone-replacement-therapy"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, root), "utf8"));

async function textFilesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await textFilesUnder(absolute));
    else if (entry.isFile() && /(?:\.html|\.js|\.mjs|\.json|\.xml|\.txt|_redirects)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

async function sourceInputs() {
  const [
    contractRaw,
    amendment,
    qaReceipt,
    programRegistry,
    providerContracts,
    providerFastpath,
    approvedRegistry,
    evidenceSnapshot,
    money,
    quiz,
    contentLedger,
    eligibility,
    activationSelection,
    reviewBrief,
  ] = await Promise.all([
    readFile(contractUrl),
    readFile(amendmentUrl, "utf8").then(JSON.parse),
    readFile(qaReceiptUrl, "utf8").then(JSON.parse),
    readJson("data/program-registry.json"),
    readJson("data/provider-page-contracts.json"),
    readJson("data/provider-fastpath-contract.json"),
    readJson("data/approved-program-registry.json"),
    readJson("data/approved-program-evidence-snapshot.json"),
    readJson("data/money-page-specs.json"),
    readJson("data/quiz-config.json"),
    readJson("data/program-content-ledger.json"),
    readJson("data/program-page-eligibility.json"),
    readJson("data/affiliate-activation-selection.json"),
    readJson("data/review-briefs/cj-affiliate-7538517.json"),
  ]);
  return {
    contractRaw,
    contract: JSON.parse(contractRaw),
    amendment,
    qaReceipt,
    programRegistry,
    providerContracts,
    providerFastpath,
    approvedRegistry,
    evidenceSnapshot,
    money,
    quiz,
    contentLedger,
    eligibility,
    activationSelection,
    reviewBrief,
  };
}

test("the 2026-08-08 incident record is superseded by an amendment, not edited", async () => {
  const inputs = await sourceInputs();
  assert.equal(sha256(inputs.contractRaw), originalContractSha256,
    "the original repair contract must stay byte-identical - a lift may not rewrite the incident it resolves");
  assert.equal(inputs.contract.required_posture.affiliate_cta, "LINK_DARK");
  assert.equal(inputs.contract.required_posture.tracking_click, "FORBIDDEN");

  assert.equal(inputs.amendment.amends.sha256, originalContractSha256);
  assert.equal(inputs.amendment.authority.id, RULING);
  assert.match(inputs.amendment.authority.verbatim, /content-fit hold lifted for the weight-loss-therapy deep-link destination only/);
  assert.equal(inputs.amendment.finding.state, "CLOSED_UNBLOCK_CONDITION_MET");
  // The prohibition the incident actually exists for survives the amendment.
  const stillBanned = inputs.amendment.unchanged_and_still_binding.testosterone_creative_forbidden;
  assert.equal(stillBanned.link_id, "17100444");
  assert.equal(stillBanned.url_sha256, inputs.contract.finding.tracking_hash);
  assert.equal(inputs.amendment.unchanged_and_still_binding.external_effects_allowed, false);
});

test("the link-click QA was really performed, really attributed, and really landed on the reviewed program", async () => {
  const { qaReceipt, contract } = await sourceInputs();
  assert.equal(qaReceipt.schema, "glp.affiliate_link_click_qa.v1");
  assert.equal(qaReceipt.link_click_qa_performed, true, "the QA must be recorded as PERFORMED, never claimed while flagged false");
  assert.match(qaReceipt.performed_at_utc, /^2026-08-18T/);
  assert.equal(qaReceipt.bridge_ruling.id, RULING);
  assert.equal(qaReceipt.tracking_url, DEEP_LINK);
  assert.equal(qaReceipt.tracking_url_sha256, sha256(Buffer.from(DEEP_LINK, "utf8")));
  assert.equal(qaReceipt.observed_final_status, 200);
  assert.ok(qaReceipt.observed_final_url.startsWith("https://trtnation.com/weight-loss-therapy/"));
  // A click that resolves but does not attribute is a click that never pays.
  assert.equal(qaReceipt.attribution.cjevent_param_present, true);
  assert.ok(qaReceipt.observed_final_url.includes(`cjevent=${qaReceipt.attribution.cjevent}`));
  assert.equal(qaReceipt.destination_content_check.is_the_reviewed_glp_weight_loss_program, true);
  assert.equal(qaReceipt.destination_content_check.is_the_testosterone_vertical, false);
  // The disclosure is complete: one click, no purchase, no lead.
  assert.equal(qaReceipt.honesty.tracking_clicks_this_qa, 1);
  assert.equal(qaReceipt.honesty.purchases, 0);
  assert.equal(qaReceipt.honesty.leads_submitted, 0);
  assert.equal(qaReceipt.honesty.superseded_creative.url_sha256, contract.finding.tracking_hash);
});

test("every TRT source authority now carries the verified weight-loss deep link and only that", async () => {
  const inputs = await sourceInputs();
  const falseUrl = inputs.evidenceSnapshot.tracking_by_program["CJ Affiliate:7538517"].provider_issued_url;
  const falseUrlHash = sha256(Buffer.from(falseUrl, "utf8"));
  assert.equal(falseUrlHash, inputs.contract.finding.tracking_hash);

  const program = inputs.programRegistry.programs.find((item) => item.program_id === "trt-nation");
  const profile = program.profiles["glp-clinic-scout"];
  assert.equal(program.commercial_state, "live");
  assert.equal(program.go.entry_state, "transparent_direct");
  assert.equal(program.go.route, "/go/trt-nation");
  assert.equal(profile.wired, true);
  for (const surface of ["go", "compare", "quiz", "calculator", "review", "sitemap"]) {
    assert.equal(profile.surfaces[surface], true, surface);
  }
  // Every surface is claimed, so no surface may carry a restriction reason. A
  // leftover "not live-eligible" exception would be a false statement.
  assert.deepEqual(profile.exceptions, {});

  const providerContract = inputs.providerContracts.providers.find((item) => item.program_id === "trt-nation");
  assert.equal(providerContract.network_contract.tracking_url, DEEP_LINK);
  assert.equal(providerContract.network_contract.activation_blocker, null);
  assert.equal(providerContract.network_contract.promotion_authorized_in_this_artifact, true);
  assert.equal(providerContract.network_contract.content_fit_evidence.verified_glp_deep_link, true);
  assert.equal(providerContract.network_contract.content_fit_evidence.superseded_creative_url_sha256, falseUrlHash);
  assert.equal(providerContract.row_contract.affiliate_href, DEEP_LINK);
  assert.equal(providerContract.row_contract.affiliate_link_mode, "transparent_direct");
  assert.equal(providerContract.row_contract.live_link_allowed, true);
  assert.equal(providerContract.row_contract.promotion_authorized, true);
  assert.equal(providerContract.publication_state.affiliate_activation_candidate_after_gate, true);
  assert.equal(providerContract.link_contract.commercial_destination_state, "ACTIVE_VERIFIED_GLP_DEEP_LINK");

  const integration = inputs.providerFastpath.providers.find((item) => item.program_id === "trt-nation");
  assert.equal(integration.route_state, "LIVE_EDITORIAL_AFFILIATE_ACTIVE");
  assert.equal(integration.affiliate_cta_state, "ACTIVE_PROVIDER_ISSUED_DIRECT");

  const approved = inputs.approvedRegistry.programs.find((item) => item.program_key === "CJ Affiliate:7538517");
  assert.equal(approved.tracking.state, "content_fit_lifted_provider_issued");
  assert.equal(approved.tracking.provider_issued_url, DEEP_LINK);
  assert.equal(approved.tracking.tracking_host, "www.tkqlhce.com");
  assert.equal(approved.tracking.candidate_registry_wired, true);
  assert.equal(approved.tracking.click_qa_performed, true);
  assert.equal(approved.tracking.link_click_qa.authority, RULING);
  assert.equal(approved.tracking.superseded_evidence_snapshot_url_sha256, falseUrlHash);
  assert.ok(inputs.approvedRegistry.allowed_provider_tracking_hosts["CJ Affiliate"].includes("www.tkqlhce.com"));
  assert.equal(
    inputs.evidenceSnapshot.tracking_by_program["CJ Affiliate:7538517"].provider_issued_url,
    falseUrl,
    "the frozen 2026-08-02 snapshot still records what was actually captured then",
  );

  const moneyRows = inputs.money.pages.flatMap((page) => page.rows).filter((row) => row.program_id === "trt-nation");
  assert.equal(moneyRows.length, 3);
  for (const row of moneyRows) {
    assert.equal(row.affiliate_href, DEEP_LINK);
    assert.equal(row.affiliate_tracking_host, "www.tkqlhce.com");
    assert.equal(row.affiliate_link_mode, "transparent_direct");
    assert.equal(row.live_link_allowed, true);
    assert.equal(row.promotion_authorized, true);
    assert.match(row.operator_selection_receipt_sha256, /^[a-f0-9]{64}$/);
  }

  const { projectQuizFromRegistry } = await import("../src/program-registry.mjs");
  const projectedQuiz = projectQuizFromRegistry(inputs.programRegistry, "glp-clinic-scout", inputs.quiz, inputs.contentLedger);
  assert.equal(projectedQuiz.candidates.some((item) => item.program_id === "trt-nation"), true,
    "a live-eligible program must reach the quiz conversion pool");

  const ledgerEntry = inputs.contentLedger.programs.find((item) => item.program_id === "trt-nation");
  assert.equal(ledgerEntry.live_link_allowed, true);
  assert.equal(ledgerEntry.promotion_authorized, true);
  assert.equal(ledgerEntry.status, "live_operator_approved_transparent_direct");

  // Eligibility retains historical held evidence; taxonomy only counts the
  // current live population. Exact identity parity prevents equal-count swaps.
  assert.equal(inputs.eligibility.program_count, inputs.contentLedger.programs.length);
  assert.deepEqual(inputs.eligibility.programs.map(p => p.program_id).sort(), inputs.contentLedger.programs.map(p => p.program_id).sort());
  const heldEligibility = inputs.eligibility.programs.filter(p => !p.live_link_allowed && !p.promotion_authorized);
  assert.deepEqual(heldEligibility.map(p => p.program_id), ['telos-rx']);
  assert.equal(heldEligibility[0].status, 'paused_network_program_paused');
  assert.equal(heldEligibility[0].go_route_wired, false);
  assert.equal(heldEligibility[0].tracking, null);
  assert.equal(inputs.eligibility.live_program_count, inputs.activationSelection.live_program_count);
  const eligibilityRow = inputs.eligibility.programs.find((item) => item.program_id === "trt-nation");
  assert.ok(eligibilityRow, "TRT Nation must remain explicitly represented in commercial/editorial eligibility");
  assert.equal(eligibilityRow.affiliate_link_mode, "transparent_direct");
  assert.equal(eligibilityRow.live_link_allowed, true);
  assert.equal(eligibilityRow.promotion_authorized, true);
  assert.equal(eligibilityRow.status, "live_operator_approved_transparent_direct");
  // The row used to allowlist "trt-nation.com" as a fallback host - a domain we
  // do not control and the provider does not use.
  assert.deepEqual(eligibilityRow.allowed_fallback_hosts, ["trtnation.com"]);
  assert.equal("affiliate_href" in eligibilityRow, false);

  const buildReport = await readJson("artifacts/ops/build-report.json");
  const aliasIds = new Set(inputs.programRegistry.programs
    .filter((program) => program.profiles?.["glp-clinic-scout"]?.canonical_identity?.role === "alias")
    .map((program) => String(program.review_slug || program.program_id)));
  const expectedDirectPrograms = inputs.contentLedger.programs
    .filter((program) => (program.live_link_allowed || program.promotion_authorized) && !aliasIds.has(program.program_id)).length;
  assert.equal(buildReport.direct_affiliate_programs, expectedDirectPrograms);
  assert.equal(buildReport.live_programs, inputs.programRegistry.provider_dynamic_profiles.expected_counts.provider_identities);
  assert.equal(buildReport.live_registry_rows, inputs.programRegistry.therapeutic_taxonomy.expected_counts.provider_rows);

  assert.equal(inputs.reviewBrief.cta.enabled, true);
  assert.equal(inputs.reviewBrief.cta.link_click_qa_performed, true);
  assert.equal(inputs.reviewBrief.cta.public_affiliate_surface, true);
  assert.equal(inputs.reviewBrief.cta.public_go_surface, true);
  assert.equal(inputs.reviewBrief.coverage_gate.deployment_authority, true);
  assert.equal(inputs.reviewBrief.coverage_gate.bridge_review_state, RULING);

  const extraAuthorities = {
    providerContracts: inputs.providerContracts,
    providerFastpath: inputs.providerFastpath,
    approvedRegistry: inputs.approvedRegistry,
  };
  for (const surface of ["compare", "calculator", "quiz", "review"]) {
    const linkMap = buildAffiliateLinkMap(
      inputs.money.pages,
      inputs.programRegistry,
      inputs.activationSelection,
      surface,
      "glp-clinic-scout",
      extraAuthorities,
    );
    const entry = linkMap["trt-nation"];
    assert.equal(entry?.live, true, `TRT Nation must be live on ${surface}`);
    assert.equal(entry?.affiliate_href, DEEP_LINK, `wrong carrier on ${surface}`);
    assert.notEqual(entry?.affiliate_href, falseUrl, `false creative leaked on ${surface}`);
  }

  // UNCHANGED FROM THE LINK-DARK ERA: not one renderer authority may carry the
  // testosterone creative, its click host, or the testosterone destination.
  const rendererAuthorities = [
    "data/program-registry.json",
    "data/provider-page-contracts.json",
    "data/provider-fastpath-contract.json",
    "data/approved-program-registry.json",
    "data/money-page-specs.json",
    "data/quiz-config.json",
    "data/program-content-ledger.json",
    "data/program-page-eligibility.json",
    "data/affiliate-activation-selection.json",
    "data/review-briefs/cj-affiliate-7538517.json",
  ];
  for (const relative of rendererAuthorities) {
    const text = await readFile(new URL(relative, root), "utf8");
    assert.equal(text.includes(falseUrl), false, `${relative} retained false renderer URL`);
    // D2f S5: historical captured prose is evidence, not a rendered href.
    // Keep direct URL/href fields guarded recursively, including nested contracts.
    const hrefs = [];
    const visit = (value, key = "") => {
      if (typeof value === "string" && /(?:href|url)$/.test(key)) hrefs.push(value);
      else if (Array.isArray(value)) value.forEach(item => visit(item, key));
      else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => visit(v, k));
    };
    visit(JSON.parse(text));
    for (const token of FORBIDDEN_TOKENS) {
      assert.equal(hrefs.some(href => href.includes(token)), false, `${relative} retained forbidden href token ${token}`);
    }
  }
});

test("the generated candidate ships the weight-loss CTA and no testosterone carrier anywhere", async () => {
  const { evidenceSnapshot } = await sourceInputs();
  const falseUrl = evidenceSnapshot.tracking_by_program["CJ Affiliate:7538517"].provider_issued_url;
  const publicRoot = path.join(rootPath, "public");
  const forbidden = [falseUrl, ...FORBIDDEN_TOKENS];
  const publicFiles = await textFilesUnder(publicRoot);
  for (const filename of publicFiles) {
    const text = await readFile(filename, "utf8");
    for (const token of forbidden) {
      assert.equal(text.includes(token), false, `${path.relative(publicRoot, filename)} contains forbidden TRT carrier ${token}`);
    }
  }

  const review = await readFile(new URL("public/reviews/trt-nation/index.html", root), "utf8");
  assert.match(review, /data-link-dark="false"/);
  assert.match(review, /data-affiliate-state="active"/);
  assert.match(review, /data-link-mode="server-redirect"/);
  assert.match(review, /TRT Nation/);
  assert.match(review, /compounded tirzepatide/i);
  assert.doesNotMatch(review, /Partner link unavailable/);
  // The reader-visible CTA points at the weight-loss deep link, never the raw
  // /go carrier and never a testosterone page.
  const selected=loadGoSelection(root).programs['trt-nation'];assert.equal(selected.status,'VERIFIED');
  assert.equal(GO_RUNTIME_MANIFEST.programs['trt-nation'].tracking.base_url,DEEP_LINK);
  assert.equal(selected.issued_link,DEEP_LINK);
  assert.match(review, /weight-loss-therapy/);
  assert.match(review, /href="\/go\/trt-nation\?s=reviews\.rv2&amp;v=a"/);
  assert.ok(review.indexOf("This page contains one active affiliate link") < review.indexOf('data-affiliate-state="active"'));

  const provider = await readFile(new URL("public/providers/trt-nation/index.html", root), "utf8");
  const quiz = await readFile(new URL("public/quiz/provider-fit/index.html", root), "utf8");
  assert.match(provider, /TRT Nation/, "provider detail lost truthful identity content");
  assert.match(provider, /href="\/reviews\/trt-nation\/"/, "provider detail lost its governed editorial path");
  assert.doesNotMatch(provider, /17100444|testosterone-replacement-therapy/, "provider detail regained a forbidden TRT carrier");
  assert.match(provider, /href="\/go\/trt-nation\?/);
  // The quiz is a conversion pool and equals the live-eligible set exactly, so
  // the now-live program must appear in it.
  assert.match(quiz, /trt-nation|TRT Nation/, "quiz must offer the live-eligible program");

  const workerManifest = await readJson("artifacts/ops/worker-manifest.staging.json");
  assert.equal(workerManifest.programs.some((item) => item.program_id === "trt-nation"), true);
  const generatedGo = await readFile(new URL("functions/go/program-manifest.js", root), "utf8");
  assert.match(generatedGo, /trt-nation/);
  assert.doesNotMatch(generatedGo, /17100444|dpbolvw/);

  // The /go carrier is a REGISTERED but attribution-gated route: with no valid
  // assignment it bounces every program, live ones included, to the comparison
  // page. What distinguishes a registered program from a removed one is the
  // reason header - `assignment-not-allowlisted` vs `unknown-program`. So the
  // real assertion is that TRT Nation now behaves exactly like a live program,
  // and specifically no longer like a program the manifest has never heard of.
  const { onRequest } = await import("../functions/go/[program].js");
  const call = (program) => onRequest({
    request: new Request(`https://glpclinicscout.com/go/${program}?s=provider-fit.result&v=a`, { method: "GET" }),
    params: { program },
    env: {},
  });
  const trtGo = await call("trt-nation");
  const liveGo = await call("drhouse");
  assert.equal(trtGo.status, liveGo.status);
  assert.equal(trtGo.headers.get("x-redirect-reason"), liveGo.headers.get("x-redirect-reason"));
  assert.notEqual(trtGo.headers.get("x-redirect-reason"), "unknown-program");
  assert.doesNotMatch(await trtGo.text(), /dpbolvw|17100444/);
});
