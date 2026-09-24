// A12b closed vocabulary, not eligibility, a permission store or an exporter.
// Snapshot is pinned to the reviewed input bytes; changes need contract tests.
export const A12B_SCHEMA_SHA256 = "8fa102c8a82a7cf30430eed6e04ed1c41b46174388451ac01e1f28c2be13698a";
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const A12B_PLATFORMS = freeze({
  "meta": {
    "events": [
      "Lead",
      "TEST_A12_Meta_B2BInquiry",
      "TEST_A12_Meta_CaptureProbe"
    ],
    "identifiers": {
      "capture": [
        "fbclid",
        "fbc",
        "fbp"
      ],
      "export": [
        "fbc",
        "fbp"
      ]
    },
    "payload": [
      "event_name",
      "event_time",
      "event_id",
      "action_source",
      "event_source_url",
      "user_data.fbc",
      "user_data.fbp"
    ]
  },
  "microsoft": {
    "events": [
      "GCS_B2B_AdminInquiry",
      "gcs_b2b_admin_inquiry",
      "TEST_A12_Microsoft_B2BInquiry",
      "TEST_A12_Microsoft_CaptureProbe"
    ],
    "identifiers": {
      "capture": [
        "msclkid"
      ],
      "export": [
        "msclkid"
      ]
    },
    "payload": [
      "ConversionName",
      "ConversionTime",
      "MicrosoftClickId",
      "ConversionValue",
      "ConversionCurrencyCode"
    ]
  },
  "google": {
    "events": [
      "GCS_B2B_AdminInquiry",
      "TEST_A12_Google_B2BInquiry",
      "TEST_A12_Google_CaptureProbe"
    ],
    "identifiers": {
      "capture": [
        "gclid"
      ],
      "export": [
        "gclid"
      ]
    },
    "payload": [
      "conversion_action",
      "conversion_date_time",
      "gclid",
      "conversion_value",
      "currency_code",
      "order_id",
      "consent.ad_user_data",
      "consent.ad_personalization"
    ]
  }
});

// Python ensure_ascii=True encodes UTF-16 surrogate pairs and DEL as escapes.
function quote(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
function keyOrder(a, b) {
  const left = Array.from(a, c => c.codePointAt(0)), right = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
export function canonicalPermissionJSON(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw Error('canonical_integer_required');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalPermissionJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort(keyOrder).map(k => quote(k) + ':' + canonicalPermissionJSON(value[k])).join(',') + '}';
  throw Error('canonical_json_value_required');
}
const subset = (values, allowed) => Array.isArray(values) && values.length > 0 && new Set(values).size === values.length && values.every(v => typeof v === 'string' && allowed.includes(v));
export function validA12bVocabulary(permission) {
  const p = A12B_PLATFORMS[permission.platform], ids = permission.allowed_identifiers;
  return !!p && p.events.includes(permission.event_name) && ids !== null && typeof ids === 'object' && !Array.isArray(ids) &&
    Object.keys(ids).sort().join(',') === 'capture,export' && subset(ids.capture,p.identifiers.capture) && subset(ids.export,p.identifiers.export) && subset(permission.allowed_payload_fields,p.payload);
}
