"""A6 TEST-only CAPI contract. No production mode or implicit permissions.

The only currently permitted local exercise is a SYNTHETIC_OFFLINE_FIXTURE.
No real dataset event has an independently reviewed non-sensitive semantic
contract. Consequently every non-offline request is blocked. This is NOT
permission inferred from an event label or a test_event_code.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from send_proof import verify, ProofDenied, PROOF_FIELDS

DATASET_ID = '586886932687286'  # Saved authenticated meta-setup.json readback.
OFFLINE_DATASET_ID = '999999999999999'  # Synthetic; NEVER a network target.
TOP_FIELDS = {'schema','record_kind','provenance','semantic_key','occurrence_id',
              'click_id','event_time','identifiers','identity_receipt','consent',
              'test_event_code'} | PROOF_FIELDS


class Blocked(ValueError):
    """Safe fixed reason only; never echo input values or upstream exceptions."""


def require(ok, reason):
    if not ok:
        raise Blocked(reason)


def exact_keys(obj, keys):
    require(type(obj) is dict and set(obj) == set(keys), 'UNEXPECTED_OR_MISSING_FIELDS')


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), allow_nan=False)


def validate_context(row, now):
    require(type(now) is int and now > 0, 'INVALID_CLOCK')
    for key in ('occurrence_id', 'click_id'):
        opaque_uuid(row[key])
    event_time = row['event_time']
    require(type(event_time) is int and 0 <= now-event_time <= 604800, 'EVENT_TIME_INVALID')
    identity = row['identity_receipt']
    exact_keys(identity, {'provenance', 'click_id', 'captured_at'})
    require(identity['provenance'] == 'SYNTHETIC_OFFLINE_FIXTURE', 'IDENTITY_PROVENANCE_INVALID')
    require(identity['click_id'] == row['click_id'], 'IDENTITY_CLICK_MISMATCH')
    captured = identity['captured_at']
    require(type(captured) is int and 0 < captured <= event_time, 'CAPTURE_TIME_INVALID')
    identifiers = row['identifiers']
    require(type(identifiers) is dict and bool(identifiers) and
            set(identifiers) <= {'fbc', 'fbp'}, 'IDENTIFIERS_NOT_PERMITTED')
    for key, value in identifiers.items():
        require(type(value) is str and len(value) <= 512, 'IDENTIFIER_INVALID')
        pattern = r'fb\.[0-9]+\.([0-9]{13})\.([A-Za-z0-9_-]+)' if key == 'fbc' else r'fb\.[0-9]+\.([0-9]{13})\.([0-9]+)'
        match = re.fullmatch(pattern, value)
        require(match is not None, 'IDENTIFIER_INVALID')
        require(int(match.group(1)) <= captured*1000, 'IDENTIFIER_AFTER_CAPTURE')
    consent = row['consent']
    exact_keys(consent, {'schema','receipt_id','click_id','ad_storage','ad_user_data',
                        'ad_personalization','withdrawn','gpc','region','granted_at',
                        'checked_at','expires_at'})
    require(consent['schema'] == 'a6-meta-consent-v1', 'CONSENT_SCHEMA_INVALID')
    opaque_uuid(consent['receipt_id'])
    require(consent['click_id'] == row['click_id'], 'CONSENT_CLICK_MISMATCH')
    require(all(consent[k] == 'granted' for k in ('ad_storage','ad_user_data')) and consent['ad_personalization'] == 'denied',
            'ADVERTISING_CONSENT_NOT_GRANTED')
    require(consent['withdrawn'] is False and consent['gpc'] is False, 'OPT_OUT_OR_UNKNOWN')
    require(consent['region'] == 'OFFLINE', 'REGION_NOT_PERMITTED')
    require(all(type(consent[k]) is int for k in ('granted_at','checked_at','expires_at')),
            'CONSENT_TIME_INVALID')
    require(0 < consent['granted_at'] <= captured and consent['checked_at'] == now and
            consent['expires_at'] > now, 'CONSENT_NOT_CURRENT')


def opaque_uuid(value):
    require(type(value) is str and re.fullmatch(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', value) is not None,
        'OPAQUE_ID_INVALID')


def offline_target(resolver):
    from issuer_adapter import StagingIssuerResolver
    return 'TEST_A17_META_DATASET' if type(resolver) is StagingIssuerResolver else OFFLINE_DATASET_ID


def build_request(row, *, now, offline=False, resolver=None):
    # No caller-supplied boolean/policy file can declare a real event permissible.
    require(offline is True, 'DATASET_PERMISSION_UNKNOWN')
    try:
        verify(row, 'meta', 'OFFLINE_ACCOUNT', offline_target(resolver), resolver, local_only=True)
    except ProofDenied as exc:
        raise Blocked(str(exc)) from None
    exact_keys(row, TOP_FIELDS)
    require(row['schema'] == 'a6-meta-test-v1', 'SCHEMA_UNSUPPORTED')
    require(row['record_kind'] == 'TEST', 'NON_TEST_FORBIDDEN')
    require(row['provenance'] == 'SYNTHETIC_OFFLINE_FIXTURE', 'PROVENANCE_NOT_OFFLINE')
    require(row['semantic_key'] == 'offline_administrative_test_v1', 'SEMANTICS_NOT_PERMITTED')
    require(row['test_event_code'] == 'OFFLINE_ONLY', 'TEST_CODE_NOT_OFFLINE')
    validate_context(row, now)
    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, canonical([
        'a6-meta-test-v1', offline_target(resolver), 'TEST_A12_Meta_B2BInquiry', row['occurrence_id']
    ])))
    return {'data': [{'event_name': 'TEST_A12_Meta_B2BInquiry', 'event_time': row['event_time'],
                      'event_id': event_id, 'action_source': 'system_generated',
                      'user_data': dict(row['identifiers'])}],
            'test_event_code': row['test_event_code']}


class OfflineTransport:
    """Injected, socket-free transport. Outcomes are explicitly simulated, not Meta responses.

    Exact type is enforced at dispatch so a caller cannot accidentally hand a
    live HTTP adapter synthetic identifiers. No configurable endpoint exists.
    """
    def __init__(self, status=200, body=None, *, failure=None):
        self.status = status
        self.body = {'events_received': 1} if body is None else body
        self.failure = failure
        self.calls = 0

    def send(self, request):
        self.calls += 1
        if self.failure == 'timeout':
            raise TimeoutError('SIMULATED_TIMEOUT')
        if self.failure == 'process_crash':
            raise KeyboardInterrupt('SIMULATED_PROCESS_CRASH')
        return self.status, self.body


def receipt(event_id, state, replay=False):
    return {'event_id': event_id, 'state': state, 'record_kind': 'TEST',
            'evidence_level': 'SYNTHETIC_OFFLINE_ONLY',
            'replay_suppressed': replay,
            'reconciliation_required': state in ('DISPATCHED_TEST_OFFLINE', 'AMBIGUOUS_TEST_OFFLINE'),
            'excluded_from_money_reporting': True,
            'platform_acceptance_observed': False, 'attribution_observed': False,
            'external_posts': 0}


def dispatch(row, *, ledger, transport, now, offline=False, resolver=None):
    payload = build_request(row, now=now, offline=offline, resolver=resolver)
    require(type(transport) is OfflineTransport, 'LIVE_TRANSPORT_FORBIDDEN')
    event_id = payload['data'][0]['event_id']
    # Include the local source and consent bindings, not only exported parameters.
    # Recheck time is volatile; permission identity and other decision fields are immutable.
    bound = json.loads(canonical(row))
    del bound['consent']['checked_at']
    digest = hashlib.sha256(canonical(bound).encode()).hexdigest()
    path = Path(ledger)
    require(str(path) != ':memory:' and path.parent.is_dir(), 'DURABLE_LEDGER_REQUIRED')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        require(os.fstat(fd).st_mode & 0o077 == 0, 'LEDGER_PERMISSIONS_UNSAFE')
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    try:
        db.execute('PRAGMA synchronous=FULL')
        db.execute('PRAGMA journal_mode=DELETE')
        db.execute('CREATE TABLE IF NOT EXISTS events '
                   '(event_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, '
                   'record_kind TEXT NOT NULL CHECK(record_kind="TEST"), excluded_money INTEGER NOT NULL CHECK(excluded_money=1))')
        db.execute('CREATE TABLE IF NOT EXISTS transitions '
                   '(id INTEGER PRIMARY KEY, event_id TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL)')
        db.execute('BEGIN IMMEDIATE')
        found = db.execute('SELECT fingerprint,state FROM events WHERE event_id=?', (event_id,)).fetchone()
        if found:
            require(found[0] == digest, 'EVENT_ID_PAYLOAD_CONFLICT')
            db.execute('COMMIT')
            return receipt(event_id, found[1], replay=True)
        db.execute('INSERT INTO events VALUES (?,?,?,"TEST",1)', (event_id,digest,'DISPATCHED_TEST_OFFLINE'))
        for state in ('PREPARED_TEST_OFFLINE','DISPATCHED_TEST_OFFLINE'):
            db.execute('INSERT INTO transitions(event_id,state,at) VALUES (?,?,?)', (event_id,state,now))
        # Durable reservation is committed BEFORE any transport invocation.
        db.execute('COMMIT')
        state = 'AMBIGUOUS_TEST_OFFLINE'
        # Re-read authoritative state AFTER reservation; denial cannot be retried.
        try:
            verify(row, 'meta', 'OFFLINE_ACCOUNT', offline_target(resolver), resolver, local_only=True)
        except ProofDenied as exc:
            db.execute('UPDATE events SET state=? WHERE event_id=?', ('BLOCKED_PROOF_TEST_OFFLINE',event_id))
            raise Blocked(str(exc)) from None
        try:
            status, body = transport.send(payload)
            if type(body) is dict and type(body.get('events_received')) is int:
                if type(status) is int and 200 <= status < 300 and body['events_received'] == 1 and not body.get('error'):
                    state = 'ACCEPTED_TEST_OFFLINE'
                elif body['events_received'] == 0 and body.get('error'):
                    state = 'REJECTED_TEST_OFFLINE'
        except Exception:
            # Unknown effect never becomes an automatically retryable failure.
            pass
        db.execute('BEGIN IMMEDIATE')
        db.execute('UPDATE events SET state=? WHERE event_id=?', (state,event_id))
        db.execute('INSERT INTO transitions(event_id,state,at) VALUES (?,?,?)', (event_id,state,now))
        db.execute('COMMIT')
        return receipt(event_id,state)
    finally:
        # A process crash before finalization leaves DISPATCHED. Restart does not resend.
        db.close()


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise Blocked('INVALID_CLI_ARGUMENTS')


def unique_object(pairs):
    obj = {}
    for key,value in pairs:
        require(key not in obj, 'DUPLICATE_JSON_KEY')
        obj[key] = value
    return obj


def main(argv=None):
    parser = SafeParser(description='A6 TEST-only local sender. Real Meta dispatch is blocked; no production mode.')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--test-only', action='store_true')
    parser.add_argument('--input', help='Local JSON input; never a URL')
    parser.add_argument('--ledger', help='Private durable SQLite file for TEST-only dispatch')
    parser.add_argument('--offline-fixture', action='store_true', help='Synthetic data stays on this machine')
    parser.add_argument('--offline-now', type=int, help='Clock solely for synthetic offline fixtures')
    try:
        args = parser.parse_args(argv)
        # Gate BEFORE input or credential reads. There is no credential reader in this module.
        require(args.offline_fixture, 'DATASET_PERMISSION_UNKNOWN')
        require(args.input and args.offline_now is not None, 'OFFLINE_INPUT_AND_CLOCK_REQUIRED')
        path = Path(args.input)
        require(path.stat().st_size <= 65536, 'INPUT_TOO_LARGE')
        row = json.loads(path.read_text(), object_pairs_hook=unique_object)
        if args.dry_run:
            payload = build_request(row, now=args.offline_now, offline=True)
            result = {'state':'DRY_RUN_TEST_OFFLINE', 'record_kind':'TEST',
                      'evidence_level':'SYNTHETIC_OFFLINE_ONLY', 'request':payload,
                      'dataset_id':OFFLINE_DATASET_ID, 'external_posts':0,
                      'excluded_from_money_reporting':True,
                      'platform_acceptance_observed':False, 'attribution_observed':False}
        else:
            require(args.ledger is not None, 'DURABLE_LEDGER_REQUIRED')
            result = dispatch(row, ledger=args.ledger, transport=OfflineTransport(),
                              now=args.offline_now, offline=True)
        print(canonical(result))
        return 0
    except Blocked as exc:
        print(canonical({'state':'BLOCKED', 'reason':str(exc), 'external_posts':0}))
        return 3
    except Exception:
        # Do not leak file paths, source values, database bytes, or parser excerpts.
        print(canonical({'state':'BLOCKED', 'reason':'LOCAL_INPUT_OR_LEDGER_ERROR', 'external_posts':0}))
        return 3


if __name__ == '__main__':
    raise SystemExit(main())
