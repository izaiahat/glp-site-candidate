import receipt from '../data/go-price-basis-supersession.json' with { type: 'json' };
import heldSurface from '../data/d2w-held-surface-price-basis.json' with { type: 'json' };
import selection from '../data/go-selection-receipt.json' with { type: 'json' };
import telosHeld from '../data/telos-held-price-basis.json' with { type: 'json' };
import coivasResearch from '../data/coivas-research-price-basis.json' with { type: 'json' };
import aliasDescendant from '../data/d2w-s9-alias-price-descendant.json' with { type: 'json' };

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const equal = (a,b) => canonical(a) === canonical(b);
export const GO_PRICE_BASIS_SELECTION_SHA256 = receipt.selection_sha256;

// Edge-safe, pure pricing projection, not commercial activation authority.
// The caller still checks the entire restored document against its frozen SHA.
export function projectGoOnlyPriceBasis(basis) {
  const ids=['awin-128761','katalys-1286','katalys-1304','katalys-647'].sort();
  if(receipt.schema!=='d2s-exact-go-only-price-basis-v1' || !equal(receipt.entries.map(r=>r.program_id).sort(),ids))
    throw new Error('go_price_basis_receipt_invalid');
  const restored=structuredClone(basis);
  // Exact parent-adopted research successor, orthogonal to /go selection.
  // Edge-safe descriptor projection; Node price owner independently checks the
  // complete receipt chain, and every caller still owes the whole SHA oracle.
  const cr=coivasResearch,coivas=restored.programs.find(p=>p.program_id==='awin-128761');
  if(cr.schema!=='d2w-exact-coivas-research-price-basis-v1'||cr.program_id!=='awin-128761'
      ||cr.field!=='research_dynamic_profile'||cr.before_present!==false||cr.before!==null
      ||cr.integration.sha256!=='2862d82812d945907d052bd9d966a816774ce30fd2077cafb342a7528b88ed95'||!coivas)
    throw new Error('go_price_basis_coivas_receipt_invalid');
  if(Object.hasOwn(coivas,cr.field)){
    if(!equal(coivas[cr.field],cr.after))throw new Error('go_price_basis_coivas_scope_drift');
    delete coivas[cr.field];
  }
  for(const row of receipt.entries){
    const p=restored.programs.find(p=>p.program_id===row.program_id),before=row.before_profile;
    if(!p || row.before_go.entry_state!=='held' || before.surfaces.go!==false
      || before.exceptions.go?.surface_restriction_basis!=='operator_terms_transparent_direct_only')
      throw new Error(`go_price_basis_authority_invalid:${row.program_id}`);
    // Historical/frozen inputs remain valid without acquiring any new meaning.
    if(equal(p.go,row.before_go)&&equal(p.profiles['glp-clinic-scout'],before))continue;
    const expected=structuredClone(before);expected.surfaces.go=true;delete expected.exceptions.go;
    if(!equal(p.go,{...row.before_go,entry_state:'server_redirect'})||!equal(p.profiles['glp-clinic-scout'],expected))
      throw new Error(`go_price_basis_scope_drift:${row.program_id}`);
    p.go=structuredClone(row.before_go);p.profiles['glp-clinic-scout']=structuredClone(before);
  }
  // D2w: accurately declare the already-selected Longevity HOLD without
  // replacing the frozen price basis. Only go:false + this exact exception
  // may be projected away; every unrelated difference reaches the SHA oracle.
  const heldId = 'longevity-meds-glp-1-review';
  const adoptedHold = selection.programs.find(p => p.program_id === heldId);
  if (heldSurface.schema !== 'd2w-exact-held-surface-price-basis-v1'
      || heldSurface.program_id !== heldId || heldSurface.selection_sha256 !== receipt.selection_sha256
      || adoptedHold?.disposition !== 'HOLD' || adoptedHold.promotion_authorized !== false)
    throw new Error('go_price_basis_held_authority_invalid');
  const heldProgram = restored.programs.find(p => p.program_id === heldId);
  const beforeHeld = heldSurface.before_profile, afterHeld = heldSurface.after_profile;
  const expectedHeld = structuredClone(beforeHeld);
  expectedHeld.surfaces.go = false;
  expectedHeld.exceptions.go = afterHeld.exceptions.go;
  if (beforeHeld.surfaces.go !== true || beforeHeld.exceptions.go
      || afterHeld.exceptions.go?.enabled !== true
      || afterHeld.exceptions.go.authority_sha256 !== receipt.selection_sha256
      || afterHeld.exceptions.go.authority_path !== 'data/go-selection-receipt.json'
      || !afterHeld.exceptions.go.reason.includes(adoptedHold.required_artifact)
      || !equal(afterHeld, expectedHeld) || !heldProgram)
    throw new Error('go_price_basis_held_receipt_invalid');
  const profile = heldProgram.profiles['glp-clinic-scout'];
  if (equal(profile, afterHeld)) heldProgram.profiles['glp-clinic-scout'] = structuredClone(beforeHeld);
  else if (!equal(profile, beforeHeld)) throw new Error('go_price_basis_held_scope_drift');
  // Exact source-only Telos commercial revocation. This restores a historical
  // pricing oracle, never a render/activation input; the whole-document SHA
  // remains mandatory at the caller. Historical input needs no alias added.
  const t = telosHeld;
  const holdHash = 'f18426e9dea271a1c8ae5b234324ddbb57c3c524e61c1494dd8c281174c9c585';
  if (t.schema !== 'd2w-exact-telos-held-price-basis-v1' || t.hold_receipt_sha256 !== holdHash
      || t.before_program.program_id !== 'telos-rx' || t.after_program.program_id !== 'telos-rx'
      || t.after_program.research_hold_receipt?.sha256 !== holdHash
      || t.after_program.commercial_state !== 'held' || t.alias_program.program_id !== 'telos-rx-review')
    throw new Error('go_price_basis_telos_receipt_invalid');
  const telosIndex = restored.programs.findIndex(p => p.program_id === 'telos-rx');
  const aliasIndex = restored.programs.findIndex(p => p.program_id === 'telos-rx-review');
  // S9-7: reconstruct only the absent review_path of the exact identity-only
  // held alias. Original descriptor and whole historical oracle are unchanged.
  const d = aliasDescendant;
  const expectedAlias = structuredClone(t.alias_program); delete expectedAlias.review_path;
  if (d.schema !== 'd2w-s9-identity-only-alias-price-descendant-v1'
      || d.field !== 'review_path'
      || d.authority.path !== 'data/d2w-s9-final-decision.md'
      || d.authority.sha256 !== '9919a9f3d8b147be9699eb8edd9b2d60fe8f27d31f9de63b6232d3118cf2748d'
      || d.predecessor_descriptor.path !== 'data/telos-held-price-basis.json'
      || d.predecessor_descriptor.sha256 !== '0c8f55bfe93c0f8250f96d0e7f7ab7053e06634cd5e0e618914b8a6370f72f25'
      || !equal(d.before_alias, t.alias_program) || !equal(d.after_alias, expectedAlias))
    throw new Error('go_price_basis_alias_descendant_invalid');
  if (aliasIndex >= 0 && equal(restored.programs[aliasIndex], d.after_alias))
    restored.programs[aliasIndex] = structuredClone(d.before_alias);
  if (telosIndex < 0) throw new Error('go_price_basis_telos_identity_missing');
  if (equal(restored.programs[telosIndex], t.before_program) && aliasIndex < 0) return restored;
  if (!equal(restored.programs[telosIndex], t.after_program)
      || aliasIndex < 0 || !equal(restored.programs[aliasIndex], t.alias_program))
    throw new Error('go_price_basis_telos_scope_drift');
  const beforeT = structuredClone(t.before_program), afterT = structuredClone(t.after_program);
  // Only these commercial/profile/identity fields may change. All price,
  // display, route and evidence fields must remain exactly as before.
  delete afterT.research_hold_receipt; afterT.commercial_state = beforeT.commercial_state;
  afterT.go.entry_state = beforeT.go.entry_state;
  const ap = afterT.profiles['glp-clinic-scout'], bp = beforeT.profiles['glp-clinic-scout'];
  delete ap.canonical_identity; ap.wired = bp.wired;
  for (const surface of ['compare','quiz','calculator','go']) {
    if (ap.surfaces[surface] !== false || ap.exceptions[surface]?.authority_sha256 !== holdHash)
      throw new Error('go_price_basis_telos_surface_invalid');
    ap.surfaces[surface] = bp.surfaces[surface];
    if (bp.exceptions[surface]) ap.exceptions[surface] = bp.exceptions[surface]; else delete ap.exceptions[surface];
  }
  if (!equal(afterT,beforeT)) throw new Error('go_price_basis_telos_noncommercial_drift');
  restored.programs[telosIndex] = structuredClone(t.before_program);
  restored.programs.splice(aliasIndex,1);
  return restored;
}
