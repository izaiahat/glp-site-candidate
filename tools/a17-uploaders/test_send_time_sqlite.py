"""Exercise actual durable reservations with a freshly reopened SQLite issuer."""
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch
from issuer_adapter import StagingIssuerResolver
from send_proof import canonical_sha256
from synthetic_fixture import actual_fixture as fixture
from test_issuer_adapter import load

M = load('a17_meta_dispatch', 'meta/sender.py')
B = load('a17_ms_dispatch', 'microsoft/uploader.py')

class SendTimeTests(unittest.TestCase):
    def run_case(self, platform, mutation=None, after_reservation=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); database = root/'issuer.sqlite'; ledger = root/'outbox.sqlite'
            row, now, setup, records = fixture(platform, database)
            clock = [now]
            resolver = StagingIssuerResolver(database, clock=lambda:clock[0], timeout=0.01)
            original = resolver.resolve_current
            table = 'events' if platform == 'meta' else 'exports'
            transport = M.OfflineTransport() if platform == 'meta' else Mock(return_value={'PartialErrors':[]})
            calls = lambda: transport.calls if platform == 'meta' else transport.call_count
            lock = []
            def mutate():
                p,c,b = (records[k] for k in ('permission','consent','probe'))
                if mutation == 'missing_epoch':
                    with sqlite3.connect(database) as db: db.execute('DELETE FROM a17_issuer_revocations')
                    return
                if mutation == 'missing_scope_store':
                    with sqlite3.connect(database) as db:
                        db.execute('DROP TABLE a17_issuer_scopes')
                        db.execute('UPDATE a17_issuer_probes SET probe_json=?',(json.dumps(b),))
                    return
                if mutation == 'session_policy':
                    with sqlite3.connect(database) as db:
                        session=json.loads(db.execute('SELECT session_json FROM a17_issuer_sessions').fetchone()[0]);session['gpc']=True
                        db.execute('UPDATE a17_issuer_sessions SET session_json=?',(json.dumps(session),))
                    return
                if mutation == 'scope_expired':
                    with sqlite3.connect(database) as db:
                        scope=json.loads(db.execute('SELECT scope_json FROM a17_issuer_scopes').fetchone()[0]);scope['expires_at_ms']=now
                        db.execute('UPDATE a17_issuer_scopes SET scope_json=?',(json.dumps(scope),))
                    return
                if mutation == 'review_expired':
                    with sqlite3.connect(database) as db:
                        review=json.loads(db.execute('SELECT review_json FROM a17_issuer_reviews').fetchone()[0]);review['expires_at_ms']=now
                        db.execute('UPDATE a17_issuer_reviews SET review_json=?',(json.dumps(review),))
                    return
                if mutation == 'revoked':
                    with sqlite3.connect(database) as db:
                        db.execute('INSERT INTO a17_issuer_revocations VALUES (?,?,1) ON CONFLICT(subject_ref,permission_ref) DO UPDATE SET epoch=1', (c['subject_ref'],p['evidence_ref']))
                    return
                if mutation == 'wildcard_revoked':
                    with sqlite3.connect(database) as db: db.execute('INSERT INTO a17_issuer_revocations VALUES (?,?,1)', ('*','*'))
                    return
                if mutation == 'timeout':
                    db = sqlite3.connect(database); db.execute('BEGIN EXCLUSIVE'); lock.append(db); return
                if mutation == 'clock_expired': clock[0] = b['expires_at_ms']; return
                if mutation == 'source_row':
                    if platform == 'meta': row['identifiers']['fbc'] += 'FORGED'
                    else: row['click']['msclkid'] += 'FORGED'
                    return
                if mutation == 'forged_scope': row['proof']['target_id'] = 'TEST_FORGED'; return
                if mutation == 'forged_probe': row['probe_ref'] = 'TEST_FORGED'; return
                if mutation == 'forged_hash': row['permission_sha256'] = 'f'*64; return
                if mutation == 'withdrawn': c['withdrawn'] = True
                elif mutation == 'gpc': c['gpc'] = True
                elif mutation == 'consent_expired': c['expires_at_ms'] = now
                elif mutation == 'probe_expired': b['expires_at_ms'] = now
                elif mutation == 'permission_expired': p['expires_at_ms'] = now
                elif mutation == 'status_revoked': p['status'] = 'REVOKED'
                elif mutation == 'source_kind': b['source_kind'] = 'TEST_CONSUMER_QUIZ_COMPLETE'
                elif mutation == 'source_digest': b['source_sha256'] = 'f'*64
                elif mutation == 'missing_schema': p.pop('ownership_evidence_ref')
                elif mutation == 'capture_probe':
                    name = 'TEST_A12_'+('Meta' if platform == 'meta' else 'Microsoft')+'_CaptureProbe'
                    p['event_name'] = b['event_name'] = row['proof']['event_name'] = name
                    c['event_names'] = [name]
                # Rebind hashes so refusal is semantic, not only stale digest.
                row['permission_sha256'] = c['permission_sha256'] = b['permission_sha256'] = canonical_sha256(p)
                if platform == 'microsoft': row['event_permission'] = canonical_sha256(p)
                b['consent_sha256'] = canonical_sha256(c)
                with sqlite3.connect(database) as db:
                    db.execute('UPDATE a6_platform_event_permissions SET permission_json=?', (json.dumps(p),))
                    db.execute('UPDATE a6_advertising_consent_receipts SET consent_json=?', (json.dumps(c),))
                    wrapper=json.loads(db.execute('SELECT probe_json FROM a17_issuer_probes').fetchone()[0])
                    wrapper['probe']=b
                    db.execute('UPDATE a17_issuer_probes SET probe_json=?', (json.dumps(wrapper),))
            def fresh(*args):
                if after_reservation and resolver.calls == 1 and mutation:
                    # Separate connection proves reservation was committed first.
                    with sqlite3.connect(ledger) as db:
                        self.assertIn(db.execute('SELECT state FROM '+table).fetchone()[0], ('RESERVED','DISPATCHED_TEST_OFFLINE'))
                    mutate()
                return original(*args)
            resolver.resolve_current = fresh
            def dispatch():
                if platform == 'meta':
                    return M.dispatch(row, ledger=ledger, transport=transport, now=now//1000, offline=True, resolver=resolver)
                return B.run_test_only(row, setup, ledger, datetime.fromtimestamp(now/1000, timezone.utc), transport, resolver=resolver)
            try:
                with patch('socket.socket.connect', side_effect=AssertionError('NETWORK_FORBIDDEN')), patch('socket.getaddrinfo', side_effect=AssertionError('DNS_FORBIDDEN')):
                    if mutation:
                        if not after_reservation: mutate()
                        with self.assertRaises(ValueError): dispatch()
                        self.assertEqual(calls(), 0)
                        if after_reservation:
                            self.assertEqual(resolver.calls, 2)
                            with sqlite3.connect(ledger) as db:
                                self.assertEqual(db.execute('SELECT state FROM '+table).fetchone()[0], 'BLOCKED_PROOF_TEST_OFFLINE' if platform == 'meta' else 'BLOCKED_PROOF')
                    else:
                        dispatch(); self.assertEqual(calls(), 1); self.assertEqual(resolver.calls, 2)
                        dispatch(); self.assertEqual(calls(), 1)
            finally:
                for db in lock: db.rollback(); db.close()

def case(platform, mutation, after=True):
    def test(self): self.run_case(platform, mutation, after)
    return test

for platform in ('meta','microsoft'):
    setattr(SendTimeTests, 'test_'+platform+'_positive_and_replay', case(platform,None))
    for mutation in ('missing_epoch','missing_scope_store','session_policy','scope_expired','review_expired','revoked','wildcard_revoked','timeout','clock_expired','source_row','forged_scope','forged_probe','forged_hash','withdrawn','gpc','consent_expired','probe_expired','permission_expired','status_revoked','source_kind','source_digest','missing_schema','capture_probe'):
        setattr(SendTimeTests, 'test_'+platform+'_after_reservation_'+mutation, case(platform,mutation))
        setattr(SendTimeTests, 'test_'+platform+'_preflight_'+mutation, case(platform,mutation,False))

if __name__ == '__main__': unittest.main(verbosity=2)
