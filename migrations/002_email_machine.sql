-- D1 staging contract for leads, subscribers, Resend delivery, engagement, and EPC.
CREATE TABLE IF NOT EXISTS leads (
  lead_id TEXT PRIMARY KEY, first_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
  state TEXT NOT NULL, priority TEXT NOT NULL, source_page TEXT NOT NULL, provider_interest TEXT,
  privacy_consent INTEGER NOT NULL, marketing_consent INTEGER NOT NULL, contact_consent INTEGER NOT NULL,
  consent_version TEXT NOT NULL, created_at TEXT NOT NULL, email_send_authorized INTEGER NOT NULL DEFAULT 0,
  provider_share_authorized INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscribers (
  subscriber_id TEXT NOT NULL, email TEXT NOT NULL, first_name TEXT NOT NULL, vertical TEXT NOT NULL,
  funnel_stage TEXT NOT NULL, consent_status TEXT NOT NULL, consent_version TEXT NOT NULL,
  consent_source TEXT NOT NULL, consent_at TEXT NOT NULL, unsubscribe_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('active','sunset','unsubscribed','bounced','complained','suppressed')),
  next_drip_step INTEGER NOT NULL DEFAULT 1, next_send_at TEXT, last_engaged_at TEXT, last_sent_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (email, vertical)
);
CREATE INDEX IF NOT EXISTS idx_subscribers_due ON subscribers(status, next_send_at);
CREATE TABLE IF NOT EXISTS email_deliveries (
  delivery_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, subscriber_id TEXT NOT NULL,
  vertical TEXT NOT NULL, funnel_stage TEXT NOT NULL, message_type TEXT NOT NULL, sequence_step INTEGER,
  campaign_id TEXT NOT NULL, resend_email_id TEXT UNIQUE, featured_program_id TEXT, promo_code TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT, delivered_at TEXT, failed_at TEXT,
  unsubscribed_at TEXT, click_count INTEGER NOT NULL DEFAULT 0, valid_affiliate_clicks INTEGER NOT NULL DEFAULT 0,
  net_commission_micros INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_deliveries_campaign ON email_deliveries(campaign_id, status);
CREATE TABLE IF NOT EXISTS resend_webhook_events (
  svix_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, resend_email_id TEXT, occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL, payload_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_clicks (
  svix_id TEXT PRIMARY KEY, resend_email_id TEXT NOT NULL, clicked_url_class TEXT NOT NULL,
  click_token TEXT, occurred_at TEXT NOT NULL, UNIQUE(resend_email_id, svix_id)
);
CREATE TABLE IF NOT EXISTS newsletter_issues (
  issue_id TEXT PRIMARY KEY, vertical TEXT NOT NULL, week_key TEXT NOT NULL UNIQUE, subject TEXT NOT NULL,
  content_hash TEXT NOT NULL, featured_program_id TEXT, promo_code TEXT, status TEXT NOT NULL,
  operator_receipt_sha256 TEXT, created_at TEXT NOT NULL, sent_at TEXT
);
CREATE TABLE IF NOT EXISTS suppression_log (
  email TEXT NOT NULL, vertical TEXT NOT NULL, reason TEXT NOT NULL, source TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(email, vertical, reason, created_at)
);
