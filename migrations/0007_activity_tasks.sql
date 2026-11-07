-- Additive V4 reporters. Existing presence, Spotify and singleton cloud rows remain intact.
CREATE TABLE activity_sources (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('codex','chatgpt-work','github-actions')),
  project_slug TEXT NOT NULL,
  generation INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK(public_enabled IN (0,1)),
  token_hash TEXT NOT NULL UNIQUE,
  token_until INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_created INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE TABLE activity_tasks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES activity_sources(id),
  token_hash TEXT NOT NULL UNIQUE,
  token_until INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'waiting' CHECK(state IN ('running','waiting','completed','failed','cancelled')),
  checkpoint TEXT CHECK(checkpoint IN ('testing','tests-passed','building','reviewing')),
  observed_at INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE INDEX activity_tasks_source ON activity_tasks(source_id);
