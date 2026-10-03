import { airMatchesTrack, matchKey } from './match';
import { stationTracks } from './catalog';
import { normalizeKey } from './rules';
import type { AirLogEntry, StationState, Track } from './types';
import type { OnAirTrack } from '../live365/normalize';

/** Unique-by-match-key cap. Oldest `lastSeenAt` is dropped first. Not an unbounded append log. */
export const MAX_AIR_LOG_ENTRIES = 4000;

/** Same Live365 play (current-track polled every ~18s, last-played lingering) must not increment. */
export const AIR_COUNT_WINDOW_MS = 12 * 60 * 1000;

/** Without a Live365 start time, slide lastSeenAt at most once a minute. */
const AIR_TOUCH_WINDOW_MS = 60 * 1000;

export function hydrateAirLog(raw: unknown): Record<string, AirLogEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, AirLogEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseEntry(key, value);
    if (entry) out[entry.key] = entry;
  }
  return out;
}

export function hydratePromotedTracks(raw: unknown): Track[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Partial<Track>;
    if (typeof row.id !== 'string' || !row.id.trim()) return [];
    if (typeof row.artist !== 'string' || typeof row.title !== 'string') return [];
    const track: Track = {
      id: row.id.trim(),
      artist: row.artist.trim(),
      title: row.title.trim(),
    };
    if (typeof row.album === 'string' && row.album.trim() && row.album.trim() !== '—') {
      track.album = row.album.trim();
    }
    if (typeof row.year === 'number' && row.year > 0) track.year = row.year;
    if (typeof row.durationSec === 'number' && row.durationSec > 0) track.durationSec = row.durationSec;
    if (typeof row.isrc === 'string' && row.isrc.trim()) track.isrc = row.isrc.trim();
    if (typeof row.audioUrl === 'string' && row.audioUrl.trim()) track.audioUrl = row.audioUrl.trim();
    return [track];
  });
}

export function upsertAirLog(options: {
  state: StationState;
  air: OnAirTrack[];
  now: Date;
  maxEntries?: number;
}): { state: StationState; changed: boolean; upserted: number } {
  const maxEntries = options.maxEntries ?? MAX_AIR_LOG_ENTRIES;
  const log: Record<string, AirLogEntry> = { ...options.state.airLog };
  const seenThisPass = new Set<string>();
  let changed = false;
  let upserted = 0;

  for (const item of options.air) {
    const artist = item.artist.trim();
    const title = item.title.trim();
    if (!artist || !title) continue;
    if (artist === 'Unknown artist' && title === 'Unknown title') continue;

    const key = matchKey(artist, title);
    if (!key || key === '::') continue;
    if (seenThisPass.has(key)) continue;
    seenThisPass.add(key);

    const at = airSeenAt(item, options.now);
    const existing = log[key];
    if (!existing) {
      log[key] = {
        key,
        artist,
        title,
        firstSeenAt: at.toISOString(),
        lastSeenAt: at.toISOString(),
        plays: 1,
        ...(item.art ? { art: item.art } : {}),
      };
      changed = true;
      upserted += 1;
      continue;
    }

    const last = Date.parse(existing.lastSeenAt);
    const startMs = item.startedAt ? Date.parse(item.startedAt) : Number.NaN;
    const sameStart = Number.isFinite(startMs) && startMs === last;
    const withinCountWindow = Number.isFinite(last) && Math.abs(at.getTime() - last) < AIR_COUNT_WINDOW_MS;
    const increment = !sameStart && !withinCountWindow;

    let next: AirLogEntry = existing;
    if (increment) {
      next = { ...next, plays: existing.plays + 1, lastSeenAt: at.toISOString() };
    } else if (Number.isFinite(startMs) && startMs > last) {
      next = { ...next, lastSeenAt: new Date(startMs).toISOString() };
    } else if (!Number.isFinite(startMs) && Number.isFinite(last) && at.getTime() - last >= AIR_TOUCH_WINDOW_MS) {
      next = { ...next, lastSeenAt: at.toISOString() };
    }

    if (item.art && !existing.art) next = { ...next, art: item.art };
    if (artist && artist !== existing.artist) next = { ...next, artist };
    if (title && title !== existing.title) next = { ...next, title };

    if (next !== existing) {
      log[key] = next;
      changed = true;
      upserted += 1;
    }
  }

  const capped = capAirLog(log, maxEntries);
  if (Object.keys(capped).length !== Object.keys(log).length) changed = true;

  if (!changed) return { state: options.state, changed: false, upserted: 0 };
  return { state: { ...options.state, airLog: capped }, changed: true, upserted };
}

export function listAirLog(
  state: StationState,
  options: { query?: string; limit?: number } = {},
): AirLogEntry[] {
  const q = normalizeKey(options.query ?? '');
  const tracks = stationTracks(state);
  let rows = Object.values(state.airLog).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  if (q) {
    rows = rows.filter((entry) => {
      const hay = `${entry.artist} ${entry.title}`.toLowerCase();
      return hay.includes(q) || entry.key.includes(q);
    });
  }
  if (options.limit && options.limit > 0) rows = rows.slice(0, options.limit);
  return rows.map((entry) => annotateCatalog(entry, tracks));
}

export function airLogInCatalog(entry: AirLogEntry, state: StationState): boolean {
  if (entry.promotedTrackId) return true;
  return stationTracks(state).some((track) => airMatchesTrack(entry, track));
}

export function promoteAirKeys(
  state: StationState,
  keys: string[],
): { state: StationState; promoted: Track[]; skipped: string[] } {
  const tracks = stationTracks(state);
  const airLog = { ...state.airLog };
  const promotedTracks = [...state.promotedTracks];
  const promoted: Track[] = [];
  const skipped: string[] = [];
  const seenIds = new Set(tracks.map((track) => track.id));

  for (const rawKey of keys) {
    const entry = airLog[rawKey];
    if (!entry) {
      skipped.push(rawKey);
      continue;
    }

    const existing = tracks.find((track) => airMatchesTrack(entry, track) || track.id === entry.promotedTrackId);
    if (existing) {
      if (entry.promotedTrackId !== existing.id) {
        airLog[rawKey] = { ...entry, promotedTrackId: existing.id };
      }
      skipped.push(rawKey);
      continue;
    }

    const track = airEntryToTrack(entry);
    if (seenIds.has(track.id)) {
      skipped.push(rawKey);
      continue;
    }

    promotedTracks.push(track);
    promoted.push(track);
    seenIds.add(track.id);
    airLog[rawKey] = { ...entry, promotedTrackId: track.id };
  }

  if (promoted.length === 0 && skipped.length === keys.length) {
    const logChanged = Object.keys(airLog).some((key) => airLog[key] !== state.airLog[key]);
    if (!logChanged) return { state, promoted, skipped };
  }

  return { state: { ...state, airLog, promotedTracks }, promoted, skipped };
}

export function airEntryToTrack(entry: AirLogEntry): Track {
  return {
    id: trackIdFromMatchKey(entry.key),
    artist: entry.artist,
    title: entry.title,
  };
}

export function trackIdFromMatchKey(key: string): string {
  const slug = key
    .replace(/::/g, '--')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `air:${slug || 'track'}`;
}

export function toAirLogJson(entries: AirLogEntry[]): string {
  return `${JSON.stringify(
    {
      station: 'Bad Radio',
      note: 'Harvested from Live365 current-track and last-played. Not a full library sync. Unique by folded artist/title; cap 4000, oldest lastSeenAt dropped.',
      cap: MAX_AIR_LOG_ENTRIES,
      tracks: entries.map((entry) => ({
        artist: entry.artist,
        title: entry.title,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        plays: entry.plays,
      })),
    },
    null,
    2,
  )}\n`;
}

export function toAirLogCsv(entries: AirLogEntry[]): string {
  const lines = ['artist,title,firstSeenAt,lastSeenAt,plays'];
  for (const entry of entries) {
    lines.push(
      [entry.artist, entry.title, entry.firstSeenAt, entry.lastSeenAt, String(entry.plays)].map(csvField).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function annotateCatalog(entry: AirLogEntry, tracks: Track[]): AirLogEntry {
  if (entry.promotedTrackId) return entry;
  const hit = tracks.find((track) => airMatchesTrack(entry, track));
  return hit ? { ...entry, promotedTrackId: hit.id } : entry;
}

function capAirLog(log: Record<string, AirLogEntry>, maxEntries: number): Record<string, AirLogEntry> {
  const keys = Object.keys(log);
  if (keys.length <= maxEntries) return log;
  const ranked = Object.values(log).sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
  const drop = ranked.slice(0, keys.length - maxEntries).map((entry) => entry.key);
  const next = { ...log };
  for (const key of drop) delete next[key];
  return next;
}

function airSeenAt(air: OnAirTrack, fallback: Date): Date {
  if (!air.startedAt) return fallback;
  const parsed = Date.parse(air.startedAt);
  return Number.isFinite(parsed) ? new Date(parsed) : fallback;
}

function parseEntry(fallbackKey: string, raw: unknown): AirLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<AirLogEntry>;
  const artist = typeof row.artist === 'string' ? row.artist.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!artist || !title) return null;
  const key = typeof row.key === 'string' && row.key.trim() ? row.key.trim() : fallbackKey;
  const firstSeenAt = isoOrNull(row.firstSeenAt);
  const lastSeenAt = isoOrNull(row.lastSeenAt) ?? firstSeenAt;
  if (!firstSeenAt || !lastSeenAt) return null;
  const plays = typeof row.plays === 'number' && Number.isFinite(row.plays) ? Math.max(1, Math.floor(row.plays)) : 1;
  return {
    key,
    artist,
    title,
    firstSeenAt,
    lastSeenAt,
    plays,
    ...(typeof row.art === 'string' && row.art.startsWith('http') ? { art: row.art } : {}),
    ...(typeof row.promotedTrackId === 'string' && row.promotedTrackId.trim()
      ? { promotedTrackId: row.promotedTrackId.trim() }
      : {}),
  };
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
