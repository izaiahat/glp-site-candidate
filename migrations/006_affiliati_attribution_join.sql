-- Candidate-only attribution contract. Applying this one-shot migration remotely requires a separate operator gate.
-- Existing rows remain nullable because no network/offer identity may be backfilled without source evidence.
ALTER TABLE affiliate_click_map ADD COLUMN network TEXT;
ALTER TABLE affiliate_click_map ADD COLUMN network_offer_id TEXT;

CREATE INDEX IF NOT EXISTS affiliate_click_map_network_offer_idx
  ON affiliate_click_map (network, network_offer_id, click_token);

CREATE TABLE IF NOT EXISTS analytics_revenue_ledger_v1 (
  ledger_row_id TEXT PRIMARY KEY CHECK (length(ledger_row_id) >= 16),
  revenue_event_id TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  network_account_ref TEXT,
  program_id TEXT NOT NULL,
  network_click_id TEXT,
  cs_click_id TEXT,
  conversion_id TEXT,
  order_ref_hash TEXT CHECK (order_ref_hash IS NULL OR length(order_ref_hash) = 64),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('accepted_click','accepted_conversion','commission','commission_status','payment','reversal')
  ),
  event_status TEXT NOT NULL,
  currency TEXT,
  order_amount_minor INTEGER,
  commission_minor INTEGER,
  occurred_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  source_file_sha256 TEXT NOT NULL CHECK (length(source_file_sha256) = 64),
  raw_row_sha256 TEXT NOT NULL CHECK (length(raw_row_sha256) = 64),
  attributes_json TEXT NOT NULL DEFAULT '{}',
  CHECK (network_click_id IS NOT NULL OR cs_click_id IS NOT NULL OR conversion_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_revenue_ledger_v1_network_conversion_idx
  ON analytics_revenue_ledger_v1 (network, conversion_id)
  WHERE conversion_id IS NOT NULL;
