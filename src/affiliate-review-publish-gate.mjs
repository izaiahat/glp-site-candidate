import { parse } from 'parse5';

function anchors(html) {
  const result=[];
  const visit=node=>{ const attrs=Object.fromEntries((node.attrs||[]).map(a=>[a.name,a.value])); if(['script','style','template','noscript'].includes(node.tagName) || Object.hasOwn(attrs,'hidden') || attrs['aria-hidden']==='true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style||'')) return; if(node.tagName==='a') result.push(attrs); for(const child of node.childNodes||[]) visit(child); };
  visit(parse(html)); return result;
}

function visibleText(html) {
  const texts=[];
  const visit=node=>{const attrs=Object.fromEntries((node.attrs||[]).map(a=>[a.name,a.value])); if(['script','style','template','noscript'].includes(node.tagName)||Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style||''))return; if(node.nodeName==='#text')texts.push(node.value);for(const child of node.childNodes||[])visit(child);};
  visit(parse(html));return texts.join(' ');
}

// Current denial outranks a historical grant. Missing authority is not denial,
// and missing relationship evidence is not a non-affiliate designation.
export function assertAffiliateReviewPublishable(review, program, authority, html) {
  const id=review.program_id;
  if (!program || ![program.program_id, program.review_slug].includes(id)) throw new Error(`affiliate_review_registry_missing:${id}`);
  const own=anchors(html).filter(a=>a['data-program'] && [id, program.program_id, program.review_slug].includes(a['data-program']) && (a['data-analytics-event']==='affiliate_click'||(a.rel||'').split(/\s+/).includes('sponsored')));
  const relationship=program.affiliate_relationship_snapshot;
  const profile=program.profiles?.['glp-clinic-scout'];
  const identity=profile?.canonical_identity;
  if(identity?.role==='alias' && profile.surfaces?.go===false && profile.surfaces?.compare===false) {
    if(own.length || !anchors(html).some(a=>a.href===`/reviews/${identity.canonical_program_id}/`)) throw new Error(`canonical_alias_review_invalid:${id}`);
    return {status:'CANONICAL_ALIAS_NO_PROMOTION',program_id:id};
  }
  const held=relationship?.promotion_denied===true || (authority?.status==='WITHHELD' && authority?.promotion_authorized===false);
  if(held) {
    if(own.length) throw new Error(`held_review_has_affiliate_anchor:${id}`);
    return {status:'HELD_NO_PROMOTION',program_id:id};
  }
  if(program.affiliate_relationship==='non_affiliate' && program.prescription_provider===true) {
    if(own.length || !/non[- ]affiliate/i.test(visibleText(html)) || !/do not earn a commission from this provider/i.test(visibleText(html))) throw new Error(`non_affiliate_review_label_missing:${id}`);
    return {status:'NON_AFFILIATE_LABELED',program_id:id};
  }
  const net=review.fastpath_contract?.network_contract;
  const affiliated=relationship?.relationship_status?.startsWith('approved_active_') || net?.relationship_state==='approved_or_active' || review.row?.promotion_authorized===true;
  if(!affiliated) throw new Error(`affiliate_review_relationship_unknown:${id}`);
  const approved=authority?.disposition==='ADOPT' ? authority.issued_link : (net?.tracking_url || review.row?.affiliate_href);
  if(authority?.issued_link && authority.disposition!=='ADOPT' && authority.issued_link!==approved) throw new Error(`affiliate_review_approval_unbound:${id}`);
  if(authority?.status!=='VERIFIED'||authority.promotion_authorized!==true || !approved || review.row?.live_link_allowed!==true) throw new Error(`affiliate_review_approval_unbound:${id}`);
  let url; try {url=new URL(approved);} catch {throw new Error(`affiliate_review_url_invalid:${id}`);}
  if(url.protocol!=='https:' || url.username || url.password) throw new Error(`affiliate_review_url_invalid:${id}`);
  // Redirect selections are accepted only when the authority binds both the
  // exact issued URL and exact first-party href. No redirect is requested here.
  const surface=review.surface_code || 'reviews.rv2';
  if(!/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(surface)) throw new Error(`affiliate_review_surface_invalid:${id}`);
  const expected=authority.disposition==='ADOPT' && authority.issued_link===approved ? `${authority.route}?s=${surface}&v=a` : approved;
  const matching=own.filter(a=>a.href===expected && ['sponsored','nofollow'].every(v=>(a.rel||'').split(/\s+/).includes(v)));
  if(!matching.length || matching.length!==own.length) throw new Error(`affiliate_review_missing_approved_anchor:${id}`);
  if(!/commission/i.test(visibleText(html))) throw new Error(`affiliate_review_disclosure_missing:${id}`);
  return {status:'AFFILIATE_BOUND',program_id:id,anchors:matching.length,approved_url:approved};
}
