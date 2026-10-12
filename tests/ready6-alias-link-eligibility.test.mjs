import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderReady6ReviewPage} from '../src/ready6-editorial.mjs';
import {assertAffiliateReviewPublishable} from '../src/affiliate-review-publish-gate.mjs';
const root=new URL('../',import.meta.url);
test('SHED alias retains editorial route and canonical navigation without historical affiliate CTA',async()=>{
 // Real native-model exports let hosted CI exercise the renderer without
 // requiring the private capture filesystem used by the native constructor.
 const contract=JSON.parse(readFileSync(new URL('data/ready6-editorial-contract.json',root)));
 const registry=JSON.parse(readFileSync(new URL('data/program-registry.json',root)));
 const program=registry.programs.find(p=>p.program_id==='katalys-1516');
 const canonical=registry.programs.find(p=>p.program_id==='shedrx');
 const model=JSON.parse(readFileSync(new URL('tests/fixtures/ready6-shed-alias-model.json',root)));
 assert.deepEqual(model.alias_of,{brand:canonical.display_name,route:canonical.review_path});
 assert.deepEqual(model.page,contract.programs.find(p=>p.registry_id===program.program_id).page);
 const before=JSON.stringify(model);
 const html=renderReady6ReviewPage(model);
 assert.equal(model.route,'/reviews/shed/');
 assert.ok(html.includes('href="/reviews/shedrx/"'));
 assert.match(html,/UNKNOWN exact first charge/);
 assert.equal((html.match(/data-affiliate-state="active"|class="affiliate-cta"/g)||[]).length,0);
 assert.equal(html.includes(model.cta.href),false);
 assert.equal(assertAffiliateReviewPublishable({program_id:program.program_id,row:{affiliate_href:model.cta.href}},program,undefined,html).status,'CANONICAL_ALIAS_NO_PROMOTION');
 assert.equal(JSON.stringify(model),before,'historical model is not mutated');
 const sibling=JSON.parse(readFileSync(new URL('tests/fixtures/ready6-coivas-model.json',root)));
 assert.deepEqual(sibling.page,contract.programs.find(p=>p.registry_id===sibling.registry_id).page);
 assert.match(renderReady6ReviewPage(sibling),/data-affiliate-state="active"/);
});
