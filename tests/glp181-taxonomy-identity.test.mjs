import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commercialLinkState, deriveFacetCounts, normalizedTaxonomySha256,
  sameCanonicalRegistryIdentity, validateTherapeuticTaxonomy,
} from '../src/therapeutic-taxonomy.mjs';
import {
  deriveGoEntriesFromRegistry, deriveProfileSurfaceSets,
  projectMoneyPagesFromRegistry, projectQuizFromRegistry,
} from '../src/program-registry.mjs';

const profile = 'glp-clinic-scout';
const asOf = new Date('2026-09-26T12:00:00Z');
const source = 'https://example.org/fixture';
const digest = 'a'.repeat(64);
const surfaces = (enabled) => Object.fromEntries(
  ['review', 'compare', 'quiz', 'calculator', 'go', 'sitemap'].map((name) => [name, enabled]),
);
const identity = (role, canonicalProgramId) => ({
  role, canonical_program_id: canonicalProgramId, identity_key: 'directmeds',
  reason: 'Fixture identity declaration for the same merchant across network and review records.',
});

function program(id, name, { renderId = id, state = 'live', enabled = true, fit = true, declaration } = {}) {
  return {
    program_id: id, ...(renderId !== id ? { review_slug: renderId } : {}),
    display_name: name, commercial_state: state,
    ...(enabled || !declaration ? { review_path: `/reviews/${renderId}/` } : {}),
    go: { route: `/go/${renderId}`, entry_state: 'held' },
    profiles: { [profile]: {
      vertical_fit: fit, wired: enabled, surfaces: surfaces(enabled),
      data_profile: { has_price: false, has_review_facts: false },
      ...(declaration ? { canonical_identity: declaration } : {}),
    } },
  };
}

function taxonomyRow(id, registryId, provider) {
  const row = {
    program_id: id, registry_program_id: registryId, provider,
    classification_state: 'FIXTURE_EVIDENCE', verified_as_of: '2026-09-26',
    source_urls: [source], molecule_tags: [], brand_name_tags: [],
    delivery_form_tags: [], treatment_type_tags: [], treatment_type_state: 'not_verified',
    commercial_link_state: { compare: 'editorial_link_dark', quiz: 'editorial_link_dark' },
    evidence_bindings: [{ authority: 'one', authority_sha256: digest,
      source_url: source, verified_as_of: '2026-09-26', evidence_sha256: digest }],
  };
  row.normalized_sha256 = normalizedTaxonomySha256(row);
  return row;
}

function fixture() {
  const programs = [
    program('katalys-1304', 'Direct Meds', { renderId: 'direct-meds', declaration: identity('canonical', 'katalys-1304') }),
    program('direct-meds-review', ' DIRECT  MEDS ', { enabled: false, declaration: identity('alias', 'direct-meds') }),
    program('trt-nation', 'TRT Nation'),
    program('fella', 'Fella Health', { state: 'held', enabled: false, fit: false }),
    program('telos-rx', 'Telos Rx', { state: 'held', enabled: false }),
    program('telos-rx-review', 'Telos Rx', { state: 'held', enabled: false, declaration: identity('alias', 'telos-rx') }),
    program('network-paused', 'Paused Network Offer', { state: 'held', enabled: false }),
  ];
  const rows = Object.fromEntries([
    ['direct-meds', 'katalys-1304', 'Direct Meds'],
    ['direct-meds-review', 'direct-meds-review', ' DIRECT  MEDS '],
    ['trt-nation', 'trt-nation', 'TRT Nation'],
  ].map(([id, registryId, provider]) => [id, taxonomyRow(id, registryId, provider)]));
  return {
    schema: 'site-program-registry-v1',
    site_profiles: { [profile]: { auto_generate: false, auto_publish: false } },
    programs,
    therapeutic_taxonomy: {
      schema: 'glp-therapeutic-taxonomy-v1', sealed_as_of: '2026-09-26',
      freshness_max_days: 30, required_surface_paths: ['/best/fixture/'],
      authorities: Object.fromEntries(['one', 'two', 'three'].map((key) => [key, { path: `reports/${key}`, sha256: digest }])),
      programs: rows, expected_counts: deriveFacetCounts(rows),
    },
  };
}
const validate = (registry) => validateTherapeuticTaxonomy(registry, profile, { asOf });

test('GLP-181 full taxonomy gate accepts only the declared canonical/review name collision', () => {
  const registry = fixture();
  const validated = validate(registry);
  assert.deepEqual([...validated.programs.keys()], ['direct-meds', 'direct-meds-review', 'trt-nation']);
  const byRenderId = new Map(registry.programs.map((p) => [p.review_slug || p.program_id, p]));
  assert.equal(sameCanonicalRegistryIdentity(byRenderId, profile, 'direct-meds', 'direct-meds-review'), true);
  assert.equal(sameCanonicalRegistryIdentity(byRenderId, profile, 'direct-meds-review', 'direct-meds'), true);
  assert.equal(sameCanonicalRegistryIdentity(byRenderId, profile, 'direct-meds', 'trt-nation'), false);
});

test('GLP-181 unrelated normalized collision and adversarial alias targets fail at the full gate', () => {
  for (const name of ['DIRECT MEDS', ' Direct - Meds  ']) {
    const bad = fixture();
    bad.therapeutic_taxonomy.programs['trt-nation'].provider = name;
    bad.therapeutic_taxonomy.programs['trt-nation'].normalized_sha256 = normalizedTaxonomySha256(bad.therapeutic_taxonomy.programs['trt-nation']);
    assert.throws(() => validate(bad), /therapeutic_taxonomy_render_identity_duplicate:trt-nation:direct-meds-review/);
  }
  for (const target of ['trt-nation', 'Direct-Meds', 'telos-rx-review']) {
    const bad = fixture();
    bad.programs[1].profiles[profile].canonical_identity.canonical_program_id = target;
    assert.throws(() => validate(bad), /therapeutic_taxonomy_render_identity_duplicate:direct-meds-review:direct-meds/, target);
  }
  const chain = fixture();
  chain.programs[0].profiles[profile].canonical_identity = identity('alias', 'trt-nation');
  assert.throws(() => validate(chain), /therapeutic_taxonomy_render_identity_duplicate:direct-meds-review:direct-meds/);
});

test('GLP-181 held, excluded and paused rows remain off render and conversion surfaces despite aliases', () => {
  const registry = fixture();
  const validated = validate(registry);
  // The registry's surface gate binds aliases to program_id, while the taxonomy
  // gate above binds them to the render slug; model the held surface source.
  registry.programs[1].commercial_state = 'held';
  registry.programs[1].profiles[profile].canonical_identity.canonical_program_id = 'katalys-1304';
  registry.programs[4].profiles[profile].canonical_identity = identity('canonical', 'telos-rx');
  registry.programs[4].review_path = '/reviews/telos-rx/';
  const held = ['fella', 'telos-rx', 'telos-rx-review', 'network-paused'];
  const sourceRows = registry.programs.map((p) => ({
    program_id: p.review_slug || p.program_id, provider: p.display_name,
    live_link_allowed: false, promotion_authorized: false, affiliate_href: null,
  }));
  const pages = projectMoneyPagesFromRegistry(registry, profile, [{ page_id: 'fixture', path: '/best/fixture/', rows: sourceRows }]);
  const quiz = projectQuizFromRegistry(registry, profile, { candidates: sourceRows.map((r) => ({ ...r, display_name: r.provider })) });
  const surfaceSets = deriveProfileSurfaceSets(registry, profile);
  const go = deriveGoEntriesFromRegistry(registry, profile);
  for (const id of held) {
    assert.equal(validated.programs.has(id), false, `${id} not in taxonomy`);
    assert.equal(pages[0].rows.some((r) => r.program_id === id), false, `${id} not in compare`);
    assert.equal(quiz.candidates.some((r) => r.program_id === id), false, `${id} not in quiz`);
    assert.equal(go.some((r) => r.program_id === id), false, `${id} has no go entry`);
    for (const surface of Object.keys(surfaceSets)) assert.equal(surfaceSets[surface].has(id), false, `${id} off ${surface}`);
    const raw = sourceRows.find((r) => r.program_id === id);
    assert.equal(commercialLinkState(raw), 'editorial_link_dark');
    assert.equal(commercialLinkState({ ...raw, affiliate_href: 'https://example.org/cta' }), 'editorial_link_dark');
  }
  assert.deepEqual(pages[0].rows.map((r) => r.program_id), ['direct-meds', 'trt-nation']);
  assert.deepEqual(quiz.candidates.map((r) => r.program_id), ['direct-meds', 'trt-nation']);
});
