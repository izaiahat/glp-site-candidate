-- Design Pass 4 canonical capture ledger. The existing subscribers table remains
-- the marketing-send eligibility source; this append-only ledger records every
-- first-party capture surface, including verification-only review contacts.
CREATE TABLE IF NOT EXISTS contact_capture_events (
  capture_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  funnel_stage TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  source_context TEXT,
  review_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('marketing','verification-only','withdrawal','suppression')),
  marketing_consent INTEGER NOT NULL CHECK(marketing_consent IN (0,1)),
  consent_status TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_source TEXT NOT NULL,
  consent_copy_sha256 TEXT NOT NULL CHECK(length(consent_copy_sha256) = 64),
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_capture_events_email
  ON contact_capture_events(email, vertical, captured_at);
CREATE INDEX IF NOT EXISTS idx_contact_capture_events_surface
  ON contact_capture_events(source_surface, captured_at);
CREATE INDEX IF NOT EXISTS idx_contact_capture_events_review
  ON contact_capture_events(review_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_contact_capture_events_effective_consent
  ON contact_capture_events(email, vertical, captured_at, purpose, marketing_consent);
