import { execFileSync } from 'node:child_process';
import { runEmailScheduler } from '../workers/email-scheduler.mjs';

// Registered manual entry invokes the same deployed-source function, never a
// parallel sender. Credentials are injected by the host's approved secret reader.
// Without --execute the normal runtime gate returns HELD before any D1 request.
const execute = process.argv.includes('--execute');
const env = execute ? { ...process.env } : {};
if (execute && (execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==env.ONBOARDING_SOURCE_HEAD || execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())) throw new Error('onboarding_manual_exact_clean_head_required');
if (execute) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.RESEND_API_KEY || !/^[a-f0-9]{40}$/.test(env.ONBOARDING_SOURCE_HEAD || '')) throw new Error('manual_runtime_credentials_or_source_missing');
  const endpoint='https://api.cloudflare.com/client/v4/accounts/f860943dff399ffb1db0a28dcd3dadfd/d1/database/bcb91d2d-c3f1-4c55-93e3-070587e86d60/query';
  env.EMAIL_DB = { prepare(sql) { return { bind(...params) {
    const query=async()=>{
      const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
      const body=await response.json();
      if (!response.ok || !body.success || body.result?.[0]?.success===false) throw new Error('manual_d1_query_failed');
      return body.result[0];
    };
    return {run:query,all:query,first:async()=>((await query()).results||[])[0]||null};
  } }; } };
}
const result=await runEmailScheduler(env);
if (result.status!=='PASS') process.exitCode=2;
