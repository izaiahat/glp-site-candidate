import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAffiliateLinkMap } from '../../src/affiliate-link-map.mjs';

// Complete authentic pre-relationship-overlay raw inputs; retained history only.
// No generated map is stored, no current approval is created, no network occurs.
export const EDITORIAL_HISTORICAL_REF = '9cd63e73d743d69104fa0a281ce42113743faf4a';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pins = {
  'money-page-specs.json': '0b67ae04770fa7d8c96164383877881a88334a59b1a98b6c166991acd9c37638',
  'program-registry.json': '385a0f30f0ca6f72d9d83d8e0cab173f9c66191d4ea7b2fb6bd51c0a34d35ce5',
  'affiliate-activation-selection.json': '63586a11a80878a008c61b0825ff5344726906b0e7efece6811dd986f3db0de6',
  'go-runtime-promotion-authority.json': 'ed0060a986a5703829035c29ce23c252d1285083daa17a9ae778d5655e1b53f2',
};

export function historicalGuidesLinkMap(read = file => execFileSync('git', ['show', `${EDITORIAL_HISTORICAL_REF}:data/${file}`], {cwd: root, maxBuffer: 16 * 1024 * 1024})) {
  const inputs = Object.fromEntries(Object.entries(pins).map(([file, pin]) => {
    const bytes = read(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin, `${file}: immutable historical raw-input custody`);
    return [file, JSON.parse(bytes)];
  }));
  return buildAffiliateLinkMap(inputs['money-page-specs.json'].pages, inputs['program-registry.json'],
    inputs['affiliate-activation-selection.json'], 'guides', 'glp-clinic-scout',
    {promotionAuthority: inputs['go-runtime-promotion-authority.json']});
}
