-- 隐私友好的每日访问聚合与短期去重表（仅存单向当日哈希，不保存访客明文 IP）
CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('site', 'post', 'page')),
  target_key TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  duration_samples INTEGER NOT NULL DEFAULT 0,
  completed_reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, target_type, target_key)
);
CREATE INDEX IF NOT EXISTS analytics_daily_target ON analytics_daily (target_type, target_key, day);

CREATE TABLE IF NOT EXISTS analytics_visitors (
  day TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('site', 'post', 'page')),
  target_key TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 1,
  last_view_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  duration_recorded INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, target_type, target_key, visitor_hash)
);
CREATE INDEX IF NOT EXISTS analytics_visitors_day ON analytics_visitors (day);

CREATE TABLE IF NOT EXISTS analytics_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
