import { execFileSync } from 'node:child_process';
import { runEmailScheduler } from '../workers/email-scheduler.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// One documented REST batch request; uncertain responses are never retried and
// cannot arm a follow-up. D1's Worker binding supplies the native transaction.
export function manualD1(token, fetchImpl = fetch) {
  const endpoint='https://api.cloudflare.com/client/v4/accounts/f860943dff399ffb1db0a28dcd3dadfd/d1/database/bcb91d2d-c3f1-4c55-93e3-070587e86d60/query';
  const query=async(payload, count)=>{
    const response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const body=await response.json();
    if (!response.ok || body.success!==true || !Array.isArray(body.result) || body.result.length!==count || body.result.some(row=>row?.success!==true)) throw new Error('manual_d1_query_failed');
    return body.result;
  };
  return {
    prepare(sql) { return { bind(...params) {
      const statement={sql,params};
      const run=async()=> (await query(statement,1))[0];
      return {statement,run,all:run,first:async()=>((await run()).results||[])[0]||null};
    } }; },
    batch(statements) { return query({batch:statements.map(item=>item.statement)},statements.length); },
  };
}

// Registered manual entry invokes the same deployed-source function, never a
// parallel sender. Credentials are injected by the host's approved secret reader.
// Without --execute the normal runtime gate returns HELD before any D1 request.
if (resolve(process.argv[1] || '')===fileURLToPath(import.meta.url)) {
const execute = process.argv.includes('--execute');
const env = execute ? { ...process.env } : {};
if (execute && (execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==env.ONBOARDING_SOURCE_HEAD || execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())) throw new Error('onboarding_manual_exact_clean_head_required');
if (execute) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.RESEND_API_KEY || !/^[a-f0-9]{40}$/.test(env.ONBOARDING_SOURCE_HEAD || '')) throw new Error('manual_runtime_credentials_or_source_missing');
  env.EMAIL_DB = manualD1(env.CLOUDFLARE_API_TOKEN);
}
const result=await runEmailScheduler(env);
if (result.status!=='PASS') process.exitCode=2;
}
