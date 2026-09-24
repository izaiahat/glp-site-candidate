import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
const contract=JSON.parse(readFileSync(new URL('../data/affiliati-postback-contract.json',import.meta.url)));
const source=readFileSync(new URL('../functions/api/postback/affiliati.js',import.meta.url),'utf8');
test('receiver code and shipped registration contract agree on money identity',()=>{
 for(const field of ['subid','click_id','placement']){const statement=source.split('\n').find(l=>l.includes('identity(url.searchParams.get("'+field+'")'));assert.ok(statement);assert.equal(contract.parameter_map[field].required,statement.includes('required: true'));}
 assert.match(source,/if \(!isUuidV7\(clickId\)\)/);assert.match(contract.parameter_map.subid.role,/authoritative UUIDv7/);assert.match(contract.parameter_map.click_id.role,/compatibility duplicate/);assert.match(source,/bind\(payload.clickId\)/);assert.match(contract.persistence.ownership_join,/postback.subid/);
 assert.equal(contract.required_live_proof.remote_migration_required,'migrations/007_postback_scoped_identity.sql');assert.ok(existsSync(new URL('../'+contract.required_live_proof.remote_migration_required,import.meta.url)));
 assert.equal(contract.persistence.idempotency,'network + network_account_ref + program_id + conversion_id + event_type');assert.doesNotMatch(JSON.stringify(contract),/s1_s2_mismatch|subid\/#s1# is authoritative|migrations\/006_/);
});
