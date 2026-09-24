"""TEST SUPPORT ONLY. Explicit local synthetic issuance, never imported by runtime.

Legacy source codecs retained for A6 payload compatibility. No input row can call
this fixture constructor through an uploader CLI or issuer endpoint.
"""
import json
from pathlib import Path
import sqlite3
from test_issuer_adapter import load
from fictional_proof_support import attach, sha, source_digest
from issuer_adapter import VALIDATOR

META = load('fixture_meta', 'meta/test_sender.py')
MS = load('fixture_ms', 'microsoft/test_uploader.py')

def actual_fixture(platform, database):
    """Issue permission/consent through actual Node staged issuer, export DB."""
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory); source=root/'source.json'; output=root/'issued.json'
        source.write_text(json.dumps(META.fixture() if platform=='meta' else MS.fixture()))
        completed=subprocess.run(['node','--disable-warning=ExperimentalWarning',str(Path(__file__).parent/'issue_fixture.mjs'),platform,str(source),str(Path(database).resolve()),str(output)],capture_output=True,text=True)
        if completed.returncode:
            raise RuntimeError('STAGED_ISSUER_FIXTURE_FAILED: '+completed.stderr)
        issued=json.loads(output.read_text())
    setup=None if platform=='meta' else MS.inventory()
    if setup:
        setup['offline_goals']['ConversionGoals'][0]['Name']='TEST_A12_Microsoft_B2BInquiry'
    return issued['row'],issued['now'],setup,issued['records']


def fixture(platform, database):
    if platform == 'meta':
        row, now, setup = META.fixture(), META.NOW*1000, None
    else:
        row, now, setup = MS.fixture(), int(MS.NOW.timestamp()*1000), MS.inventory()
        row['goal_name'] = 'TEST_A12_Microsoft_B2BInquiry'
        setup['offline_goals']['ConversionGoals'][0]['Name'] = row['goal_name']
        row['commission_minor'] = 0  # administrative inquiry has no affiliate revenue
        row['click']['capture_source'] = 'synthetic_owned_b2b_inquiry_fixture'
    # Construct a NEW full synthetic record before issuance; never adapt a stored
    # issued permission to a legacy subset or rehash a real permission.
    seed = attach(row, platform, now)
    p, c, b = (seed.snapshot[k] for k in ('permission', 'consent', 'probe'))
    if platform == 'meta':
        for record in (p,c,b,row['proof']): record['target_id']='TEST_A17_META_DATASET'
    p.update(status='ELIGIBLE', issuer_id='TEST_ISSUER', reviewer_id='TEST_REVIEWER',
             source_type='owned_b2b_inquiry', event_definition='TEST_SYNTHETIC_ADMINISTRATIVE_INQUIRY_NOT_CONSUMER',
             ownership_evidence_ref='TEST_OWNERSHIP', lawful_basis_review_ref='TEST_LAWFUL_BASIS',
             notice_version='TEST_NOTICE_V1', notice_sha256=sha('TEST_NOTICE'),
             retention_policy_ref='TEST_RETENTION', erasure_owner='TEST_ERASURE_OWNER',
             transport_contract_ref='TEST_LOCAL_ONLY', payload_schema_sha256=sha(p['allowed_payload_fields']),
             tos_refs=[dict(source_id='TEST_TOS', requested_url='https://tos.invalid',final_url='https://tos.invalid',retrieved_on='2026-09-09',effective_date=None,version_label='NOT_OBSERVED',captured_sha256=sha('TEST_TOS'),scope_review_ref='TEST_SCOPE',account_acceptance_ref='TEST_FICTIONAL_ACCEPTANCE_NOT_PLATFORM_APPROVAL',reviewed_at_ms=now-600000)])
    c.update(schema='a12-advertising-consent-v1',receipt_id=sha('TEST_RECEIPT_'+platform),version='TEST_V1',issuer_id=p['issuer_id'],notice_version=p['notice_version'],notice_sha256=p['notice_sha256'],choice_at_ms=now-500000)
    c['permission_sha256'] = sha(p)
    b.update(permission_sha256=sha(p),consent_receipt_id=c['receipt_id'],consent_sha256=sha(c),source_sha256=source_digest(row),source_kind='TEST_SERVER_OWNED_ADMINISTRATIVE_INQUIRY')
    row.update(permission_sha256=sha(p))
    row['proof']['consent_receipt_id'] = c['receipt_id']
    if platform == 'microsoft': row['event_permission'] = sha(p)
    VALIDATOR.validate(p); VALIDATOR.validate(c)
    with sqlite3.connect(database) as db:
        db.executescript('CREATE TABLE IF NOT EXISTS a6_platform_event_permissions(evidence_ref TEXT PRIMARY KEY, permission_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS a6_advertising_consent_receipts(receipt_id TEXT PRIMARY KEY, consent_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS a17_issuer_probes(probe_ref TEXT PRIMARY KEY, probe_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS a17_issuer_revocations(subject_ref TEXT, permission_ref TEXT, epoch INTEGER);')
        for table, record in [('a6_platform_event_permissions',p),('a6_advertising_consent_receipts',c),('a17_issuer_probes',b)]:
            key = p['evidence_ref'] if table.endswith('permissions') else c['receipt_id'] if table.endswith('receipts') else b['probe_ref']
            db.execute('INSERT INTO '+table+' VALUES (?,?)', (key,json.dumps(record)))
    return row, now, setup, dict(permission=p,consent=c,probe=b)
