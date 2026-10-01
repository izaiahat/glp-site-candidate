import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {taxonomyDigestBasis, normalizedTaxonomySha256, deriveFacetCounts, validateTherapeuticTaxonomy, projectTherapeuticSurfaces} from '../src/therapeutic-taxonomy.mjs';
import {deriveDynamicFacetCounts, normalizedProfileSha256, stableProfileSha256, REQUIRED_PROFILE_EVIDENCE_FIELDS} from '../src/provider-dynamic-profiles.mjs';
import {renderComparisonTable, renderProviderCards, renderBestForBox} from '../src/money-page.mjs';
import {buildPhase4PageData} from '../src/quiz.mjs';
import {renderMatchesCustomized} from '../src/matches-customized.mjs';
import {JSDOM} from 'jsdom';

const json = relative => JSON.parse(readFileSync(new URL(relative, import.meta.url)));
const fixture = json('./fixtures/eden-qualified-closure.json');
const pid = fixture.row.program_id;
const note = fixture.row.claim_qualification;
const date = fixture.row.verified_as_of;
const asOf = new Date(`${date}T12:00:00Z`);
const profileId = 'glp-clinic-scout';
const fields = ['molecule_tags', 'brand_name_tags', 'delivery_form_tags', 'treatment_type_tags'];

function setup() {
  // Synthetic profile/prices: no renewal of operational data.
  const row = structuredClone(fixture.row);
  row.commercial_link_state = {compare:'editorial_link_dark',quiz:'editorial_link_dark'};
  const taxonomy = Object.fromEntries(fields.map(f => [f, row[f]]));
  taxonomy.treatment_type_state = row.treatment_type_state;
  const calculator = {mode:'manual', first_month_base_usd:null, recurring_month_base_usd:null,
    one_time_fee_usd:null, price_context:'Synthetic manual price fixture; no price adoption.',
    source_url:row.source_urls[0], checked_as_of:date,
    evidence_gap_copy:'Synthetic offline fixture: comparable checkout and renewal prices are not verified.'};
  calculator.evidence_sha256 = stableProfileSha256(calculator);
  const text = 'Synthetic profile terms only: semaglutide tirzepatide mounjaro wegovy zepbound injectable compounded. Manual prices are not verified.';
  const dynamic = {program_id:pid, registry_program_ids:[pid], provider:'Eden', aliases:[], version:1,
    verified_as_of:date, source_urls:fixture.previous_row.source_urls, taxonomy, calculator,
    evidence_bindings:[{fields:REQUIRED_PROFILE_EVIDENCE_FIELDS, source_url:row.source_urls[0],
      verified_as_of:date, evidence_text:text, evidence_sha256:createHash('sha256').update(text).digest('hex')}]};
  dynamic.source_urls = [...new Set([...dynamic.source_urls, calculator.source_url])].sort();
  dynamic.normalized_sha256 = normalizedProfileSha256(dynamic);
  const registry = {programs:[{program_id:pid,display_name:'Eden',commercial_state:'live',
    profiles:{[profileId]:{vertical_fit:true,wired:true,surfaces:{review:true,compare:true,quiz:true,calculator:true}}}}],
    therapeutic_taxonomy:{schema:'glp-therapeutic-taxonomy-v1',sealed_as_of:date,freshness_max_days:31,
      required_surface_paths:json('../data/program-registry.json').therapeutic_taxonomy.required_surface_paths,
      authorities:fixture.authorities,
      programs:{[pid]:row},expected_counts:deriveFacetCounts({[pid]:row})},
    provider_dynamic_profiles:{schema:'glp-provider-dynamic-profiles-v1',version:1,sealed_as_of:date,
      freshness_max_days:31,required_surfaces:['compare','quiz','calculator','counts','suggestions'],
      profiles:{[pid]:dynamic},expected_counts:deriveDynamicFacetCounts({[pid]:dynamic})},
    consumer_therapeutic_authorities:fixture.consumer_authorities};
  row.normalized_sha256 = normalizedTaxonomySha256(row);
  const moneyRow = {program_id:pid,provider:'Eden',meds_offered:'Mounjaro, Wegovy and Zepbound (conditional advertisements)',
    insurance:'Not verified',average_wait:'Unknown',starting_price:'Not verified',starting_price_sort:0,
    live_link_allowed:false,promotion_authorized:false,source_url:row.source_urls[0],
    citation_source_id:'source-1',review_path:'/reviews/eden/'};
  const pages = registry.therapeutic_taxonomy.required_surface_paths.map(path => ({path,rows:[structuredClone(moneyRow)],
    sources:[{source_id:'source-1',url:row.source_urls[0]}]}));
  const config = json('../data/quiz-config.json');
  config.candidates = [{...structuredClone(config.candidates[0]),program_id:pid,provider:'Eden',
    review_path:'/reviews/eden/',live_link_allowed:false,promotion_authorized:false,
    source_clearance:true,staging_eligible:true,glp_service_verified:true}];
  return {registry,pages,quizConfig:config};
}
const project = input => projectTherapeuticSurfaces({...input,profileId,asOf});

test('qualification is optional but precise, authenticated; old digests unchanged', () => {
  assert.equal(taxonomyDigestBasis(fixture.row).claim_qualification, note);
  assert.equal(normalizedTaxonomySha256(fixture.previous_row), fixture.previous_row.normalized_sha256);
  for (const value of ['', ' ', {}, ['note'], '<script>alert(1)</script>']) {
    const {registry} = setup();
    const row = registry.therapeutic_taxonomy.programs[pid];
    row.claim_qualification = value;
    row.normalized_sha256 = normalizedTaxonomySha256(row);
    assert.throws(() => validateTherapeuticTaxonomy(registry,profileId,{asOf}), /claim_qualification_invalid/);
  }
  const {registry} = setup();
  registry.therapeutic_taxonomy.programs[pid].claim_qualification += ' altered';
  assert.throws(() => validateTherapeuticTaxonomy(registry,profileId,{asOf}), /normalized_hash_mismatch/);
});

test('native active projection preserves four sources, all seven tags and held links', () => {
  const input = setup();
  const before = structuredClone(input.registry);
  const output = project(input);
  assert.deepEqual(input.registry,before);
  for (const row of [...output.pages.flatMap(p=>p.rows),...output.quizConfig.candidates]) {
    assert.equal(row.therapeutic_taxonomy.claim_qualification,note);
    assert.deepEqual(row.therapeutic_taxonomy.source_urls,fixture.row.source_urls);
    for (const f of fields) assert.deepEqual(row.therapeutic_taxonomy[f],fixture.row[f]);
    assert.equal(row.live_link_allowed,false);
    assert.equal(row.promotion_authorized,false);
  }
  const drift = setup();
  const p = drift.registry.provider_dynamic_profiles.profiles[pid];
  p.taxonomy.brand_name_tags = ['mounjaro'];
  p.normalized_sha256 = normalizedProfileSha256(p);
  drift.registry.provider_dynamic_profiles.expected_counts = deriveDynamicFacetCounts({[pid]:p});
  assert.throws(() => project(drift), /provider_dynamic_profile_taxonomy_conflict/);
});

test('shared blog/compare table variants display adjacent escaped note only on affected row', () => {
  for (const page of project(setup()).pages) for (const template_revision of [undefined,'money-page-p1-v2-wave0']) {
    const controls = Array.from({length:3}, (_,i) => ({...page.rows[0],program_id:`synthetic-control-${i}`,
      provider:`Control ${i}`,render_provider:`Control ${i}`,meds_offered:'Unrelated fixture',therapeutic_taxonomy:undefined}));
    const html = renderComparisonTable({...page,template_revision,rows:[page.rows[0],...controls]});
    const cell = [...html.matchAll(/<td data-label="Medications offered">(.*?)<\/td>/sg)].map(m=>m[1]).find(t=>t.includes('Zepbound'));
    assert.ok(cell.includes(note));
    assert.match(cell, /Reported options \(conditional advertisement\)/);
    assert.equal(html.split(note).length-1,1);
    const escaped = renderComparisonTable({...page,rows:[{...page.rows[0],therapeutic_taxonomy:{...page.rows[0].therapeutic_taxonomy,claim_qualification:'Text & "quote" <not-markup>'}},...controls]});
    assert.ok(escaped.includes('Text &amp; &quot;quote&quot; &lt;not-markup&gt;'));
    assert.ok(!escaped.includes('<not-markup>'));
  }
});

test('actual Phase4 dataset carries qualification and four-source membership', () => {
  const dataset = buildPhase4PageData(project(setup()).quizConfig);
  const record = dataset.candidate_records[pid];
  assert.equal(record.claim_qualification,note);
  assert.deepEqual(record.claim_source_urls,fixture.row.source_urls);
  assert.equal(record.has_live_link,false);
  const runtime = readFileSync(new URL('../assets/quiz-page.js',import.meta.url),'utf8');
  assert.match(runtime, /appendText\(card, "p", "qz-card-qualification", record\.claim_qualification\)/);
});

test('current customized-matches runtime displays safe adjacent note, never sends', () => {
  const html = renderMatchesCustomized(project(setup()).quizConfig);
  const dom = new JSDOM(html,{runScripts:'outside-only',url:'https://glpclinicscout.com/matches/customized/?state=CA&drug=SEMAGLUTIDE&form=COMPOUNDED&goal=medication-form'});
  const payload = dom.window.document.querySelector('#phase4-matches-data');
  const data = JSON.parse(payload.textContent);
  // Synthetic UI arrangement only, not live ranking/eligibility acceptance.
  data.result_sets['SEMAGLUTIDE|CA|medication-form'] = [pid];
  payload.textContent = JSON.stringify(data);
  dom.window.fetch = () => {throw new Error('network forbidden');};
  dom.window.eval(readFileSync(new URL('../assets/matches-customized.js',import.meta.url),'utf8'));
  const card = dom.window.document.querySelector(`.qz-card[data-program="${pid}"]`);
  assert.ok(card);
  const visible = card.querySelector('.qz-card-qualification');
  assert.equal(visible.textContent,note);
  assert.equal(visible.previousElementSibling.className,'qz-card-identity');
  assert.equal(visible.closest('[hidden],details'),null);
  assert.equal(card.querySelector('a[rel*="sponsored"]'),null);
  dom.window.close();
});

test('affected branded prose is qualified in provider detail cards and best-for projections only', () => {
  const base = json('../data/money-page-specs.json').pages.find(p => p.rows.some(r => r.program_id === pid));
  const row = {...base.rows.find(r => r.program_id === pid),
    therapeutic_taxonomy:project(setup()).pages[0].rows[0].therapeutic_taxonomy,
    live_link_allowed:false,promotion_authorized:false,affiliate_href:null,
    pros:['Synthetic fixture: Zepbound advertisement','Synthetic fixture: Wegovy advertisement'],
    cons:['Synthetic fixture: Mounjaro naming conflict','Synthetic fixture: Zepbound supply not verified'],
    best_for:'Synthetic fixture comparing Zepbound',bottom_line:'Synthetic fixture comparing Wegovy'};
  const control = {...base.rows.find(r => r.program_id !== pid),live_link_allowed:false,promotion_authorized:false,affiliate_href:null};
  const spec = {...base,rows:[row,control],best_for:[row,control].map(r => ({program_id:r.program_id,provider:r.provider,intent_label:'Synthetic fixture',one_line:'Synthetic fixture'}))};
  const html = renderProviderCards(spec);
  const dom = new JSDOM(html);
  for (const li of dom.window.document.querySelectorAll(`.provider-card[data-program="${pid}"] .pros-cons li`)) {
    assert.ok(li.textContent.includes(note));
    assert.equal(li.querySelector('.therapeutic-summary__qualification').textContent,note);
  }
  const best = renderBestForBox(spec);
  assert.ok(best.includes(note));
  assert.equal(dom.window.document.querySelectorAll('a[rel*="sponsored"]').length,0);
  dom.window.close();
});

test('native freshness gate remains closed; capture is not full-site readiness', () => {
  const {registry} = setup();
  const row = registry.therapeutic_taxonomy.programs[pid];
  row.verified_as_of = fixture.previous_row.verified_as_of;
  row.normalized_sha256 = normalizedTaxonomySha256(row);
  assert.throws(() => validateTherapeuticTaxonomy(registry,profileId,{asOf}),/evidence_stale/);
});
