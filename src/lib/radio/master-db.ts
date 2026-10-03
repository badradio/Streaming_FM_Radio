import type { DiffBuckets, MasterTrack, UpsertPlan } from './master';
import { diffMasterVsAir } from './master';
import { workerEnv, type D1Like } from '../runtime';

/** D1 allows 100 bound parameters and 100 statements per batch. */
const BATCH = 100;

export type MasterOpenResult = {
  db?: D1Like;
  bound: boolean;
  note: string | null;
  masterIds: string[];
  diff: DiffBuckets;
};

/** Reject plaintext dashboard vars (e.g. MASTER="MASTER") that are not a D1 handle. */
export function asMasterDb(value: unknown): D1Like | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const db = value as D1Like;
  if (typeof db.prepare !== 'function' || typeof db.batch !== 'function') return undefined;
  return db;
}

export async function getMasterDb(): Promise<D1Like | undefined> {
  const env = await workerEnv();
  return asMasterDb(env?.MASTER);
}

export async function openMasterLibrary(raw: unknown, airKeys: string[]): Promise<MasterOpenResult> {
  const empty = emptyDesk(airKeys);
  const db = asMasterDb(raw);
  if (!db) {
    const note =
      typeof raw === 'string' && raw.trim()
        ? 'MASTER is a plaintext Worker variable, not a D1 binding. Remove that variable in the dashboard and bind D1 MASTER to badradio-master (do not name a var MASTER).'
        : 'D1 binding MASTER is not on this Worker yet. Bind MASTER to badradio-master, apply migrations, redeploy. See README.';
    return { ...empty, note };
  }
  try {
    if (!(await masterTracksReady(db))) {
      return {
        ...empty,
        db,
        note: 'D1 MASTER is bound but master_tracks is missing. From a login that can query D1: npm run d1:migrate:remote.',
      };
    }
    const masterIds = await loadMasterIds(db);
    return {
      db,
      bound: true,
      note: null,
      masterIds,
      diff: diffMasterVsAir(masterIds, airKeys),
    };
  } catch {
    return {
      ...empty,
      db,
      note: 'D1 MASTER query failed. The rest of the desk still works. Check the binding and master_tracks migration.',
    };
  }
}

export async function masterTracksReady(db: D1Like): Promise<boolean> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind('master_tracks')
    .all<{ name: string }>();
  return results.some((row) => row.name === 'master_tracks');
}

function emptyDesk(airKeys: string[]): MasterOpenResult {
  return {
    bound: false,
    note: null,
    masterIds: [],
    diff: diffMasterVsAir([], airKeys),
  };
}

export function masterUnavailableMessage(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) {
    return 'MASTER is a plaintext Worker variable, not a D1 binding. Remove it and bind D1 MASTER to badradio-master.';
  }
  return 'D1 binding MASTER is not set. Bind MASTER to badradio-master, apply migrations, redeploy.';
}

export async function importMasterPlan(db: D1Like, plan: UpsertPlan, importedAt: string): Promise<void> {
  const rows = [...plan.insert, ...plan.update];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const statements = chunk.map((row) =>
      db
        .prepare(
          `INSERT INTO master_tracks (
            id, artist, album, title, duration_sec, format, size_bytes,
            relative_path, folder_root, content_hash, tag_source, scanned_at, imported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            artist = excluded.artist,
            album = excluded.album,
            title = excluded.title,
            duration_sec = excluded.duration_sec,
            format = excluded.format,
            size_bytes = excluded.size_bytes,
            relative_path = excluded.relative_path,
            folder_root = excluded.folder_root,
            content_hash = excluded.content_hash,
            tag_source = excluded.tag_source,
            scanned_at = excluded.scanned_at,
            imported_at = excluded.imported_at`,
        )
        .bind(
          row.id,
          row.artist,
          row.album ?? null,
          row.title,
          row.durationSec ?? null,
          row.format ?? null,
          row.sizeBytes ?? null,
          row.relativePath ?? null,
          row.folderRoot ?? null,
          row.contentHash ?? null,
          row.tagSource ?? null,
          row.scannedAt ?? null,
          importedAt,
        ),
    );
    await db.batch(statements);
  }
}

export async function loadMasterFingerprints(db: D1Like): Promise<
  Array<{ id: string; contentHash?: string; relativePath?: string; sizeBytes?: number }>
> {
  const { results } = await db
    .prepare('SELECT id, content_hash AS contentHash, relative_path AS relativePath, size_bytes AS sizeBytes FROM master_tracks')
    .bind()
    .all<{ id: string; contentHash?: string | null; relativePath?: string | null; sizeBytes?: number | null }>();
  return results.map((row) => ({
    id: row.id,
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    ...(row.relativePath ? { relativePath: row.relativePath } : {}),
    ...(typeof row.sizeBytes === 'number' ? { sizeBytes: row.sizeBytes } : {}),
  }));
}

export async function loadMasterIds(db: D1Like): Promise<string[]> {
  const { results } = await db.prepare('SELECT id FROM master_tracks').bind().all<{ id: string }>();
  return results.map((row) => row.id);
}

export async function countMaster(db: D1Like): Promise<number> {
  const { results } = await db.prepare('SELECT COUNT(*) AS n FROM master_tracks').bind().all<{ n: number }>();
  return Number(results[0]?.n ?? 0);
}

export async function loadMasterRows(db: D1Like, ids: string[]): Promise<MasterTrack[]> {
  if (ids.length === 0) return [];
  const out: MasterTrack[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT id, artist, album, title, duration_sec AS durationSec, format,
                size_bytes AS sizeBytes, relative_path AS relativePath, folder_root AS folderRoot,
                content_hash AS contentHash, tag_source AS tagSource, scanned_at AS scannedAt
         FROM master_tracks WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const row of results) {
      if (typeof row.id !== 'string' || typeof row.artist !== 'string' || typeof row.title !== 'string') continue;
      out.push({
        id: row.id,
        artist: row.artist,
        title: row.title,
        ...(typeof row.album === 'string' && row.album ? { album: row.album } : {}),
        ...(typeof row.durationSec === 'number' ? { durationSec: row.durationSec } : {}),
        ...(typeof row.format === 'string' && row.format ? { format: row.format } : {}),
        ...(typeof row.sizeBytes === 'number' ? { sizeBytes: row.sizeBytes } : {}),
        ...(typeof row.relativePath === 'string' && row.relativePath ? { relativePath: row.relativePath } : {}),
        ...(typeof row.folderRoot === 'string' && row.folderRoot ? { folderRoot: row.folderRoot } : {}),
        ...(typeof row.contentHash === 'string' && row.contentHash ? { contentHash: row.contentHash } : {}),
        ...(typeof row.tagSource === 'string' && row.tagSource ? { tagSource: row.tagSource } : {}),
        ...(typeof row.scannedAt === 'string' && row.scannedAt ? { scannedAt: row.scannedAt } : {}),
      });
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
