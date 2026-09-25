import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildAffiliateLinkMap } from "../src/affiliate-link-map.mjs";
import { buildCostCalculatorData, renderCostCalculator } from "../src/cost-calculator.mjs";
import { decorateCostCalculatorAffiliateSurface, costAffiliateEmailManifest } from "../src/cost-calculator-affiliate.mjs";
import { loadGoSelection, loadGoPromotionAuthority } from "../src/go-runtime-selection.mjs";

const readJson = async (relative) => JSON.parse(await readFile(new URL(`../data/${relative}`, import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);

async function inputs() {
  const [config, money, providerPages, providerFastpath, approvedRegistry, wireApprovals, registry, selection] = await Promise.all([
    readJson("cost-calculator.json"),
    readJson("money-page-specs.json"),
    readJson("provider-page-contracts.json"),
    readJson("provider-fastpath-contract.json"),
    readJson("approved-program-registry.json"),
    readJson("affiliate-wire-in-approvals.json"),
    readJson("program-registry.json"),
    readJson("affiliate-activation-selection.json"),
  ]);
  return { config, money, providerPages, providerFastpath, approvedRegistry, wireApprovals, registry, selection,
    promotionAuthority: loadGoPromotionAuthority() };
}

function mutateRows(money, programId, mutate) {
  for (const page of money.pages) {
    for (const row of page.rows || []) if (row.program_id === programId) mutate(row);
  }
}

test("calculator and quiz share one fail-closed transparent-direct resolver", async () => {
  const { money, registry, selection, promotionAuthority } = await inputs();
  const calculator = buildAffiliateLinkMap(money.pages, registry, selection, "calculator", "glp-clinic-scout", { promotionAuthority });
  const quiz = buildAffiliateLinkMap(money.pages, registry, selection, "quiz", "glp-clinic-scout", { promotionAuthority });
  assert.equal(buildAffiliateLinkMap(money.pages, registry, selection, "calculator")["enhance-md"].live, false,
    "omitting sealed authority remains fail-closed");
  const liveCalculator = Object.values(calculator).filter((item) => item.live);
  const liveQuiz = Object.values(quiz).filter((item) => item.live);

  // The Sheet selection is sealed at 11; its Ageless row is now network-paused.
  // Pin the exact source reason, then require every other selected identity.
  assert.equal(selection.programs.find((item) => item.program_id === "try-ageless")?.network_program_id, "1538");
  assert.equal(promotionAuthority.programs["try-ageless"]?.status, "WITHHELD");
  assert.equal(promotionAuthority.programs["try-ageless"]?.reason, "network_paused_katalys_offer_1538");
  const eligibleIds = new Set(selection.programs.filter((item) => item.program_id !== "try-ageless").map((item) => item.program_id));
  assert.equal(eligibleIds.size, 10);
  assert.deepEqual(new Set(liveCalculator.map((item) => item.program_id)), eligibleIds);
  assert.deepEqual(new Set(liveQuiz.map((item) => item.program_id)), eligibleIds);
  for (const paused of ["synergy-rx", "care-bare-rx-glp1", "try-ageless"]) {
    assert.equal(liveCalculator.some((item) => item.program_id === paused), false, paused);
    assert.equal(liveQuiz.some((item) => item.program_id === paused), false, paused);
  }
  for (const item of [...liveCalculator, ...liveQuiz]) {
    assert.match(item.affiliate_href, /^https:\/\/(?:track\.revoffers\.com|www\.awin1\.com)\//);
    assert.match(item.review_path, /^\/reviews\/[a-z0-9-]+\/$/);
  }
});

test("calculator resolver keeps held, ineligible, malformed, and conflicting programs link-dark", async () => {
  const { money, registry, selection, promotionAuthority } = await inputs();

  const heldRegistry = clone(registry);
  heldRegistry.programs.find((item) => item.program_id === "enhance-md").commercial_state = "held";
  assert.equal(buildAffiliateLinkMap(money.pages, heldRegistry, selection, "calculator", "glp-clinic-scout", { promotionAuthority })["enhance-md"].live, false);

  const ineligibleRegistry = clone(registry);
  ineligibleRegistry.programs.find((item) => item.program_id === "enhance-md").profiles["glp-clinic-scout"].surfaces.calculator = false;
  assert.equal(buildAffiliateLinkMap(money.pages, ineligibleRegistry, selection, "calculator", "glp-clinic-scout", { promotionAuthority })["enhance-md"].live, false);

  const malformedMoney = clone(money);
  mutateRows(malformedMoney, "enhance-md", (row) => { row.affiliate_href = "https://example.invalid/invented"; });
  assert.equal(buildAffiliateLinkMap(malformedMoney.pages, registry, selection, "calculator", "glp-clinic-scout", { promotionAuthority })["enhance-md"].live, false);

  const conflictingMoney = clone(money);
  let changed = false;
  mutateRows(conflictingMoney, "enhance-md", (row) => {
    if (!changed) { row.affiliate_href = "https://track.revoffers.com/conflicting-approved-host-path"; changed = true; }
  });
  assert.equal(buildAffiliateLinkMap(conflictingMoney.pages, registry, selection, "calculator", "glp-clinic-scout", { promotionAuthority })["enhance-md"].live, false);
});

test("resolver rejects same-host URL drift and missing or mismatched activation authority", async () => {
  const { money, registry, selection, promotionAuthority } = await inputs();
  const enhanceLive = (pages, authority) => buildAffiliateLinkMap(pages, registry, authority, "calculator", "glp-clinic-scout", { promotionAuthority })["enhance-md"]?.live ?? false;
  assert.equal(enhanceLive(money.pages, selection), true, "positive control must be live before adverse mutations");

  const hostileSameHost = clone(money);
  mutateRows(hostileSameHost, "enhance-md", (row) => { row.affiliate_href = "https://track.revoffers.com/attacker-controlled?program=738"; });
  assert.equal(enhanceLive(hostileSameHost.pages, selection), false);

  const missingReceipt = clone(money);
  mutateRows(missingReceipt, "enhance-md", (row) => { delete row.operator_selection_receipt_sha256; });
  assert.equal(enhanceLive(missingReceipt.pages, selection), false);

  const mismatchedReceipt = clone(money);
  mutateRows(mismatchedReceipt, "enhance-md", (row) => { row.operator_selection_receipt_sha256 = "f".repeat(64); });
  assert.equal(enhanceLive(mismatchedReceipt.pages, selection), false);

  const omittedSelection = clone(selection);
  omittedSelection.programs = omittedSelection.programs.filter((program) => program.program_id !== "enhance-md");
  omittedSelection.program_count = omittedSelection.programs.length;
  assert.equal(enhanceLive(money.pages, omittedSelection), false);

  const mismatchedLinkHash = clone(selection);
  mismatchedLinkHash.programs.find((program) => program.program_id === "enhance-md").tracking_link_sha256 = "0".repeat(64);
  assert.equal(enhanceLive(money.pages, mismatchedLinkHash), false);

  const missingSelectionReceipt = clone(selection);
  delete missingSelectionReceipt.operator_gate_receipt_sha256;
  assert.equal(enhanceLive(money.pages, missingSelectionReceipt), false);
});

test("calculator result decorator routes selected on-site links while preserving direct email links", async () => {
  const { config, money, providerPages, providerFastpath, registry, selection } = await inputs();
  const data = buildCostCalculatorData(config, money.pages, providerPages, providerFastpath, registry);
  const base = renderCostCalculator(data);
  const html = decorateCostCalculatorAffiliateSurface(base, data, money.pages, registry, selection);

  assert.equal(config.attribution_month, "202608");
  assert.match(html, /id="cost-affiliate-offer"/);
  assert.match(html, /Affiliate disclosure: Clinic Scout may earn a commission/);
  assert.match(html, /cta\.rel='sponsored nofollow noopener'/);
  assert.match(html, /cta.href=link.go_href\|\|link.affiliate_href/);
  assert.match(html, /data-link-mode',link.go_href\?'server-redirect':'transparent-direct'/);
  assert.match(html, /link.go_href\?'calculator.pc1':'calculator-'/);
  assert.match(html, /'calculator-'\+link\.program_id\+'-result-'\+month/);
  assert.match(html, /Start with /);
  assert.match(html, /Email me this cost breakdown|id="cost-result"/);
  assert.doesNotMatch(html, /href="\/go\//);
  const links = JSON.parse(html.match(/const links=new Map\((\[.*?\])\.map\(link=>/s)[1]);
  const selectionRows = Object.values(loadGoSelection().programs);
  let routed = 0, direct = 0;
  for (const link of links) {
    const selected = selectionRows.find(row => row.program_id === link.program_id || row.render_id === link.program_id);
    if (selected?.status === 'VERIFIED') {
      routed++;
      assert.equal(link.go_href, `${selected.route}?s=calculator.pc1&v=a`);
      assert.equal(link.affiliate_href, selected.issued_link);
    } else {
      direct++;
      assert.equal(link.go_href, undefined);
      assert.match(link.affiliate_href, /^https:\/\//);
    }
  }
  assert.ok(routed > 0 && direct > 0, 'both selected GO and unselected direct paths must be exercised');
  const email = costAffiliateEmailManifest(links);
  assert.deepEqual(email.programs.map(row => row.affiliate_href), links.map(row => row.affiliate_href));
  for (const row of email.programs) {assert.match(row.affiliate_href, /^https:\/\//);assert.equal(row.go_href, undefined);}
  assert.equal((html.match(/id="cost-affiliate-offer"/g) || []).length, 1);
  assert.equal((html.match(/data-cost-affiliate-runtime/g) || []).length, 1);
});

test("calculator authority carries four Awin Item 1 links and approved Katalys Shed", async () => {
  const { config, money, providerPages, providerFastpath, approvedRegistry, wireApprovals, registry, selection, promotionAuthority } = await inputs();
  const data = buildCostCalculatorData(config, money.pages, providerPages, providerFastpath, registry);
  const html = decorateCostCalculatorAffiliateSurface(
    renderCostCalculator(data), data, money.pages, registry, selection, "glp-clinic-scout",
    { providerContracts: providerPages, providerFastpath, approvedRegistry, wireInApprovals: wireApprovals, promotionAuthority },
  );
  const match = html.match(/const links=new Map\((\[.*?\])\.map\(link=>/s);
  assert.ok(match, "calculator runtime tracked-link map missing");
  const links = JSON.parse(match[1]);
  const required = new Map([
    ["drhouse", "53271"], ["biltrx", "115383"],
    ["serena-health", "128203"], ["coivas", "128761"],
  ]);
  const item1Ids = new Set(["53271", "80963", "115383", "126727", "128203", "128761"]);
  const selected = links.filter((row) => {
    const url = new URL(row.affiliate_href);
    return item1Ids.has(url.searchParams.get("mid") || url.searchParams.get("awinmid"));
  });
  assert.deepEqual(selected.map((row) => row.program_id).sort(), [...required.keys()].sort());
  for (const row of selected) {
    const url = new URL(row.affiliate_href);
    assert.equal(url.hostname, "www.awin1.com");
    assert.equal(url.searchParams.get("mid") || url.searchParams.get("awinmid"), required.get(row.program_id));
  }
  assert.equal(selected.some((row) => row.program_id === "measured"), false);
  assert.equal(promotionAuthority.programs["katalys-1516"]?.status, "VERIFIED", "approved GLP-1 offer 1516 has the operator decision receipt");
  const shed = links.find((row) => row.program_id === "shedrx");
  assert.ok(shed, "approved Shed offer must be live");
  const shedUrl = new URL(shed.affiliate_href);
  assert.equal(shedUrl.hostname, "track.revoffers.com");
  assert.equal(shedUrl.searchParams.get("offer_id"), "1516");
});

test("calculator Awin Item 1 authority fails closed on missing, stale, or broadened surface policy", async () => {
  const { config, money, providerPages, providerFastpath, approvedRegistry, wireApprovals, registry, selection, promotionAuthority } = await inputs();
  const data = buildCostCalculatorData(config, money.pages, providerPages, providerFastpath, registry);
  const buildLinks = (authority) => {
    const html = decorateCostCalculatorAffiliateSurface(
      renderCostCalculator(data), data, money.pages, registry, selection, "glp-clinic-scout",
      { providerContracts: providerPages, providerFastpath, approvedRegistry, wireInApprovals: authority, promotionAuthority },
    );
    return JSON.parse(html.match(/const links=new Map\((\[.*?\])\.map\(link=>/s)[1]);
  };
  const item1 = (links) => links.filter((row) => ["drhouse", "biltrx", "measured", "serena-health", "coivas"].includes(row.program_id));
  assert.deepEqual(item1(buildLinks(null)), []);
  const stale = clone(wireApprovals);
  stale.current_terms_reassessment.evidence_sha256 = "0".repeat(64);
  assert.deepEqual(item1(buildLinks(stale)), []);
  // 2026-09-03: a defect in ONE row now de-authorizes only that row - the
  // module header always promised "one poisoned program still takes only itself
  // down", and returning null for the whole authority is what took four healthy
  // Awin programs dark when the Measured rescission landed. The two envelope
  // cases above still empty the surface; these prove the tampered program goes
  // dark WITHOUT its healthy siblings.
  const ids = (authority) => item1(buildLinks(authority)).map((row) => row.program_id).sort();
  const healthy = ids(wireApprovals);
  // Never let this test pass vacuously: the untampered surface must carry links.
  assert.ok(healthy.length >= 3, `expected live Item 1 links, got ${JSON.stringify(healthy)}`);
  const find = (rows, id) => rows.find((row) => row.provider_program_id === id);
  const tampered = (mutate) => {
    const document = clone(wireApprovals);
    mutate(document.current_terms_reassessment.programs);
    return ids(document);
  };
  const without = (alias) => healthy.filter((id) => id !== alias);
  assert.deepEqual(tampered((rows) => {
    const row = find(rows, "126727");
    row.authorized_material_expansion_surfaces = ["calculator"];
    row.may_authorize_material_expansion = true;
  }), without("measured"));
  assert.deepEqual(tampered((rows) => { find(rows, "115383").operator_words = "accept the terms"; }), without("biltrx"));
  assert.deepEqual(tampered((rows) => { find(rows, "115383").decision_receipt_sha256 = "f".repeat(64); }), without("biltrx"));
  assert.deepEqual(tampered((rows) => { find(rows, "126727").provenance = "discord-message-forged"; }), without("measured"));
});

test("current terms reassessment binds exact accepted and rejected decisions to bounded expansion", async () => {
  const { wireApprovals } = await inputs();
  const reassessment = wireApprovals.current_terms_reassessment;
  // 2026-08-13 rejected 126727 (Measured); the operator RESCINDED that on
  // 2026-08-31, so no program carries rejected terms and Measured preserves its
  // existing live links like any other accepted program.
  assert.ok(["accepted_live_preserved_rejected_terms_de_linked",
    "accepted_live_preserved_rejected_terms_rescinded_20260831"].includes(reassessment.governance_scope));
  assert.equal(reassessment.evidence_sha256, "7eb6660110af1b7f64149036217723c1095398b9d2016dfb7da32135dfc6ae73");
  assert.equal(reassessment.programs.length, 6);
  const accepted = reassessment.programs.filter((row) => row.verdict === "operator_accepted_terms");
  const rejected = reassessment.programs.filter((row) => row.verdict === "operator_rejected_terms");
  assert.deepEqual(accepted.map((row) => row.provider_program_id).sort(), ["115383", "126727", "80963"]);
  assert.deepEqual(rejected.map((row) => row.provider_program_id), []);
  for (const row of reassessment.programs) {
    const isRejected = row.verdict === "operator_rejected_terms";
    const retiredBestTerms = row.provider_program_id === "80963";
    const disposition = isRejected ? "de_link_all_surfaces_operator_rejected_terms"
      : retiredBestTerms ? "retired_best_terms_higher_payout" : "preserve_existing_live";
    assert.equal(row.live_link_disposition, disposition);
    assert.equal(row.may_authorize_new_activation, false);
    assert.match(row.historical_activation_authority_ref, /^data\//);
  }
  assert.deepEqual(reassessment.programs.filter((row) => row.may_authorize_material_expansion)
    .map((row) => row.provider_program_id).sort(), ["115383", "128761", "53271"]);
  const shedrx = reassessment.programs.find((row) => row.provider_program_id === "80963");
  assert.deepEqual(shedrx.existing_live_surfaces, []);
  assert.deepEqual(shedrx.authorized_material_expansion_surfaces, []);
  const biltrx = reassessment.programs.find((row) => row.provider_program_id === "115383");
  assert.deepEqual(biltrx.existing_live_surfaces, ["compare", "cost", "quiz"]);
  assert.deepEqual(biltrx.authorized_material_expansion_surfaces, ["calculator"]);
  assert.equal(biltrx.operator_words, "ACCEPT-TERMS 115383");
  assert.equal(biltrx.provenance, "discord-message-1537243566156546078");
  const measured = reassessment.programs.find((row) => row.provider_program_id === "126727");
  // 2026-08-31 rescission: Measured keeps its three existing live surfaces and
  // may expand onto none of them; the indemnity trigger that justified the
  // original hold is carried as an explicit recorded risk-acceptance.
  assert.deepEqual(measured.existing_live_surfaces, ["compare", "cost", "quiz"]);
  assert.deepEqual(measured.authorized_material_expansion_surfaces, []);
  assert.equal(measured.may_authorize_material_expansion, false);
  assert.equal(measured.rescission_note, "MEASURED_TERMS_RESCISSION_V1");
  assert.equal(measured.provenance, "operator-decision-supersession-20260831");
  assert.equal(measured.risk_acceptance.risk_accepted, true);
  assert.equal(measured.reversible_by, "ACCEPT-TERMS 126727");
  for (const approval of wireApprovals.programs.filter((row) => ["drhouse", "biltrx", "measured"].includes(row.existing_release_alias))) {
    assert.ok(approval.historical_activation_authority);
    assert.ok(approval.current_terms_reassessment);
    assert.equal(approval.terms, undefined);
  }
  assert.equal(wireApprovals.programs.find((row) => row.existing_release_alias === "biltrx").current_terms_reassessment.verdict, "operator_accepted_terms");
  assert.equal(wireApprovals.programs.find((row) => row.existing_release_alias === "measured").current_terms_reassessment.verdict, "operator_accepted_terms");
});

test("every active READY6 review CTA maps to a canonical program with exact selected go supersessions", async () => {
  const registry = await readJson("program-registry.json");
  const contract = await readJson("ready6-editorial-contract.json");
  const byId = new Map(registry.programs.map((program) => [program.program_id, program]));

  // The READY6 contract is a sealed 2026-08-02 record and stays 6. A program the
  // network has since paused is out of the site registry, so it is not published
  // and has no CTA to check - it is asserted absent instead.
  const SUPPRESSED_NETWORK_PAUSED = new Set(["katalys-1518"]);
  assert.equal(contract.programs.length, 6);
  for (const candidate of contract.programs) {
    const program = byId.get(candidate.registry_id);
    if (SUPPRESSED_NETWORK_PAUSED.has(candidate.registry_id)) {
      assert.equal(program, undefined, `paused_program_still_registered:${candidate.registry_id}`);
      continue;
    }
    assert.ok(program, `missing registry program ${candidate.registry_id}`);
    assert.equal(program.commercial_state, "live", candidate.registry_id);
    assert.equal(program.profiles["glp-clinic-scout"].surfaces.review, true, candidate.registry_id);
    const selected = loadGoSelection().programs[candidate.registry_id];
    const adopted = selected?.status === "VERIFIED";
    assert.equal(program.profiles["glp-clinic-scout"].surfaces.go, adopted, candidate.registry_id);
    assert.equal(program.go.entry_state, adopted ? "server_redirect" : "held", candidate.registry_id);
    // 2026-08-06 surface unification: READY6 sits on compare and quiz with every
    // other live provider. Only the opaque /go route stays held, and it keeps its
    // written reason.
    // 2026-08-06 cluster 1: unless the row is a declared ALIAS of another
    // merchant (Katalys 1516 "SHED" is the same provider as Awin `shedrx`), in
    // which case it is off every list surface by design and says so in writing.
    const profile = program.profiles["glp-clinic-scout"];
    const alias = profile.canonical_identity?.role === "alias";
    assert.equal(profile.surfaces.compare, !alias, candidate.registry_id);
    assert.equal(profile.surfaces.quiz, !alias, candidate.registry_id);
    if (adopted) assert.equal(profile.exceptions.go, undefined, `${candidate.registry_id}:superseded_go_hold`);
    else {
      assert.equal(profile.exceptions.go.enabled, true, `${candidate.registry_id}:go`);
      assert.ok(profile.exceptions.go.reason.length > 20, `${candidate.registry_id}:go`);
    }
    for (const surface of ["compare", "quiz"]) {
      if (alias) assert.ok(profile.exceptions[surface]?.reason.length > 40, `${candidate.registry_id}:${surface}:alias_reason_missing`);
      else assert.equal(profile.exceptions[surface], undefined, `${candidate.registry_id}:${surface}:stale_exception`);
    }

    if (alias) {
      const canonical = byId.get(profile.canonical_identity.canonical_program_id);
      assert.ok(canonical?.review_path, `${candidate.registry_id}:canonical_review_missing`);
      const redirects = await readFile(new URL("../public/_redirects", import.meta.url), "utf8");
      assert.match(redirects, new RegExp(`^${program.review_path} ${canonical.review_path} 301$`, "m"));
      continue;
    }
    const html = await readFile(new URL(`../public${candidate.review_path}index.html`, import.meta.url), "utf8");
    assert.equal((html.match(/data-affiliate-state="active"/g) || []).length, 1, candidate.registry_id);
  }
});