import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {projectGoOnlyPriceBasis} from './go-price-basis.mjs';
import {projectCoivasResearchPriceBasis} from './price-index-coivas-research-binding.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const descriptor = {path:'data/telos-held-price-basis.json',sha256:'0c8f55bfe93c0f8250f96d0e7f7ab7053e06634cd5e0e618914b8a6370f72f25'};
const hold = {path:'data/telos-research-hold-receipt.json',sha256:'f18426e9dea271a1c8ae5b234324ddbb57c3c524e61c1494dd8c281174c9c585'};
const frozenLedger = {path:'data/price-index-frozen-content-ledger.json',sha256:'374667b3f4a13bb7dd5776f1cd29add113b25fa1826c6af4620c07668b496830'};
const frozenRegistrySource = '7940a48ddb453a1ebe274a48ed1c1fb7b5afdedfbbb4bed364153da6b5293499';
const wholeHistoricalPriceBody = 'f9a8ce57165d5a014fe623c820a4ab90313d4c5679c4d079e6703a7e2df8f234';

// PRICE-INDEX ONLY. This copy must never enter a commercial selector or writer.
// This is not an "accept held" filter: exact Telos receipt, descriptor, authority
// bytes, complete restored registry body and complete frozen ledger are required.
// The three separately governed evidence attachments are not price-body fields.
export function historicalPriceIndexRegistry(registry, contentLedger, readBytes = readFileSync) {
  const telos = registry?.programs?.find(p => p.program_id === 'telos-rx');
  const alias = registry?.programs?.some(p => p.program_id === 'telos-rx-review');
  if (telos?.commercial_state !== 'held' && !alias) return registry;
  const read = (ref, local = false) => {
    let bytes;
    try { bytes = readBytes(local ? new URL('../'+ref.path,import.meta.url) : ref.path); }
    catch { throw Error('price_index_historical_authority_unreadable'); }
    if (sha(bytes) !== ref.sha256) throw Error('price_index_historical_authority_hash_mismatch');
    return JSON.parse(bytes);
  };
  read(descriptor,true);
  const aliasDescendant = read({path:'data/d2w-s9-alias-price-descendant.json',sha256:'a76d4cccc8faf7237bf1551aaff0e3727ed576b020318ed4b49cfb3a9f185508'},true);
  // Authenticate the exact repair ruling copy, not a newly invented approval.
  let authorityBytes;
  try { authorityBytes = readBytes(new URL('../'+aliasDescendant.authority.path, import.meta.url)); }
  catch { throw Error('price_index_historical_alias_authority_unreadable'); }
  if (sha(authorityBytes) !== aliasDescendant.authority.sha256) throw Error('price_index_historical_alias_authority_hash_mismatch');
  const receipt = read(hold,true);
  read(receipt.operator_ack); read(receipt.row_readback);
  if (receipt.program_id !== 'telos-rx' || receipt.disposition !== 'HOLD'
      || receipt.live_link_allowed !== false || receipt.promotion_authorized !== false
      || receipt.research_intake_authorized !== false) throw Error('price_index_historical_hold_invalid');
  const taxonomy = registry.therapeutic_taxonomy;
  if (taxonomy?.price_index_registry_frozen_source_sha256 !== frozenRegistrySource
      || taxonomy?.price_index_registry_programs_semantic_basis_sha256 !== wholeHistoricalPriceBody)
    throw Error('price_index_historical_oracle_invalid');
  const restored = projectGoOnlyPriceBasis(projectCoivasResearchPriceBasis(registry,'registry',readBytes));
  const body = structuredClone(restored);
  delete body.therapeutic_taxonomy;
  delete body.provider_dynamic_profiles;
  delete body.consumer_therapeutic_authorities;
  if (sha(canonical(body)) !== wholeHistoricalPriceBody) throw Error('price_index_historical_registry_drift');
  if (contentLedger !== undefined && canonical(contentLedger) !== canonical(read(frozenLedger,true)))
    throw Error('price_index_historical_ledger_drift');
  return restored;
}
