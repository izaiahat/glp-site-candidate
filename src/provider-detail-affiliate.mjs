// Resolve canonical registry identities onto the governed renderer link map.
// A current denial still wins; selection is never used to manufacture a link.
export function providerDetailAffiliate(program, links, selected) {
  const affiliate = links[program.review_slug || program.program_id];
  if (selected?.held === true) return affiliate ? {...affiliate,live:false,affiliate_href:null} : null;
  return affiliate || null;
}
