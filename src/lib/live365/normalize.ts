import { isJunkAirTrack, stripPlaceholderArt } from './junk';

export type OnAirTrack = {
  artist: string;
  title: string;
  art?: string;
  startedAt?: string;
};

export type Live365Feed = {
  ok: true;
  source: 'live365';
  isPlaying: boolean;
  stationName?: string;
  now: OnAirTrack | null;
  recent: OnAirTrack[];
};

export type Live365Unavailable = {
  ok: false;
  reason: 'no_station' | 'unavailable';
  now: null;
  recent: [];
};

export type Live365Result = Live365Feed | Live365Unavailable;

type RawTrack = {
  artist?: unknown;
  title?: unknown;
  art?: unknown;
  start?: unknown;
  played?: unknown;
};

type RawStation = {
  'current-track'?: RawTrack | null;
  'last-played'?: unknown;
  is_playing?: unknown;
  name?: unknown;
};

export function normalizeLive365Station(raw: unknown): Live365Feed | Live365Unavailable {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'unavailable', now: null, recent: [] };
  }

  const data = raw as RawStation;
  const now = normalizeTrack(data['current-track']);
  const history = Array.isArray(data['last-played'])
    ? data['last-played'].flatMap((item) => {
        const track = normalizeTrack(item);
        return track ? [track] : [];
      })
    : [];

  const recent = dedupeRecent(now, history);
  const stationName = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : undefined;

  return {
    ok: true,
    source: 'live365',
    isPlaying: data.is_playing === true,
    ...(stationName ? { stationName } : {}),
    now,
    recent,
  };
}

export function normalizeTrack(raw: unknown): OnAirTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const track = raw as RawTrack;
  const artist = typeof track.artist === 'string' ? track.artist.trim() : '';
  const title = typeof track.title === 'string' ? track.title.trim() : '';
  if (!artist && !title) return null;
  const rawArt = typeof track.art === 'string' && track.art.startsWith('http') ? track.art.trim() : undefined;
  const startedAt = parseStart(track.start ?? track.played);
  const mapped: OnAirTrack = {
    artist: artist || 'Unknown artist',
    title: title || 'Unknown title',
    ...(rawArt ? { art: rawArt } : {}),
    ...(startedAt ? { startedAt } : {}),
  };
  if (isJunkAirTrack(mapped)) return null;
  return stripPlaceholderArt(mapped);
}

function parseStart(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return undefined;
}

function dedupeRecent(now: OnAirTrack | null, history: OnAirTrack[]): OnAirTrack[] {
  const seen = new Set<string>();
  if (now) seen.add(key(now));
  const out: OnAirTrack[] = [];
  for (const track of history) {
    const id = key(track);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(track);
    if (out.length >= 10) break;
  }
  return out;
}

function key(track: OnAirTrack): string {
  return `${track.artist.toLowerCase()}::${track.title.toLowerCase()}`;
}
