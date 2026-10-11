import { readFileSync, existsSync } from 'node:fs';
import { loadProviderPageContracts } from '../src/provider-cta-contract.mjs';
import { loadGoPromotionAuthority } from '../src/go-runtime-selection.mjs';
import { assertAffiliateReviewPublishable } from '../src/affiliate-review-publish-gate.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const registry=JSON.parse(readFileSync(path.join(root,'data/program-registry.json')));
const contracts=loadProviderPageContracts(root).providers;
const money=JSON.parse(readFileSync(path.join(root,'data/money-page-specs.json'))).pages.flatMap(p=>p.rows);
const authority=loadGoPromotionAuthority(root).programs;
let count=0;
for(const program of registry.programs) {
  if(!program.review_path) continue;
  const file=path.join(root,'public',program.review_path,'index.html');
  if(!existsSync(file)) continue;
  const contract=contracts.find(p=>p.program_id===program.program_id);
  const approval=authority[program.program_id];
  const row=contract?.row_contract || money.find(r=>[program.program_id,program.review_slug].includes(r.program_id)) || {};
  const review={program_id:program.program_id,row,fastpath_contract:contract};
  assertAffiliateReviewPublishable(review,program,approval,readFileSync(file,'utf8'));
  count++;
}
console.log(JSON.stringify({status:'PASS',review_pages_checked:count,tracking_visits:0}));
