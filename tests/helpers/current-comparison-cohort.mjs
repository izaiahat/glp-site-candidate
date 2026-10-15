import assert from 'node:assert/strict';
import { loadGoPromotionAuthority } from '../../src/go-runtime-selection.mjs';

// Independent expected-side membership for F03's current relationship overlay.
// Do not read rendered HTML, copy its count, or subtract every WITHHELD row:
// pauses/unknowns can retain editorial comparison cards. Only explicit ended or
// withdrawn raw relationships remove a program from this commercial cohort.
export function currentComparisonPrograms(registry, authority = loadGoPromotionAuthority()) {
  assert.ok(Array.isArray(registry.programs) && registry.programs.length, 'empty comparison registry');
  assert.equal(new Set(registry.programs.map(row => row.program_id)).size, registry.programs.length, 'duplicate comparison identity');
  return registry.programs.filter(row => {
    const snapshot = row.affiliate_relationship_snapshot;
    if (!['ended', 'withdrawn'].includes(snapshot?.lifecycle)) return true;
    const effective = authority.programs?.[row.program_id];
    assert.equal(snapshot.promotion_denied, true, `${row.program_id}: terminal relationship lacks denial`);
    assert.equal(effective?.status, 'WITHHELD', `${row.program_id}: terminal relationship authority missing/contradictory`);
    assert.equal(effective.promotion_authorized, false, `${row.program_id}: terminal relationship reactivated`);
    assert.ok(snapshot.source_event_id && snapshot.source_kind && snapshot.source_checked_at,
      `${row.program_id}: terminal relationship provenance missing`);
    for (const [key, value] of Object.entries(snapshot)) {
      assert.deepEqual(effective.relationship_snapshot?.[key], value, `${row.program_id}: terminal relationship provenance drift (${key})`);
    }
    return false;
  });
}
