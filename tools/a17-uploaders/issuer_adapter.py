"""Read-only authoritative SQLite seam for LOCAL synthetic A17 dry runs.

Not a network/D1 client or production authorizer. Database writer is the issuer,
not the submitted uploader row. Each call opens a new coherent read transaction.
"""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit
from jsonschema import Draft202012Validator, FormatChecker

SCHEMA = json.loads((Path(__file__).parent/'issuer-record.schema.json').read_text())
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())

def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('DUPLICATE_ISSUER_KEY')
        result[key] = value
    return result

def parse(raw):
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('NONFINITE_JSON')))

class StagingIssuerResolver:
    local_only = True

    def __init__(self, database, *, clock=None, timeout=0.1):
        self.database = Path(database).resolve()
        self.clock = clock or (lambda: time.time_ns() // 1000000)
        self.timeout = timeout
        self.calls = 0

    def now_ms(self):
        return self.clock()

    def resolve_current(self, platform, permission_ref, probe_ref, consent_receipt_id):
        self.calls += 1
        try:
            with closing(sqlite3.connect(self.database.as_uri()+'?mode=ro', uri=True, timeout=self.timeout)) as db:
                db.execute('PRAGMA query_only=ON')
                db.execute('BEGIN')
                def record(table, key, value, column):
                    rows = db.execute(f'SELECT {column} FROM {table} WHERE {key}=?', (value,)).fetchall()
                    if len(rows) != 1:
                        raise ValueError('ISSUER_RECORD_ABSENT_OR_AMBIGUOUS')
                    return parse(rows[0][0])
                p = record('a6_platform_event_permissions', 'evidence_ref', permission_ref, 'permission_json')
                c = record('a6_advertising_consent_receipts', 'receipt_id', consent_receipt_id, 'consent_json')
                b = record('a17_issuer_probes', 'probe_ref', probe_ref, 'probe_json')
                if b.get('kind') != 'a17-uploader-source-v1':
                    raise ValueError('TYPED_UPLOADER_SOURCE_REQUIRED')
                if b.get('kind') == 'a17-uploader-source-v1':
                    from send_proof import canonical_sha256
                    s=record('a17_issuer_scopes','permission_ref',permission_ref,'scope_json')
                    r=record('a17_issuer_reviews','review_ref',p['review_ref'],'review_json')
                    now=self.now_ms()
                    if (s['expires_at_ms'] <= now or s['purge_healthy_until_ms'] <= now or r['expires_at_ms'] <= now or
                        r['status'] != 'STAGING_FIXTURE_ONLY' or r['is_test'] is not True or
                        r['review_ref'] != p['review_ref'] or r['reviewer_id'] != p['reviewer_id'] or p['reviewer_id'] == p['issuer_id'] or
                        hashlib.sha256(s['notice'].encode('utf-8')).hexdigest() != p['notice_sha256'] or
                        r['permission_sha256'] != canonical_sha256(p) or r['scope_sha256'] != canonical_sha256(s) or
                        s['transport'] != {'meta':'meta_capi','microsoft':'microsoft_offline'}.get(platform) or
                        any(s[k] != p[k] for k in ('platform','origin','target_id','source_ref','source_revision','review_ref')) or
                        any(s[k] is not True for k in ('containment','notice_approved','retention_approved'))):
                        raise ValueError('CURRENT_REVIEW_SCOPE_DENIED')
                    if b.get('permission_ref') != permission_ref:
                        raise ValueError('PROBE_SCOPE_MISMATCH')
                    session = record('a17_issuer_sessions','session_id',b['session_id'],'session_json')
                    if (session['session_id'] != b['session_id'] or session['scope_id'] != s['id'] or
                        session['origin'] != p['origin'] or session['epoch'] != p['revocation_epoch'] or
                        session['gpc'] is not False or session['jurisdiction'] != 'TEST_SUPPORTED' or session['age_policy'] != 'TEST_ADULT' or
                        session['issued_at_ms'] > now or session['subject_ref'] != c['subject_ref'] or
                        session['permission_ref'] != permission_ref or session['expires_at_ms'] <= now):
                        raise ValueError('PROBE_SESSION_MISMATCH')
                    b = b['probe']
                VALIDATOR.validate(p)
                VALIDATOR.validate(c)
                if p['platform'] != platform or p['evidence_ref'] != permission_ref or c['receipt_id'] != consent_receipt_id or b['probe_ref'] != probe_ref:
                    raise ValueError('ISSUER_SELECTOR_MISMATCH')
                # Synthetic staging authority is explicit, never inferred from is_test.
                host = urlsplit(p['origin']).hostname or ''
                if not host.endswith('.invalid') or not p['is_test'] or p['status'] != 'ELIGIBLE':
                    raise ValueError('LOCAL_SYNTHETIC_SCOPE_REQUIRED')
                if not c['issuer_id'].startswith('TEST_') or any(c[k] != p[k] for k in ('notice_version','notice_sha256')):
                    raise ValueError('CONSENT_ISSUER_NOTICE_MISMATCH')
                if not p['issued_at_ms'] <= c['choice_at_ms'] <= c['issued_at_ms'] < c['expires_at_ms'] <= p['expires_at_ms']:
                    raise ValueError('CONSENT_CHOICE_TIME_INVALID')
                if p['source_type'] != 'owned_b2b_inquiry' or p['event_class'] != 'non_sensitive_b2b' or b.get('source_kind') != 'TEST_SERVER_OWNED_ADMINISTRATIVE_INQUIRY':
                    raise ValueError('SOURCE_NOT_ADMINISTRATIVE_B2B')
                for field in ('evidence_ref','issuer_id','review_ref','reviewer_id','source_ref','source_revision','ownership_evidence_ref','lawful_basis_review_ref','retention_policy_ref','erasure_owner','transport_contract_ref'):
                    if not p[field].startswith('TEST_'):
                        raise ValueError('SYNTHETIC_EVIDENCE_REQUIRED')
                for tos in p['tos_refs']:
                    if not tos['account_acceptance_ref'].startswith('TEST_'):
                        raise ValueError('SYNTHETIC_EVIDENCE_REQUIRED')
                exact_epoch = db.execute('SELECT epoch FROM a17_issuer_revocations WHERE subject_ref=? AND permission_ref=?',(c['subject_ref'],permission_ref)).fetchall()
                if len(exact_epoch) != 1:
                    raise ValueError('REVOCATION_STATE_MISSING')
                epochs = db.execute('SELECT epoch FROM a17_issuer_revocations WHERE subject_ref IN (?, ?) AND permission_ref IN (?, ?)', (c['subject_ref'], '*', permission_ref, '*')).fetchall()
                if any(type(r[0]) is not int or r[0] < 0 for r in epochs):
                    raise ValueError('REVOCATION_STATE_INVALID')
                epoch = max(r[0] for r in epochs)
                return dict(permission=p, consent=c, probe=b, current_revocation_epoch=epoch)
        except Exception:
            raise ValueError('ISSUER_UNAVAILABLE_OR_INVALID') from None
