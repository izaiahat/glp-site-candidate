import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderBlogPost } from '../src/blog-system.mjs';
import { renderConfiguredListing } from '../src/phase3-page-graph.mjs';
import { createHash } from 'node:crypto';

// GLP-75 standalone fixtures remain frozen. GLP-234 composes only the
// independently adjudicated PR4 catalog keys and seven registry paths, plus
// exactly five Breeze groups from merged PR12 in fixed PR8. This combined
// expectation is a PENDING_REVIEW proposal, not independent acceptance.
const BASE = 'e52b7cb903ceaa77ff8d16f958a986398cf3abda';
const PR4 = '752572dc8bfa64e5cea2c8da7de6181dade5fbdd';
const PR6 = 'e62afa5e91afe5338f5d364413c4f2d6cde77c85';
const root = new URL('../', import.meta.url);
const read = file => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
const frozen = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const base = file => JSON.parse(frozen(BASE, file));
const hash = value => createHash('sha256').update(value).digest('hex');
const pinned = (ref, file, sha256) => {
  const bytes = frozen(ref, file);
  assert.equal(hash(bytes), sha256, `frozen fixture ${ref}:${file}`);
  return JSON.parse(bytes);
};
const route = '/guides/wegovy-pills-oral-semaglutide-cost/';
const description = 'Reported oral/tablet Wegovy information dated August 2, 2026. Current prices and terms are unconfirmed; recheck sources before relying on an offer.';

const pr4ArticleKeys = {
  '/guides/healthrx-vs-agelessrx/': ['claims', 'conclusion', 'cons', 'date_modified', 'description', 'direct_answer', 'evidence_review', 'h1', 'owner_key', 'primary_keyword', 'pros', 'sections', 'source_checked_through', 'sources', 'status', 'target_query', 'title', 'updated_at', 'word_count'],
  '/guides/glp-1-hsa-fsa-reimbursement-evidence/': ['sections', 'sources'],
};

test('oral guide renders only a dated description successor, without a price or approval assertion', () => {
  const current = read('data/blog/content-batch.json');
  const previous = pinned(BASE, 'data/blog/content-batch.json', '8d9643a68b158b3f44e967dd742fa10e9b83d51191204abd5b1e55b661e7ec24');
  const article = current.articles.find(a => a.canonical_path === route);
  const old = previous.articles.find(a => a.canonical_path === route);
  assert.equal(article.description, description);
  assert.doesNotMatch(article.description, /\$|\b\d+(?:\.\d+)?\s*mg\b|FDA|approved|current official|available now/i);
  const html = renderBlogPost(article, null, article.author);
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
  assert.ok(html.includes(`<meta name="description" content="${description}">`));
  const oldHtml = renderBlogPost(old, null, old.author);
  assert.equal(html, oldHtml.replaceAll(old.description, description), 'no body, title, source date, link, hold or authority changes');
  // Frozen standalone PR6 still permits exactly the one description edit.
  const standalone = pinned(PR6, 'data/blog/content-batch.json', '09cfdbefe66a926f912db321e49d0c4086c427f9f00c458cf8cab3239319643e');
  const standaloneArticle = standalone.articles.find(a => a.canonical_path === route);
  assert.equal(standaloneArticle.description, description);
  standaloneArticle.description = old.description;
  assert.deepEqual(standalone, previous, 'standalone PR6: exactly one maintained description field changes');

  // Reconstruct from authenticated parent values, never from current articles.
  const pr4 = pinned(PR4, 'data/blog/content-batch.json', '538ef84f014a816ddfe2a706ba11c1354e16f547412da402b911ebb33783c316');
  const expected = structuredClone(previous);
  for (const [path, keys] of Object.entries(pr4ArticleKeys)) {
    const target = expected.articles.find(a => a.canonical_path === path);
    const source = pr4.articles.find(a => a.canonical_path === path);
    for (const key of keys) {
      assert.notDeepEqual(source[key], target[key], `${path}:${key} is a real PR4 delta`);
      target[key] = structuredClone(source[key]);
    }
  }
  assert.deepEqual(expected, pr4, 'PR4 contains only the named 19-key and two-key deltas');
  expected.articles.find(a => a.canonical_path === route).description = description;
  const exactCatalog = value => assert.deepEqual(value, expected, 'exact PR4 + PR6 composition; all metadata, routes, order and other fields retained');
  exactCatalog(current);
  for (const mutate of [
    value => { value.articles[0].title += ' unapproved'; },
    value => { value.articles.find(a => a.canonical_path === route).sections = []; },
    value => { value.articles.find(a => a.canonical_path === '/guides/healthrx-vs-agelessrx/').status = 'APPROVED'; },
    value => { value.articles.find(a => a.canonical_path === '/guides/glp-1-hsa-fsa-reimbursement-evidence/').sources = []; },
    value => { value.unapproved_metadata = true; },
    value => { value.articles.reverse(); },
    value => { value.articles.pop(); },
    value => { value.articles.push(structuredClone(value.articles[0])); },
  ]) {
    const mutant = structuredClone(current);
    mutate(mutant);
    assert.throws(() => exactCatalog(mutant), { code: 'ERR_ASSERTION' }, 'unapproved catalog edits must fail');
  }
  const unchangedCatalog = 'data/blog/content-national-wow-additions.json';
  for (const ref of [BASE, PR4, PR6]) {
    pinned(ref, unchangedCatalog, 'a94d52663b17c9f69b2e059b82602cabc6812dd666abcffff670274c0e29622a');
  }
  assert.equal(readFileSync(new URL(unchangedCatalog, root), 'utf8'), frozen(BASE, unchangedCatalog));
});

test('pharmacy scope note renders once before filters, without changing the grid or asserting approval', () => {
  const html = renderConfiguredListing('D', { route: '/pharmacies/', slug: 'pharmacies', name: 'Compare compounding pharmacies' }, {
    pharmacyInput: read('data/phase3-pharmacy-render-input.json'), registry: read('data/program-registry.json'), articles: [],
  });
  const notes = [...html.matchAll(/<aside\b[^>]*data-pharmacy-evidence-scope[^>]*>([\s\S]*?)<\/aside>/g)];
  assert.equal(notes.length, 1, 'one visible scope note, not an additional pathway explanation');
  const note = notes[0][0];
  assert.ok(html.indexOf(note) < html.indexOf('<details open data-native-pharmacy-filters>'));
  assert.match(note, /Reported information — how to read this directory/);
  assert.match(note, /This grid is a source-coverage subset, not a current licensure or availability list\./);
  assert.match(note, /Directory inclusion alone does not establish current licensure, stock or product approval\./);
  assert.match(note, /state licensure, NPI identity, facility registration and product regulatory status as separate checks/);
  assert.doesNotMatch(note, /\$|\b(?:75|15)\b|FDA-approved|licensed pharmacies|certified|guaranteed/i);
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(html.match(/<div class="listing-grid p3-pharmacy-grid"[\s\S]*?<\/div><\/section>/)[0]), 'f63434b92f7722f67ac143d9f6a8d272c937174d60ac313e43292bf339f9591a');
  assert.equal(hash(html.match(/<details open data-native-pharmacy-filters>[\s\S]*?<\/details>/)[0]), 'b0789c1cf2787affae12218732b5d4a95e7f5d7813e4d5d248c1da48cfde917e');
  assert.equal((html.match(/503 pathway labels describe oversight, not quality\./g) || []).length, 1);
});

test('Wellmedr already consolidates unknown charges and policy conflict; protected inputs are unchanged', () => {
  const contracts = read('data/provider-page-contracts.json');
  const wellmedr = contracts.providers.find(p => p.program_id === 'wellmedr-review');
  assert.match(wellmedr.page_copy.bottom_line, /UNKNOWN exact first-month charge and initial checkout total/);
  assert.match(wellmedr.page_copy.bottom_line, /UNKNOWN exact recurring charge for a selected treatment and plan/);
  assert.match(wellmedr.page_copy.bottom_line, /Terms-of-use wording about intake-stage consultation refunds conflicts and is retained separately, not resolved here/);
  const registryFile = 'data/program-registry.json';
  const original = pinned(BASE, registryFile, 'b37017463dbcb1b706e71f87f126e0c118ed24a6d923dbb0362cfff03f59911b');
  const pr4 = pinned(PR4, registryFile, '836bba4cd1cee5afe637ac0a727a65ee539361295a615e2767cc8d5b923a74e4');
  const registryPaths = [
    'programs/7/display_name',
    'provider_dynamic_profiles/profiles/try-ageless/evidence_bindings/0/evidence_sha256',
    'provider_dynamic_profiles/profiles/try-ageless/evidence_bindings/0/evidence_text',
    'provider_dynamic_profiles/profiles/try-ageless/normalized_sha256',
    'provider_dynamic_profiles/profiles/try-ageless/provider',
    'therapeutic_taxonomy/programs/try-ageless/normalized_sha256',
    'therapeutic_taxonomy/programs/try-ageless/provider',
  ];
  const expected = structuredClone(original);
  for (const path of registryPaths) {
    const keys = path.split('/');
    const key = keys.pop();
    const target = keys.reduce((value, part) => value[part], expected);
    const source = keys.reduce((value, part) => value[part], pr4);
    assert.notDeepEqual(source[key], target[key], `real PR4 registry delta: ${path}`);
    target[key] = structuredClone(source[key]);
  }
  assert.deepEqual(expected, pr4, 'exactly seven paths; all identities, holds and selection fields unchanged');
  // The immutable PR4 expectation above still stands on its frozen parent.
  // Reconstruct PR8 independently, then transplant only its five named groups.
  const pr8 = pinned('b42a4983f1cea415328473d93b6bf57aa063532a', registryFile, '139ead035992abe19e0e5c99830869c72274931ca4d7280dd65c3f1e6e241f86');
  const breezePaths = [
    'therapeutic_taxonomy/authorities/taxonomy_refresh_breeze_meds_review_run-20260927T005531350729Z',
    'therapeutic_taxonomy/programs/breeze-meds-review/evidence_bindings',
    'therapeutic_taxonomy/programs/breeze-meds-review/normalized_sha256',
    'therapeutic_taxonomy/programs/breeze-meds-review/verified_as_of',
    'therapeutic_taxonomy/sealed_as_of',
  ];
  const standaloneBreeze = structuredClone(original);
  for (const path of breezePaths) {
    const keys = path.split('/');
    const key = keys.pop();
    const source = keys.reduce((value, part) => value[part], pr8);
    for (const targetRoot of [standaloneBreeze, expected]) {
      const target = keys.reduce((value, part) => value[part], targetRoot);
      assert.notDeepEqual(source[key], target[key], `real Breeze delta: ${path}`);
      target[key] = structuredClone(source[key]);
    }
  }
  assert.deepEqual(standaloneBreeze, pr8, 'PR8 changes only the five exact Breeze groups from original registry');
  const exactRegistry = value => assert.deepEqual(value, expected, 'only exact PR4 seven-path + PR8 five-group union is permitted');
  const historicalRegistryBytes = readFileSync(new URL('tests/fixtures/f06-historical-source/program-registry.json',root),'utf8');
  exactRegistry(JSON.parse(historicalRegistryBytes));
  // The independently accepted factual successor is a separate input, not a
  // claim that today's registry still equals the earlier PR4/PR8 composition.
  const pins=read('tests/fixtures/glp41-approved-input-successor.json');
  assert.equal(pins.provenance.prior_care_after_sha256, '612814c63d7276d2affe721a7e63664d02703c2554d049a4db25ee61ee05560d');
  assert.equal(pins.inputs[registryFile].after_sha256, '0e5483bb42df81a6d03be465ed98318bc454288cca39562839a10f92fa5a4c5b');
  assert.equal(hash(readFileSync(new URL(registryFile,root))), pins.inputs[registryFile].after_sha256);
  const expectedBytes = JSON.stringify(expected, null, 2) + '\n';
  assert.equal(hash(expectedBytes), '612814c63d7276d2affe721a7e63664d02703c2554d049a4db25ee61ee05560d', 'fixed combined bytes reconstructed exclusively from authenticated parent values');
  const exactRegistryBytes = bytes => assert.equal(bytes, expectedBytes, 'combined registry bytes equal independently reconstructed union');
  exactRegistryBytes(historicalRegistryBytes);
  assert.throws(() => exactRegistryBytes(`${expectedBytes} `), { code: 'ERR_ASSERTION' });
  for (const path of [...registryPaths, ...breezePaths, 'programs/7/program_id', 'programs/7/commercial_state', 'programs/7/go/entry_state', 'programs/7/go/route', 'provider_dynamic_profiles/sealed_as_of', 'therapeutic_taxonomy/programs/breeze-meds-review/molecule_tags']) {
    const mutant = structuredClone(expected);
    const keys = path.split('/');
    const key = keys.pop();
    keys.reduce((value, part) => value[part], mutant)[key] += ' unapproved';
    assert.throws(() => exactRegistry(mutant), { code: 'ERR_ASSERTION' }, `reject registry mutation: ${path}`);
  }
  for (const file of ['data/provider-page-contracts.json', 'data/phase3-pharmacy-render-input.json', registryFile, 'data/affiliate-activation-selection.json', 'data/go-runtime-promotion-authority.json']) {
    const baselineBytes = frozen(BASE, file);
    const standaloneBytes = frozen(PR6, file);
    assert.equal(standaloneBytes, baselineBytes, `standalone PR6 must not rewrite ${file}`);
    assert.deepEqual(JSON.parse(standaloneBytes), base(file), `GLP-75 must not rewrite ${file}`);
    if (file === registryFile) continue; // the sole exact seven + five group union above
    const acceptedSuccessors = {
      // Care scoped negative factual repair + exact paired fastpath binding.
      'data/provider-page-contracts.json': 'edcbabb72522b0884f6d6ac97a813b6bf7afc2bb63bf4302c42162a0d03ffef6',
      // D3 paused-offer exclusion and retained commercial custody, already
      // independently bound in the GLP-234 accepted identity contract.
      'data/affiliate-activation-selection.json': '63586a11a80878a008c61b0825ff5344726906b0e7efece6811dd986f3db0de6',
      'data/go-runtime-promotion-authority.json': 'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2',
    };
    const unchanged = bytes => acceptedSuccessors[file]
      ? assert.equal(hash(bytes), acceptedSuccessors[file], `separately accepted successor: ${file}`)
      : assert.equal(bytes, baselineBytes, `combined must not rewrite ${file}`);
    const currentBytes=readFileSync(new URL(file, root), 'utf8');
    unchanged(currentBytes);
    assert.throws(() => unchanged(`${currentBytes} `), { code: 'ERR_ASSERTION' }, `even serialization drift is forbidden: ${file}`);
  }
});
