-- Phase 5 durable review capture. Local/D1 rows are held by default; applying
-- this staged migration to any provider requires a separate release gate.
PRAGMA foreign_keys = ON;

-- Legacy W16 capture remains for backwards-compatible readback of already
-- staged synthetic receipts. The Phase 5 intake writes the normalized v2 table
-- below and does not make legacy rows public.
CREATE TABLE IF NOT EXISTS review_submissions (
  review_id TEXT PRIMARY KEY,
  subject_name TEXT NOT NULL,
  experience_type TEXT NOT NULL CHECK(experience_type IN ('provider','pharmacy')),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  headline TEXT NOT NULL,
  review_body TEXT NOT NULL,
  first_name TEXT NOT NULL,
  verification_email TEXT NOT NULL,
  occurred_month TEXT NOT NULL,
  truthful_attestation INTEGER NOT NULL CHECK(truthful_attestation = 1),
  moderation_consent INTEGER NOT NULL CHECK(moderation_consent = 1),
  moderation_status TEXT NOT NULL DEFAULT 'held_manual_review' CHECK(moderation_status IN ('held_manual_review','verification_pending','approved','rejected','withdrawn')),
  publish_approved INTEGER NOT NULL DEFAULT 0 CHECK(publish_approved IN (0,1)),
  moderation_notes TEXT,
  verified_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(publish_approved = 0 OR moderation_status = 'approved')
);
CREATE INDEX IF NOT EXISTS idx_review_submissions_moderation ON review_submissions(moderation_status, created_at);
CREATE INDEX IF NOT EXISTS idx_review_submissions_subject ON review_submissions(experience_type, subject_name, created_at);

CREATE TABLE IF NOT EXISTS review_evidence (
  evidence_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES review_submissions(review_id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 2097152),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 16),
  moderation_status TEXT NOT NULL DEFAULT 'held_manual_review' CHECK(moderation_status IN ('held_manual_review','approved','rejected','deleted')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_evidence_review ON review_evidence(review_id);
CREATE TABLE IF NOT EXISTS review_evidence_chunks (
  evidence_id TEXT NOT NULL REFERENCES review_evidence(evidence_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 15),
  body_base64 TEXT NOT NULL,
  PRIMARY KEY (evidence_id, chunk_index)
);

-- Phase 5 v2 stores the complete first review and its optional opposite-entity
-- counterpart in one moderation unit. Every future-public field, the private
-- verification contact, attestations, and the submitted timestamp are durable.
CREATE TABLE IF NOT EXISTS review_intake_submissions (
  review_id TEXT PRIMARY KEY,
  public_display_name TEXT NOT NULL CHECK(length(public_display_name) BETWEEN 1 AND 60),
  verification_email TEXT NOT NULL,
  primary_entity_name TEXT NOT NULL,
  primary_entity_type TEXT NOT NULL CHECK(primary_entity_type IN ('provider','pharmacy')),
  primary_product TEXT NOT NULL CHECK(primary_product IN ('compounded_semaglutide','compounded_tirzepatide','ozempic','wegovy','wegovy_pill','mounjaro','zepbound','other_or_unsure')),
  primary_rating INTEGER NOT NULL CHECK(primary_rating BETWEEN 1 AND 5),
  primary_review_type TEXT NOT NULL CHECK(primary_review_type IN ('overall_experience','billing_and_cost','service_and_support','fulfillment','other')),
  primary_headline TEXT NOT NULL,
  primary_review_body TEXT NOT NULL,
  primary_experience_date TEXT NOT NULL,
  counterpart_entity_name TEXT,
  counterpart_entity_type TEXT CHECK(counterpart_entity_type IN ('provider','pharmacy')),
  counterpart_product TEXT CHECK(counterpart_product IN ('compounded_semaglutide','compounded_tirzepatide','ozempic','wegovy','wegovy_pill','mounjaro','zepbound','other_or_unsure')),
  counterpart_rating INTEGER CHECK(counterpart_rating BETWEEN 1 AND 5),
  counterpart_review_type TEXT CHECK(counterpart_review_type IN ('overall_experience','billing_and_cost','service_and_support','fulfillment','other')),
  counterpart_headline TEXT,
  counterpart_review_body TEXT,
  counterpart_experience_date TEXT,
  truthful_attestation INTEGER NOT NULL CHECK(truthful_attestation = 1),
  privacy_attestation INTEGER NOT NULL CHECK(privacy_attestation = 1),
  moderation_consent INTEGER NOT NULL CHECK(moderation_consent = 1),
  moderation_status TEXT NOT NULL DEFAULT 'held_manual_review' CHECK(moderation_status IN ('held_manual_review','verification_pending','approved','rejected','withdrawn')),
  publish_approved INTEGER NOT NULL DEFAULT 0 CHECK(publish_approved IN (0,1)),
  moderation_notes TEXT,
  verified_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(publish_approved = 0 OR moderation_status = 'approved'),
  CHECK(
    (counterpart_entity_name IS NULL AND counterpart_entity_type IS NULL AND counterpart_product IS NULL AND counterpart_rating IS NULL AND counterpart_review_type IS NULL AND counterpart_headline IS NULL AND counterpart_review_body IS NULL AND counterpart_experience_date IS NULL)
    OR
    (counterpart_entity_name IS NOT NULL AND counterpart_entity_type IS NOT NULL AND counterpart_product IS NOT NULL AND counterpart_rating IS NOT NULL AND counterpart_review_type IS NOT NULL AND counterpart_headline IS NOT NULL AND counterpart_review_body IS NOT NULL AND counterpart_experience_date IS NOT NULL AND counterpart_entity_type <> primary_entity_type)
  )
);
CREATE INDEX IF NOT EXISTS idx_review_intake_moderation ON review_intake_submissions(moderation_status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_review_intake_primary_entity ON review_intake_submissions(primary_entity_type, primary_entity_name, submitted_at);
CREATE INDEX IF NOT EXISTS idx_review_intake_counterpart_entity ON review_intake_submissions(counterpart_entity_type, counterpart_entity_name, submitted_at);

-- Evidence is role-scoped so the primary and counterpart records can each carry
-- one held file while the request-level combined-byte limit remains 2 MB.
CREATE TABLE IF NOT EXISTS review_intake_evidence (
  evidence_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES review_intake_submissions(review_id) ON DELETE CASCADE,
  review_role TEXT NOT NULL CHECK(review_role IN ('primary','counterpart')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 2097152),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 16),
  moderation_status TEXT NOT NULL DEFAULT 'held_manual_review' CHECK(moderation_status IN ('held_manual_review','approved','rejected','deleted')),
  created_at TEXT NOT NULL,
  UNIQUE(review_id, review_role)
);
CREATE TABLE IF NOT EXISTS review_intake_evidence_chunks (
  evidence_id TEXT NOT NULL REFERENCES review_intake_evidence(evidence_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 15),
  body_base64 TEXT NOT NULL,
  PRIMARY KEY (evidence_id, chunk_index)
);

-- Public readers and counts must use this approval-gated view. Held,
-- verification-pending, rejected, withdrawn, and legacy rows cannot enter it.
CREATE VIEW IF NOT EXISTS approved_review_publication AS
SELECT
  review_id,
  public_display_name,
  primary_entity_name,
  primary_entity_type,
  primary_product,
  primary_rating,
  primary_review_type,
  primary_headline,
  primary_review_body,
  primary_experience_date,
  counterpart_entity_name,
  counterpart_entity_type,
  counterpart_product,
  counterpart_rating,
  counterpart_review_type,
  counterpart_headline,
  counterpart_review_body,
  counterpart_experience_date,
  submitted_at,
  approved_at
FROM review_intake_submissions
WHERE moderation_status = 'approved' AND publish_approved = 1;
