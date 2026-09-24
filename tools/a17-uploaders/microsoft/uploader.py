"""A6 isolated local-only Microsoft offline contract. No network transport."""
from decimal import Decimal

URL = 'https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply'
ACCOUNT = '189346863'
CUSTOMER = '255039117'

from datetime import datetime, timedelta, timezone
import re
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from send_proof import verify, ProofDenied, PROOF_FIELDS

EVENT_KEYS = set('provenance test account_id goal_name network network_account conversion_id cs_click_id program_id event_status approval_source health_context event_permission occurred_at commission_minor currency consent click'.split())
EVENT_KEYS |= PROOF_FIELDS
CLICK_KEYS = set('cs_click_id network network_account program_id account_id msclkid observed_msclkid capture_source captured_at consent_version'.split())
CONSENT_KEYS = set('version ad_storage ad_user_data withdrawn gpc expires_at'.split())
# Intentionally narrow supported currencies; others require a reviewed exponent contract.
EXPONENTS = {'USD': 2, 'EUR': 2, 'GBP': 2, 'CAD': 2, 'AUD': 2, 'JPY': 0}

def require(condition, code):
    if not condition:
        raise ValueError(code)

def utc(value):
    require(isinstance(value, str) and value.endswith('Z'), 'UTC_REQUIRED')
    try:
        return datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        raise ValueError('UTC_INVALID') from None

def exact_keys(value, keys):
    require(isinstance(value, dict) and set(value) == keys, 'FIELD_ALLOWLIST')

def proof_target(event, setup):
    goals = setup.get('offline_goals', {}).get('ConversionGoals', [])
    matches = [g for g in goals if g.get('Name') == event.get('goal_name') and g.get('Type') == 'OfflineConversion']
    return str(matches[0]['Id']) if len(matches) == 1 and matches[0].get('Id') is not None else None

def prepare(event, setup, now, *, resolver=None):
    verify(event, 'microsoft', ACCOUNT, proof_target(event, setup), resolver, local_only=True)
    exact_keys(event, EVENT_KEYS)
    click, consent = event['click'], event['consent']
    exact_keys(click, CLICK_KEYS)
    exact_keys(consent, CONSENT_KEYS)
    require(event['test'] is True and event['provenance'] == 'SYNTHETIC_LOCAL_ONLY', 'TEST_FIXTURE_ONLY')
    require(event['account_id'] == setup.get('account_id') == ACCOUNT, 'ACCOUNT_MISMATCH')
    require(event['health_context'] is False and event['event_permission'] == event['permission_sha256'], 'HEALTH_OR_PERMISSION_BLOCK')
    require(event['event_status'] == 'approved' and event['approval_source'] == 'authenticated_test_fixture', 'APPROVAL_UNPROVEN')
    for key in ('network', 'network_account', 'conversion_id', 'cs_click_id', 'program_id'):
        require(isinstance(event[key], str) and re.fullmatch(r'TEST_[A-Z0-9_]{1,80}', event[key]), 'TEST_ID_REQUIRED')
    for key in ('cs_click_id', 'network', 'network_account', 'program_id', 'account_id'):
        require(event[key] == click[key], 'CLICK_BINDING_MISMATCH')
    require(consent['ad_storage'] == consent['ad_user_data'] == 'granted'
            and consent['withdrawn'] is False and consent['gpc'] is False
            and utc(consent['expires_at']) > now, 'CONSENT_BLOCK')
    require(isinstance(consent['version'], str) and consent['version'] and click['consent_version'] == consent['version'], 'CONSENT_BINDING')
    from issuer_adapter import StagingIssuerResolver
    expected_capture = ('synthetic_owned_b2b_inquiry_fixture' if type(resolver) is StagingIssuerResolver else 'synthetic_landing_to_go_fixture')
    require(click['capture_source'] == expected_capture, 'CAPTURE_UNPROVEN')
    require(isinstance(click['msclkid'], str) and re.fullmatch(r'[A-Za-z0-9_-]{16,128}', click['msclkid'])
            and click['msclkid'] == click['observed_msclkid'], 'MSCLKID_BINDING')
    goals = setup.get('offline_goals', {})
    require(goals.get('PartialErrors') == [], 'GOAL_INVENTORY_UNCERTAIN')
    matches = [g for g in goals.get('ConversionGoals', []) if g.get('Name') == event['goal_name'] and g.get('Type') == 'OfflineConversion']
    require(len(matches) == 1, 'EXACT_OFFLINE_GOAL_ABSENT_OR_AMBIGUOUS')
    goal = matches[0]
    require(goal.get('Status') == 'Active' and goal.get('Scope') == 'Account'
            and goal.get('CountType') in ('All', 'Unique'), 'GOAL_CONFIGURATION_BLOCK')
    require(now - utc(goal.get('created_at')) >= timedelta(hours=2), 'GOAL_TWO_HOUR_WAIT')
    window = goal.get('ConversionWindowInMinutes')
    require(type(window) is int and 1 <= window <= 129600, 'GOAL_WINDOW_INVALID')
    sale, captured = utc(event['occurred_at']), utc(click['captured_at'])
    require(now - timedelta(days=90) <= sale <= now, 'UPLOAD_AGE_INVALID')
    require(captured < sale <= captured + timedelta(minutes=window), 'CLICK_WINDOW_INVALID')
    require(type(event['commission_minor']) is int and 0 <= event['commission_minor'] <= 10**12, 'COMMISSION_UNKNOWN_OR_INVALID')
    require(event['currency'] in EXPONENTS, 'CURRENCY_UNSUPPORTED')
    return {'method': 'POST', 'url': URL,
            'headers': {'CustomerAccountId': ACCOUNT, 'CustomerId': CUSTOMER,
                        'Content-Type': 'application/json'},
            'provenance': event['provenance'],
            'body': {'OfflineConversions': [{
                'ConversionCurrencyCode': event['currency'],
                'ConversionName': event['goal_name'],
                'ConversionTime': event['occurred_at'],
                'ConversionValue': float(Decimal(event['commission_minor']).scaleb(-EXPONENTS[event['currency']])),
                'MicrosoftClickId': event['click']['msclkid']}]}}


def run_test_only(event, setup, ledger, now, transport, *, resolver=None):
    """Dispatch ONLY to unittest.mock.Mock. No adapter, auth or socket code.

    Commit RESERVED before crossing even the simulated effect boundary. Every
    existing state blocks automatic replay, including an interrupted reservation.
    """
    import hashlib
    import json
    import sqlite3
    from unittest.mock import Mock
    require(isinstance(transport, Mock), 'ONLY_LOCAL_MOCK_TRANSPORT')
    request = prepare(event, setup, now, resolver=resolver)
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    identity = digest([event[k] for k in ('network','network_account','conversion_id','account_id','goal_name')])
    fingerprint = digest(request)
    row = request['body']['OfflineConversions'][0]
    vendor_key = digest([ACCOUNT, row['ConversionName'], row['MicrosoftClickId'], utc(row['ConversionTime']).isoformat()])
    base = {'test': True, 'provenance': 'SYNTHETIC_LOCAL_ONLY', 'attribution_observed': False,
            'platform_acceptance_observed': False, 'external_requests': 0,
            'money_reporting_eligible': False, 'identity_sha256': identity}
    with sqlite3.connect(ledger, timeout=30) as db:
        db.execute('PRAGMA synchronous=FULL')
        db.execute('CREATE TABLE IF NOT EXISTS exports (identity TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, vendor_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL, receipt TEXT)')
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT fingerprint,state FROM exports WHERE identity=?', (identity,)).fetchone()
        if existing:
            return dict(base, state='DUPLICATE_SUPPRESSED' if existing[0] == fingerprint else 'IDENTITY_CONFLICT', prior_state=existing[1])
        if db.execute('SELECT 1 FROM exports WHERE vendor_key=?', (vendor_key,)).fetchone():
            return dict(base, state='VENDOR_DUPLICATE_SUPPRESSED')
        db.execute('INSERT INTO exports VALUES (?,?,?,?,NULL)', (identity, fingerprint, vendor_key, 'RESERVED'))
        db.commit()
    state, codes = 'AMBIGUOUS', []
    try:
        verify(event, 'microsoft', ACCOUNT, proof_target(event, setup), resolver, local_only=True)
    except ProofDenied:
        with sqlite3.connect(ledger, timeout=30) as db:
            db.execute('UPDATE exports SET state=? WHERE identity=?', ('BLOCKED_PROOF',identity))
        raise
    try:
        response = transport(request)
        errors = response.get('PartialErrors') if isinstance(response, dict) else None
        if isinstance(errors, list):
            if not errors:
                state = 'MOCK_ACCEPTED_NOT_ATTRIBUTED'
            elif all(isinstance(e, dict) and type(e.get('Index')) is int and e['Index'] == 0 for e in errors):
                state = 'MOCK_REJECTED'
                codes = [e['Code'] for e in errors if type(e.get('Code')) is int]
        # Free-text API fields are never persisted, even in local error fixtures.
    except Exception:
        pass
    receipt = dict(base, state=state, partial_error_codes=codes)
    with sqlite3.connect(ledger, timeout=30) as db:
        db.execute('PRAGMA synchronous=FULL')
        db.execute('UPDATE exports SET state=?,receipt=? WHERE identity=?', (state, json.dumps(receipt, sort_keys=True), identity))
    return receipt


def main(argv=None):
    import argparse
    import json
    from pathlib import Path
    from unittest.mock import Mock
    parser = argparse.ArgumentParser(description='LOCAL TEST fixtures only; no network or production mode')
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--dry-run', action='store_true')
    modes.add_argument('--test-only', action='store_true', help='simulate one API response locally with durable reservation')
    parser.add_argument('--event', required=True, type=Path)
    parser.add_argument('--setup', required=True, type=Path)
    parser.add_argument('--ledger', type=Path)
    parser.add_argument('--now', help='Explicit synthetic fixture clock only; UTC Z')
    args = parser.parse_args(argv)
    try:
        event = json.loads(args.event.read_text())
        setup = json.loads(args.setup.read_text())
        now = utc(args.now) if args.now else datetime.now(timezone.utc)
        if args.dry_run:
            receipt = {'state': 'DRY_RUN_ONLY', 'test': True, 'external_requests': 0,
                       'platform_acceptance_observed': False, 'attribution_observed': False,
                       'money_reporting_eligible': False, 'request': prepare(event, setup, now)}
        else:
            require(args.ledger is not None, 'LEDGER_REQUIRED')
            receipt = run_test_only(event, setup, args.ledger, now, Mock(return_value={'PartialErrors': []}))
        print(json.dumps(receipt, sort_keys=True, allow_nan=False))
        return 0
    except ValueError as exc:
        # Only emit known fixed validation codes, never JSON parser content.
        reason = str(exc) if re.fullmatch(r'[A-Z_]{3,80}', str(exc)) else 'INVALID_INPUT'
    except (OSError, TypeError, KeyError, AttributeError):
        reason = 'INVALID_INPUT_OR_LOCAL_IO'
    print(json.dumps({'state':'BLOCKED','reason':reason,'external_requests':0,
                      'platform_acceptance_observed':False,'attribution_observed':False}))
    return 2

if __name__ == '__main__':
    raise SystemExit(main())
