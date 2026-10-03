import { workerEnv } from '../runtime';
import { hydrateAirLog, hydratePromotedTracks } from './airlog';
import { emptyState, seedPlaylist } from './catalog';
import type { StationState } from './types';

export type StationStore = {
  read(): Promise<StationState>;
  write(state: StationState): Promise<void>;
};

const KV_KEY = 'station:v1';

export function hydrate(raw: unknown): StationState {
  if (!raw || typeof raw !== 'object') return emptyState();
  const value = raw as Partial<StationState>;
  return {
    playlist: {
      id: value.playlist?.id ?? seedPlaylist.id,
      name: value.playlist?.name ?? seedPlaylist.name,
      daypart: value.playlist?.daypart ?? seedPlaylist.daypart,
      trackIds: Array.isArray(value.playlist?.trackIds) ? value.playlist.trackIds : [...seedPlaylist.trackIds],
    },
    nextSetIndex: typeof value.nextSetIndex === 'number' ? value.nextSetIndex : 0,
    requests: Array.isArray(value.requests) ? value.requests : [],
    plays: Array.isArray(value.plays) ? value.plays : [],
    airLog: hydrateAirLog(value.airLog),
    promotedTracks: hydratePromotedTracks(value.promotedTracks),
  };
}

export class MemoryStore implements StationStore {
  constructor(private state: StationState = emptyState()) {}

  async read(): Promise<StationState> {
    return structuredClone(this.state);
  }

  async write(state: StationState): Promise<void> {
    this.state = structuredClone(state);
  }
}

export class KvStore implements StationStore {
  constructor(private kv: KVNamespace) {}

  async read(): Promise<StationState> {
    const raw = await this.kv.get(KV_KEY, 'json');
    return hydrate(raw);
  }

  async write(state: StationState): Promise<void> {
    await this.kv.put(KV_KEY, JSON.stringify(state));
  }
}

export class FileStore implements StationStore {
  constructor(private path: string) {}

  async read(): Promise<StationState> {
    const fs = await import('node:fs/promises');
    try {
      const text = await fs.readFile(this.path, 'utf8');
      return hydrate(JSON.parse(text) as unknown);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return emptyState();
      }
      throw error;
    }
  }

  async write(state: StationState): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}

let memoryFallback: MemoryStore | undefined;

export async function getStore(): Promise<StationStore> {
  const env = await workerEnv();
  if (env?.STATION) return new KvStore(env.STATION);

  if (import.meta.env.DEV) {
    try {
      return new FileStore('.data/station.json');
    } catch {
      // fall through
    }
  }

  memoryFallback ??= new MemoryStore();
  return memoryFallback;
}
