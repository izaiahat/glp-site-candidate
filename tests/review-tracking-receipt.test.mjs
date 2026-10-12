import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadGoPromotionAuthority} from '../src/go-runtime-selection.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url)));
test('a valid approval for a different campaign cannot authorize this provider',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'review-receipt-'));
 try {
  fs.mkdirSync(path.join(root,'data'));
  const authority=read('go-runtime-promotion-authority.json');
  const receipts=read('review-tracking-receipts.json');
  const registry=read('program-registry.json');
  const id='rightwell-review';
  const href=authority.programs[id].issued_link.replace('o=32122','o=29207');
  authority.programs[id].issued_link=href;
  authority.programs[id].tracking_link_sha256=createHash('sha256').update(href).digest('hex');
  receipts.programs[id].campaign.campaign_id=29207;
  receipts.programs[id].tracking_api_receipt.response['tracking-link']=href;
  const files={'go-runtime-promotion-authority.json':authority,'review-tracking-receipts.json':receipts,'program-registry.json':registry};
  for(const [name,value] of Object.entries(files)) fs.writeFileSync(path.join(root,'data',name),JSON.stringify(value));
  assert.throws(()=>loadGoPromotionAuthority(root),/review_tracking_receipt_unbound/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
