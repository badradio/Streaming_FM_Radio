import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { getStore } from '../../../lib/radio/store';
import { pageIds, promoteMasterTracks, toMasterDiffCsv } from '../../../lib/radio/master';
import { loadMasterRows, openMasterLibrary } from '../../../lib/radio/master-db';
import { workerEnv, type D1Like } from '../../../lib/runtime';
import type { StationState } from '../../../lib/radio/types';

export const prerender = false;

const PAGE_SIZE = 40;

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const store = await getStore();
  const state = await store.read();
  const opened = await openMasterLibrary((await workerEnv())?.MASTER, Object.keys(state.airLog));
  if (!opened.bound || !opened.db) {
    return Response.json({ ok: false, message: opened.note ?? 'D1 binding MASTER is not set' }, { status: 503 });
  }

  const diff = opened.diff;
  const bucket = url.searchParams.get('bucket') ?? 'counts';
  const format = url.searchParams.get('format') ?? 'json';
  const page = Number(url.searchParams.get('page') ?? '1') || 1;

  const ids =
    bucket === 'master-only'
      ? diff.masterOnly
      : bucket === 'air-only'
        ? diff.airOnly
        : bucket === 'intersection'
          ? diff.intersection
          : [];

  try {
    if (format === 'csv' && bucket !== 'counts') {
      const rows = await rowsForBucket(opened.db, state.airLog, bucket, ids);
      const filename =
        bucket === 'master-only'
          ? 'badradio-master-not-in-air-log.csv'
          : bucket === 'air-only'
            ? 'badradio-air-log-not-in-master.csv'
            : 'badradio-master-air-intersection.csv';
      return new Response(toMasterDiffCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    const paged = pageIds(ids, page, PAGE_SIZE);
    const pageRows = await rowsForBucket(opened.db, state.airLog, bucket, paged.slice);

    return Response.json({
      ok: true,
      masterTotal: diff.masterTotal,
      airTotal: diff.airTotal,
      intersection: diff.intersection.length,
      masterOnly: diff.masterOnly.length,
      airOnly: diff.airOnly.length,
      bucket,
      page: paged.page,
      pages: bucket === 'counts' ? 1 : paged.pages,
      rows: pageRows,
    });
  } catch {
    return Response.json(
      { ok: false, message: 'D1 MASTER query failed. The desk still loads; check master_tracks.' },
      { status: 503 },
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const store = await getStore();
  const state = await store.read();
  const opened = await openMasterLibrary((await workerEnv())?.MASTER, Object.keys(state.airLog));

  const body = (await request.json()) as { keys?: string[]; bucket?: string };
  let keys = Array.isArray(body.keys) ? body.keys.filter((key) => typeof key === 'string' && key.trim()) : [];

  if (body.bucket === 'intersection' && keys.length === 0) {
    if (!opened.bound) {
      return Response.json({ ok: false, message: opened.note ?? 'D1 binding MASTER is not set' }, { status: 503 });
    }
    keys = opened.diff.intersection.slice(0, 400);
  }

  if (keys.length === 0) {
    return Response.json({ ok: false, message: 'keys required' }, { status: 400 });
  }

  try {
    const rows = opened.db ? await loadMasterRows(opened.db, keys) : [];
    const fromAir = keys
      .filter((key) => !rows.some((row) => row.id === key) && state.airLog[key])
      .map((key) => ({
        id: key,
        artist: state.airLog[key]!.artist,
        title: state.airLog[key]!.title,
      }));

    const result = promoteMasterTracks(state, [...rows, ...fromAir]);
    await store.write(result.state);
    return Response.json({
      ok: true,
      promoted: result.promoted.map((track) => ({ id: track.id, artist: track.artist, title: track.title })),
      skipped: result.skipped.length,
    });
  } catch {
    return Response.json({ ok: false, message: 'Promote failed (D1 or store). Desk is still up.' }, { status: 503 });
  }
};

async function rowsForBucket(
  db: D1Like,
  airLog: StationState['airLog'],
  bucket: string,
  ids: string[],
) {
  if (bucket === 'air-only') {
    return ids.flatMap((id) => {
      const entry = airLog[id];
      return entry ? [{ artist: entry.artist, title: entry.title, plays: entry.plays }] : [];
    });
  }
  const master = await loadMasterRows(db, ids);
  return master.map((row) => ({
    id: row.id,
    artist: row.artist,
    title: row.title,
    album: row.album,
    folderRoot: row.folderRoot,
    relativePath: row.relativePath,
    plays: airLog[row.id]?.plays,
  }));
}
