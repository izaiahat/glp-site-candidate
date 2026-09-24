"""TEST SUPPORT ONLY: fictional evidence, never live grants or a D2n adapter.
No uploader imports this module. Only tests may construct the simulator.
"""
import copy
import hashlib
import json

def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('utf-8')).hexdigest()

def source_digest(row):
    value = copy.deepcopy(row)
    for key in ('proof', 'probe_ref', 'permission_sha256', 'event_permission'):
        value.pop(key, None)
    value.get('consent', {}).pop('checked_at', None)
    return sha(value)

class LOCAL_ONLY_FictionalTrustedStore:
    """Isolated mutable store to exercise rereads/revocation without any I/O."""
    local_only = True
    def __init__(self, snapshot, now):
        self.snapshot = copy.deepcopy(snapshot)
        self.now = now
        self.calls = 0
        self.on_read = None
    def now_ms(self):
        return self.now
    def resolve_current(self, platform, permission_ref, probe_ref, consent_receipt_id):
        self.calls += 1
        if self.on_read:
            self.on_read(self)
        p, c, b = (self.snapshot[k] for k in ('permission', 'consent', 'probe'))
        if (platform, permission_ref, probe_ref, consent_receipt_id) != (p['platform'], p['evidence_ref'], b['probe_ref'], c['receipt_id']):
            return None
        return copy.deepcopy(self.snapshot)

def attach(row, platform, now_ms, target=None):
    """Explicitly register a fictional source before exercising real guards."""
    account = {'google':'1177599039','meta':'OFFLINE_ACCOUNT','microsoft':'189346863'}[platform]
    target = target or {'google': row.get('action', {}).get('resource_name'), 'meta':'999999999999999', 'microsoft':'TEST_GOAL_NOT_PLATFORM_ID'}[platform]
    name = {'google':'TEST_A12_Google_B2BInquiry', 'meta':'TEST_A12_Meta_B2BInquiry', 'microsoft':'TEST_A12_Microsoft_B2BInquiry'}[platform]
    scope = dict(platform=platform, account_id=account, target_id=target, origin='https://fictional.invalid', source_ref='TEST_OWNED_ADMIN_SOURCE', source_revision='TEST_REVISION_1', subject_ref='TEST_SUBJECT', event_name=name, event_class='non_sensitive_b2b', purpose='ad_measurement', is_test=True)
    p = dict(scope, schema='a12-platform-permission-v1', evidence_ref='TEST_PERMISSION_'+platform, revision=1, status='OFFLINE_FIXTURE_ONLY', issuer_id='FICTIONAL_ISSUER', reviewer_id='FICTIONAL_REVIEWER', review_ref='TEST_REVIEW', issued_at_ms=now_ms-600000, expires_at_ms=now_ms+600000, revocation_epoch=0, probe_ref='TEST_PROBE_'+platform, allowed_identifiers={'capture':{'google':['gclid'],'meta':['fbclid','fbc','fbp'],'microsoft':['msclkid']}[platform], 'export':{'google':['gclid'],'meta':['fbc','fbp'],'microsoft':['msclkid']}[platform]})
    p.pop('subject_ref')
    p['allowed_payload_fields'] = {
        'google':['conversion_action','conversion_date_time','gclid','conversion_value','currency_code','order_id','consent.ad_user_data','consent.ad_personalization'],
        'meta':['event_name','event_time','event_id','action_source','user_data.fbc','user_data.fbp'],
        'microsoft':['ConversionName','ConversionTime','MicrosoftClickId','ConversionValue','ConversionCurrencyCode'],
    }[platform]
    digest = sha(p)
    c = dict(scope, receipt_id='TEST_CONSENT_'+platform, permission_ref=p['evidence_ref'], permission_revision=1, permission_sha256=digest, probe_ref=p['probe_ref'], issued_at_ms=now_ms-500000, expires_at_ms=now_ms+300000, revocation_epoch=0, withdrawn=False, gpc=False, ad_storage='granted', ad_user_data='granted', ad_personalization='denied', choice='explicit_opt_in')
    c['event_names'] = [c.pop('event_name')]
    c.pop('event_class')
    b = dict(scope, probe_ref=p['probe_ref'], permission_sha256=digest, consent_receipt_id=c['receipt_id'], consent_sha256=sha(c), issued_at_ms=now_ms-400000, expires_at_ms=now_ms+200000, revocation_epoch=0, status='REGISTERED', source_sha256=source_digest(row))
    row.update(probe_ref=p['probe_ref'], permission_sha256=digest, proof=dict(scope, permission_ref=p['evidence_ref'], consent_receipt_id=c['receipt_id']))
    if platform == 'microsoft':
        row['event_permission'] = digest
    return LOCAL_ONLY_FictionalTrustedStore(dict(permission=p, consent=c, probe=b, current_revocation_epoch=0), now_ms)
