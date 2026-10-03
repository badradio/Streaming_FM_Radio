-- Outpost transmissions (listen-page email list). Lives in the same D1 as master_tracks.
-- Unique on normalized email. unsub_token is the public unsubscribe key (not derived from email).
CREATE TABLE IF NOT EXISTS outpost_signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_norm TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'listen',
  status TEXT NOT NULL DEFAULT 'subscribed',
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  unsub_token TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_outpost_status ON outpost_signups(status);
CREATE INDEX IF NOT EXISTS idx_outpost_created ON outpost_signups(created_at);
