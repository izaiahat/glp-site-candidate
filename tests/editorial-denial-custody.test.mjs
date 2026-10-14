import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { historicalGuidesLinkMap, EDITORIAL_HISTORICAL_REF } from './fixtures/editorial-historical-links.mjs';
import { resolveBlogComparisonSpec } from '../src/blog-system.mjs';
import { loadAffiliateLinkMap } from '../src/affiliate-link-map.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';

const title = 'current ruled guides preserve every healthy row while authentic paused Trimi remains link-dark';
const read = file => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url)));
const originals = {registry: read('program-registry.json'), selection: read('affiliate-activation-selection.json'), authority: loadGoPromotionAuthority(), links: loadAffiliateLinkMap('guides')};
const batch = read('blog/content-batch.json');
const ledger = read('program-content-ledger.json');
const RULED_YES = ['/guides/gala-vs-shed/', '/guides/trimi-vs-yourera/', '/guides/found-vs-trimi-insurance-self-pay/', '/guides/glp-1-insurance-support-vs-coverage/'];

function owningCallback(values, resolver = resolveBlogComparisonSpec) {
  const source = readFileSync(new URL('./editorial-monetization.test.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(`test(${JSON.stringify(title)},`);
  assert.ok(start >= 0, 'maintained current guide oracle must exist');
  const end = source.indexOf('\ntest(', start + 1);
  let callback;
  new Function('test', 'assert', 'RULED_YES', 'guideOf', 'ledger', 'registry', 'readJson', 'loadGoPromotionAuthority', 'loadAffiliateLinkMap', 'resolveBlogComparisonSpec', source.slice(start, end < 0 ? source.length : end))(
    (_title, body) => { callback = body; }, assert, RULED_YES,
    path => batch.articles.find(row => row.canonical_path === path), ledger, values.registry,
    file => { assert.equal(file, 'data/affiliate-activation-selection.json'); return values.selection; },
    () => values.authority, () => values.links, resolver,
  );
  return callback;
}

test('historical editorial inputs reject current substitution and byte drift without changing the original minimum', () => {
  const files = ['money-page-specs.json', 'program-registry.json', 'affiliate-activation-selection.json', 'go-runtime-promotion-authority.json'];
  const originals = Object.fromEntries(files.map(file => [file, execFileSync('git', ['show', `${EDITORIAL_HISTORICAL_REF}:data/${file}`], {cwd: new URL('../', import.meta.url), maxBuffer: 16 * 1024 * 1024})]));
  const map = historicalGuidesLinkMap(file => originals[file]);
  for (const canonical of RULED_YES) {
    const spec = resolveBlogComparisonSpec(batch.articles.find(row => row.canonical_path === canonical), ledger.programs, map);
    assert.ok(spec.rows.filter(row => row.live_link_allowed && row.affiliate_href).length >= 3);
  }
  for (const target of files) {
    assert.throws(() => historicalGuidesLinkMap(file => file === target ? Buffer.concat([originals[file], Buffer.from('\nunauthorized')]) : originals[file]), {name: 'AssertionError'});
    const current = readFileSync(new URL(`../data/${target}`, import.meta.url));
    if (!current.equals(originals[target])) assert.throws(() => historicalGuidesLinkMap(file => file === target ? current : originals[file]), {name: 'AssertionError'});
    else assert.deepEqual(current, originals[target], `${target}: unchanged selection stays frozen`);
  }
});

test('current editorial oracle refuses denied reactivation and every missing healthy row or provenance drift', () => {
  owningCallback(originals)();
  for (const mutate of [
    v => { v.authority.programs['trimi-glp-1'].status = 'VERIFIED'; },
    v => { v.authority.programs['trimi-glp-1'].promotion_authorized = true; },
    v => { v.authority.programs['trimi-glp-1'].reason = 'legacy_pause'; },
    v => { delete v.authority.programs['trimi-glp-1'].relationship_snapshot; },
    v => { v.authority.programs['trimi-glp-1'].relationship_snapshot.source_checked_at = '2000-01-01T00:00:00Z'; },
    v => { v.registry.programs.find(row => row.program_id === 'trimi-glp-1').affiliate_relationship_snapshot.promotion_denied = false; },
    v => { v.links['trimi-glp-1'].live = true; },
    v => { v.links['trimi-glp-1'].affiliate_href = 'https://attacker.invalid/'; },
    v => { v.links['trimi-glp-1'].go_href = '/go/trimi-glp-1'; },
    ...['found-health', 'gala-health', 'yourera-program'].map(id => v => { delete v.links[id]; }),
  ]) {
    const values = structuredClone(originals); mutate(values);
    assert.throws(() => owningCallback(values)(), {name: 'AssertionError'});
  }
  for (const mutate of [
    spec => { spec.rows.pop(); },
    spec => { spec.rows.find(row => row.program_id === 'trimi-glp-1').live_link_allowed = true; },
    spec => { spec.rows.find(row => row.program_id === 'trimi-glp-1').promotion_authorized = true; },
    spec => { spec.rows.find(row => row.program_id === 'trimi-glp-1').affiliate_href = 'https://attacker.invalid/'; },
    spec => { spec.rows.find(row => row.program_id === 'shedrx').live_link_allowed = true; },
    spec => { spec.rows.find(row => row.program_id === 'found-health').affiliate_href = 'https://attacker.invalid/'; },
    spec => { spec.rows.find(row => row.program_id === 'found-health').promotion_authorized = false; },
  ]) assert.throws(() => owningCallback(originals, (...args) => {
    const result = resolveBlogComparisonSpec(...args); mutate(result); return result;
  })(), {name: 'AssertionError'});
});
