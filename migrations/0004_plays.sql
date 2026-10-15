-- Live365 play log (cron poll). Same D1 as master_tracks / outpost_signups.
-- Live365 has no album field; album is kept nullable for later sources.
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  album TEXT,
  art TEXT,
  started_at TEXT NOT NULL,
  started_ct TEXT NOT NULL,
  duration INTEGER,
  is_cue INTEGER NOT NULL DEFAULT 0,
  source TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_artist_title_started
  ON plays(artist, title, started_at);

CREATE INDEX IF NOT EXISTS idx_plays_started_at ON plays(started_at);
