import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApprovedProviderDomainMap} from '../src/approved-provider-domains.mjs';
import {loadAffiliateLinkMap} from '../src/affiliate-link-map.mjs';
test('domain audit shares exact current renderer hrefs',()=>{
 const domains=loadApprovedProviderDomainMap();
 const links=loadAffiliateLinkMap('compare');
 for(const [id,link] of Object.entries(links)) {
  if(link.live) assert.ok(domains.programs.get(id).monetized_hrefs.includes(link.affiliate_href),id);
 }
});
