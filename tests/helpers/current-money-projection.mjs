import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveAffiliateRegistry, effectiveAffiliateBuildInputs } from '../../src/affiliate-relationship-sync.mjs';
import { projectProviderDisplayLedger } from '../../src/provider-display-evidence.mjs';
import { projectMoneyPagesFromRegistry, projectQuizFromRegistry } from '../../src/program-registry.mjs';
import { projectTherapeuticSurfaces } from '../../src/therapeutic-taxonomy.mjs';
import { activeCouponMap } from '../../src/coupon-offers.mjs';
import { decorateProviderChips } from '../../src/provider-chip.mjs';
import { loadGoPromotionAuthority } from '../../src/go-runtime-selection.mjs';
import { fileURLToPath } from 'node:url';
import { deriveMoneyPageFreshness } from '../../src/freshness.mjs';
import { publicProviderNames } from '../../src/public-provider-names.mjs';

export const readMoneyData = name => JSON.parse(readFileSync(new URL('../../data/' + name, import.meta.url)));
export function currentMoneyInputs() {
  return Object.fromEntries(Object.entries({rawProgramRegistry:'program-registry.json', rawEligibility:'program-page-eligibility.json', rawActivationSelection:'affiliate-activation-selection.json', rawContentLedger:'program-content-ledger.json', moneySpecs:'money-page-specs.json', quizConfig:'quiz-config.json', couponFeed:'coupon-offers.json'}).map(([key, file]) => [key, readMoneyData(file)]));
}

// Execute the COMPLETE actual build-owned page augmentation, not a filtered
// imitation of the output or a row-count cap change. No builder main/effects.
export function currentMoneyPages(inputs = currentMoneyInputs()) {
  const SITE_PROFILE = 'glp-clinic-scout';
  const programRegistry = effectiveAffiliateRegistry(inputs.rawProgramRegistry);
  const {contentLedger: relationshipLedger, activationSelection} = effectiveAffiliateBuildInputs(inputs.rawProgramRegistry,
    {eligibility:inputs.rawEligibility, activationSelection:inputs.rawActivationSelection, contentLedger:inputs.rawContentLedger}, SITE_PROFILE);
  const contentLedger = {...relationshipLedger, programs:relationshipLedger.programs.map(row => projectProviderDisplayLedger(row))};
  const source = readFileSync(new URL('../../scripts/build-staging.mjs', import.meta.url), 'utf8');
  const block = (startText, endText) => {
    const start = source.indexOf(startText), end = source.indexOf(endText, start);
    assert.ok(start > 0 && end > start, 'complete build-owned money block exists');
    return source.slice(start, end);
  };
  const code = block('  const programMap = new Map(contentLedger.programs', '  const therapeuticProgramIds = ')
    + block('  const augmented = therapeuticSurfaces.pages.map(', '  // 2026-08-06 cluster 1: freshness')
    + block('  const couponOffersByProgram = activeCouponMap(', '  buildDerivations.coupon_offers = ');
  const values = {...inputs, SITE_PROFILE, programRegistry, contentLedger, activationSelection,
    ROOT:fileURLToPath(new URL('../../', import.meta.url)), loadGoPromotionAuthority,
    providerFastpath:readMoneyData('provider-fastpath-contract.json'), providerPageContracts:readMoneyData('provider-page-contracts.json'),
    readyRegistry:readMoneyData('approved-program-registry.json'), ready6Contract:readMoneyData('ready6-editorial-contract.json'),
    providerPricingMatrix:readMoneyData('provider-pricing-matrix.json'), activeCouponMap,
    projectMoneyPagesFromRegistry, projectQuizFromRegistry, projectTherapeuticSurfaces};
  const augmented = new Function(...Object.keys(values), code + '\nreturn augmented;')(...Object.values(values));
  decorateProviderChips(augmented, publicProviderNames(JSON.parse(readFileSync(new URL('../../assets/provider-logos/manifest.json', import.meta.url)))), readMoneyData('wordmark-font-metrics.json'));
  for (const spec of augmented) Object.assign(spec, deriveMoneyPageFreshness(spec));
  return publicProviderNames(augmented);
}

// Independent expected-side membership: raw authorized comparison identities,
// minus ONLY explicit terminal relationships and declared aggregate aliases.
export function expectedMoneyIds(rawPage, registry) {
  return rawPage.rows.filter(row => {
    const record = registry.programs.find(p => (p.review_slug || p.program_id) === row.program_id);
    assert.ok(record, `${row.program_id}: registered identity`);
    const profile = record.profiles['glp-clinic-scout'];
    return profile.surfaces.compare === true && profile.canonical_identity?.role !== 'alias'
      && !['ended','withdrawn'].includes(record.affiliate_relationship_snapshot?.lifecycle);
  }).map(row => row.program_id);
}

export function assertMoneyDenial(record, promotion) {
  const snapshot = record.affiliate_relationship_snapshot;
  assert.ok(['paused','ended','withdrawn','declined'].includes(snapshot?.lifecycle), `${record.program_id}: named denial lifecycle`);
  assert.equal(snapshot.promotion_denied, true);
  assert.equal(snapshot.reported_information, true);
  assert.equal(snapshot.network, 'katalys');
  assert.ok(/^\d+$/.test(snapshot.network_program_id));
  assert.ok(Number.isInteger(snapshot.sheet_row) && snapshot.sheet_row > 0);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(snapshot.source_checked_at));
  if (snapshot.lifecycle === 'paused') assert.equal(snapshot.relationship_status, 'paused_network_program_paused');
  else assert.ok(snapshot.source_event_id && snapshot.source_kind);
  assert.equal(promotion?.status, 'WITHHELD');
  assert.equal(promotion.promotion_authorized, false);
  assert.equal(promotion.reason, 'sole_writer_relationship_' + snapshot.lifecycle);
  assert.deepEqual(promotion.relationship_snapshot, {program_id:record.program_id, render_id:record.review_slug || record.program_id, ...snapshot});
}
