CREATE TABLE IF NOT EXISTS request_rate_limits (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL CHECK(length(key_hash)=64),
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope,key_hash,window_start)
);
CREATE INDEX IF NOT EXISTS idx_request_rate_limits_window ON request_rate_limits(window_start);
