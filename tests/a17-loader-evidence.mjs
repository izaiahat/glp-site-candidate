import {createStagedAdvertisingRuntimeSource} from '../src/advertising-staging-runtime.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const out='/home/ubuntu/business/reports/ops/orchestration-restore-20260907/PLAN/A17/loaders';
const report=JSON.parse(readFileSync(path.join(out,'playwright.json'),'utf8'));
const specs=[];function walk(suites){for(const s of suites){specs.push(...(s.specs||[]));walk(s.suites||[])}}walk(report.suites);
const rows=specs.map(s=>{
 const result=s.tests[0].results[0];if(result.status!=='passed')throw Error('nonpassing_browser_case');
 const attachment=result.attachments.find(a=>a.name==='network-storage');if(!attachment)throw Error('missing_network_storage');
 const evidence=JSON.parse(Buffer.from(attachment.body,'base64').toString('utf8'));
 return {name:s.title,status:result.status,...evidence};
});
if(rows.length!==report.stats.expected||report.stats.unexpected||report.stats.skipped||report.stats.flaky)throw Error('browser_count_mismatch');
const negative=rows.filter(r=>r.name.includes(': negative '));
for(const row of negative){for(const k of ['sdk','pageview','beacon','collector'])if(row[k]!==0)throw Error('negative_egress_'+k);for(const values of Object.values(row.storage))if(values.length!==0)throw Error('negative_storage');}
const counts=log=>Object.fromEntries([...readFileSync(path.join(out,log),'utf8').matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
const owned=['src/advertising-loaders.mjs','assets/advertising-consent-adapter.mjs','src/advertising-staging-runtime.mjs','tests/a17-loaders.test.mjs','tests/browser/a17-loaders.spec.mjs','tests/a17-loader-fixtures.mjs','tests/a17-loader-browser-helper.mjs','tests/a17-loader-evidence.mjs','playwright.a17.config.mjs'];
const participating=['src/consent-runtime.mjs','src/advertising-issuer.mjs','tests/helpers/a17-issuer-fixture.mjs','src/a12-permission-contract.mjs','migrations/009_a17_staging_issuer.sql'];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const summary={status:'PASS_STAGED_CONTAINED_BOOTSTRAP_AUTOMATIC_VENDOR_TRANSPORT_HELD',browser:{version:report.config.version,...report.stats,enumerated:rows.length,negativeCases:negative.length},unitAndD2oRegression:counts('FINAL-unit-regression.log'),ownedFiles:owned.map(p=>({path:p,sha256:hash(p)})),participatingParentFiles:participating.map(p=>({path:p,sha256:hash(p)})),networkBoundary:'Every request intercepted before navigation; service workers blocked; SDK requests fulfilled with synthetic executable artifacts; all other nonlocal or collector requests aborted. No external network passthrough.',storageBoundary:'Necessary session/consent receipt and preference cookies are separately enumerated, not advertising identifiers. Vendor cookie/localStorage/sessionStorage checks and sandbox write attempts are enumerated.',skills_loaded:['privacy-conversion-measurement','affiliate-platform-conversion-feedback','telehealth-comparison-ads-policy','static-site-playwright-e2e','test-driven-development'],skills_should_have_loaded:['privacy-conversion-measurement','affiliate-platform-conversion-feedback','telehealth-comparison-ads-policy','static-site-playwright-e2e','test-driven-development'],skills_created:[]};
mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'advertising-staged.generated.mjs'),'await '+createStagedAdvertisingRuntimeSource()+';\n');summary.stagedGeneratedAsset={path:path.join(out,'advertising-staged.generated.mjs'),sha256:hash(path.join(out,'advertising-staged.generated.mjs'))};writeFileSync(path.join(out,'NETWORK-STORAGE-EVIDENCE.json'),JSON.stringify({summary,rows},null,2)+'\n');writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({browser:summary.browser,unit:summary.unitAndD2oRegression,ownedFiles:owned.length,negativeCases:negative.length}));
