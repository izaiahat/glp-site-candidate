import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSponsorInventory} from '../src/sponsor-inventory.mjs';
import shippedInventory from '../data/sponsor-inventory.json' with {type:'json'};
test('shipped resources are approved while paid inventory stays empty',()=>{
 assert.equal(shippedInventory.selection,null);
 assert.deepEqual(shippedInventory.orders,[]);
 assert.equal(Object.keys(renderSponsorInventory(shippedInventory).pages).length,2);
});
const approval={status:'approved',decision:'OPERATOR-DECISION-20261014-grill-day-plan',scope:'rate-card-and-example-only'};
test('approved public resources do not select a live sponsor',()=>{
 const result=renderSponsorInventory({schema:'glp327_sponsor_inventory_v1',selection:null,orders:[],public_resources:approval});
 assert.equal(result.order,null);
 assert.deepEqual(Object.keys(result.pages).sort(),['sponsors/example-provider/index.html','sponsors/rates/index.html']);
 assert.match(result.pages['sponsors/rates/index.html'],/\$750/);
 assert.match(result.pages['sponsors/example-provider/index.html'],/Template only. No provider is being promoted/);
});
test('public approval never authorizes a paid inventory selection',()=>{
 const inventory={schema:'glp327_sponsor_inventory_v1',selection:{slot:'providers-directory-panel',order_reference:'UNPAID'},orders:[],public_resources:approval};
 assert.throws(()=>renderSponsorInventory(inventory),/Missing, duplicate or mismatched/);
});
test('incorrect public approval stays refused',()=>{
 for(const value of [true,{}, {...approval,status:'pending'},{...approval,scope:'paid-order'}])
 assert.throws(()=>renderSponsorInventory({schema:'glp327_sponsor_inventory_v1',selection:null,orders:[],public_resources:value}),/Exact public-resource approval/);
});
