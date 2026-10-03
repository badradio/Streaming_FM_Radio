import { isJunkAirTrack, stripPlaceholderArt } from './live365/junk';
import type { Live365Feed, OnAirTrack } from './live365/normalize';
import { matchKey } from './radio/match';
import { workerEnv } from './runtime';

export const WIDGET_RECENT_KEY = 'widget:recent:v1';
export const WIDGET_RECENT_CAP = 10;

export function hydrateWidgetRecent(raw: unknown): OnAirTrack[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Partial<OnAirTrack>;
    if (typeof row.artist !== 'string' || typeof row.title !== 'string') return [];
    const artist = row.artist.trim();
    const title = row.title.trim();
    if (!artist && !title) return [];
    const track: OnAirTrack = { artist: artist || 'Unknown artist', title: title || 'Unknown title' };
    if (typeof row.art === 'string' && row.art.startsWith('http')) track.art = row.art.trim();
    if (typeof row.startedAt === 'string' && Number.isFinite(Date.parse(row.startedAt))) {
      track.startedAt = new Date(Date.parse(row.startedAt)).toISOString();
    }
    return [stripPlaceholderArt(track)];
  });
}

export function mergeWidgetRecent(options: {
  now: OnAirTrack | null;
  live365Recent: OnAirTrack[];
  stored: OnAirTrack[];
  cap?: number;
  seenAt?: Date;
}): { now: OnAirTrack | null; recent: OnAirTrack[]; nextStored: OnAirTrack[] } {
  const cap = options.cap ?? WIDGET_RECENT_CAP;
  const now = cleanTrack(options.now);
  const incoming = [...options.live365Recent, ...options.stored]
    .map((track) => cleanTrack(track))
    .filter((track): track is OnAirTrack => !!track);

  const recent = uniqueTracks(
    incoming.filter((track) => !now || matchKey(track.artist, track.title) !== matchKey(now.artist, now.title)),
    cap,
  );

  const stampedNow = now && !now.startedAt
    ? { ...now, startedAt: (options.seenAt ?? new Date()).toISOString() }
    : now;

  const nextStored = uniqueTracks([...(stampedNow ? [stampedNow] : []), ...recent, ...incoming], cap + 1);
  return { now, recent, nextStored };
}

export async function attachWidgetRecent(feed: Live365Feed, seenAt = new Date()): Promise<Live365Feed> {
  const stored = await readWidgetRecent();
  const merged = mergeWidgetRecent({
    now: feed.now,
    live365Recent: feed.recent,
    stored,
    cap: WIDGET_RECENT_CAP,
    seenAt,
  });
  if (JSON.stringify(merged.nextStored) !== JSON.stringify(stored)) {
    await writeWidgetRecent(merged.nextStored);
  }
  return { ...feed, now: merged.now, recent: merged.recent };
}

export async function readWidgetRecent(): Promise<OnAirTrack[]> {
  const store = await widgetRecentBackend();
  return store.read();
}

export async function writeWidgetRecent(tracks: OnAirTrack[]): Promise<void> {
  const store = await widgetRecentBackend();
  await store.write(tracks);
}

function cleanTrack(track: OnAirTrack | null | undefined): OnAirTrack | null {
  if (!track) return null;
  if (isJunkAirTrack(track)) return null;
  return stripPlaceholderArt(track);
}

function uniqueTracks(tracks: OnAirTrack[], cap: number): OnAirTrack[] {
  const seen = new Set<string>();
  const out: OnAirTrack[] = [];
  for (const track of tracks) {
    const id = matchKey(track.artist, track.title);
    if (!id || id === '::' || seen.has(id)) continue;
    seen.add(id);
    out.push(track);
    if (out.length >= cap) break;
  }
  return out;
}

type RecentBackend = {
  read(): Promise<OnAirTrack[]>;
  write(tracks: OnAirTrack[]): Promise<void>;
};

let memoryRecent: OnAirTrack[] = [];

async function widgetRecentBackend(): Promise<RecentBackend> {
  const env = await workerEnv();
  if (env?.STATION) {
    const kv = env.STATION;
    return {
      async read() {
        const raw = await kv.get(WIDGET_RECENT_KEY, 'json');
        return hydrateWidgetRecent(raw);
      },
      async write(tracks) {
        await kv.put(WIDGET_RECENT_KEY, JSON.stringify(tracks));
      },
    };
  }

  if (import.meta.env.DEV) {
    return {
      async read() {
        const fs = await import('node:fs/promises');
        try {
          const text = await fs.readFile('.data/widget-recent.json', 'utf8');
          return hydrateWidgetRecent(JSON.parse(text) as unknown);
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
          throw error;
        }
      },
      async write(tracks) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        await fs.mkdir(path.dirname('.data/widget-recent.json'), { recursive: true });
        await fs.writeFile('.data/widget-recent.json', `${JSON.stringify(tracks, null, 2)}\n`, 'utf8');
      },
    };
  }

  return {
    async read() {
      return [...memoryRecent];
    },
    async write(tracks) {
      memoryRecent = [...tracks];
    },
  };
}
