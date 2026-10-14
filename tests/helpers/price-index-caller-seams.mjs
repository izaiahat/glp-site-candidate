import assert from 'node:assert/strict';

// Test-only compilation of the maintained expressions. Never imports/runs the
// build entry point or any writer; callers supply the real or synthetic readers.
export function priceIndexCallerSeams(build) {
 const preflightStart=build.indexOf('  let priceIndexRegistrySourceSha256 =');
 const preflightEnd=build.indexOf('  const priceLedger =',preflightStart);
 assert.ok(preflightStart>=0&&preflightEnd>preflightStart);
 const preflight=new Function('programRegistry','programRegistryBytes','priceTrackerConfig','createHash','stableSha256','restoreGoOnlyPriceBasis','ROOT','historicalPriceIndexRegistry','historicalAffiliateRegistry','rawProgramRegistry',
  build.slice(preflightStart,preflightEnd)+'\nreturn priceIndexRegistrySourceSha256;');
 const buildStart=build.indexOf('  const priceIndexInput = {');
 const buildEnd=build.indexOf('  const priceIndexRefresh =',buildStart);
 assert.ok(buildStart>=0&&buildEnd>buildStart);
 const buildCall=new Function('priceTrackerConfig','originalDataStudy','rawProgramRegistry','priceLedger','originalDataStudyBytes','priceIndexRegistrySourceSha256','createHash','buildPriceIndexArtifacts','applyWave2P1Surfaces','markReleaseReady','addByteFrozenSharedRuntime','PRICE_INDEX_ROUTE_FILE','historicalAffiliateRegistry',
  build.slice(buildStart,buildEnd)+'\nreturn priceIndex;');
 return {preflight,buildCall};
}
