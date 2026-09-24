-- Exact landed Q48 table definitions; local tests only.
CREATE TABLE a6_advertising_consent_receipts (
  receipt_id TEXT PRIMARY KEY,
  consent_json TEXT NOT NULL CHECK (json_valid(consent_json))
);
CREATE TABLE a6_platform_click_handoffs (
  handoff_token TEXT PRIMARY KEY CHECK (length(handoff_token)=64 AND handoff_token NOT GLOB '*[^0-9a-f]*'),
  click_token TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  consent_receipt_id TEXT NOT NULL REFERENCES a6_advertising_consent_receipts(receipt_id),
  permission_ref TEXT NOT NULL REFERENCES a6_platform_event_permissions(evidence_ref),
  context_json TEXT NOT NULL CHECK (json_valid(context_json))
);
CREATE TABLE a6_platform_event_permissions (
  evidence_ref TEXT PRIMARY KEY,
  permission_json TEXT NOT NULL CHECK (json_valid(permission_json))
);
CREATE TABLE affiliate_click_map (
  click_token TEXT PRIMARY KEY CHECK(length(click_token) BETWEEN 16 AND 128),
  event_id TEXT NOT NULL UNIQUE CHECK(length(event_id) BETWEEN 16 AND 128),
  page_slug TEXT NOT NULL,
  link_position TEXT NOT NULL,
  program_id TEXT NOT NULL,
  merchant TEXT NOT NULL,
  variant TEXT NOT NULL,
  yyyymm TEXT NOT NULL CHECK(length(yyyymm) = 6),
  created_at TEXT NOT NULL,
  ivt_status TEXT NOT NULL,
  ua_class TEXT NOT NULL,
  referrer_class TEXT NOT NULL,
  analytics_consent TEXT NOT NULL,
  ga4_status TEXT NOT NULL,
  ga4_attempts INTEGER NOT NULL DEFAULT 0,
  reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  reconciled_at TEXT
, network TEXT, network_offer_id TEXT, network_account_ref TEXT, is_test INTEGER CHECK (is_test IS NULL OR is_test IN (0,1)), probe_ref TEXT, platform_context_json TEXT
  CHECK (platform_context_json IS NULL OR json_valid(platform_context_json)));
