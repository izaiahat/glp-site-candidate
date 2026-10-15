import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phase3Registry } from '../../src/phase3-page-graph.mjs';
import { deriveIdentityGroups } from '../../src/provider-identity.mjs';
import { currentComparisonPrograms } from './current-comparison-cohort.mjs';

export const readData = name => JSON.parse(readFileSync(new URL('../../data/' + name, import.meta.url), 'utf8'));

// Use the renderer's actual graph owner: it retains legacy rendered aliases and
// unbound work-order details, but excludes identity-only (review/sitemap off) rows.
export function detailPrograms(registry, graph = readData('phase3-page-graph.json')) {
  const rows = phase3Registry(graph, registry).programs;
  assert.ok(rows.length > 0, 'empty canonical renderer graph');
  assert.equal(new Set(rows.map(p => p.program_id)).size, rows.length);
  return rows;
}

export function categoryPrograms(registry, medication) {
  const { aliasIds } = deriveIdentityGroups(registry, 'glp-clinic-scout', readData('program-content-ledger.json').programs);
  return registry.programs.filter(p => {
    const profile = p.profiles?.['glp-clinic-scout'];
    const taxonomy = registry.therapeutic_taxonomy.programs[p.review_slug || p.program_id];
    return !aliasIds.has(p.program_id) && p.commercial_state === 'live' && profile?.vertical_fit === true
      && profile.wired === true && profile.surfaces?.review === true
      && !/fella/i.test(`${p.program_id} ${p.review_slug || ''} ${p.display_name}`)
      && taxonomy?.commercial_link_state?.compare === 'live'
      && taxonomy.molecule_tags?.includes(medication) && taxonomy.treatment_type_tags?.includes('compounded');
  });
}

// Provider-card ownership is facts + ledger, not registry minus six literals.
// Keep the source-reported-value predicate independent of rendered counts.
//
// Ruling reports/ops/glp38-20260915/FABLE-RULING-20260917-candidate-test-debt.md (T13, WO-11),
// amended by the Fable ruling of 2026-09-17: STALE_FIXTURE. The facts+ledger population is the
// EVIDENCE population, not the card population - it admitted two ids that no producer may ever
// emit a card for, and the hard-coded expectation therefore demanded fabricated cards:
//   * `telos-rx` - registry record commercial_state 'held', profile wired false, surfaces.compare
//     false, and no therapeutic_taxonomy entry. Held providers stay held, so a card for it must
//     NOT render.
//   * `shed` - the Shed identity is keyed as `shedrx`
//     (site-system/flagship-v2/candidates/*/SHED-IDENTITY-RECONCILIATION-20260806.md); the `shed`
//     spelling resolves to the DECLARED ALIAS record katalys-1516, whose surfaces.compare is false
//     precisely so the alias never produces a second card for one merchant.
// So the oracle is DERIVED, never a literal list and never a subset check: the ids the evidence
// population admits, INTERSECTED with registry records that are card-eligible. The assertion stays
// deepEqual (strict) on that derived set, so an eligible provider that is missing from the render
// still fails - the intersection filters the EXPECTED side only and can never hide a missing card.
// Identity resolution uses program_id OR review_slug because that is the identity key the renderer
// itself puts in data-program (awin-128761 renders as `coivas`, katalys-1304 as `direct-meds`).
export function cardEligibleIdentity(registry) {
  const byIdentity = new Map();
  for (const program of currentComparisonPrograms(registry)) {
    byIdentity.set(program.program_id, program);
    if (program.review_slug) byIdentity.set(program.review_slug, program);
  }
  const taxonomy = registry.therapeutic_taxonomy.programs;
  return id => {
    const record = byIdentity.get(id);
    if (!record) return false;                                   // no registry identity, no card
    if (record.commercial_state !== 'live') return false;         // held (or any non-live) stays off
    const profile = record.profiles?.['glp-clinic-scout'];
    if (profile?.wired !== true) return false;                    // not wired for this surface
    if (profile?.surfaces?.compare !== true) return false;        // comparison surface off (aliases)
    return Boolean(taxonomy[record.review_slug || record.program_id]);
  };
}

export function optionCProgramIds(registry = readData('program-registry.json')) {
  const ledger = new Map(readData('program-content-ledger.json').programs.map(p => [p.program_id, p]));
  const facts = readData('provider-facts-backfill-20260830.json');
  const reported = f => f?.status === 'SOURCE_REPORTED' && Boolean(String(f.value || '').trim()) && Boolean(f.source_url) && Boolean(f.capture_date);
  const evidenceIds = facts.programs.filter(p => p.display_name && ledger.get(p.program_id)?.meds_offered
    && ledger.get(p.program_id)?.source_url && reported(p.facts?.total_monthly_cost) && reported(p.facts?.cancellation)).map(p => p.program_id);
  assert.ok(evidenceIds.length > 0, 'empty Option C evidence population');
  assert.equal(new Set(evidenceIds).size, evidenceIds.length);
  const ids = evidenceIds.filter(cardEligibleIdentity(registry));
  assert.ok(ids.length > 0, 'empty Option C card-eligible population');
  assert.equal(new Set(ids).size, ids.length);
  return ids;
}

// Review intake owns valid declared review paths; display names are its exact
// entity key and duplicates (including legacy aliases) yield one option.
export const reviewRows = programs => programs.filter(p => /^\/reviews\/[a-z0-9-]+\/$/.test(p.review_path || ''));
export const reviewOptionNames = programs => [...new Set(reviewRows(programs).map(p => p.display_name))];
