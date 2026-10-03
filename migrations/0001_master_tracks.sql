-- Dropbox master library. PK `id` is the folded artist::title match_key (unique).
CREATE TABLE IF NOT EXISTS master_tracks (
  id TEXT PRIMARY KEY,
  artist TEXT NOT NULL,
  album TEXT,
  title TEXT NOT NULL,
  duration_sec INTEGER,
  format TEXT,
  size_bytes INTEGER,
  relative_path TEXT,
  folder_root TEXT,
  content_hash TEXT,
  tag_source TEXT,
  scanned_at TEXT,
  imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_master_content_hash ON master_tracks(content_hash);
CREATE INDEX IF NOT EXISTS idx_master_folder_root ON master_tracks(folder_root);
CREATE INDEX IF NOT EXISTS idx_master_artist_title ON master_tracks(artist, title);
