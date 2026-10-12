import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeProviderPriceAppend,projectProviderPriceAppend,refreshProviderPriceAppendEvidence} from '../src/provider-price-append.mjs';
import {createHash} from 'node:crypto';
import {renameSync} from 'node:fs';
import {historicalPriceIndexRegistry} from '../src/price-index-historical-registry.mjs';
import {frozenPriceLedger} from '../src/price-index-nonprice-binding.mjs';
import {historicalAffiliateRegistry} from '../src/affiliate-relationship-sync.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.includes('--refresh-evidence')) {
 const target=path.join(root,'data/provider-price-append.json');
 const registryPath=path.join(root,'data/program-registry.json');
 const original=readFileSync(target), current=readFileSync(registryPath), pair=JSON.parse(original);
 if(pair.schema!=='glp.provider-price-append-pair.v1')throw Error('append_pair_invalid');
 const registry=JSON.parse(current);
 pair.registry=refreshProviderPriceAppendEvidence(Buffer.from(JSON.stringify(historicalAffiliateRegistry(registry))),pair.registry);
 const successor=Buffer.from(JSON.stringify(pair,null,2)+'\n');
 const reader=ref=>path.resolve(ref instanceof URL?fileURLToPath(ref):String(ref))===target?successor:readFileSync(ref);
 // Original historical whole-body gates, not a new baseline or waived oracle.
 historicalPriceIndexRegistry(registry,undefined,reader);
 if(!readFileSync(target).equals(original)||!readFileSync(registryPath).equals(current))throw Error('append_refresh_input_drift');
 const staged=target+'.refresh.tmp';writeFileSync(staged,successor);renameSync(staged,target);
 const sha=x=>createHash('sha256').update(x).digest('hex');
 console.log(JSON.stringify({status:'PASS_EVIDENCE_APPEND_SUCCESSOR',before_sha256:sha(original),after_sha256:sha(successor),predecessor_sha256:pair.registry.predecessor_sha256,ledger_unchanged:true,historical_oracles:'UNCHANGED_PASS'}));
} else {
const arg=process.argv.indexOf('--base');
if(arg<0||!/^[a-f0-9]{40}$/.test(process.argv[arg+1]||''))throw Error('exact_git_base_required');
const base=process.argv[arg+1], ids=['rightwell-review','willow-review','ivim-health-review','tyde-wellness-review','feelgood-review','instarx-review','retaclinic-review'];
const get=(name)=>execFileSync('git',['show',`${base}:data/${name}`],{cwd:root,maxBuffer:20*1024*1024});
const prior=JSON.parse(get('provider-price-append.json'));
if(prior.schema!=='glp.provider-price-append-pair.v1')throw Error('predecessor_pair_missing');
// Authenticate the actual earlier append before reconstructing its predecessor.
// The original price oracles below remain unchanged and run on that exact input.
const oldRegistry=projectProviderPriceAppend(Buffer.from(JSON.stringify(historicalAffiliateRegistry(JSON.parse(get('program-registry.json'))))),prior.registry,'registry');
const currentRegistry=Buffer.from(JSON.stringify(historicalAffiliateRegistry(JSON.parse(readFileSync(path.join(root,'data/program-registry.json'))))));
const oldLedger=projectProviderPriceAppend(get('program-content-ledger.json'),prior.ledger,'ledger'), currentLedger=readFileSync(path.join(root,'data/program-content-ledger.json'));
// Authentic historical source must pass the original whole-body/ledger gates.
historicalPriceIndexRegistry(JSON.parse(oldRegistry));
frozenPriceLedger(oldLedger,readFileSync(path.join(root,'data/price-index-frozen-content-ledger.json')),JSON.parse(readFileSync(path.join(root,'data/price-index-nonprice-binding.json'))));
const pair={schema:'glp.provider-price-append-pair.v1',registry:makeProviderPriceAppend(oldRegistry,currentRegistry,'registry',ids),ledger:makeProviderPriceAppend(oldLedger,currentLedger,'ledger',ids)};
writeFileSync(path.join(root,'data/provider-price-append.json'),JSON.stringify(pair,null,2)+'\n');
console.log(JSON.stringify({status:'PAIRED_APPEND_DERIVED',base,added_ids:ids,historical_oracles:'UNCHANGED_PASS'}));
}
