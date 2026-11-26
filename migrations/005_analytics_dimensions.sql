-- 隐私友好的多维访问统计聚合与跨天回访识别（不存储任何明文 IP 或敏感路径）
CREATE TABLE IF NOT EXISTS analytics_dimensions (
  day TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('referrer', 'device', 'os', 'browser', 'country', 'hour', 'visitor_type')),
  label TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dimension, label)
);
CREATE INDEX IF NOT EXISTS analytics_dimensions_lookup ON analytics_dimensions (dimension, day);

-- 短期维度独立访客去重表（滚动清理，仅保留近 2 天）
CREATE TABLE IF NOT EXISTS analytics_dimension_visitors (
  day TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('referrer', 'device', 'os', 'browser', 'country', 'hour', 'visitor_type')),
  label TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, dimension, label, visitor_hash)
);
CREATE INDEX IF NOT EXISTS analytics_dimension_visitors_day ON analytics_dimension_visitors (day);

-- 匿名长期回访者记录（仅存单向加盐哈希与首/末活跃日期，用于区分新访客与回访客）
CREATE TABLE IF NOT EXISTS analytics_known_visitors (
  client_hash TEXT PRIMARY KEY,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_known_visitors_last ON analytics_known_visitors (last_day);
