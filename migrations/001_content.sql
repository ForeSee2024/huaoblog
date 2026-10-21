-- Portable content metadata. Authentication/session tables are deliberately separate.
CREATE TABLE IF NOT EXISTS content_documents (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'settings', 'media')),
  id TEXT NOT NULL,
  revision TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE TABLE IF NOT EXISTS content_history (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'settings', 'media')),
  id TEXT NOT NULL,
  revision TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  actor TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, id, revision)
);
CREATE TABLE IF NOT EXISTS content_media_refs (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'settings')),
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'draft')),
  name TEXT NOT NULL,
  PRIMARY KEY (kind, id, status, name)
);
CREATE INDEX IF NOT EXISTS content_media_refs_name ON content_media_refs (name);
CREATE INDEX IF NOT EXISTS content_history_entity ON content_history (kind, id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS content_media_object_key ON content_documents (json_extract(payload_json, '$.objectKey')) WHERE kind = 'media';
CREATE TABLE IF NOT EXISTS content_import_guards (
  token TEXT PRIMARY KEY
);
-- Bodies stay below D1's per-row limit even when both post versions reach 1 MiB.
-- A revision's bodies are shared by the current aggregate and its history entry.
CREATE TABLE IF NOT EXISTS content_post_bodies (
  id TEXT NOT NULL,
  revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'draft')),
  body TEXT NOT NULL,
  PRIMARY KEY (id, revision, status)
);
