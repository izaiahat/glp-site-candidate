// Editorial scoring and comparison ranking have different contracts. A
// capture-bound editorial review can deliberately withhold a comparable score;
// this never changes the deterministic ranking input used by comparisons.
export function explicitlyUnscoredReview(contract) {
 const row=contract?.row_contract, captures=contract?.source_capture_bindings;
 if(!captures || !row || !Object.hasOwn(row,'score') || row.score!==null)return false;
 const entries=Object.entries(captures);
 if(entries.length<2 || entries.some(([url,c])=>!/^https:\/\//.test(url)
    || !/^[a-f0-9]{64}$/.test(c?.raw_capture_sha256 || '')
    || !/^[a-f0-9]{64}$/.test(c?.bundle_sha256 || ''))
    || !row.criteria_scores || Object.keys(row.criteria_scores).length)throw Error('unscored_review_contract_invalid');
 return true;
}
