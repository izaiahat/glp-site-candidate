import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {candidateSharedRuntime} from '../src/candidate-export-policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
// Source-transform fixture from inherited rendered page, NOT a fresh build.
const inherited=readFileSync(root+'public/reviews/coivas/index.html','utf8').replace(/<script data-candidate-export-policy>[\s\S]*?<\/script>/,'');
for(const stage of ['candidate','production-seal'])test('READY6 AST gate executes non-noop negative controls: '+stage,()=>{
 const html=candidateSharedRuntime(inherited,{stage});
 const code=`import ast,json,copy,os,re,sys
from pathlib import Path
from html.parser import HTMLParser
root=Path(${JSON.stringify(root)})
source=root/'scripts/validate-ready6-static.py'
module=ast.parse(source.read_text()); selected=[n for n in module.body if getattr(n,'name',None) in ('candidate_inline_allowed','Document')]
assert len(selected)==2
scope={'HTMLParser':HTMLParser,'os':os,'json':json,'re':re};exec(compile(ast.Module(body=selected,type_ignores=[]),str(source),'exec'),scope)
p=scope['Document']();p.feed(sys.stdin.read())
scripts=[s for s in p.scripts if not s['attrs'].get('src') and s['attrs'].get('type')!='application/ld+json']
valid=scope['candidate_inline_allowed'];assert valid(scripts),'source-transformed positive'
controls=[]
flag='true' if os.environ['GCS_RELEASE_STAGE']=='production-seal' else 'false'
other='false' if flag=='true' else 'true'
for label in ('missing_policy','duplicate_policy','wrong_attribute','flip_exports','flip_analytics','flip_posthog','enable_unbound_clarity','legacy_gtm','extra_script'):
 s=copy.deepcopy(scripts)
 if label=='missing_policy':s.pop(0)
 elif label=='duplicate_policy':s.insert(0,copy.deepcopy(s[0]))
 elif label=='wrong_attribute':s[0]['attrs']['src']='https://example.invalid/control'
 elif label=='flip_exports':s[0]['parts']=[x.replace('third_party_exports":'+flag,'third_party_exports":'+other)for x in s[0]['parts']]
 elif label=='flip_analytics':s[1]['parts']=[x.replace('GCS_ANALYTICS={enabled:'+flag,'GCS_ANALYTICS={enabled:'+other,1)for x in s[1]['parts']]
 elif label=='flip_posthog':s[1]['parts']=[x.replace('GCS_POSTHOG={"enabled":'+flag,'GCS_POSTHOG={"enabled":'+other)for x in s[1]['parts']]
 elif label=='enable_unbound_clarity':s[1]['parts']=[x.replace('GCS_CLARITY={enabled:false','GCS_CLARITY={enabled:true')for x in s[1]['parts']]
 elif label=='legacy_gtm':s[2]['parts'].append('googletagmanager.com/gtm.js')
 else:s.append({'attrs':{},'parts':['fetch("https://example.invalid/")']})
 assert s!=scripts,'NO-OP '+label
 assert not valid(s),label
 controls.append(label)
print(json.dumps({'stage':os.environ['GCS_RELEASE_STAGE'],'source_transformed_positive':True,'rejected_non_noop':controls}))`;
 const r=spawnSync('python3',['-B','-c',code],{cwd:root,env:{...process.env,GCS_RELEASE_STAGE:stage},input:html,encoding:'utf8',timeout:10000});
 assert.equal(r.status,0,r.stderr);const proof=JSON.parse(r.stdout);assert.equal(proof.source_transformed_positive,true);assert.equal(proof.rejected_non_noop.length,9);console.log(JSON.stringify(proof));
});
test('P27 stage projection retains the embedded PostHog key without inventing consent',()=>{
 const key=html=>html.match(/window\.GCS_POSTHOG=\{[^<]*?["']api_key["']:["']([^"']+)["']/)?.[1];assert.match(key(inherited)||'',/^phc_[A-Za-z0-9]{10,}$/);
 for(const stage of ['candidate','production-seal']){const html=candidateSharedRuntime(inherited,{stage});assert.equal(key(html),key(inherited));assert.match(html,/window\.GCS_ANALYTICS=\{enabled:(?:true|false),consent:'unknown'/)}
});
