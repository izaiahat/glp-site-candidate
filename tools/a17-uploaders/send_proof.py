"""A6 send-time authority seam. No issuer, browser trust, store or live adapter.

Trusted runtime resolver must implement resolve_current(platform, permission_ref,
probe_ref, consent_receipt_id) and now_ms(). It must return a fresh, atomic store
snapshot on EVERY read, including current revocations and authenticated source
binding; lookup failure is denial. A supplied input dictionary is not a resolver.
"""
import copy
import hashlib
import json
import re

PROOF_FIELDS = {'proof', 'probe_ref', 'permission_sha256'}
SCOPE = ('platform','account_id','target_id','origin','source_ref','source_revision',
         'purpose','is_test')
EVENTS = {'google':'TEST_A12_Google_B2BInquiry', 'meta':'TEST_A12_Meta_B2BInquiry',
          'microsoft':'TEST_A12_Microsoft_B2BInquiry'}
CAPTURE = {'google':{'gclid'}, 'meta':{'fbclid','fbc','fbp'}, 'microsoft':{'msclkid'}}
EXPORT = {'google':{'gclid'}, 'meta':{'fbc','fbp'}, 'microsoft':{'msclkid'}}
PAYLOAD_FIELDS = {
    'google': {'conversion_action','conversion_date_time','gclid','conversion_value','currency_code','order_id','consent.ad_user_data','consent.ad_personalization'},
    'meta': {'event_name','event_time','event_id','action_source','user_data.fbc','user_data.fbp'},
    'microsoft': {'ConversionName','ConversionTime','MicrosoftClickId','ConversionValue','ConversionCurrencyCode'},
}

class ProofDenied(ValueError):
    pass

def require(ok, reason):
    if not ok:
        raise ProofDenied(reason)

def canonical_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('utf-8')).hexdigest()

def source_sha256(row):
    value = copy.deepcopy(row)
    for key in (*PROOF_FIELDS, 'event_permission'):
        value.pop(key, None)
    value.get('consent', {}).pop('checked_at', None)
    return canonical_sha256(value)

def verify(row, platform, account, target, resolver, *, local_only):
    """Verify fresh trusted permission + consent + probe, never row assertions.

    Source digest binds the full owned source row (including click tuple and
    payload fields), excluding proof envelope and volatile checked_at only.
    Runtime source adapter must register it from authoritative source, not input.
    """
    require(resolver is not None and not isinstance(resolver, dict), 'TRUSTED_PROOF_REQUIRED')
    try:
        proof = row['proof']
        digest, probe_ref = row['permission_sha256'], row['probe_ref']
        require(type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest) is not None and type(probe_ref) is str and bool(probe_ref), 'PROOF_REFERENCE_INVALID')
        row_digest = canonical_sha256(row)
        snapshot = resolver.resolve_current(platform, proof['permission_ref'], probe_ref, proof['consent_receipt_id'])
        require(canonical_sha256(row) == row_digest, 'SOURCE_MUTATED_DURING_REVALIDATION')
        require(type(snapshot) is dict, 'TRUSTED_PROOF_UNREGISTERED')
        now = resolver.now_ms()  # server/store clock, never queued row time
        require(type(now) is int and now > 0, 'TRUSTED_CLOCK_INVALID')
        p, c, b = (snapshot[k] for k in ('permission','consent','probe'))
        require(canonical_sha256(p) == digest, 'PERMISSION_DIGEST_MISMATCH')
        require(p['evidence_ref'] == proof['permission_ref'] and c['receipt_id'] == proof['consent_receipt_id'], 'PROOF_REFERENCE_MISMATCH')
        require(p['platform'] == platform and p['account_id'] == account and p['target_id'] == target, 'PROOF_PLATFORM_SCOPE_MISMATCH')
        require(p['purpose'] == 'ad_measurement' and p['event_class'] == 'non_sensitive_b2b' and p['event_name'] == EVENTS[platform], 'SOURCE_EVENT_NOT_PERMITTED')
        require(p['is_test'] is True, 'PROOF_TEST_REQUIRED')
        require(c['subject_ref'] == b['subject_ref'] == proof['subject_ref'], 'PROOF_SUBJECT_MISMATCH')
        require(c['event_names'] == [p['event_name']] and b['event_name'] == proof['event_name'] == p['event_name'], 'PROOF_EVENT_MISMATCH')
        require(proof['event_class'] == p['event_class'], 'PROOF_EVENT_CLASS_MISMATCH')
        # A17 explicitly local full-schema adapter: preserve the whole issued
        # record and digest. Legacy fictional subsets remain a distinct path.
        from issuer_adapter import StagingIssuerResolver
        full_staging = type(resolver) is StagingIssuerResolver
        require(not full_staging or local_only is True, 'STAGING_ONLY')
        require(p['status'] == ('ELIGIBLE' if full_staging or not local_only else 'OFFLINE_FIXTURE_ONLY'), 'PERMISSION_NOT_CURRENT')
        if local_only:
            require(getattr(resolver, 'local_only', False) is True and p['origin'].startswith('https://') and p['origin'].endswith('.invalid'), 'FICTIONAL_PROOF_NOT_LOCAL')
        else:
            require(getattr(resolver, 'local_only', False) is False, 'FICTIONAL_PROOF_FORBIDDEN')
        epoch = snapshot['current_revocation_epoch']
        require(type(epoch) is int and epoch >= 0, 'REVOCATION_STATE_UNKNOWN')
        for record in (p, c, b):
            require(all(record[k] == p[k] == proof[k] for k in SCOPE), 'PROOF_SCOPE_MISMATCH')
            require(record['is_test'] is True and record['probe_ref'] == probe_ref, 'PROBE_BINDING_MISMATCH')
            require(type(record['revocation_epoch']) is int and record['revocation_epoch'] == epoch, 'PROOF_REVOKED')
            issued, expires = record['issued_at_ms'], record['expires_at_ms']
            require(type(issued) is int and type(expires) is int and 0 < issued <= now < expires, 'PROOF_EXPIRED_OR_FUTURE')
        require(c['permission_ref'] == p['evidence_ref'] and c['permission_revision'] == p['revision'] and c['permission_sha256'] == digest == b['permission_sha256'], 'PERMISSION_BINDING_MISMATCH')
        require(c['withdrawn'] is False and c['gpc'] is False and c['choice'] == 'explicit_opt_in' and c['ad_storage'] == c['ad_user_data'] == 'granted' and c['ad_personalization'] == 'denied', 'TRUSTED_CONSENT_DENIED')
        require(b['status'] == 'REGISTERED' and b['consent_receipt_id'] == c['receipt_id'] and b['consent_sha256'] == canonical_sha256(c), 'PROBE_CONSENT_MISMATCH')
        require(b['source_sha256'] == source_sha256(row), 'AUTHENTIC_SOURCE_BINDING_MISMATCH')
        identifiers = p['allowed_identifiers']
        require(type(identifiers) is dict and set(identifiers) == {'capture','export'}, 'IDENTIFIER_PERMISSION_INVALID')
        for values in identifiers.values():
            require(type(values) is list and bool(values) and all(type(v) is str for v in values) and len(values) == len(set(values)), 'IDENTIFIER_PERMISSION_INVALID')
        require(set(identifiers['capture']) <= CAPTURE[platform] and set(identifiers['export']) <= EXPORT[platform], 'IDENTIFIER_PERMISSION_INVALID')
        used = set(row['identifiers']) if platform == 'meta' else ({k for k in ('gclid','gbraid','wbraid') if row['click'].get(k) is not None} if platform == 'google' else {'msclkid'})
        require(bool(used) and used <= set(identifiers['export']), 'IDENTIFIER_EXPORT_DENIED')
        fields = PAYLOAD_FIELDS[platform]
        if platform == 'meta':
            fields = fields - {'user_data.'+k for k in EXPORT[platform]-used}
        require(type(p['allowed_payload_fields']) is list and fields <= set(p['allowed_payload_fields']) <= PAYLOAD_FIELDS[platform], 'PAYLOAD_FIELD_PERMISSION_DENIED')
        if platform == 'microsoft':
            require(row['event_permission'] == digest, 'PERMISSION_DIGEST_MISMATCH')
        return digest
    except ProofDenied:
        raise
    except Exception:
        raise ProofDenied('TRUSTED_PROOF_INVALID_OR_UNAVAILABLE') from None
