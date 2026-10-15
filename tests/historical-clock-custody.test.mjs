import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readHistoricalPriceFixture} from './helpers/provider-append-predecessor.mjs';
import {reconcileTherapeuticTaxonomyWireIn} from '../src/therapeutic-taxonomy.mjs';
import {reconcileProviderDynamicProfilesWireIn} from '../src/provider-dynamic-profiles.mjs';
const json=p=>JSON.parse(readHistoricalPriceFixture(new URL('../data/'+p,import.meta.url)));
const source=readFileSync(new URL('./d2w-price-index-historical-registry.test.mjs',import.meta.url),'utf8');
const start=source.indexOf("test('reconciled owner subtrees are idempotent and Telos remains absent',");
assert.ok(start>0);
const callbacks=source.slice(start);
assert.equal((callbacks.match(/\btest\(/g)||[]).length,2);
// Execute both COMPLETE maintained callbacks. Their only input owner is the
// raw historical registry; unrelated private price-ledger receipts stay private.
new Function('test','assert','input','json','reconcileTherapeuticTaxonomyWireIn','reconcileProviderDynamicProfilesWireIn',callbacks)(test,assert,{programRegistry:json('program-registry.json')},json,reconcileTherapeuticTaxonomyWireIn,reconcileProviderDynamicProfilesWireIn);
