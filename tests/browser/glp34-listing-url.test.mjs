import test from 'node:test';
import assert from 'node:assert/strict';
import { listingQuery } from './glp34-listing-handler.mjs';

test('pharmacy oracle accepts mapped relative routes and preserves query intent', () => {
  const base = new URL('http://127.0.0.1:18894');
  assert.equal(listingQuery('/pharmacies/', base).size, 0);
  assert.equal(listingQuery('/pharmacies/?pharmacyDrug=semaglutide', base).get('pharmacyDrug'), 'semaglutide');
  assert.equal(listingQuery('http://127.0.0.1:18894/pharmacies/?pharmacyType=503a', base).get('pharmacyType'), '503a');
});
