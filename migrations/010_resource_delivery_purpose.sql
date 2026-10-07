-- Extend the event ledger only. Existing rows and marketing eligibility are
-- preserved; resource-only requests never create/reactivate subscribers.
CREATE TABLE contact_capture_events_resource_successor (
  capture_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  funnel_stage TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  source_context TEXT,
  review_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('marketing','verification-only','withdrawal','suppression','resource-delivery')),
  marketing_consent INTEGER NOT NULL CHECK(marketing_consent IN (0,1)),
  consent_status TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_source TEXT NOT NULL,
  consent_copy_sha256 TEXT NOT NULL CHECK(length(consent_copy_sha256) = 64),
  captured_at TEXT NOT NULL
);
INSERT INTO contact_capture_events_resource_successor SELECT * FROM contact_capture_events;
DROP TABLE contact_capture_events;
ALTER TABLE contact_capture_events_resource_successor RENAME TO contact_capture_events;
CREATE INDEX idx_contact_capture_events_email ON contact_capture_events(email, vertical, captured_at);
CREATE INDEX idx_contact_capture_events_surface ON contact_capture_events(source_surface, captured_at);
CREATE INDEX idx_contact_capture_events_review ON contact_capture_events(review_id, captured_at);
CREATE INDEX idx_contact_capture_events_effective_consent ON contact_capture_events(email, vertical, captured_at, purpose, marketing_consent);
