#!/usr/bin/env python3
"""Archive exact pre-append Git inputs for historical tests; never used in builds."""
import base64, gzip, hashlib, json, pathlib, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='c5154618dae0f62e16db9543788f36c3bdbed7b7'
FILES=['program-registry.json','program-content-ledger.json','provider-page-contracts.json','provider-fastpath-contract.json','quiz-config.json','go-runtime-promotion-authority.json']
rows={}
for name in FILES:
 raw=subprocess.check_output(['git','show',f'{BASE}:data/{name}'],cwd=ROOT)
 rows[name]={'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}
payload=json.dumps({'git_commit':BASE,'files':rows},sort_keys=True,separators=(',',':')).encode()
packed=gzip.compress(payload,mtime=0)
(ROOT/'tests/fixtures/provider-append-predecessor.json.gz').write_bytes(packed)
print(json.dumps({'base':BASE,'archive_sha256':hashlib.sha256(packed).hexdigest(),'files':{n:r['sha256'] for n,r in rows.items()}}))
