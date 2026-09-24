-- A17 STAGING proposal only. Never replay 007/008 or apply remotely here.
-- Existing a6_* tables are the landed Q48 schema. Reviews have NO HTTP writer.
CREATE TABLE a17_issuer_reviews (review_ref TEXT PRIMARY KEY, review_json TEXT NOT NULL CHECK(json_valid(review_json)));
CREATE TABLE a17_issuer_scopes (scope_id TEXT PRIMARY KEY, permission_ref TEXT NOT NULL UNIQUE REFERENCES a6_platform_event_permissions(evidence_ref), scope_json TEXT NOT NULL CHECK(json_valid(scope_json)));
CREATE TABLE a17_issuer_sessions (session_id TEXT PRIMARY KEY, session_json TEXT NOT NULL CHECK(json_valid(session_json)));
CREATE TABLE a17_issuer_revocations (subject_ref TEXT NOT NULL, permission_ref TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch>=0), PRIMARY KEY(subject_ref,permission_ref));
CREATE TABLE a17_issuer_operations (op_key TEXT PRIMARY KEY, receipt_id TEXT NOT NULL UNIQUE REFERENCES a6_advertising_consent_receipts(receipt_id));
CREATE TABLE a17_issuer_probes (probe_ref TEXT PRIMARY KEY, probe_json TEXT NOT NULL CHECK(json_valid(probe_json)));
