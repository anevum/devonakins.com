-- One short-lived participating cloud task; no provider IDs or free text.
CREATE TABLE presence_cloud (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK(public_enabled IN (0,1)),
  source TEXT CHECK(source IN ('codex','chatgpt-work')),
  pair_hash TEXT,
  pair_until INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT,
  token_until INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 0,
  state TEXT CHECK(state IN ('running','waiting','completed','failed','cancelled')),
  checkpoint TEXT CHECK(checkpoint IN ('testing','tests-passed','building','reviewing')),
  project_slug TEXT,
  observed_at INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO presence_cloud(id) VALUES(1);
