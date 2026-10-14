import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizedProfileSha256 } from '../src/provider-dynamic-profiles.mjs';
import { normalizedTaxonomySha256 } from '../src/therapeutic-taxonomy.mjs';
import { projectProviderDisplayFacts, projectProviderDisplayLedger } from '../src/provider-display-evidence.mjs';
import { reviewBrief } from '../src/blog-system.mjs';
import { projectQuizFromRegistry } from '../src/program-registry.mjs';
import { applyMeritScores, meritScore } from '../src/merit-ranking.mjs';
import { comparablePriceProviderIds } from '../src/provider-dynamic-profiles.mjs';
import { historicalPriceIndexRegistry } from '../src/price-index-historical-registry.mjs';
import { readFileSync } from 'node:fs';
import { assertCurrentHoldGoSuccessor } from '../src/go-runtime-manifest.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { GO_RUNTIME_MANIFEST } from '../functions/go/program-manifest.js';
import { effectiveAffiliateBuildInputs, effectiveAffiliateRegistry } from '../src/affiliate-relationship-sync.mjs';
import { quizInputSeam } from './helpers/quiz-input-seam.mjs';
import { readF17PinnedRegistry } from './helpers/f17-pinned-registry.mjs';

test('GLP-234 F3 exact identity successor reconstructs only the historical price label', async () => {
  const {readHistoricalPriceFixture} = await import('./helpers/provider-append-predecessor.mjs');
  const registry = JSON.parse(readHistoricalPriceFixture(new URL('../data/program-registry.json',import.meta.url)));
  const ledger = await load('price-index-frozen-content-ledger.json');
  const before = structuredClone({registry, ledger});
  const historical = historicalPriceIndexRegistry(registry, ledger);
  const target = r => r.programs.find(row => row.program_id === 'try-ageless');
  assert.equal(target(historical).display_name, 'AgelessRx');
  assert.equal(target(registry).display_name, 'Try Ageless');
  assert.deepEqual({registry, ledger}, before);
  const care = r => r.programs.find(row => row.program_id === 'care-bare-rx-glp1-review');
  assert.deepEqual(care(registry).research_dynamic_profile.taxonomy.brand_name_tags, []);
  assert.deepEqual(care(historical).research_dynamic_profile.taxonomy.brand_name_tags, ['mounjaro']);
  assert.deepEqual(registry.provider_dynamic_profiles.profiles['care-bare-rx-glp1-review'].taxonomy.brand_name_tags, []);
  assert.deepEqual(registry.therapeutic_taxonomy.programs['care-bare-rx-glp1-review'].brand_name_tags, []);
  const priceBody = structuredClone(historical);
  for (const key of ['therapeutic_taxonomy', 'provider_dynamic_profiles', 'consumer_therapeutic_authorities']) delete priceBody[key];
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
  assert.equal(sha(canonical(priceBody)), 'f9a8ce57165d5a014fe623c820a4ab90313d4c5679c4d079e6703a7e2df8f234');
  assert.deepEqual(historical, historicalPriceIndexRegistry(historical, ledger));
  const retained = structuredClone(registry);
  target(retained).display_name = 'AgelessRx';
  assert.deepEqual(historical, historicalPriceIndexRegistry(retained, ledger));
  // The full historical oracle remains exact, including every other row/field.
  for (const edit of [
    r => { target(r).display_name = 'Unapproved alias'; },
    r => { target(r).go.route = '/go/unapproved'; },
    r => { target(r).profiles['glp-clinic-scout'].surfaces.go = false; },
    r => { target(r).extra_fact = 'invented'; },
    r => { r.programs.push(structuredClone(target(r))); },
    r => { r.programs = r.programs.filter(row => row.program_id !== 'try-ageless'); },
    r => { r.programs.find(row => row.program_id === 'found-health').display_name = 'Changed'; },
  ]) {
    const invalid = structuredClone(registry);
    edit(invalid);
    assert.throws(() => historicalPriceIndexRegistry(invalid, ledger), /price_index_historical_(identity|registry)_drift/);
  }
  for (const edit of [
    r => { care(r).display_name = 'Unapproved Care identity'; },
    r => { care(r).research_dynamic_profile.taxonomy.brand_name_tags = ['wegovy']; },
    r => { care(r).research_dynamic_profile.evidence_bindings[0].evidence_text += ' unapproved'; },
  ]) {
    const invalid = structuredClone(registry); edit(invalid);
    assert.throws(() => historicalPriceIndexRegistry(invalid, ledger), /price_index_historical_care_drift/);
  }
  const changedHistorical = structuredClone(historical);
  care(changedHistorical).research_dynamic_profile.taxonomy.brand_name_tags = ['wegovy'];
  assert.throws(() => historicalPriceIndexRegistry(changedHistorical, ledger), /price_index_historical_care_drift/);
  const wrongOracle = structuredClone(registry);
  wrongOracle.therapeutic_taxonomy.price_index_registry_programs_semantic_basis_sha256 = '0'.repeat(64);
  assert.throws(() => historicalPriceIndexRegistry(wrongOracle, ledger), /price_index_historical_oracle_invalid/);
  const wrongLedger = structuredClone(ledger);
  wrongLedger.programs[0].display_name = 'Changed';
  assert.throws(() => historicalPriceIndexRegistry(registry, wrongLedger), /price_index_historical_ledger_drift/);
  assert.throws(() => historicalPriceIndexRegistry(registry, ledger, file =>
    String(file).endsWith('d2w-s9-final-decision.md') ? Buffer.from('forged') : readFileSync(file)), /price_index_historical_alias_authority_hash_mismatch/);
});

// Execute the maintained build input block and quiz call, not a copied caller.
// This is bounded caller-chain coverage: no build outputs or article admission.
async function buildQuizInputs(ledger) {
  const source = await readFile(new URL('../scripts/build-staging.mjs', import.meta.url), 'utf8');
  const execute = quizInputSeam(source);
  const rawProgramRegistry = await load('program-registry.json');
  return execute(name => name === 'program-content-ledger.json' ? ledger : load(name),
    projectProviderDisplayLedger, projectQuizFromRegistry, effectiveAffiliateRegistry(rawProgramRegistry), 'glp-clinic-scout', comparablePriceProviderIds, applyMeritScores, meritScore,
    effectiveAffiliateBuildInputs, rawProgramRegistry);
}

test('GLP-234 F1 actual build-to-quiz projection owns raw input without weakening source guards', async () => {
  const ledger = await load('program-content-ledger.json');
  const before = structuredClone(ledger);
  const {contentLedger, canonicalQuiz} = await buildQuizInputs(ledger);
  assert.deepEqual(ledger, before, 'build consumer view must not replace raw ledger rows');
  const registry = await load('program-registry.json');
  const rawScored = structuredClone(before.programs);
  applyMeritScores(rawScored, { comparablePriceIds: comparablePriceProviderIds(registry, 'glp-clinic-scout', {
    asOf: new Date(`${registry.provider_dynamic_profiles.sealed_as_of}T12:00:00Z`),
  }) });
  const scoreFields = row => ({program_id: row.program_id, criteria_scores: row.criteria_scores,
    score_basis: row.score_basis, score_evidence_earned: row.score_evidence_earned, score: meritScore(row)});
  assert.deepEqual(contentLedger.programs.map(scoreFields), rawScored.map(scoreFields),
    'display-only research projection must not change any provider scoring input');
  const body = contentLedger.programs.find(row => row.program_id === 'bodybuilding-com-glp-1-longevity-review');
  assert.ok(body.research_cancellation.value, 'retain source-backed cancellation display');
  assert.equal(before.programs.find(row => row.program_id === body.program_id).research_cancellation.value, '');
  assert.equal(body.criteria_scores.price_transparency, 65);
  const target = contentLedger.programs.find(row => row.program_id === 'try-ageless');
  assert.equal(target.display_name, 'Try Ageless');
  assert.equal(target.research_backfill_20260830, undefined);
  assert.deepEqual(canonicalQuiz, projectQuizFromRegistry(effectiveAffiliateRegistry(await load('program-registry.json')), 'glp-clinic-scout', await load('quiz-config.json'), before));
  for (const edit of [
    row => { delete row.research_backfill_20260830; },
    row => { row.research_backfill_20260830.facts.shipping.source_url = 'https://unrelated.example/'; },
    row => { row.research_shipping_wait.source_url = 'https://agelessrx.com/'; },
  ]) {
    const invalid = structuredClone(before);
    edit(invalid.programs.find(row => row.program_id === 'try-ageless'));
    await assert.rejects(buildQuizInputs(invalid), /try_ageless_historical_backfill_unexpected|try_ageless_cross_business_fact/);
  }
});

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url)));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Candidate-oracle regression only: executing these pure maintained guards does
// not supply independent acceptance, run a browser, or authorize publication.
test('GLP-234 F17 exact adopted successor retains identity plus Breeze union and refuses unintended leaves', async () => {
  const read = (path) => readFileSync(new URL('../' + path, import.meta.url));
  // Exact Git pins at ed8deacd242647f38f029eae1ce84303b5097fca, before
  // fe0df36 adopted the Pallas denial. Original lineage assertions below are
  // historical custody, not approval of today's registry or this successor.
  const lineageBytes = read('tests/fixtures/f17-pre-pallas-input-successor.json');
  assert.equal(sha(lineageBytes), '7a8ad0ed7c3a3e58be97a7b9ac2bdc8e0f2b45b469964e3cfa86369dd7ea399a');
  const pins = JSON.parse(lineageBytes);
  const input = 'data/program-registry.json';
  const bytes = readF17PinnedRegistry();
  const immutable = {data: {[input]: 'bd74cce7b25ccc1b754f26b70be51a8f96afb8356e8a53c3e919985c9d8500b6'}};
  assert.equal(pins.inputs[input].after_sha256, '87b578d60e4803f0ab28e39d01a33cec478d26e0c3c333d0373dccb2a61dc887');
  assert.equal(pins.provenance.previous_care_after_sha256, 'e463477e4a0094353f763e37a044eafd53a07d09b4e72345769244a879eb515e');
  assert.equal(pins.provenance.previous_care_fixture_git_ref, 'aa13b69fcbff4f9990b7043702da2fa37756390a:tests/fixtures/glp41-approved-input-successor.json');
  assert.match(pins.authority, /care-metadata-source-repair-authorization-20260927\/RESULT\.json/);
  assert.equal(pins.status, 'PROPOSED_EXACT_INPUT_SUCCESSOR_PENDING_INDEPENDENT_REVIEW');
  assert.equal(pins.provenance.source_adoption_grant_sha256, '4c16c5924ad1ed4aaa515f3dc6ed0ca608e79e35ed18377caa181d33c5fc30c2');
  assert.equal(pins.provenance.metadata_source_grant_sha256, '7bb6931e5ac1ee6e9c9c0b7ed171dc12c56d1fbe1bc8ff2ddbb8a3a644be4f6a');
  assert.equal(pins.provenance.combined_input_review_status, 'ACCEPTED_EXACT_DATA_AT_REVIEWED_HEAD_SOURCE_ADOPTION_ONLY');
  assert.equal(pins.provenance.prior_care_after_sha256, '612814c63d7276d2affe721a7e63664d02703c2554d049a4db25ee61ee05560d');
  assert.equal(pins.source_head, 'fc647dc91582f9bb7d0b5321d432480ca16bef1f');
  assert.equal(pins.provenance.integration_parent, 'b42a4983f1cea415328473d93b6bf57aa063532a');
  // Fixed parent hashes are provenance, not inherited approval of this union.
  assert.equal(pins.provenance.immediate_predecessor_sha256, '836bba4cd1cee5afe637ac0a727a65ee539361295a615e2767cc8d5b923a74e4');
  assert.equal(pins.provenance.breeze_parent_registry_sha256, '139ead035992abe19e0e5c99830869c72274931ca4d7280dd65c3f1e6e241f86');

  const lineagePins = pins;
  {
  // Current maintained consumers still receive the exact Pallas successor
  // pins and registry. The lexical scope keeps their injection seam unchanged.
  const pins = JSON.parse(read('tests/fixtures/glp41-approved-input-successor.json'));
  const pallas = pins.provenance.pallas_successor_proposal;
  assert.equal(pallas.before_sha256, lineagePins.inputs[input].after_sha256);
  assert.equal(pallas.after_sha256, sha(bytes));
  assert.equal(pins.inputs[input].after_sha256, sha(bytes));
  assert.equal(pallas.changed_program_count, 1);
  assert.equal(pallas.changed_program_id, 'pallas-health-review');
  assert.equal(pallas.only_changed_program_field, 'affiliate_relationship_snapshot');
  assert.equal(pallas.independent_acceptance, null, 'proposal is not inherited acceptance');
  const retainedLineage = structuredClone(pins);
  delete retainedLineage.provenance.pallas_successor_proposal;
  retainedLineage.inputs[input].after_sha256 = lineagePins.inputs[input].after_sha256;
  assert.deepEqual(retainedLineage, lineagePins, 'all other historical pin fields remain exact');

  // Run the existing Node test body unchanged with in-memory input substitutions.
  const nodeSource = read('tests/glp41-material-contracts.test.mjs').toString();
  const nodeStart = nodeSource.indexOf("test('F17 approved registry successor binds exact prior and current bytes'");
  const nodeEnd = nodeSource.indexOf("\ntest('F34", nodeStart);
  assert.ok(nodeStart >= 0 && nodeEnd > nodeStart);
  const nodeGuard = new Function('test', 'assert', 'f17Read', 'sha', nodeSource.slice(nodeStart, nodeEnd));
  const runNode = (candidate, fixture = pins) => {
    let calls = 0;
    nodeGuard((_name, check) => { calls++; check(); }, assert,
      path => path === input ? candidate : path === 'tests/fixtures/glp41-approved-input-successor.json'
        ? Buffer.from(JSON.stringify(fixture)) : assert.fail('unexpected Node input: ' + path), sha);
    assert.equal(calls, 1);
  };

  // Exercise only the browser consumer's pure input function with the frozen
  // K10 hash supplied in memory, not its external manifest or actual browser.
  const browserSource = read('tests/browser/glp34-listing-handler.mjs').toString();
  const browserStart = browserSource.indexOf(' const boundInput=relative=>{');
  const browserEnd = browserSource.indexOf(' const registrySource=boundInput(', browserStart);
  assert.ok(browserStart >= 0 && browserEnd > browserStart);
  const browserGuard = new Function('fs', 'root', 'successor', 'immutable', 'assert', 'sha',
    browserSource.slice(browserStart, browserEnd) + '\nreturn boundInput;');
  const runBrowserInput = (candidate, fixture = pins) => browserGuard({readFileSync: url => {
    assert.equal(url.href, new URL('../' + input, import.meta.url).href);
    return candidate;
  }}, new URL('../', import.meta.url), fixture, immutable, assert, sha)(input);
  runNode(bytes);
  assert.deepEqual(runBrowserInput(bytes), JSON.parse(bytes));
  // Historical custody cannot accidentally accept today's distinct registry.
  assert.throws(() => runNode(read(input)), {code: 'ERR_ASSERTION'});
  assert.throws(() => runBrowserInput(read(input)), /immutable listing oracle/);

  const registry = JSON.parse(bytes);
  assert.equal(JSON.stringify(registry, null, 2) + '\n', bytes.toString(), 'mutation serialization must preserve otherwise exact bytes');
  for (const edit of [
    value => { value.programs.find(row => row.program_id === 'try-ageless').display_name = 'Unapproved alias'; },
    value => { value.programs.find(row => row.program_id === 'found-health').display_name = 'Unintended change'; },
    value => { value.programs.find(row => row.program_id === 'try-ageless').go.route = '/go/unapproved'; },
    value => { value.therapeutic_taxonomy.programs['breeze-meds-review'].verified_as_of = '2026-09-28'; },
    value => { value.therapeutic_taxonomy.programs['breeze-meds-review'].evidence_bindings[0].evidence_sha256 = '0'.repeat(64); },
    value => { value.provider_dynamic_profiles.sealed_as_of = '2026-09-27'; },
  ]) {
    const invalid = structuredClone(registry); edit(invalid);
    const changed = Buffer.from(JSON.stringify(invalid, null, 2) + '\n');
    assert.throws(() => runNode(changed), {code: 'ERR_ASSERTION'});
    assert.throws(() => runBrowserInput(changed), /immutable listing oracle/);
  }
  const appended = Buffer.concat([bytes, Buffer.from(' ')]);
  assert.throws(() => runNode(appended), {code: 'ERR_ASSERTION'});
  assert.throws(() => runBrowserInput(appended), /immutable listing oracle/);
  const staleCare = structuredClone(pins);
  staleCare.inputs[input].after_sha256 = pins.provenance.previous_care_after_sha256;
  assert.throws(() => runNode(bytes, staleCare), {code: 'ERR_ASSERTION'});
  assert.throws(() => runBrowserInput(bytes, staleCare), /immutable listing oracle/);
  const priorCare = structuredClone(pins);
  priorCare.inputs[input].after_sha256 = pins.provenance.prior_care_after_sha256;
  assert.throws(() => runNode(bytes, priorCare), {code: 'ERR_ASSERTION'});
  assert.throws(() => runBrowserInput(bytes, priorCare), /immutable listing oracle/);
  const prior = structuredClone(pins);
  prior.inputs[input].after_sha256 = 'b37017463dbcb1b706e71f87f126e0c118ed24a6d923dbb0362cfff03f59911b';
  assert.throws(() => runNode(bytes, prior), {code: 'ERR_ASSERTION'});
  assert.throws(() => runBrowserInput(bytes, prior), /immutable listing oracle/);
  for (const parentHash of [
    '836bba4cd1cee5afe637ac0a727a65ee539361295a615e2767cc8d5b923a74e4',
    '139ead035992abe19e0e5c99830869c72274931ca4d7280dd65c3f1e6e241f86',
  ]) {
    const parent = structuredClone(pins);
    parent.inputs[input].after_sha256 = parentHash;
    assert.throws(() => runNode(bytes, parent), {code: 'ERR_ASSERTION'});
    assert.throws(() => runBrowserInput(bytes, parent), /immutable listing oracle/);
  }
  const wrongBefore = structuredClone(pins);
  wrongBefore.inputs[input].before_sha256 = prior.inputs[input].after_sha256;
  assert.throws(() => runNode(bytes, wrongBefore), {code: 'ERR_ASSERTION'});
  assert.throws(() => runBrowserInput(bytes, wrongBefore), /approved successor must bind the old input/);
  }
});

test('GLP-234 registry projections name the first-party brand without altering routing or held commercial custody', async () => {
  const registry = await load('program-registry.json');
  const program = registry.programs.find((row) => row.program_id === 'try-ageless');
  const profile = registry.provider_dynamic_profiles.profiles['try-ageless'];
  const taxonomy = registry.therapeutic_taxonomy.programs['try-ageless'];
  assert.ok(program && profile && taxonomy);
  assert.deepEqual([program.display_name, profile.provider, taxonomy.provider],
    ['Try Ageless', 'Try Ageless', 'Try Ageless']);
  assert.deepEqual(profile.aliases, []); // AgelessRx is not a verified alias.
  assert.equal(profile.program_id, 'try-ageless');
  assert.equal(taxonomy.registry_program_id, 'try-ageless');
  assert.deepEqual(program.go, { entry_state: 'transparent_direct', route: '/go/try-ageless' });
  assert.deepEqual(taxonomy.commercial_link_state, { compare: 'live', quiz: 'live' });
  const binding = profile.evidence_bindings.find((row) => row.evidence_kind === 'registry_identity_projection');
  assert.equal(JSON.parse(binding.evidence_text).provider, 'Try Ageless');
  assert.equal(binding.evidence_sha256, sha(binding.evidence_text));
  assert.equal(profile.normalized_sha256, normalizedProfileSha256(profile));
  assert.equal(taxonomy.normalized_sha256, normalizedTaxonomySha256(taxonomy));

  // Historical network row is deliberately not rewritten as a brand-mapping assertion.
  const selection = await load('affiliate-activation-selection.json');
  assert.ok(selection.excluded_network_paused_programs.includes('try-ageless'));
  assert.deepEqual(selection.excluded_selection_evidence.find((row) => row.program_id === 'try-ageless'), {
    display_name: 'AgelessRx', link_mode: 'transparent_direct', network: 'Katalys',
    network_program_id: '1538', program_id: 'try-ageless', sheet_row: 94,
    sheet_status: 'approved_active_tracking_ready', tracking_host: 'track.revoffers.com',
    tracking_link_sha256: 'f160cdd13074620be4ba6fac5258d2480ae1dcb45327a9b11e0e49cc3e4ed650',
    disposition: 'historical_snapshot_only_not_activation_authority',
  });
  for (const [name, expected] of [
    ['affiliate-activation-selection.json', '63586a11a80878a008c61b0825ff5344726906b0e7efece6811dd986f3db0de6'],
    ['affiliate-held-link-manifest.json', '613ce4dcd21357466e11f9338c71c554d71c6feac71a57127c2059d0db153675'],
    ['go-runtime-promotion-authority.json', 'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2'],
  ]) assert.equal(sha(await readFile(new URL(`../data/${name}`, import.meta.url))), expected, name);
  // Historical identity approval remains exact; the later accepted current
  // denial may remove held tracking only, never alter non-held custody.
  const historicalGo = new URL('./fixtures/f06-historical-source/program-manifest.js', import.meta.url);
  assert.equal(sha(await readFile(historicalGo)),
    'cab1f5b4a8437080c09f580daf7be19bb4b9a177673150ba1f1e8f9abe113f7a');
  const { GO_RUNTIME_MANIFEST: beforeGo } = await import(historicalGo.href);
  const held = new Set(Object.entries(loadGoPromotionAuthority().programs).filter(([,row])=>row.status==='WITHHELD').map(([id])=>id));
  assertCurrentHoldGoSuccessor(beforeGo, {...GO_RUNTIME_MANIFEST, programs:Object.values(GO_RUNTIME_MANIFEST.programs)}, held);

  // Current editorial projections must not import the distinct AgelessRx firm's
  // dated facts. Historical raw evidence and all commercial gates stay intact.
  const rawLedger = (await load('program-content-ledger.json')).programs.find((r) => r.program_id === 'try-ageless');
  assert.equal(rawLedger.display_name, 'AgelessRx'); // Hash-pinned price-index history.
  assert.equal(rawLedger.research_backfill_20260830.facts.shipping.source_url, 'https://agelessrx.com/');
  const ledger = projectProviderDisplayLedger(rawLedger);
  assert.equal(ledger.display_name, 'Try Ageless');
  assert.equal(ledger.research_backfill_20260830, undefined);
  const crossBusiness = structuredClone(rawLedger);
  crossBusiness.research_shipping_wait.source_url = 'https://agelessrx.com/faq/';
  assert.throws(() => projectProviderDisplayLedger(crossBusiness), /try_ageless_cross_business_fact/);
  for (const [key, fact] of Object.entries(ledger)) {
    if (!key.startsWith('research_') || !fact?.source_url) continue;
    assert.match(fact.source_url, /^https:\/\/tryageless\.com\//, key);
  }
  assert.match(ledger.research_first_month_price.value, /UNKNOWN|yearly|annual/i);
  assert.match(ledger.research_cancellation.value, /\$40|prepaid/i);
  const historical = (await load('provider-facts-backfill-20260830.json')).programs.find((r) => r.program_id === 'try-ageless');
  assert.equal(historical.display_name, 'AgelessRx');
  assert.equal(historical.facts.shipping.source_url, 'https://agelessrx.com/');
  const projected = projectProviderDisplayFacts(historical);
  assert.equal(projected.display_name, 'Try Ageless');
  for (const fact of Object.values(projected.facts)) {
    assert.match(fact.source_url, /^https:\/\/tryageless\.com\//);
    assert.doesNotMatch(JSON.stringify(fact), /agelessrx\.com|AgelessRx/i);
  }
  for (const [name, expected] of [
    ['program-page-eligibility.json', '751f063a70d26ab8f2b420f9d4f433fb7786cbfc59db82e7a3d21c1d03fc9d8b'],
    ['provider-facts-backfill-20260830.json', 'e08a533653dd20f8400ad35d4562ec21478704a4d6c5758d61e85f83c1b97f3f'],
    ['price-index-frozen-content-ledger.json', '374667b3f4a13bb7dd5776f1cd29add113b25fa1826c6af4620c07668b496830'],
  ]) assert.equal(sha(await readFile(new URL(`../data/${name}`, import.meta.url))), expected, name);

  const quiz = (await load('quiz-config.json')).candidates.find((r) => r.program_id === 'try-ageless');
  assert.equal(quiz.display_name, 'Try Ageless');
  assert.match(quiz.research_fact_ref, /^program-content-ledger\.json#/);
  const seo = (await load('page-seo-copy.json')).routes['/reviews/try-ageless/'];
  assert.match(seo.title, /^Try Ageless/);
  assert.doesNotMatch(JSON.stringify(seo), /AgelessRx/);
  const logo = (await load('provider-logo-sources.json')).programs.find((r) => r.program_id === 'try-ageless');
  assert.equal(logo.provider, 'Try Ageless');
  assert.equal((await load('provider-pricing-matrix.json')).providers['try-ageless'].provider, 'Try Ageless');
  for (const medication of ['semaglutide', 'tirzepatide']) {
    const packet = await load(`compounded-category-evidence/${medication}/PACKET.json`);
    assert.equal(packet.providers.find((r) => r.program_id === 'try-ageless').display_name, 'Try Ageless');
  }
  for (const file of ['../data/money-page-specs.json', '../src/money-page-specs.json']) {
    const specs = JSON.parse(await readFile(new URL(file, import.meta.url)));
    for (const page of specs.pages.filter((p) => p.rows.some((r) => r.program_id === 'try-ageless'))) {
      assert.doesNotMatch(JSON.stringify(page).replaceAll('agelessrx', ''), /AgelessRx/);
      const consumer = page.rows.find((r) => r.program_id === 'try-ageless');
      assert.equal(consumer.display_name, 'Try Ageless');
      assert.ok(page.sources.some((s) => s.source_id === consumer.citation_source_id && s.url.startsWith('https://tryageless.com/')));
      assert.equal(consumer.review_path, '/reviews/try-ageless/');
    }
  }
  const article = (await load('blog/content-batch.json')).articles.find((a) => a.canonical_path === '/guides/healthrx-vs-agelessrx/');
  assert.match(article.title, /Try Ageless/);
  assert.match(article.direct_answer, /\$1,908 prepaid yearly tirzepatide sublingual oral-drops/);
  assert.equal(article.status, 'HELD_SOURCE_REVIEW_IDENTITY_CORRECTION');
  assert.ok(article.sources.some((s) => s.url === 'https://tryageless.com/terms/'));
  assert.deepEqual(reviewBrief(article, { status: 'verified_organization', clinical_credentials_claimed: false }),
    { status: 'HELD', reason: 'evidence_review_receipt_missing' });
  const blogOwner = (await load('blog/keyword-ownership-map.json')).entries.find((e) => e.url === article.canonical_path);
  assert.equal(blogOwner.primary_keyword, 'HealthRX vs Try Ageless cost and terms');
  assert.equal(blogOwner.status, article.status);
});

test('GLP-234 held article uses current product-specific billing and preserves its review boundary', async () => {
  const article = (await load('blog/content-batch.json')).articles.find((a) => a.canonical_path === '/guides/healthrx-vs-agelessrx/');
  const prose = JSON.stringify([article.claims, article.direct_answer, article.sections, article.pros, article.cons, article.conclusion]);
  assert.doesNotMatch(prose, /\$133|\$99|one click|HealthRX.{0,80}(?:12-month|12 months|lower price)/);
  assert.match(article.direct_answer, /semaglutide at \$149 for the first month, then \$165\/month/);
  assert.match(article.direct_answer, /tirzepatide at \$193 for the first month, then \$214\/month/);
  assert.match(article.direct_answer, /\$199 every month/);
  assert.match(article.direct_answer, /selected first debit remains unknown/);
  assert.match(prose, /cancel by emailing support@healthrx\.com/);
  assert.match(prose, /\$40 non-TRT consultation fee/);
  assert.match(prose, /non-returned payment processing costs/);
  assert.match(prose, /prepaid-plan repricing/);
  assert.match(prose, /not a one-month charge/);
  assert.doesNotMatch(prose, /HealthRX publishes more detail/);
  assert.equal(article.source_checked_through, '2026-09-26');
  const paragraphWords = article.sections.flatMap((s) => s.paragraphs).join(' ').match(/\b[\w'-]+\b/g).length;
  assert.equal(article.word_count, paragraphWords); // Do not preserve the legacy inflated count.
  for (const id of ['healthrx', 'try-ageless', 'try-ageless-terms', 'fda-compounding-risks']) {
    assert.equal(article.sources.find((s) => s.source_id === id)?.verified_as_of, '2026-09-26');
  }
  const rate = article.claims.find((c) => c.claim_id === 'ageless-rate');
  assert.ok(rate.source_ids.includes('try-ageless-terms'));
  assert.deepEqual(article.evidence_review, {
    content_sha256: '639c0d8ae24b6fe25d42718881dcc75346a4f2e842f1cfa6cd4159b6c15b51af',
    reviewed_at: '2026-07-23T09:00:00Z', status: 'STALE_AFTER_IDENTITY_CORRECTION_REVIEW_REQUIRED',
  });
  assert.equal(article.article_id, 'phase2-batch2-low-healthrx-vs-agelessrx-20260723');
  assert.equal(article.brief_id, article.article_id);
  assert.equal(article.comparison_spec.page_slug, 'healthrx-vs-agelessrx');
  assert.equal(article.comparison_spec.live_link_allowed, false);
  assert.equal(article.comparison_spec.operator_gate_receipt, null);
  assert.equal(article.operator_release_receipt, null);
  assert.equal(article.batch_gate_passed, false);
  assert.deepEqual(reviewBrief(article, article.author), { status: 'HELD', reason: 'evidence_review_receipt_missing' });
});

test('GLP-234 actual paragraph length and cancellation explanation retain first-party provenance', async () => {
  const article = (await load('blog/content-batch.json')).articles.find((a) => a.article_id === 'phase2-batch2-low-healthrx-vs-agelessrx-20260723');
  const paragraphs = article.sections.flatMap((s) => s.paragraphs);
  const actualWords = paragraphs.join(' ').match(/\b[\w'-]+\b/g).length;
  assert.ok(actualWords >= 1500 && actualWords <= 3600, `Actual paragraph words: ${actualWords}`);
  assert.equal(article.word_count, actualWords);
  const explanation = "Early cancellation also raises a different price question from the next renewal: what rate applies to benefits already received? Try Ageless's terms point to the shorter-duration pricing available when the plan was purchased, not a newly advertised rate. Keep that original pricing with the terms; the yearly monthly equivalent alone cannot establish the amount retained after cancellation.";
  assert.ok(article.sections.find((s) => s.heading === 'Read commitment and cancellation together').paragraphs.includes(explanation));
  const terms = article.sources.find((s) => s.source_id === 'try-ageless-terms');
  assert.equal(terms.url, 'https://tryageless.com/terms/');
  assert.ok(terms.claim_ids.includes('ageless-rate'));
  assert.ok(article.claims.find((c) => c.claim_id === 'ageless-rate').source_ids.includes(terms.source_id));
  // Existing brief has no seo-phase1-v1 contract: do not silently apply or
  // claim its stricter 50–60 / 150–160 / 40–60 title/meta/answer limits pass.
  assert.equal(article.editorial_contract_version, undefined);
  assert.equal(article.title.length, 81);
  assert.equal(article.description.length, 137);
  assert.equal(article.direct_answer.trim().split(/\s+/).length, 73);
  assert.deepEqual(reviewBrief(article, article.author), { status: 'HELD', reason: 'evidence_review_receipt_missing' });
});

test('GLP-234 annual-plan billing prose in both maintained money-spec copies', async (t) => {
  for (const file of ['../data/money-page-specs.json', '../src/money-page-specs.json']) {
    await t.test(file, async () => {
      const specs = JSON.parse(await readFile(new URL(file, import.meta.url)));
      const page = specs.pages.find((row) => row.path === '/compare/found-vs-yourera/');
      assert.ok(page, file);
      const prose = page.intro.join(' ');
      assert.match(prose, /compounded semaglutide plus B12 injection at \$2,388 prepaid yearly \(\$199 per month equivalent\)/);
      assert.match(prose, /compounded tirzepatide plus B12 injection at \$2,988 prepaid yearly \(\$249 per month equivalent\)/);
      assert.match(prose, /tirzepatide sublingual oral drops at \$1,908 prepaid yearly \(\$159 per month equivalent\)/);
      assert.match(prose, /annual-plan monthly equivalents, not month-to-month billing; the selected initial debit remains unknown/);
      assert.doesNotMatch(prose, /\$199 per month for compounded semaglutide|\$249 per month for compounded tirzepatide/);
    });
  }
});
