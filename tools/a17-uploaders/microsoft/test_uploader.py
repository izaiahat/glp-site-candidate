"""Synthetic offline fixtures only; never platform evidence."""
import copy
import importlib.util
import unittest
from pathlib import Path
from datetime import datetime, timezone

HERE = Path(__file__).parent
NOW = datetime(2026, 9, 9, 3, tzinfo=timezone.utc)
import sys
sys.path.insert(0, str(HERE.resolve().parent))
from fictional_proof_support import attach

def fictional_store(row, now):
    old = row.get('event_permission')
    resolver = attach(row, 'microsoft', int(now.timestamp()*1000))
    if old not in ('TEST_NON_HEALTH_ONLY', None) and old != row['permission_sha256']:
        row['event_permission'] = old
    return resolver

def fictional_prepare(module, row, setup, now):
    return module.prepare(row, setup, now, resolver=fictional_store(row, now))

def fictional_dispatch(module, row, setup, ledger, now, transport):
    return module.run_test_only(row, setup, ledger, now, transport, resolver=fictional_store(row, now))

def fixture():
    return {
        'provenance': 'SYNTHETIC_LOCAL_ONLY', 'test': True,
        'account_id': '189346863', 'goal_name': 'TEST_LOCAL_OFFLINE',
        'network': 'TEST_NETWORK', 'network_account': 'TEST_ACCOUNT',
        'conversion_id': 'TEST_CONVERSION_1', 'cs_click_id': 'TEST_CLICK_1',
        'program_id': 'TEST_PROGRAM', 'event_status': 'approved',
        'approval_source': 'authenticated_test_fixture',
        'health_context': False, 'event_permission': 'TEST_NON_HEALTH_ONLY',
        'occurred_at': '2026-09-09T01:00:00Z',
        'commission_minor': 12345, 'currency': 'USD',
        'consent': {'version': 'test-v1', 'ad_storage': 'granted', 'ad_user_data': 'granted',
                    'withdrawn': False, 'gpc': False, 'expires_at': '2026-09-10T00:00:00Z'},
        'click': {'cs_click_id': 'TEST_CLICK_1', 'network': 'TEST_NETWORK',
                  'network_account': 'TEST_ACCOUNT', 'program_id': 'TEST_PROGRAM',
                  'account_id': '189346863', 'msclkid': 'ABCDEF0123456789abcdef0123456789',
                  'observed_msclkid': 'ABCDEF0123456789abcdef0123456789',
                  'capture_source': 'synthetic_landing_to_go_fixture',
                  'captured_at': '2026-09-08T23:00:00Z', 'consent_version': 'test-v1'}
    }

def inventory():
    return {'provenance': 'SYNTHETIC_LOCAL_ONLY', 'account_id': '189346863',
            'offline_goals': {'PartialErrors': [], 'ConversionGoals': [{
                'Id': 'TEST_GOAL_NOT_PLATFORM_ID', 'Name': 'TEST_LOCAL_OFFLINE',
                'Type': 'OfflineConversion', 'Status': 'Active', 'Scope': 'Account',
                'CountType': 'All', 'ConversionWindowInMinutes': 43200,
                'created_at': '2026-09-08T00:00:00Z'}]}}

class PreparationTests(unittest.TestCase):
    def module(self):
        self.assertTrue((HERE / 'uploader.py').exists(), 'missing uploader behavior')
        spec = importlib.util.spec_from_file_location('ms_uploader', HERE / 'uploader.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_documented_request_shape(self):
        m = self.module()
        prepared = fictional_prepare(m, fixture(), inventory(), NOW)
        self.assertEqual(prepared['method'], 'POST')
        self.assertEqual(prepared['url'], 'https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply')
        self.assertEqual(prepared['headers'], {'CustomerAccountId': '189346863', 'CustomerId': '255039117', 'Content-Type': 'application/json'})
        self.assertEqual(prepared['body'], {'OfflineConversions': [{
            'ConversionCurrencyCode': 'USD', 'ConversionName': 'TEST_LOCAL_OFFLINE',
            'ConversionTime': '2026-09-09T01:00:00Z', 'ConversionValue': 123.45,
            'MicrosoftClickId': 'ABCDEF0123456789abcdef0123456789'}]})
        self.assertEqual(prepared['provenance'], 'SYNTHETIC_LOCAL_ONLY')

    def test_fail_closed_export_eligibility(self):
        m = self.module()
        mutations = [
            ('REAL', lambda e,s: e.update(test=False)),
            ('provenance', lambda e,s: e.update(provenance='REAL')),
            ('account', lambda e,s: e.update(account_id='wrong')),
            ('health', lambda e,s: e.update(health_context=True)),
            ('permission', lambda e,s: e.update(event_permission='unknown')),
            ('pending', lambda e,s: e.update(event_status='pending')),
            ('reversed', lambda e,s: e.update(event_status='reversed')),
            ('approval', lambda e,s: e.update(approval_source='receiver_default')),
            ('unknown fields', lambda e,s: e.update(attributes_json={'email':'private'})),
            ('patient', lambda e,s: e['click'].update(email='private')),
            ('consent unknown', lambda e,s: e['consent'].update(ad_user_data='unknown')),
            ('storage denied', lambda e,s: e['consent'].update(ad_storage='denied')),
            ('withdrawal', lambda e,s: e['consent'].update(withdrawn=True)),
            ('GPC', lambda e,s: e['consent'].update(gpc=True)),
            ('expired', lambda e,s: e['consent'].update(expires_at='2026-09-08T00:00:00Z')),
            ('binding', lambda e,s: e['click'].update(cs_click_id='TEST_WRONG')),
            ('network binding', lambda e,s: e['click'].update(network='TEST_WRONG')),
            ('consent binding', lambda e,s: e['click'].update(consent_version='old')),
            ('observed ID', lambda e,s: e['click'].update(observed_msclkid='unrelated')),
            ('missing ID', lambda e,s: e['click'].update(msclkid='')),
            ('capture source', lambda e,s: e['click'].update(capture_source='inferred')),
            ('unknown value', lambda e,s: e.update(commission_minor=None)),
            ('bool value', lambda e,s: e.update(commission_minor=True)),
            ('negative', lambda e,s: e.update(commission_minor=-1)),
            ('unknown currency', lambda e,s: e.update(currency='ZZZ')),
            ('no goals', lambda e,s: s['offline_goals'].update(ConversionGoals=[])),
            ('wrong goal name', lambda e,s: e.update(goal_name='test_local_offline')),
            ('wrong goal type', lambda e,s: s['offline_goals']['ConversionGoals'][0].update(Type='Event')),
            ('goal wait', lambda e,s: s['offline_goals']['ConversionGoals'][0].update(created_at='2026-09-09T02:00:00Z')),
            ('goal window', lambda e,s: s['offline_goals']['ConversionGoals'][0].update(ConversionWindowInMinutes=60)),
            ('goal account', lambda e,s: s.update(account_id='wrong')),
            ('goal errors', lambda e,s: s['offline_goals'].update(PartialErrors=[{'Code':1}])),
            ('time future', lambda e,s: e.update(occurred_at='2026-09-10T00:00:00Z')),
            ('before click', lambda e,s: e.update(occurred_at='2026-09-08T22:00:00Z')),
            ('age', lambda e,s: e.update(occurred_at='2026-01-01T00:00:00Z')),
            ('UTC required', lambda e,s: e.update(occurred_at='2026-09-09T01:00:00')),
        ]
        for name, mutate in mutations:
            with self.subTest(name=name):
                e,s = fixture(), inventory()
                mutate(e,s)
                with self.assertRaises(ValueError):
                    fictional_prepare(m, e,s,NOW)
        e = fixture(); e['currency'] = 'JPY'; e['commission_minor'] = 123
        self.assertEqual(fictional_prepare(m, e, inventory(), NOW)['body']['OfflineConversions'][0]['ConversionValue'],123)

    def test_durable_presend_reservation_prevents_replay(self):
        import tempfile, sqlite3
        from unittest.mock import Mock, patch
        m = self.module()
        self.assertTrue(hasattr(m, 'run_test_only'), 'missing durable test dispatcher')
        with tempfile.TemporaryDirectory(dir=HERE) as d, patch('socket.socket.connect', side_effect=AssertionError('NETWORK')) as net:
            ledger = Path(d) / 'ledger.sqlite'
            def receive(request):
                with sqlite3.connect(ledger) as db:
                    self.assertEqual(db.execute('select state from exports').fetchone()[0], 'RESERVED')
                return {'PartialErrors': []}
            transport = Mock(side_effect=receive)
            result = fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport)
            self.assertEqual(result['state'], 'MOCK_ACCEPTED_NOT_ATTRIBUTED')
            self.assertFalse(result['attribution_observed'])
            self.assertEqual(fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport)['state'], 'DUPLICATE_SUPPRESSED')
            changed = fixture(); changed['occurred_at'] = '2026-09-09T01:01:00Z'
            self.assertEqual(fictional_dispatch(m, changed, inventory(), ledger, NOW, transport)['state'], 'IDENTITY_CONFLICT')
            self.assertEqual(transport.call_count, 1)
            # A new local event identity cannot replay the same vendor goal/click/time tuple.
            changed = fixture(); changed['conversion_id'] = 'TEST_CONVERSION_2'
            self.assertEqual(fictional_dispatch(m, changed, inventory(), ledger, NOW, transport)['state'], 'VENDOR_DUPLICATE_SUPPRESSED')
            net.assert_not_called()
        for response, expected in [({'PartialErrors':[{'Index':0,'Code':123,'Message':'DO NOT LOG PATIENT DATA'}]}, 'MOCK_REJECTED'),
                                   ({'PartialErrors':[{'Index':9,'Code':123}]}, 'AMBIGUOUS'),
                                   ({}, 'AMBIGUOUS'), (TimeoutError('secret'), 'AMBIGUOUS')]:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory(dir=HERE) as d:
                ledger = Path(d) / 'ledger.sqlite'
                transport = Mock(side_effect=response) if isinstance(response, Exception) else Mock(return_value=response)
                result = fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport)
                self.assertEqual(result['state'], expected)
                self.assertNotIn('secret', str(result)); self.assertNotIn('PATIENT', str(result))
                self.assertEqual(fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport)['state'], 'DUPLICATE_SUPPRESSED')
                self.assertEqual(transport.call_count, 1)

    def test_cli_modes_no_production_or_external_transport(self):
        import subprocess, tempfile, json, sys
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            d = Path(d)
            (d/'event.json').write_text(json.dumps(fixture()))
            (d/'setup.json').write_text(json.dumps(inventory()))
            command = [sys.executable, '-B', str(HERE/'uploader.py'), '--event', str(d/'event.json'), '--setup', str(d/'setup.json'), '--now', '2026-09-09T03:00:00Z']
            dry = subprocess.run(command + ['--dry-run'], capture_output=True, text=True)
            self.assertEqual(dry.returncode, 2, dry.stderr)
            self.assertTrue(dry.stdout.strip(), 'CLI must emit a receipt')
            self.assertEqual(json.loads(dry.stdout)['reason'], 'TRUSTED_PROOF_REQUIRED')
            self.assertFalse((d/'ledger.sqlite').exists())
            test = subprocess.run(command + ['--test-only','--ledger',str(d/'ledger.sqlite')], capture_output=True,text=True)
            self.assertEqual(test.returncode, 2, test.stderr)
            self.assertEqual(json.loads(test.stdout)['reason'], 'TRUSTED_PROOF_REQUIRED')
            self.assertNotEqual(subprocess.run(command + ['--production'], capture_output=True).returncode, 0)
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            # Saved actual inventory is not a fixture goal and cannot be treated as one.
            actual = HERE.parent/'fixtures'/'a6-microsoft-setup.json'
            (d/'setup.json').write_text(actual.read_text())
            blocked = subprocess.run(command + ['--dry-run'],capture_output=True,text=True)
            self.assertEqual(blocked.returncode, 2)
            self.assertEqual(json.loads(blocked.stdout)['reason'], 'TRUSTED_PROOF_REQUIRED')

    def test_equivalent_vendor_time_cannot_evade_dedup(self):
        import tempfile
        from unittest.mock import Mock
        m = self.module()
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger = Path(d)/'ledger.sqlite'
            transport = Mock(return_value={'PartialErrors':[]})
            fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport)
            e = fixture(); e['conversion_id'] = 'TEST_CONVERSION_2'; e['occurred_at'] = '2026-09-09T01:00:00.000Z'
            self.assertEqual(fictional_dispatch(m, e, inventory(), ledger, NOW, transport)['state'], 'VENDOR_DUPLICATE_SUPPRESSED')
            self.assertEqual(transport.call_count, 1)

    def test_interrupted_reservation_and_concurrent_duplicate_are_not_replayed(self):
        import tempfile, concurrent.futures
        from unittest.mock import Mock
        m = self.module()
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger = Path(d)/'ledger.sqlite'
            transport = Mock(side_effect=KeyboardInterrupt())
            with self.assertRaises(KeyboardInterrupt):
                fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport)
            r = fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport)
            self.assertEqual(r['state'], 'DUPLICATE_SUPPRESSED'); self.assertEqual(r['prior_state'], 'RESERVED')
            self.assertEqual(transport.call_count, 1)
        with tempfile.TemporaryDirectory(dir=HERE) as d:
            ledger = Path(d)/'ledger.sqlite'
            transport = Mock(return_value={'PartialErrors':[]})
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: fictional_dispatch(m, fixture(), inventory(), ledger, NOW, transport), range(4)))
            self.assertEqual(transport.call_count, 1)
            self.assertEqual(sum(r['state']=='DUPLICATE_SUPPRESSED' for r in results), 3)

if __name__ == '__main__':
    unittest.main()
