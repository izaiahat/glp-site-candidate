import test, {after} from 'node:test';
import {deriveTrackingFixture} from './helpers/derive-tracking-fixture.mjs';
import {resetTrackingAllowedHostsCache} from '../src/tracking-allowed-hosts.mjs';
import assert from 'node:assert/strict';
import { completeGoAuthority } from './fixtures/complete-go-authority.mjs';
import {resolveCardOutbound} from '../src/card-outbound.mjs';
import {parseGoQuery} from '../src/worker.mjs';

const program=id=>({program_id:id,commercial_state:'live',go:{entry_state:'transparent_direct',route:'/go/'+id},profiles:{'glp-clinic-scout':{vertical_fit:true,wired:true,surfaces:{compare:true,go:true}}}});
const rail=deriveTrackingFixture(['trt-nation','orderlymeds','direct-meds','fixture-routed','network-123']);
const priorDocument=process.env.GLP_TRACKING_ALLOWED_HOSTS_DOCUMENT;
process.env.GLP_TRACKING_ALLOWED_HOSTS_DOCUMENT=rail.output;
resetTrackingAllowedHostsCache();
after(()=>{if(priorDocument===undefined)delete process.env.GLP_TRACKING_ALLOWED_HOSTS_DOCUMENT;else process.env.GLP_TRACKING_ALLOWED_HOSTS_DOCUMENT=priorDocument;resetTrackingAllowedHostsCache();rail.cleanup();});
const link={live:true,affiliate_href:`https://${rail.document.programs['fixture-routed'].allowed_hosts[0]}/exact?opaque=CaseSensitive%2FToken`,network:'CJ'};
const originalHref=link.affiliate_href;
const fixture={programs:Object.fromEntries(['trt-nation','orderlymeds','direct-meds','fixture-routed','network-123'].map(id=>[id,completeGoAuthority(program(id),link)]))};
const input=id=>({program:program(id),affiliate:link,promotionAuthority:fixture,pageSlug:'mounjaro',position:'provider-card',rankPosition:2});
for(const id of ['trt-nation','orderlymeds','direct-meds','fixture-routed'])test(`D2l TEST-only ${id} authorization state controls routing; no identity allowlist`,()=>{
 const args=input(id),go=resolveCardOutbound(args);
 assert.equal(go.mode,'go');assert.equal(go.href,'/go/'+id+'?s=mounjaro.pc2&v=a');assert.equal(go.f08Key,'mounjaro.pc2');
 assert.equal(parseGoQuery(new URL(go.href,'https://site.invalid')).surface,go.f08Key);
 for(const authority of [{programs:{}},{programs:{[id]:{...fixture.programs[id],status:'WITHHELD'}}},...['promotion_authorized','constructor_verified','redirector_tos_verified'].map(key=>({programs:{[id]:{...fixture.programs[id],[key]:false}}}))]){
  const direct=resolveCardOutbound({...args,promotionAuthority:authority});assert.equal(direct.mode,'transparent_direct');assert.equal(direct.href,link.affiliate_href);
 }
 assert.equal(link.affiliate_href,originalHref);
});
test('D2l exact canonical identity and route, with canonical-key precedence',()=>{
 const p={...program('network-123'),review_slug:'fixture-routed',go:{entry_state:'transparent_direct',route:'/go/fixture-routed'}};
 const aliasOnly={programs:{'fixture-routed':fixture.programs['fixture-routed']}};
 assert.equal(resolveCardOutbound({...input('fixture-routed'),program:p,promotionAuthority:aliasOnly}).mode,'transparent_direct');
 assert.equal(resolveCardOutbound({...input('fixture-routed'),program:p}).mode,'go');
 assert.equal(resolveCardOutbound({...input('fixture-routed'),program:p,promotionAuthority:{programs:{...fixture.programs,'network-123':{status:'WITHHELD'}}}}).mode,'transparent_direct');
 assert.throws(()=>resolveCardOutbound({...input('fixture-routed'),program:{...p,go:{...p.go,route:'/go/wrong-id'}}}),/route_identity_invalid/);
});
test('D2l safety holds cannot be upgraded by promotion data',()=>{
 for(const state of ['held','excluded','pending'])assert.equal(resolveCardOutbound({...input('fixture-routed'),program:{...program('fixture-routed'),commercial_state:state}}).mode,'held');
 const a=input('fixture-routed');a.program.go.entry_state='held';assert.equal(resolveCardOutbound(a).mode,'held');
 a.program.profiles['glp-clinic-scout'].exceptions={go:{enabled:true,surface_restriction_basis:'operator_terms_transparent_direct_only'}};
 assert.equal(resolveCardOutbound(a).mode,'transparent_direct');
 assert.equal(resolveCardOutbound({...input('fixture-routed'),affiliate:{...link,live:false}}).mode,'held');
});
test('D2l malformed F08 assignment fails rather than normalizing source values',()=>{
 for(const override of [{rankPosition:0},{rankPosition:1.5},{pageSlug:'mounjaro?gclid=bad'},{position:'UNKNOWN'}])assert.throws(()=>resolveCardOutbound({...input('fixture-routed'),...override}),/assignment_invalid/);
});
