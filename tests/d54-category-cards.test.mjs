import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderCompoundedCategoryBody } from '../src/compounded-category.mjs';
import { deriveIdentityGroups } from '../src/provider-identity.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const registry = read('program-registry.json');
const pricingMatrix = read('provider-pricing-matrix.json');
const { aliasIds } = deriveIdentityGroups(registry, 'glp-clinic-scout', read('program-content-ledger.json').programs);
const programs = registry.programs.filter(program => !aliasIds.has(program.program_id));

test('D54: both organic category producers use disclosure-preserving cards, not evidence tables', () => {
  const observations = ['semaglutide', 'tirzepatide'].map(medication => {
    const html = renderCompoundedCategoryBody({ medication, programs, pricingMatrix, registry });
    const cards = [...html.matchAll(/<article data-g08-provider-id="([^"]+)"/g)];
    return {
      medication,
      tableRemoved: !/<table\b/.test(html),
      desktopAndMobileCards: cards.length > 0 && cards.length === new Set(cards.map(match => match[1])).size * 2,
      caveatRetained: html.includes('Compounded drugs are not FDA approved'),
      priceQualificationsRetained: html.includes('g08-price-limitations'),
      priceEvidenceRetained: html.includes('data-price-row-id='),
      freshnessRetained: html.includes('data-prices-checked-date'),
    };
  });
  console.log(JSON.stringify(observations));
  for (const observation of observations) {
    for (const [name, value] of Object.entries(observation)) {
      if (name !== 'medication') assert.equal(value, true, `${observation.medication}: ${name}`);
    }
  }
});
