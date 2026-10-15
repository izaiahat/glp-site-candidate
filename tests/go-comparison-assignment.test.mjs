import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveGoEntriesFromRegistry} from '../src/program-registry.mjs';
import {resolveCardOutbound, approvedDirectCard} from '../src/card-outbound.mjs';
import {handleGoRequest, parseGoQuery} from '../src/worker.mjs';
import {completeGoAuthority} from './fixtures/complete-go-authority.mjs';

const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const profile = 'glp-clinic-scout';
const graph = read('data/phase3-page-graph.json');
const registry = read('data/program-registry.json');
// Existing registry shape, synthetic receipt/link only. No production grant or I/O.
const program = structuredClone(registry.programs.find(row => row.program_id === 'orderlymeds'));
assert(program);
const fixtureRegistry = {...registry, programs: [program]};
const affiliate = {live: true, network: 'everflow', affiliate_href: 'https://tracking.invalid/test-only'};
const receipt = completeGoAuthority(program, affiliate);
const entries = promotion => deriveGoEntriesFromRegistry(fixtureRegistry, profile, [],
  {[program.program_id]: affiliate}, {programs: {[program.program_id]: promotion}});
const request = (surface, method = 'HEAD') => new Request(`https://site.invalid${program.go.route}?s=${surface}&v=a`,
  {method, headers: {'user-agent': 'Mozilla/5.0'}});

test('registered comparison preset assignments survive the actual GO producer and worker gate', async () => {
  assert.deepEqual(graph.comparison_pages.map(page => page.slug), ['both', 'starter', 'step-up']);
  const rows = entries(receipt);
  assert.equal(rows.length, 1);
  const entry = rows[0];
  assert.equal(entry.live_link_allowed, true);
  for (const page of graph.comparison_pages) {
    for (const rankPosition of [1, 25, 31]) {
      const outbound = resolveCardOutbound({program, affiliate, promotionAuthority: {programs: {[program.program_id]: receipt}},
        pageSlug: page.slug, position: 'provider-card', rankPosition});
      assert.equal(outbound.mode, 'go');
      assert.equal(approvedDirectCard(outbound, affiliate, receipt), false);
      const assignment = parseGoQuery(new URL(outbound.href, 'https://site.invalid'));
      assert(entry.allowed_page_roles.includes(assignment.pageSlug), `${page.slug}: producer omitted emitted role`);
      assert(entry.allowed_positions.includes(assignment.linkPosition));
      assert(entry.allowed_variants.includes(assignment.variant));
      // HEAD exercises the real assignment gate but cannot mint/log/follow a click.
      const response = await handleGoRequest(request(assignment.surface), {PROGRAM_MANIFEST: {programs: rows}}, program.program_id);
      assert.equal(response.headers.get('x-redirect-reason'), 'non-navigational-request');
      assert.equal(response.headers.get('x-attribution-log'), 'not-minted');
    }
  }
  for (const surface of ['unregistered.pc1', 'both.pc61', 'starter.pcu51', 'step-up.hero']) {
    const response = await handleGoRequest(request(surface), {PROGRAM_MANIFEST: {programs: rows}}, program.program_id);
    assert.equal(response.headers.get('x-redirect-reason'), 'assignment-not-allowlisted', surface);
  }
});

test('comparison assignment roles never promote incomplete or explicitly withheld authority', async () => {
  for (const promotion of [null, {...receipt, privacy_qa_passed: false}, {...receipt, status: 'WITHHELD', promotion_authorized: false}]) {
    const rows = entries(promotion);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].live_link_allowed, false);
    assert.equal(rows[0].promotion_authorized, false);
    for (const page of graph.comparison_pages) {
      const response = await handleGoRequest(request(`${page.slug}.pc1`, 'GET'),
        {PROGRAM_MANIFEST: {programs: rows}, AFFILIATE_RUNTIME_MODE: 'production'}, program.program_id);
      assert.notEqual(response.headers.get('x-redirect-reason'), 'affiliate-live');
      assert.notEqual(response.headers.get('x-attribution-log'), 'mapped');
    }
  }
});
