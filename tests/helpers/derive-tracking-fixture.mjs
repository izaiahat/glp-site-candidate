// TEST ONLY: derive rail identity with the real canonical producer.
// No handmade allowlist or production authority is admitted by this helper.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export function deriveTrackingFixture(ids, network='CJ') {
  const root=mkdtempSync(join(tmpdir(),'f06-rails-fixture-'));
  mkdirSync(join(root,'data'));
  writeFileSync(join(root,'data/provider-page-contracts.json'),JSON.stringify({providers:ids.map(program_id=>({
    program_id,network_contract:{network},official_url:'https://merchant.invalid/',
    row_contract:{affiliate_href:'https://fixture.invalid/',live_link_allowed:true,promotion_authorized:true}
  }))}));
  writeFileSync(join(root,'data/money-page-specs.json'),JSON.stringify({pages:[]}));
  writeFileSync(join(root,'data/program-registry.json'),JSON.stringify({programs:[]}));
  const output=join(root,'tracking-allowed-hosts.json');
  const {GLP_PRIVATE_APPROVED_REGISTRY:_private,...env}=process.env;
  execFileSync('python3',[fileURLToPath(new URL('../../scripts/emit-tracking-allowed-hosts.py',import.meta.url)), '--root',root,'--output',output],{env,stdio:'pipe'});
  return {output,document:JSON.parse(readFileSync(output)),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
