ALTER TABLE listening_account ADD COLUMN connection_key TEXT;
CREATE TABLE listening_collections (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  ids_json TEXT NOT NULL DEFAULT '[]',
  projection_json TEXT,
  checked_at INTEGER NOT NULL DEFAULT 0,
  connection_key TEXT,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO listening_collections(id) VALUES(1);
