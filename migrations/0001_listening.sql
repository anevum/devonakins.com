-- Private owner-only Spotify integration. Apply only to a dedicated D1 database.
-- No account history and no playback events are retained.
CREATE TABLE IF NOT EXISTS listening_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  refresh_cipher TEXT,
  access_cipher TEXT,
  access_expires INTEGER NOT NULL DEFAULT 0,
  connected_at INTEGER NOT NULL DEFAULT 0,
  reauth_due INTEGER NOT NULL DEFAULT 0,
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_enabled IN (0,1)),
  show_details INTEGER NOT NULL DEFAULT 0 CHECK (show_details IN (0,1)),
  projection_json TEXT,
  checked_at INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  reauth_required INTEGER NOT NULL DEFAULT 0 CHECK (reauth_required IN (0,1))
);
INSERT OR IGNORE INTO listening_account(id) VALUES(1);

CREATE TABLE IF NOT EXISTS listening_oauth_attempt (
  state_hash TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listening_oauth_expiry ON listening_oauth_attempt(expires_at);
