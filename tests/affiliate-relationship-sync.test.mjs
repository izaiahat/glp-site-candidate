import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveAffiliateRegistry, historicalAffiliateRegistry, relationshipDenials, publicAffiliateTerms, renderAffiliateTerms } from '../src/affiliate-relationship-sync.mjs';

test('ended relationship disables commercial surfaces while retaining editorial review and sitemap', () => {
  const base={programs:[{program_id:'katalys-1622',commercial_state:'live',go:{entry_state:'server_redirect'},profiles:{site:{wired:true,surfaces:{review:true,sitemap:true,go:true,compare:true,quiz:true,calculator:true}}},affiliate_relationship_snapshot:{promotion_denied:true,lifecycle:'ended',ended_effective_at:'2026-09-30',editorial_retained:true}}]};
  const p=effectiveAffiliateRegistry(base).programs[0];
  assert.equal(p.commercial_state,'held');assert.equal(p.profiles.site.wired,false);
  assert.equal(p.profiles.site.surfaces.review,true);assert.equal(p.profiles.site.surfaces.sitemap,true);
  for (const surface of ['go','compare','quiz','calculator']) assert.equal(p.profiles.site.surfaces[surface],false);
  assert.equal(base.programs[0].commercial_state,'live');
  // Evaluate the actual CLI's pure removal allocation without executing its
  // imports or writes. Ended must join withdrawn; paused/unknown stay distinct.
  const source = readFileSync(new URL('../scripts/regenerate-go-runtime-manifest.mjs', import.meta.url), 'utf8');
  const declarations = source.match(/^  const withdrawn = .*;$/gm);
  assert.equal(declarations?.length, 1);
  const select = new Function('registry', `${declarations[0]} return withdrawn;`);
  const cohort = {programs:['ended','withdrawn','paused','reported','unknown'].map(lifecycle => ({program_id:lifecycle, affiliate_relationship_snapshot:{lifecycle}}))};
  assert.deepEqual([...select(cohort)], ['ended','withdrawn']);
  assert.deepEqual([...select(effectiveAffiliateRegistry(base))], ['katalys-1622']);
});

test('withdrawal removes all live surfaces without repricing frozen history', () => {
  const base={programs:[{program_id:'alpha',commercial_state:'live',go:{entry_state:'server_redirect'},price:199,profiles:{site:{wired:true,surfaces:{review:true,sitemap:true,go:true,compare:true,quiz:true,calculator:true}}}}]};
  const observed=structuredClone(base);
  observed.programs[0].affiliate_relationship_snapshot={promotion_denied:true,lifecycle:'withdrawn'};
  assert.deepEqual(historicalAffiliateRegistry(observed),base);
  const effective=effectiveAffiliateRegistry(observed);
  assert.equal(effective.programs[0].commercial_state,'held');
  assert.equal(effective.programs[0].price,199);
  assert.ok(Object.values(effective.programs[0].profiles.site.surfaces).every(x=>x===false));
  assert.equal(observed.programs[0].commercial_state,'live');
});

test('F03 cancellation and pause deny only the exact selected relationship; unknown terms remain unknown', () => {
  const registry={programs:[{program_id:'alpha',display_name:'Alpha',affiliate_relationship_snapshot:{network:'awin',network_program_id:'1',relationship_status:'cancelled_by_network',promotion_denied:true,lifecycle:'withdrawn'}},{program_id:'beta',display_name:'Beta',affiliate_relationship_snapshot:{network:'awin',network_program_id:'2',promotion_denied:false,terms:{commission_terms:'Default: 0%; GLP-1: 155 USD',source_checked_at:'2026-10-03',capture_sha256:'a'.repeat(64),writer_receipt_sha256:'b'.repeat(64),source_kind:'authenticated_network_api_via_sole_sheet_writer'}}}]};
  assert.deepEqual(relationshipDenials(registry).map(x=>x.program_id),['alpha']);
  const terms=publicAffiliateTerms(registry);
  assert.equal(terms.length,1);assert.equal(terms[0].commission_terms,'Default: 0%; GLP-1: 155 USD');
  assert.equal(terms[0].cookie_window,null);
  const html=renderAffiliateTerms(registry);
  assert.match(html,/Reported affiliate terms/);assert.match(html,/155 USD/);assert.doesNotMatch(html,/\/home\/ubuntu/);
  registry.programs[1].display_name='<script>alert(1)</script>';
  assert.doesNotMatch(renderAffiliateTerms(registry),/<script>/);
});
