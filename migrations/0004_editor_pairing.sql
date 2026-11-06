ALTER TABLE presence_state ADD COLUMN editor_enabled INTEGER NOT NULL DEFAULT 0 CHECK(editor_enabled IN (0,1));
ALTER TABLE presence_state ADD COLUMN editor_generation INTEGER NOT NULL DEFAULT 0;
CREATE TABLE presence_editor (
  id INTEGER PRIMARY KEY CHECK(id=1),
  generation INTEGER NOT NULL DEFAULT 0,
  pair_hash TEXT,
  pair_until INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT,
  token_until INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL DEFAULT 0,
  last_received INTEGER NOT NULL DEFAULT 0
);
INSERT INTO presence_editor(id) VALUES(1);
