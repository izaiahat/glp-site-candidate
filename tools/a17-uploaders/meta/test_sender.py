"""Only synthetic offline data. No sockets or credential adapters needed."""
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('meta_sender', HERE / 'sender.py')
S = importlib.util.module_from_spec(SPEC) if (HERE / 'sender.py').exists() else None
if S:
    SPEC.loader.exec_module(S)
NOW = 1800000000
from fictional_proof_support import attach

def fictional_build(row, **kwargs):
    resolver = attach(row, 'meta', NOW*1000)
    return S.build_request(row, resolver=resolver, **kwargs)

def fictional_dispatch(row, **kwargs):
    resolver = attach(row, 'meta', NOW*1000)
    return S.dispatch(row, resolver=resolver, **kwargs)


def fixture():
    return {
        'schema': 'a6-meta-test-v1', 'record_kind': 'TEST',
        'provenance': 'SYNTHETIC_OFFLINE_FIXTURE',
        'semantic_key': 'offline_administrative_test_v1',
        'occurrence_id': '00000000-0000-4000-8000-000000000001',
        'click_id': '00000000-0000-4000-8000-000000000002',
        'event_time': NOW - 60,
        'identifiers': {'fbc': f'fb.1.{(NOW-120)*1000}.SyntheticCaseSensitive_A1',
                        'fbp': f'fb.1.{(NOW-120)*1000}.1234567890'},
        'identity_receipt': {'provenance': 'SYNTHETIC_OFFLINE_FIXTURE',
                             'click_id': '00000000-0000-4000-8000-000000000002',
                             'captured_at': NOW - 120},
        'consent': {'schema': 'a6-meta-consent-v1',
                    'receipt_id': '00000000-0000-4000-8000-000000000003',
                    'click_id': '00000000-0000-4000-8000-000000000002',
                    'ad_storage': 'granted', 'ad_user_data': 'granted',
                    'ad_personalization': 'denied', 'withdrawn': False, 'gpc': False,
                    'region': 'OFFLINE', 'granted_at': NOW - 130,
                    'checked_at': NOW, 'expires_at': NOW + 300},
        'test_event_code': 'OFFLINE_ONLY',
    }


class BuildTests(unittest.TestCase):
    def test_strict_offline_request_contract_and_no_health_bypass(self):
        self.assertIsNotNone(S, 'sender implementation missing (expected RED)')
        p = fictional_build(fixture(), now=NOW, offline=True)
        self.assertEqual(set(p), {'data', 'test_event_code'})
        self.assertEqual(p['test_event_code'], 'OFFLINE_ONLY')
        event = p['data'][0]
        self.assertEqual(set(event), {'event_name','event_time','event_id','action_source','user_data'})
        self.assertEqual(event['event_name'], 'TEST_A12_Meta_B2BInquiry')
        self.assertEqual(event['action_source'], 'system_generated')
        self.assertEqual(event['event_time'], NOW - 60)
        self.assertEqual(event['user_data'], fixture()['identifiers'])
        self.assertEqual(p, fictional_build(fixture(), now=NOW, offline=True))
        for field, value in [('custom_data', {'value': 1}), ('event_name', 'publisher_commission'),
                             ('event_source_url','https://glpclinicscout.com/quiz/'),
                             ('email','synthetic@example.invalid'), ('health_derived',False)]:
            with self.subTest(field=field):
                row = fixture(); row[field] = value
                with self.assertRaises(S.Blocked): fictional_build(row, now=NOW, offline=True)
        row=fixture(); row['semantic_key']='publisher_commission'
        with self.assertRaises(S.Blocked): fictional_build(row, now=NOW, offline=True)
        with self.assertRaisesRegex(S.Blocked,'DATASET_PERMISSION_UNKNOWN'):
            fictional_build(fixture(), now=NOW, offline=False)

    def test_consent_identity_timestamp_and_nested_field_gates(self):
        mutations = [
            ('consent', 'ad_storage', 'denied'), ('consent', 'ad_user_data', 'unknown'),
            ('consent', 'ad_personalization', 'granted'), ('consent', 'withdrawn', True),
            ('consent', 'gpc', True), ('consent', 'gpc', 0),
            ('consent', 'expires_at', NOW), ('consent', 'checked_at', NOW-1),
            ('consent', 'checked_at', NOW+1), ('consent', 'granted_at', NOW),
            ('consent', 'region', 'UNKNOWN'), ('consent', 'email', 'secret'),
            ('consent', 'click_id', '00000000-0000-4000-8000-000000000099'),
            ('identity_receipt', 'provenance', 'OBSERVED'),
            ('identity_receipt', 'captured_at', NOW),
            ('identity_receipt', 'click_id', '00000000-0000-4000-8000-000000000099'),
            ('identifiers', 'em', 'hashed-but-prohibited'),
            ('identifiers', 'client_user_agent', 'raw field'),
            ('identifiers', 'fbc', 'fb.1.1800000000000.after-event'),
            ('identifiers', 'fbp', 'invalid'),
            (None, 'event_time', NOW+1), (None, 'event_time', NOW-604801),
            (None, 'event_time', True), (None, 'event_time', str(NOW-60)),
            (None, 'occurrence_id', 'health-treatment-123'), (None, 'click_id', ''),
            (None, 'record_kind', 'REAL'), (None, 'provenance', 'OBSERVED'),
        ]
        for section, key, value in mutations:
            with self.subTest(section=section, key=key, value=value):
                row = fixture(); target = row if section is None else row[section]; target[key] = value
                with self.assertRaises(S.Blocked): fictional_build(row, now=NOW, offline=True)
        row=fixture(); row['identifiers']={}
        with self.assertRaises(S.Blocked): fictional_build(row, now=NOW, offline=True)
        row=fixture(); del row['consent']['ad_user_data']
        with self.assertRaises(S.Blocked): fictional_build(row, now=NOW, offline=True)
        row=fixture(); row['identifiers'].pop('fbp')
        self.assertIn('fbc', fictional_build(row, now=NOW, offline=True)['data'][0]['user_data'])
        row=fixture(); row['identifiers'].pop('fbc')
        self.assertIn('fbp', fictional_build(row, now=NOW, offline=True)['data'][0]['user_data'])

class DispatchTests(unittest.TestCase):
    def test_durable_dispatch_dedupe_conflict_and_safe_receipt(self):
        self.assertTrue(hasattr(S, 'dispatch'), 'durable dispatch not implemented (expected RED)')
        import tempfile
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger=Path(d)/'ledger.sqlite3'
            transport=S.OfflineTransport(200, {'events_received':1, 'fbtrace_id':'offline-trace'})
            result=fictional_dispatch(fixture(), ledger=ledger, transport=transport, now=NOW, offline=True)
            self.assertEqual(result['state'], 'ACCEPTED_TEST_OFFLINE')
            self.assertFalse(result['attribution_observed'])
            self.assertTrue(result['excluded_from_money_reporting'])
            self.assertEqual(transport.calls, 1)
            again=fictional_dispatch(fixture(), ledger=ledger, transport=transport, now=NOW, offline=True)
            self.assertTrue(again['replay_suppressed']); self.assertEqual(transport.calls,1)
            # Process restart: a different transport with the same durable ledger cannot resend.
            fresh=S.OfflineTransport(200, {'events_received':1})
            fictional_dispatch(fixture(), ledger=ledger, transport=fresh, now=NOW, offline=True)
            self.assertEqual(fresh.calls,0)
            row=fixture(); row['event_time']-=1
            with self.assertRaisesRegex(S.Blocked, 'EVENT_ID_PAYLOAD_CONFLICT'):
                fictional_dispatch(row, ledger=ledger, transport=fresh, now=NOW, offline=True)
            self.assertEqual(fresh.calls,0)
            data=ledger.read_bytes()
            self.assertNotIn(b'SyntheticCaseSensitive',data)
            self.assertNotIn(b'fbtrace_id',data)
            self.assertNotIn(b'fb.1.',data)

    def test_ambiguity_rejection_and_crash_never_auto_retry(self):
        self.assertTrue(hasattr(S, 'dispatch'), 'durable dispatch not implemented (expected RED)')
        import tempfile
        import sqlite3
        for status, body, failure, expected in [
            (200, {'events_received':1}, 'timeout', 'AMBIGUOUS_TEST_OFFLINE'),
            (500, {'error':{'message':'DO_NOT_LOG'}}, None, 'AMBIGUOUS_TEST_OFFLINE'),
            (200, {}, None, 'AMBIGUOUS_TEST_OFFLINE'),
            (200, {'events_received':True}, None, 'AMBIGUOUS_TEST_OFFLINE'),
            (200, {'events_received':2}, None, 'AMBIGUOUS_TEST_OFFLINE'),
            (400, {'events_received':0,'error':{'code':100}}, None, 'REJECTED_TEST_OFFLINE'),
        ]:
            with self.subTest(status=status,body=body,failure=failure):
                with tempfile.TemporaryDirectory(dir=HERE) as d:
                    ledger=Path(d)/'ledger.sqlite3'
                    transport=S.OfflineTransport(status,body,failure=failure)
                    result=fictional_dispatch(fixture(),ledger=ledger,transport=transport,now=NOW,offline=True)
                    self.assertEqual(result['state'],expected)
                    fictional_dispatch(fixture(),ledger=ledger,transport=transport,now=NOW,offline=True)
                    self.assertEqual(transport.calls,1)
                    self.assertNotIn('DO_NOT_LOG',json.dumps(result))
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger=Path(d)/'ledger.sqlite3'
            transport=S.OfflineTransport(200,{},failure='process_crash')
            with self.assertRaises(KeyboardInterrupt):
                fictional_dispatch(fixture(),ledger=ledger,transport=transport,now=NOW,offline=True)
            fresh=S.OfflineTransport(200,{'events_received':1})
            result=fictional_dispatch(fixture(),ledger=ledger,transport=fresh,now=NOW,offline=True)
            self.assertEqual(result['state'],'DISPATCHED_TEST_OFFLINE')
            self.assertTrue(result['reconciliation_required']); self.assertEqual(fresh.calls,0)

    def test_parallel_reservation_is_single_dispatch(self):
        import tempfile
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger=Path(d)/'ledger.sqlite3'; barrier=Barrier(2)
            transports=[S.OfflineTransport(), S.OfflineTransport()]
            def worker(i):
                barrier.wait()
                return fictional_dispatch(fixture(),ledger=ledger,transport=transports[i],now=NOW,offline=True)
            with ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(worker,range(2)))
            self.assertEqual(sum(t.calls for t in transports),1)
            self.assertEqual(sum(r['replay_suppressed'] for r in results),1)

    def test_no_network_and_blocked_rows_never_reach_transport(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger=Path(d)/'ledger.sqlite3'; transport=S.OfflineTransport()
            with patch('socket.socket',side_effect=AssertionError('NETWORK_FORBIDDEN')), \
                 patch('socket.create_connection',side_effect=AssertionError('NETWORK_FORBIDDEN')):
                result=fictional_dispatch(fixture(),ledger=ledger,transport=transport,now=NOW,offline=True)
                self.assertEqual(result['state'],'ACCEPTED_TEST_OFFLINE')
                for offline in (False, None, 'true', 1):
                    with self.assertRaises(S.Blocked):
                        fictional_dispatch(fixture(),ledger=ledger,transport=transport,now=NOW,offline=offline)
                row=fixture(); row['consent']['withdrawn']=True
                with self.assertRaises(S.Blocked):
                    fictional_dispatch(row,ledger=ledger,transport=transport,now=NOW,offline=True)
                self.assertEqual(transport.calls,1)
                with self.assertRaisesRegex(S.Blocked,'LIVE_TRANSPORT_FORBIDDEN'):
                    fictional_dispatch(fixture(),ledger=ledger,transport=lambda p: None,now=NOW,offline=True)

    def test_corrupt_and_unsafe_ledgers_fail_without_dispatch(self):
        import tempfile
        import os
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger=Path(d)/'ledger.sqlite3'; transport=S.OfflineTransport()
            ledger.write_bytes(b'not-a-sqlite-db'); os.chmod(ledger,0o600)
            with self.assertRaises(Exception):
                fictional_dispatch(fixture(),ledger=ledger,transport=transport,now=NOW,offline=True)
            self.assertEqual(transport.calls,0)
            os.chmod(ledger,0o644)
            with self.assertRaisesRegex(S.Blocked,'LEDGER_PERMISSIONS_UNSAFE'):
                fictional_dispatch(fixture(),ledger=ledger,transport=transport,now=NOW,offline=True)
            self.assertEqual(transport.calls,0)
            with self.assertRaisesRegex(S.Blocked,'DURABLE_LEDGER_REQUIRED'):
                fictional_dispatch(fixture(),ledger=':memory:',transport=transport,now=NOW,offline=True)


class CliTests(unittest.TestCase):
    def test_cli_dry_run_test_only_and_no_production_or_raw_errors(self):
        import subprocess
        import sys
        import tempfile
        self.assertTrue(hasattr(S, 'main'), 'CLI not implemented (expected RED)')
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            row=Path(d)/'fixture.json'; row.write_text(json.dumps(fixture()))
            ledger=Path(d)/'ledger.sqlite3'
            base=[sys.executable,'-B',str(HERE/'sender.py')]
            common=['--input',str(row),'--offline-fixture','--offline-now',str(NOW)]
            dry=subprocess.run(base+['--dry-run']+common,capture_output=True,text=True)
            self.assertEqual(dry.returncode,3,dry.stderr)
            data=json.loads(dry.stdout)
            self.assertEqual(data['reason'],'TRUSTED_PROOF_REQUIRED')
            self.assertFalse(ledger.exists())
            sent=subprocess.run(base+['--test-only','--ledger',str(ledger)]+common,capture_output=True,text=True)
            self.assertEqual(sent.returncode,3,sent.stderr)
            self.assertEqual(json.loads(sent.stdout)['reason'],'TRUSTED_PROOF_REQUIRED')
            again=subprocess.run(base+['--test-only','--ledger',str(ledger)]+common,capture_output=True,text=True)
            self.assertEqual(json.loads(again.stdout)['reason'],'TRUSTED_PROOF_REQUIRED')
            self.assertFalse(ledger.exists())
            blocked=subprocess.run(base+['--test-only','--input','DO_NOT_READ_SECRET'],capture_output=True,text=True)
            self.assertEqual(blocked.returncode,3)
            self.assertEqual(json.loads(blocked.stdout)['reason'],'DATASET_PERMISSION_UNKNOWN')
            for args in [['--production','DO_NOT_ECHO'], ['--test-only','--dry-run'], []]:
                p=subprocess.run(base+args,capture_output=True,text=True)
                self.assertNotEqual(p.returncode,0)
                self.assertNotIn('DO_NOT_ECHO',p.stdout+p.stderr)
            row.write_text('{"schema":"x","schema":"y"}')
            bad=subprocess.run(base+['--dry-run']+common,capture_output=True,text=True)
            self.assertEqual(bad.returncode,3)
            self.assertEqual(json.loads(bad.stdout)['reason'],'DUPLICATE_JSON_KEY')


if __name__ == '__main__': unittest.main(verbosity=2)
