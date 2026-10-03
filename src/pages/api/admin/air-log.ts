import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { listAirLog, promoteAirKeys, toAirLogCsv, toAirLogJson } from '../../../lib/radio/airlog';
import { reconcileDeskWithAir } from '../../../lib/radio/reconcile';
import { getStore } from '../../../lib/radio/store';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { state } = await reconcileDeskWithAir();
  const format = url.searchParams.get('format') ?? 'json';
  const query = url.searchParams.get('q') ?? undefined;
  const entries = listAirLog(state, { query });

  if (format === 'csv') {
    return new Response(toAirLogCsv(entries), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="badradio-air-log.csv"',
      },
    });
  }

  return new Response(toAirLogJson(entries), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="badradio-air-log.json"',
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json()) as { keys?: string[] };
  const keys = Array.isArray(body.keys) ? body.keys.filter((key) => typeof key === 'string' && key.trim()) : [];
  if (keys.length === 0) {
    return Response.json({ ok: false, message: 'keys required' }, { status: 400 });
  }
  const store = await getStore();
  const state = await store.read();
  const result = promoteAirKeys(state, keys);
  await store.write(result.state);
  return Response.json({
    ok: true,
    promoted: result.promoted.map((track) => ({ id: track.id, artist: track.artist, title: track.title })),
    skipped: result.skipped.length,
  });
};
