-- Listener votes and short messages. Same D1 as plays / outpost_signups.
-- Runtime also CREATE TABLE IF NOT EXISTS (wrangler D1 apply may be blocked).
-- Geo is Cloudflare request.cf country/city only. Never store an IP.

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at TEXT NOT NULL,
  vote INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_ct TEXT NOT NULL,
  country TEXT,
  city TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_session_track
  ON votes(session_id, artist, title, started_at);

CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes(created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  artist TEXT,
  title TEXT,
  started_at TEXT,
  created_at TEXT NOT NULL,
  created_ct TEXT NOT NULL,
  country TEXT,
  city TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_kind ON messages(kind);
