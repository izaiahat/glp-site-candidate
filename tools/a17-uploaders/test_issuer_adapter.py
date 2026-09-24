"""A17 local SQLite issuer integration; synthetic data only."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

class IssuerAdapterTests(unittest.TestCase):
    def test_resolver_exists_and_reads_full_records_without_rewriting(self):
        self.assertTrue((ROOT/'issuer_adapter.py').exists(), 'authoritative resolver missing')
        adapter = load('adapter_test', 'issuer_adapter.py')
        with tempfile.TemporaryDirectory() as directory:
            dbpath = Path(directory)/'issuer.sqlite'
            with sqlite3.connect(dbpath) as db:
                db.executescript('CREATE TABLE a6_platform_event_permissions(evidence_ref TEXT, permission_json TEXT); CREATE TABLE a6_advertising_consent_receipts(receipt_id TEXT, consent_json TEXT); CREATE TABLE a17_issuer_probes(probe_ref TEXT, probe_json TEXT); CREATE TABLE a17_issuer_revocations(subject_ref TEXT, permission_ref TEXT, epoch INTEGER);')
            resolver = adapter.StagingIssuerResolver(dbpath, clock=lambda:1800000000000)
            with self.assertRaises(ValueError):
                resolver.resolve_current('meta', 'TEST_MISSING', 'TEST_MISSING', '0'*64)
            self.assertEqual(resolver.now_ms(), 1800000000000)

    def test_full_issued_permission_preserved_through_actual_both_uploaders(self):
        from issuer_adapter import StagingIssuerResolver
        from synthetic_fixture import actual_fixture as fixture
        from send_proof import canonical_sha256
        for platform in ('meta', 'microsoft'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)/'issuer.sqlite'
                row, now, setup, records = fixture(platform, path)
                resolver = StagingIssuerResolver(path, clock=lambda:now)
                before = canonical_sha256(records['permission'])
                if platform == 'meta':
                    module = load('a17_meta_positive', 'meta/sender.py')
                    payload = module.build_request(row, now=now//1000, offline=True, resolver=resolver)
                    self.assertEqual(payload['data'][0]['event_name'], 'TEST_A12_Meta_B2BInquiry')
                else:
                    from datetime import datetime, timezone
                    module = load('a17_ms_positive', 'microsoft/uploader.py')
                    payload = module.prepare(row, setup, datetime.fromtimestamp(now/1000, timezone.utc), resolver=resolver)
                    self.assertEqual(payload['body']['OfflineConversions'][0]['ConversionName'], 'TEST_A12_Microsoft_B2BInquiry')
                fresh = resolver.resolve_current(platform, row['proof']['permission_ref'], row['probe_ref'], row['proof']['consent_receipt_id'])
                self.assertEqual(before, canonical_sha256(fresh['permission']))
                self.assertEqual(fresh['permission']['status'], 'ELIGIBLE')
                self.assertEqual(row['permission_sha256'], before)

    def test_authenticated_consumer_source_cannot_be_relabelled_b2b(self):
        from issuer_adapter import StagingIssuerResolver
        from synthetic_fixture import actual_fixture as fixture
        from send_proof import canonical_sha256
        for platform in ('meta', 'microsoft'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)/'issuer.sqlite'
                row, now, setup, records = fixture(platform, path)
                p,c,b = (records[k] for k in ('permission','consent','probe'))
                # All hashes coherent: only underlying authoritative source is wrong.
                p['source_type'] = 'synthetic_go_probe'
                b['source_kind'] = 'TEST_CONSUMER_AFFILIATE_CLICK'
                row['permission_sha256'] = c['permission_sha256'] = b['permission_sha256'] = canonical_sha256(p)
                b['consent_sha256'] = canonical_sha256(c)
                if platform == 'microsoft': row['event_permission'] = canonical_sha256(p)
                with sqlite3.connect(path) as db:
                    db.execute('UPDATE a6_platform_event_permissions SET permission_json=?', (json.dumps(p),))
                    db.execute('UPDATE a6_advertising_consent_receipts SET consent_json=?', (json.dumps(c),))
                    db.execute('UPDATE a17_issuer_probes SET probe_json=?', (json.dumps(b),))
                resolver = StagingIssuerResolver(path, clock=lambda:now)
                with self.assertRaises(ValueError):
                    if platform == 'meta':
                        load('a17_meta_laundering', 'meta/sender.py').build_request(row, now=now//1000, offline=True, resolver=resolver)
                    else:
                        from datetime import datetime, timezone
                        load('a17_ms_laundering', 'microsoft/uploader.py').prepare(row, setup, datetime.fromtimestamp(now/1000, timezone.utc), resolver=resolver)

    def test_current_consent_notice_must_match_permission(self):
        from issuer_adapter import StagingIssuerResolver
        from synthetic_fixture import actual_fixture as fixture
        from send_proof import canonical_sha256
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'issuer.sqlite'
            row,now,setup,records=fixture('meta',path)
            records['consent']['notice_sha256']='f'*64
            records['probe']['consent_sha256']=canonical_sha256(records['consent'])
            with sqlite3.connect(path) as db:
                db.execute('UPDATE a6_advertising_consent_receipts SET consent_json=?',(json.dumps(records['consent']),))
                db.execute('UPDATE a17_issuer_probes SET probe_json=?',(json.dumps(records['probe']),))
            with self.assertRaises(ValueError):
                load('a17_notice','meta/sender.py').build_request(row,now=now//1000,offline=True,resolver=StagingIssuerResolver(path,clock=lambda:now))

    def test_actual_node_issuer_records_reach_both_native_payloads(self):
        import subprocess
        from issuer_adapter import StagingIssuerResolver
        from synthetic_fixture import META, MS
        from datetime import datetime, timezone
        for platform in ('meta','microsoft'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); input=root/'input.json'; database=root/'issuer.sqlite'; output=root/'issued.json'
                input.write_text(json.dumps(META.fixture() if platform=='meta' else MS.fixture()))
                proc=subprocess.run(['node','--disable-warning=ExperimentalWarning',str(ROOT/'issue_fixture.mjs'),platform,str(input),str(database),str(output)],capture_output=True,text=True)
                self.assertEqual(proc.returncode,0,proc.stderr)
                issued=json.loads(output.read_text()); row=issued['row']; now=issued['now']
                resolver=StagingIssuerResolver(database,clock=lambda:now)
                try:
                    if platform=='meta':
                        payload=load('node_meta','meta/sender.py').build_request(row,now=now//1000,offline=True,resolver=resolver)
                        self.assertEqual(payload['data'][0]['event_name'],'TEST_A12_Meta_B2BInquiry')
                    else:
                        setup=MS.inventory();setup['offline_goals']['ConversionGoals'][0]['Name']=row['goal_name']
                        payload=load('node_ms','microsoft/uploader.py').prepare(row,setup,datetime.fromtimestamp(now/1000,timezone.utc),resolver=resolver)
                        self.assertEqual(payload['body']['OfflineConversions'][0]['ConversionValue'],0)
                except ValueError as error:
                    self.fail('actual issuer record rejected: '+str(error))

if __name__ == '__main__': unittest.main(verbosity=2)
