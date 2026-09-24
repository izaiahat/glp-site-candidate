-- Staging D1 contract. Applying to production requires a separate operator gate.
CREATE TABLE IF NOT EXISTS affiliate_click_map (
  click_token TEXT PRIMARY KEY CHECK (
    (
      length(click_token) = 27
      AND substr(click_token, 1, 3) = 'c1-'
      AND substr(click_token, 4) NOT GLOB '*[^0-9a-f]*'
    )
    OR
    (
      length(click_token) = 36
      AND lower(click_token) = click_token
      AND substr(click_token, 9, 1) = '-'
      AND substr(click_token, 14, 1) = '-'
      AND substr(click_token, 15, 1) = '7'
      AND substr(click_token, 19, 1) = '-'
      AND substr(click_token, 20, 1) IN ('8', '9', 'a', 'b')
      AND substr(click_token, 24, 1) = '-'
      AND replace(click_token, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  event_id TEXT NOT NULL,
  page_slug TEXT NOT NULL,
  link_position TEXT NOT NULL,
  program_id TEXT NOT NULL,
  merchant TEXT NOT NULL,
  variant TEXT NOT NULL,
  yyyymm TEXT NOT NULL CHECK (length(yyyymm) = 6),
  created_at TEXT NOT NULL,
  ivt_status TEXT NOT NULL,
  ua_class TEXT NOT NULL,
  referrer_class TEXT NOT NULL,
  analytics_consent TEXT NOT NULL CHECK (analytics_consent IN ('granted','denied')),
  ga4_status TEXT NOT NULL,
  ga4_attempts INTEGER NOT NULL DEFAULT 0,
  reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  network_transaction_id TEXT,
  approved_commission_micros INTEGER,
  reversed_commission_micros INTEGER NOT NULL DEFAULT 0,
  deposited_commission_micros INTEGER,
  reconciled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_click_map_network_transaction ON affiliate_click_map(network_transaction_id) WHERE network_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_click_map_program_month ON affiliate_click_map(program_id, yyyymm);
CREATE TABLE IF NOT EXISTS commission_adjustments (
  network TEXT NOT NULL,
  network_transaction_id TEXT NOT NULL,
  click_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','reversed','clawback')),
  gross_commission_micros INTEGER NOT NULL,
  net_commission_micros INTEGER NOT NULL,
  currency TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (network, network_transaction_id, status, effective_at)
);
