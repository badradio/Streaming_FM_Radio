import type { APIRoute } from 'astro';
import { getMasterDb } from '../../lib/radio/master-db';
import { listStoredPlays, playsTableReady } from '../../lib/plays-log';
import { parsePlayQuery } from '../../lib/plays';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const parsed = parsePlayQuery(new URL(request.url).searchParams);
  if ('error' in parsed) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const db = await getMasterDb();
  if (!db || !(await playsTableReady(db))) {
    return Response.json(
      { ok: false, error: 'Play log is offline.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const plays = await listStoredPlays(db, parsed);
    return Response.json(
      { ok: true, count: plays.length, plays },
      { headers: { 'Cache-Control': 'private, max-age=15' } },
    );
  } catch {
    return Response.json(
      { ok: false, error: 'Play log is offline.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
