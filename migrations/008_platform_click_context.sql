-- A6 one-shot proposal ONLY, after D2 007 and independent integration review.
-- No remote application, backfill, consent issuance or policy approval here.
ALTER TABLE affiliate_click_map ADD COLUMN platform_context_json TEXT
  CHECK (platform_context_json IS NULL OR json_valid(platform_context_json));
CREATE TABLE a6_advertising_consent_receipts (
  receipt_id TEXT PRIMARY KEY,
  consent_json TEXT NOT NULL CHECK (json_valid(consent_json))
);
CREATE TABLE a6_platform_event_permissions (
  evidence_ref TEXT PRIMARY KEY,
  permission_json TEXT NOT NULL CHECK (json_valid(permission_json))
);
CREATE TABLE a6_platform_click_handoffs (
  handoff_token TEXT PRIMARY KEY CHECK (length(handoff_token)=64 AND handoff_token NOT GLOB '*[^0-9a-f]*'),
  click_token TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  consent_receipt_id TEXT NOT NULL REFERENCES a6_advertising_consent_receipts(receipt_id),
  permission_ref TEXT NOT NULL REFERENCES a6_platform_event_permissions(evidence_ref),
  context_json TEXT NOT NULL CHECK (json_valid(context_json))
);
-- Retention is NOT implicitly 90 days. Issuer must supply reviewed expiry;
-- resolver and exporter refuse expired/withdrawn grants. Purge adoption held.
