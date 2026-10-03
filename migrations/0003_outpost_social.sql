ALTER TABLE outpost_signups ADD COLUMN x_handle TEXT;
ALTER TABLE outpost_signups ADD COLUMN facebook_handle TEXT;
ALTER TABLE outpost_signups ADD COLUMN shoutout_ok INTEGER NOT NULL DEFAULT 0;
