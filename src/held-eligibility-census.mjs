import {readFileSync} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {validateReceiptedHoldSource} from './historical-pricing-hold.mjs';

// Historical editorial eligibility and an old selection receipt are NOT live
// authority. Validate the authentic downward disposition before partitioning.
export function eligibilityCensus(root, registry, matrix, eligibility, liveRegistryRows, directCount) {
  const fail = reason => { throw new Error('program_page_eligibility_census:' + reason); };
  const ids = eligibility.programs.map(row => row.program_id);
  if (new Set(ids).size !== ids.length) fail('duplicate_identity');
  if (eligibility.program_count !== ids.length || eligibility.live_program_count !== directCount) fail('count_metadata');
  const liveIds = new Set(liveRegistryRows.map(row => row.review_slug || row.program_id));
  const liveRows = eligibility.programs.filter(row => liveIds.has(row.program_id));
  if (liveRows.length !== liveRegistryRows.length || [...liveIds].some(id => !ids.includes(id))) fail('live_membership');
  const heldRows = eligibility.programs.filter(row => !liveIds.has(row.program_id));
  const diskRows = JSON.parse(readFileSync(path.join(root, 'data/program-page-eligibility.json'))).programs;
  for (const row of heldRows) {
    if (row.program_id !== 'telos-rx' || row.live_link_allowed !== false || row.promotion_authorized !== false
        || row.tracking != null || row.tracking_material_included !== false
        || !isDeepStrictEqual(row, diskRows.find(item => item.program_id === row.program_id))
        || !validateReceiptedHoldSource(root, registry, row.program_id)) fail('unreceipted_or_live_extra');
  }
  return {liveRows, heldRows};
}
