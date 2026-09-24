import test from 'node:test';
import assert from 'node:assert/strict';
import { noJSIdentityCoverage } from './glp34-listing-handler.mjs';

test('no-JS identities require complete readable twins, not hidden lazy-shell readability', () => {
  const card = { id: 'fixture-provider', visible: true, lazy: false, text: 'Fixture provider details', links: [{ href: '/reviews/fixture-provider/' }] };
  const shell = { ...card, visible: false, lazy: true, text: '' };
  const expected = [card.id];
  assert.equal(noJSIdentityCoverage(expected, [card, shell]), true);
  assert.equal(noJSIdentityCoverage(expected, [shell]), false);
  assert.equal(noJSIdentityCoverage(expected, [card, card]), false);
  assert.equal(noJSIdentityCoverage(expected, [card, { ...shell, id: 'unrelated' }]), false);
  assert.equal(noJSIdentityCoverage(expected, [{ ...card, text: '' }]), false);
  assert.equal(noJSIdentityCoverage(expected, [{ ...card, links: [] }]), false);
  assert.equal(noJSIdentityCoverage([], []), false);
  assert.equal(noJSIdentityCoverage([''], [{ ...card, id: '' }]), false);
});
