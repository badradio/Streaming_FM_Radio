import { asMasterDb } from './radio/master-db';
import type { D1Like } from './runtime';
import {
  ENSURE_PLAYS_STARTED_SQL,
  ENSURE_PLAYS_TABLE_SQL,
  ENSURE_PLAYS_UNIQUE_SQL,
  INSERT_PLAY_SQL,
  PLAYS_STATION_URL,
  UPDATE_PLAYS_AD_CUES_SQL,
  collectPlayRows,
  listPlaysSql,
  playBindValues,
  type PlayQuery,
  type StoredPlay,
} from './plays';

export async function fetchLive365StationRaw(url = PLAYS_STATION_URL): Promise<unknown | undefined> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function playsTableReady(db: D1Like): Promise<boolean> {
  try {
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .bind('plays')
      .all<{ name: string }>();
    return results.some((row) => row.name === 'plays');
  } catch {
    return false;
  }
}

export async function ensurePlaysTable(db: D1Like): Promise<void> {
  await db.prepare(ENSURE_PLAYS_TABLE_SQL).bind().run();
  await db.prepare(ENSURE_PLAYS_UNIQUE_SQL).bind().run();
  await db.prepare(ENSURE_PLAYS_STARTED_SQL).bind().run();
}

export async function ingestLive365Plays(db: D1Like, raw?: unknown): Promise<{ attempted: number }> {
  await ensurePlaysTable(db);
  const payload = raw ?? (await fetchLive365StationRaw());
  const rows = collectPlayRows(payload);
  if (rows.length > 0) {
    const statements = rows.map((row) => db.prepare(INSERT_PLAY_SQL).bind(...playBindValues(row)));
    await db.batch(statements);
  }
  await db.prepare(UPDATE_PLAYS_AD_CUES_SQL).bind().run();
  return { attempted: rows.length };
}

export async function ingestPlaysFromEnv(env: { MASTER?: unknown }): Promise<void> {
  const db = asMasterDb(env.MASTER);
  if (!db) {
    console.error('plays-log', 'no-master');
    return;
  }
  try {
    const result = await ingestLive365Plays(db);
    console.error('plays-log', 'ok', result.attempted);
  } catch (error) {
    console.error('plays-log', 'failed');
    throw error;
  }
}

export async function listStoredPlays(db: D1Like, query: PlayQuery): Promise<StoredPlay[]> {
  const { sql, values } = listPlaysSql(query);
  const { results } = await db.prepare(sql).bind(...values).all<StoredPlay>();
  return results.map((row) => ({
    id: Number(row.id),
    artist: String(row.artist ?? ''),
    title: String(row.title ?? ''),
    album: typeof row.album === 'string' && row.album ? row.album : null,
    art: typeof row.art === 'string' && row.art ? row.art : null,
    started_at: String(row.started_at ?? ''),
    started_ct: String(row.started_ct ?? ''),
    duration: typeof row.duration === 'number' ? row.duration : row.duration == null ? null : Number(row.duration),
    is_cue: row.is_cue ? 1 : 0,
    source: typeof row.source === 'string' && row.source ? row.source : null,
  }));
}
