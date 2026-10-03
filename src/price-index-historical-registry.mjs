import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {projectGoOnlyPriceBasis} from './go-price-basis.mjs';
import {projectCoivasResearchPriceBasis} from './price-index-coivas-research-binding.mjs';
import {historicalAffiliateRegistry} from './affiliate-relationship-sync.mjs';
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
  // Already-projected input has a live Telos row and no alias too. Shape is
  // not authority: every return must authenticate evidence, taxonomy pins,
  // the complete historical body and any supplied ledger, then return a copy.
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
  // The registered build already excludes the non-price affiliate attachment.
  // Apply that same copy-only boundary for every price reader (including email
  // and repeat calls); raw commercial holds and the whole frozen SHA stay intact.
  const restored = projectGoOnlyPriceBasis(projectCoivasResearchPriceBasis(historicalAffiliateRegistry(registry),'registry',readBytes));
  // GLP-234: the exact consumer-identity successor in program-registry.json at
  // b9266928639796c5ecd838fe3d8de8255b734873. Its first-party brand is Try Ageless
  // (https://tryageless.com/faq/, https://tryageless.com/terms/), not an AgelessRx
  // alias. Authenticate the complete successor row, then restore ONLY the label
  // used by the frozen price oracle. No generic name stripping or repinning:
  // the complete historical body below still has to match its ORIGINAL digest.
  // This copy is price-history-only; never feed it to display or GO producers.
  const identityRows = restored.programs.filter(p => p.program_id === 'try-ageless');
  if (identityRows.length !== 1) throw Error('price_index_historical_identity_drift');
  const identity = identityRows[0];
  if (identity.display_name === 'Try Ageless') {
    if (sha(canonical(identity)) !== '0edc2bea93e337d5bdcf271a76b7c0db10e6d4297f24b58f8b8b1bf79ba47531')
      throw Error('price_index_historical_identity_drift');
    identity.display_name = 'AgelessRx';
  }
  // The accepted Care empty brand assessment is current-facing. Restore the
  // single historical research tag only in this authenticated price-only copy;
  // top-level evidence attachments and current display tags are untouched.
  const careRows = restored.programs.filter(p => p.program_id === 'care-bare-rx-glp1-review');
  if (careRows.length !== 1) throw Error('price_index_historical_care_drift');
  const care = careRows[0];
  const careHash = sha(canonical(care));
  if (careHash === '5d7e8837f04455dc08241b806e8503ffc2a85b5176c6e806b41c168d3eaae71c') {
    care.research_dynamic_profile.taxonomy.brand_name_tags = ['mounjaro'];
  } else if (careHash !== '69675f975e3a24197cca38b162955da64952ccf565bdf05c842263e9d724508b') {
    throw Error('price_index_historical_care_drift');
  }
  if (sha(canonical(care)) !== '69675f975e3a24197cca38b162955da64952ccf565bdf05c842263e9d724508b')
    throw Error('price_index_historical_care_drift');
  // Exact negative factual successors, restored only inside this price-history
  // copy. Full current/restored program hashes and the original whole-body
  // oracle remain mandatory; empty tags are not proof of permanent absence.
  for (const fix of [
    {id:'refills',field:'molecule_tags',before:['semaglutide','tirzepatide'],
     current:'fd5fb6a572dde800b409eb83c56b13d1401c6433dd3200bdc71508fbdcabf8e6',
     historical:'a8686bcbf5afce201cc320a90893b4e6c052326f667c007df9b51e9ed9f96400'},
    {id:'tmates-xentraffic-offer-3154',field:'brand_name_tags',before:['wegovy','zepbound'],
     current:'8607d972612b8dcfe800fc4a65d3adaf69ba51dee4e1bb9882917aa186e8c5d2',
     historical:'0320bb692983415950272972deb2885ec32aa582e3a72591fc6248162c2c3502'},
  ]) {
    const rows=restored.programs.filter(p=>p.program_id===fix.id);
    if(rows.length!==1) throw Error('price_index_historical_negative_claim_drift:'+fix.id);
    const row=rows[0],digest=sha(canonical(row));
    if(digest===fix.current) row.research_dynamic_profile.taxonomy[fix.field]=[...fix.before];
    else if(digest!==fix.historical) throw Error('price_index_historical_negative_claim_drift:'+fix.id);
    if(sha(canonical(row))!==fix.historical) throw Error('price_index_historical_negative_claim_drift:'+fix.id);
  }
  const body = structuredClone(restored);
  delete body.therapeutic_taxonomy;
  delete body.provider_dynamic_profiles;
  delete body.consumer_therapeutic_authorities;
  if (sha(canonical(body)) !== wholeHistoricalPriceBody) throw Error('price_index_historical_registry_drift');
  if (contentLedger !== undefined && canonical(contentLedger) !== canonical(read(frozenLedger,true)))
    throw Error('price_index_historical_ledger_drift');
  return restored;
}
