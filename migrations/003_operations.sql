CREATE TABLE IF NOT EXISTS backup_runs (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS backup_runs_started ON backup_runs (started_at DESC);
