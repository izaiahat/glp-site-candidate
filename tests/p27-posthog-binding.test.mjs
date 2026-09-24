import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const build=readFileSync(new URL('../scripts/build-staging.mjs',import.meta.url),'utf8');
const start=build.indexOf('if (postHogRuntimeSource.schema'),end=build.indexOf('const INDEXNOW_KEY_PATTERN',start);
assert.ok(start>=0&&end>start,'actual PostHog validation/projection block exists');
// Execute only the producer validation block, not the build or any network code.
const project=source=>vm.runInNewContext(build.slice(start,end)+'postHogRuntimeConfig',{postHogRuntimeSource:source});
const configured=JSON.parse(readFileSync(new URL('../data/posthog-config.json',import.meta.url),'utf8'));
test('P27 producer retains the actual publishable key and approved recipient',()=>{const result=project(configured);assert.equal(result.enabled,true);assert.equal(result.api_key,configured.api_key);assert.match(result.api_key,/^phc_[A-Za-z0-9]{10,}$/);assert.equal(result.host,'https://us.i.posthog.com');assert.equal(result.project_id,'508172')});
for(const [field,value,reason]of [
 ['schema','other','schema'],['api_key','','key'],['api_key','phc_short','key'],
 ['host','https://attacker.invalid','host'],['host','https://eu.i.posthog.com','host'],
 ['project_id','999999','project'],['project_id',508172,'project'],
])test('P27 producer rejects '+reason+' '+JSON.stringify(value),()=>{assert.throws(()=>project({...configured,[field]:value}),new RegExp('posthog_runtime_'+reason+'_invalid'))});
for(const field of ['autocapture','disable_session_recording','mask_all_text','mask_all_element_attributes'])test('P27 producer retains privacy flag '+field,()=>{assert.throws(()=>project({...configured,privacy_contract:{...configured.privacy_contract,[field]:!configured.privacy_contract[field]}}),new RegExp('posthog_privacy_contract_invalid:'+field))});
