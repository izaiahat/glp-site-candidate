import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'parse5';
import { subidAttributes, normalizeNetwork, subidParamsFor } from '../src/affiliate-subid.mjs';
import { isAllowedTrackingHost } from '../src/tracking-allowed-hosts.mjs';
import { loadApprovedDirectoryRegistry, validatePrivateDirectoryRows } from '../src/private-approved-directory.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
const root = new URL('../', import.meta.url);
const read = rel => readFileSync(new URL(rel, root), 'utf8');
const json = rel => JSON.parse(read(rel));

for (const [id, network, file] of [
  ['nu-image-medical-review', 'Trackdesk', 'public/reviews/nu-image-medical-review/index.html'],
  ['partnerize-1011l6645', 'Partnerize', 'public/providers/index.html'],
]) test(`A rail identity and served authority agree: ${id}`, () => {
  assert.match(subidAttributes({ network, position: 'review' }), new RegExp(`data-network="${network}"`));
  assert.equal(normalizeNetwork(network), 'direct', 'subid codec fallback is not a rail grant');
  assert.deepEqual(subidParamsFor(network), subidParamsFor('Katalys'));
  const anchors = [];
  const visit = node => {
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    if (node.tagName === 'a' && attrs['data-program'] === id && /sponsored/.test(attrs.rel || '')) anchors.push(attrs);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(read(file)));
  assert.ok(anchors.length > 0);
  for (const a of anchors) {
    assert.equal(a['data-network'], network);
    assert.equal(a['data-link-mode'], 'transparent-direct');
    assert.match(a.rel, /\bsponsored\b/);
    assert.match(a.rel, /\bnoopener\b/);
    const href = new URL(a.href);
    assert.equal(href.protocol, 'https:');
    assert.equal(isAllowedTrackingHost(id, network, href.hostname), true);
    assert.throws(() => isAllowedTrackingHost(id, 'direct', href.hostname), /network_drift/);
    assert.equal(isAllowedTrackingHost(id, network, 'unissued.invalid'), false);
    assert.throws(() => isAllowedTrackingHost('underived-invalid', network, href.hostname), /underived/);
  }
});

test('D3 paused activation selection is empty for all three offers; evidence survives', () => {
  const selection = json('data/affiliate-activation-selection.json');
  const authority = loadGoPromotionAuthority().programs;
  assert.equal(selection.program_count, selection.programs.length);
  const ids = ['try-ageless', 'altrx-glp1-us-cps', 'futurhealth-wegovy-pillform'];
  assert.deepEqual(selection.excluded_network_paused_programs, ids);
  for (const id of ids) {
    assert.equal(selection.programs.some(p => p.program_id === id), false);
    assert.equal(authority[id].status, 'WITHHELD');
    assert.ok(json('data/program-registry.json').programs.some(p => p.program_id === id));
  }
  assert.equal(selection.excluded_selection_evidence[0].tracking_link_sha256,
    'f160cdd13074620be4ba6fac5258d2480ae1dcb45327a9b11e0e49cc3e4ed650');
});

test('private overlay cannot replace public approvals or grant itself authority', () => {
  const approved = loadApprovedDirectoryRegistry();
  assert.deepEqual(approved.programs, json('data/approved-program-registry.json').programs);
  const rows = approved.approved_directory_programs;
  const authority = loadGoPromotionAuthority().programs;
  assert.equal(validatePrivateDirectoryRows(rows, authority).length, 4);
  for (const mutate of [
    r => r.pop(),
    r => r.push(r[0]),
    r => { r[0].tracking.provider_issued_url = 'https://unissued.invalid/'; },
    r => { r[0].directory_only = false; },
  ]) {
    const changed = structuredClone(rows); mutate(changed);
    assert.throws(() => validatePrivateDirectoryRows(changed, authority), /capture_drift/);
  }
  const held = structuredClone(authority); held[rows[0].registry_id].status = 'WITHHELD';
  assert.throws(() => validatePrivateDirectoryRows(rows, held), /authority_mismatch/);
});
