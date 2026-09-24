import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {release2PriceLedgerBasis} from './price-index-release2-basis.mjs';
import {s32LedgerPredecessor} from './price-index-s32-basis.mjs';
import {projectCoivasResearchPriceBasis,COIVAS_RESEARCH_PRICE_BINDING} from './price-index-coivas-research-binding.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
// Original whole frozen S21 dataset is the final price/authority oracle.
const frozenHash = '374667b3f4a13bb7dd5776f1cd29add113b25fa1826c6af4620c07668b496830';
const permittedIds = ['shedrx','enhance-md','wellorithm','gala-health','found-health','try-ageless'];
const permittedFields = ['meds_offered','meds_offered_evidence'];
const heldBinding = {path:'data/telos-held-ledger-binding.json',sha256:'155d4aa0261ef93c56adbda88cb312d4964536b04c158f812635661d670a8adf'};
const bindingKeys = ['schema','frozen_sha256','current_sha256','nonprice_fields','source_proposal_sha256','purpose'];
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
}
function heldProjection(current, frozen, binding, readBytes) {
  if (canonical(binding.held_binding) !== canonical(heldBinding)) throw Error('price_nonprice_held_binding_invalid');
  const read = (reference, local = false) => {
    let bytes;
    try { bytes = readBytes(local ? new URL('../'+reference.path,import.meta.url) : reference.path); }
    catch { throw Error('price_nonprice_hold_receipt_unreadable'); }
    if (sha(bytes) !== reference.sha256) throw Error('price_nonprice_hold_receipt_hash_mismatch');
    return JSON.parse(bytes);
  };
  // Descriptor, exact HOLD receipt, operator ACK and saved row observation are
  // all authenticated. A matching row field alone cannot authorize projection.
  const contract = read(heldBinding, true);
  const receipt = read(contract.hold_receipt, true);
  read(receipt.operator_ack); read(receipt.row_readback);
  if (receipt.program_id !== 'telos-rx' || receipt.disposition !== 'HOLD'
      || receipt.live_link_allowed !== false || receipt.promotion_authorized !== false
      || receipt.research_intake_authorized !== false) throw Error('price_nonprice_hold_authority_invalid');
  const rows = current.programs.filter(row => row.program_id === 'telos-rx');
  const oldRows = frozen.programs.filter(row => row.program_id === 'telos-rx');
  if (rows.length !== 1 || oldRows.length !== 1) throw Error('price_nonprice_missing_identity');
  const row = rows[0], old = oldRows[0];
  if (Object.hasOwn(old,'research_hold_receipt')
      || Object.entries(contract.before_fields).some(([key,value]) => !Object.hasOwn(old,key) || canonical(old[key]) !== canonical(value))
      || Object.entries(contract.after_fields).some(([key,value]) => !Object.hasOwn(row,key) || canonical(row[key]) !== canonical(value))) {
    throw Error('price_nonprice_price_or_authority_drift');
  }
  // Reverse only these three exact downgrades and one additive receipt, then
  // compare the complete document. Never drop arbitrary permission fields.
  for (const [key,value] of Object.entries(contract.before_fields)) row[key] = value;
  delete row.research_hold_receipt;
}
// readBytes is an injected byte transport for hostile tests; every byte read
// still has to match the immutable descriptor/receipt/authority chain above.
export function frozenPriceLedger(currentBytes, frozenBytes, binding, readBytes = readFileSync) {
  const rawCurrentSha=sha(currentBytes);
  if(binding?.schema==='glp.frozen-price-nonprice-binding.v5'){
    const prior=s32LedgerPredecessor(currentBytes,binding,readBytes);
    return {...frozenPriceLedger(prior.bytes,frozenBytes,prior.binding,readBytes),current_sha256:rawCurrentSha};
  }
  const release2=binding?.schema==='glp.frozen-price-nonprice-binding.v4';
  const research = release2 || binding?.schema === 'glp.frozen-price-nonprice-binding.v3';
  const held = research || binding?.schema === 'glp.frozen-price-nonprice-binding.v2';
  if (!exactKeys(binding,research ? [...bindingKeys,'held_binding','research_binding'] : held ? [...bindingKeys,'held_binding'] : bindingKeys)) throw Error('price_nonprice_binding_scope_invalid');
  if ((!held && binding.schema !== 'glp.frozen-price-nonprice-binding.v1') || binding.frozen_sha256 !== frozenHash || sha(frozenBytes) !== frozenHash || sha(currentBytes) !== binding.current_sha256) throw Error('price_nonprice_binding_hash_mismatch');
  if (release2) currentBytes=release2PriceLedgerBasis(currentBytes,readBytes);
  const expected = permittedIds.flatMap(program_id => permittedFields.map(key => ({program_id,key})));
  if (canonical(binding.nonprice_fields) !== canonical(expected)) throw Error('price_nonprice_binding_scope_invalid');
  const frozen = JSON.parse(frozenBytes); let current = JSON.parse(currentBytes);
  if (held) heldProjection(current, frozen, binding, readBytes);
  if (research) {
    if (canonical(binding.research_binding) !== canonical(COIVAS_RESEARCH_PRICE_BINDING)) throw Error('price_nonprice_research_binding_invalid');
    try { current = projectCoivasResearchPriceBasis(current,'ledger',readBytes); }
    catch (error) { throw Error('price_nonprice_'+error.message); }
  }
  const projection = source => {
    const value = structuredClone(source); const seen = new Set();
    for (const row of value.programs) {
      if (seen.has(row.program_id)) throw Error('price_nonprice_duplicate_identity');
      seen.add(row.program_id);
      if (permittedIds.includes(row.program_id)) for (const key of permittedFields) delete row[key];
    }
    if (!permittedIds.every(id => seen.has(id))) throw Error('price_nonprice_missing_identity');
    return canonical(value);
  };
  if (projection(frozen) !== projection(current)) throw Error('price_nonprice_price_or_authority_drift');
  return {ledger:frozen,bytes:frozenBytes,frozen_sha256:frozenHash,current_sha256:rawCurrentSha};
}
