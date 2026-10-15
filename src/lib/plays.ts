import { foldCue } from './live365/junk';

export const PLAYS_STATION_ID = 'a58480';
export const PLAYS_STATION_URL = `https://api.live365.com/station/${PLAYS_STATION_ID}`;
export const PLAYS_CHICAGO_TZ = 'America/Chicago';
export const PLAYS_DEFAULT_LIMIT = 50;
export const PLAYS_MAX_LIMIT = 500;

export type PlayRow = {
  artist: string;
  title: string;
  album: string | null;
  art: string | null;
  startedAt: string;
  startedCt: string;
  duration: number | null;
  isCue: boolean;
  source: string;
};

export type PlayQuery = {
  since?: string;
  until?: string;
  artist?: string;
  limit: number;
  includeCues: boolean;
};

export function isPlayCue(artist: string, title: string): boolean {
  const artistTrim = artist.trim();
  if (!artistTrim) return true;
  const artistFold = foldCue(artistTrim);
  const titleFold = foldCue(title);
  if (artistFold === 'live365') return true;
  if (/ad\s*break/i.test(title)) return true;
  if (/^j\d{1,3}$/.test(artistFold)) return true;
  if (artistFold.includes('patreon') || titleFold.includes('patreon')) return true;
  if (artistFold === 'id' && /^\d{1,3}-[a-z0-9-]+$/i.test(title.trim())) return true;
  return false;
}

export function parsePlayInstant(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.trim().replace(' ', 'T'));
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    const fallback = Date.parse(value.trim());
    if (Number.isFinite(fallback)) return new Date(fallback).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return undefined;
}

export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return null;
}

export function toChicagoLocal(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PLAYS_CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

export function parsePlayTrack(raw: unknown): PlayRow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const track = raw as Record<string, unknown>;
  const artist = typeof track.artist === 'string' ? track.artist.trim() : '';
  const title = typeof track.title === 'string' ? track.title.trim() : '';
  if (!artist && !title) return undefined;
  const startedAt = parsePlayInstant(track.start);
  if (!startedAt) return undefined;
  const startedCt = toChicagoLocal(startedAt);
  if (!startedCt) return undefined;
  const art = typeof track.art === 'string' && /^https?:/i.test(track.art.trim()) ? track.art.trim() : null;
  const sourceRaw = typeof track.source === 'string' ? track.source.trim() : '';
  return {
    artist,
    title,
    album: null,
    art,
    startedAt,
    startedCt,
    duration: parseDurationSeconds(track.duration),
    isCue: isPlayCue(artist, title),
    source: sourceRaw || 'live365',
  };
}

export function collectPlayRows(raw: unknown): PlayRow[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw as Record<string, unknown>;
  const rows: PlayRow[] = [];
  const seen = new Set<string>();
  const push = (item: unknown) => {
    const row = parsePlayTrack(item);
    if (!row) return;
    const key = `${row.artist}\n${row.title}\n${row.startedAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  push(data['current-track']);
  if (Array.isArray(data['last-played'])) {
    for (const item of data['last-played']) push(item);
  }
  return rows;
}

export function parsePlayQuery(search: URLSearchParams): PlayQuery | { error: string } {
  const since = parseOptionalIso(search.get('since'));
  const until = parseOptionalIso(search.get('until'));
  if (search.get('since')?.trim() && !since) return { error: 'since must be an ISO date' };
  if (search.get('until')?.trim() && !until) return { error: 'until must be an ISO date' };
  const artistRaw = search.get('artist')?.trim() ?? '';
  const includeRaw = (search.get('include_cues') ?? '').trim().toLowerCase();
  const includeCues = includeRaw === '1' || includeRaw === 'true' || includeRaw === 'yes';
  let limit = PLAYS_DEFAULT_LIMIT;
  const limitRaw = search.get('limit');
  if (limitRaw !== null && limitRaw.trim() !== '') {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 1) return { error: 'limit must be a positive number' };
    limit = Math.min(PLAYS_MAX_LIMIT, Math.floor(n));
  }
  return {
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    ...(artistRaw ? { artist: artistRaw } : {}),
    limit,
    includeCues,
  };
}

function parseOptionalIso(value: string | null): string | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = Date.parse(value.trim());
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

export const ENSURE_PLAYS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS plays (
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
)`;

export const ENSURE_PLAYS_UNIQUE_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_artist_title_started ON plays(artist, title, started_at)';

export const ENSURE_PLAYS_STARTED_SQL = 'CREATE INDEX IF NOT EXISTS idx_plays_started_at ON plays(started_at)';

export const INSERT_PLAY_SQL = `INSERT OR IGNORE INTO plays (
  artist, title, album, art, started_at, started_ct, duration, is_cue, source
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Flip already-logged Live365 ad breaks to cues (INSERT OR IGNORE will not rewrite is_cue). */
export const UPDATE_PLAYS_AD_CUES_SQL = `UPDATE plays
SET is_cue = 1
WHERE is_cue = 0
  AND (
    LOWER(TRIM(artist)) = 'live365'
    OR INSTR(LOWER(title), 'ad break') > 0
  )`;

export function playBindValues(row: PlayRow): unknown[] {
  return [
    row.artist,
    row.title,
    row.album,
    row.art,
    row.startedAt,
    row.startedCt,
    row.duration,
    row.isCue ? 1 : 0,
    row.source,
  ];
}

export type StoredPlay = {
  id: number;
  artist: string;
  title: string;
  album: string | null;
  art: string | null;
  started_at: string;
  started_ct: string;
  duration: number | null;
  is_cue: number;
  source: string | null;
};

export function listPlaysSql(query: PlayQuery): { sql: string; values: unknown[] } {
  const where: string[] = [];
  const values: unknown[] = [];
  if (query.since) {
    where.push('started_at >= ?');
    values.push(query.since);
  }
  if (query.until) {
    where.push('started_at <= ?');
    values.push(query.until);
  }
  if (query.artist) {
    where.push("LOWER(artist) LIKE '%' || LOWER(?) || '%' ESCAPE '\\'");
    values.push(escapeLike(query.artist));
  }
  if (!query.includeCues) {
    where.push('is_cue = 0');
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  values.push(query.limit);
  return {
    sql: `SELECT id, artist, title, album, art, started_at, started_ct, duration, is_cue, source
      FROM plays ${clause}
      ORDER BY started_at DESC, id DESC
      LIMIT ?`,
    values,
  };
}
