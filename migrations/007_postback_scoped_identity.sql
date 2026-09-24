-- D2 candidate-only receiver transition. NEVER auto-apply this migration remotely.
-- Deploy requires reviewed D1 backup/index preflight, coordinated Pages + n8n/K3
-- cutover and post-migration readback. No existing IDs or classifications change.
ALTER TABLE affiliate_click_map ADD COLUMN network_account_ref TEXT;
ALTER TABLE affiliate_click_map ADD COLUMN is_test INTEGER CHECK (is_test IS NULL OR is_test IN (0,1));
ALTER TABLE affiliate_click_map ADD COLUMN probe_ref TEXT;

-- Fail the transaction on unexpected scoped duplicates; do not discard rows.
CREATE UNIQUE INDEX analytics_revenue_ledger_v1_scoped_conversion_idx
  ON analytics_revenue_ledger_v1 (network, network_account_ref, program_id, conversion_id, event_type, event_status)
  WHERE conversion_id IS NOT NULL AND network_account_ref IS NOT NULL;
DROP INDEX analytics_revenue_ledger_v1_network_conversion_idx;
-- Legacy rows with unknown account remain unknown and are not backfilled.
