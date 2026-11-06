-- Same website's dedicated private D1 only. No history, editor text or paths.
CREATE TABLE IF NOT EXISTS presence_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0,
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK(public_enabled IN (0,1)),
  share_listening INTEGER NOT NULL DEFAULT 0 CHECK(share_listening IN (0,1)),
  private_work INTEGER NOT NULL DEFAULT 0 CHECK(private_work IN (0,1)),
  session_source TEXT,
  session_at INTEGER NOT NULL DEFAULT 0,
  session_until INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  project_slug TEXT,
  manual_state TEXT,
  manual_at INTEGER NOT NULL DEFAULT 0,
  manual_until INTEGER NOT NULL DEFAULT 0,
  changed_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO presence_state(id) VALUES(1);
