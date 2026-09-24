"""Execute local tests and dry-run artifact; bind evidence to actual bytes."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
WORK=ROOT.parents[1]
BUSINESS=WORK.parents[3]
OUT=BUSINESS/'reports/ops/orchestration-restore-20260907/PLAN/A17'

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    deps=[WORK/'src/advertising-issuer.mjs',WORK/'tests/helpers/a17-issuer-fixture.mjs',WORK/'migrations/009_a17_staging_issuer.sql']
    before={str(p):digest(p) for p in deps}
    counts={}
    for label,subdir,pattern in [('A17','', 'test_*.py'),('META-REGRESSION','meta','test_sender.py'),('MS-REGRESSION','microsoft','test_uploader.py')]:
        run=subprocess.run([sys.executable,'-m','unittest','discover','-s',str(ROOT/subdir),'-p',pattern,'-v'],capture_output=True,text=True)
        text=run.stdout+run.stderr;(OUT/'uploader'/('GREEN-'+label+'.log')).write_text(text)
        if run.returncode: raise RuntimeError(label+' tests failed; see log')
        counts[label]=int(re.search(r'Ran (\d+) tests',text)[1])
    run=subprocess.run([sys.executable,str(ROOT/'run_dryrun.py'),'--output',str(OUT/'DRYRUN-PAYLOADS.json')],capture_output=True,text=True)
    (OUT/'uploader'/'DRYRUN.log').write_text(run.stdout+run.stderr)
    if run.returncode: raise RuntimeError('dryrun failed')
    assert before=={str(p):digest(p) for p in deps},'parent dependency changed during verification'
    artifact=json.loads((OUT/'DRYRUN-PAYLOADS.json').read_text())
    assert len(artifact['payloads'])==2 and artifact['external_requests']==artifact['socket_connect_attempts']==artifact['dns_attempts']==0
    for entry in artifact['payloads']:
        canonical=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()).hexdigest()
        assert canonical(entry['payload'])==entry['payload_sha256']
        assert canonical(entry['records']['permission'])==entry['permission_sha256']
        assert canonical(entry['records']['consent'])==entry['consent_sha256']
    originals=json.loads((OUT/'uploader'/'A6-PREIMAGE.json').read_text())
    a6=OUT.parent/'A6/uploaders'
    assert all(digest(a6/name)==sha for name,sha in originals.items()),'A6 original changed'
    files={str(p.relative_to(WORK)):digest(p) for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc'}
    report={'status':'COMPLETE_LOCAL_DRYRUN','skills_loaded':['affiliate-platform-conversion-feedback','privacy-conversion-measurement','telehealth-comparison-ads-policy','test-driven-development','site-build-harness'],'skills_should_have_loaded':['affiliate-platform-conversion-feedback','privacy-conversion-measurement','telehealth-comparison-ads-policy','test-driven-development','site-build-harness'],'skills_created':[],
      'tests':counts,'total_tests':sum(counts.values()),'red_green_evidence':['RED-1.log','RED-2.log','RED-3.log','RED-4.log','RED-5.log','RED-6.log','RED-7.log'],
      'actual_parent_issuer_integrated':True,'actual_issuer_entrypoints':['issuePermission','registerSession','advertisingConsent GET/POST','authenticate/currentConsent'],
      'issuer_export':'VACUUM INTO local SQLite; full persisted permission/consent unchanged',
      'a6_originals_unchanged':True,'a6_original_file_count':len(originals),'files_sha256':files,'parent_dependency_sha256':before,
      'dryrun_artifact':str(OUT/'DRYRUN-PAYLOADS.json'),'dryrun_artifact_sha256':digest(OUT/'DRYRUN-PAYLOADS.json'),
      'payload_hashes':{e['platform']:e['payload_sha256'] for e in artifact['payloads']},
      'external_requests':0,'spend':0,'deployments':0,'platform_acceptance_observed':False,
      'interfaces':'uploader/INTERFACE.md; existing 009 probe table with disjoint kind=a17-uploader-source-v1; no new migration or outbox table needed',
      'issues_encountered':['Copied Microsoft regression expected historical relative receipt location; copied original receipt into own fixtures and adjusted copied test path.','Actual issuer uses separate permission/consent issuer IDs and TEST_ offline targets; adapter preserves these full issued records rather than synthesizing legacy subsets.','Tests exposed source envelope mutation during revalidation and missing current scope/notice checks; fixed in work copy only.'],
      'unverified':['Live administrative source producer','Real platform code/goal and eligibility','Production D1/network transport and post-final-read in-flight reconciliation','Train build/acceptance/deploy and vendor erasure'],
      'skills_suggested_to_save':['Actual issuer SQLite export into guarded local uploaders with disjoint synthetic source wrapper; parent may save under existing conversion-feedback owner.']}
    (OUT/'uploader'/'REPORT.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'total_tests':report['total_tests'],'tests':counts,'payload_hashes':report['payload_hashes'],'report':str(OUT/'uploader'/'REPORT.json'),'originals_unchanged':True},indent=2))
if __name__=='__main__':main()
