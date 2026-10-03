import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { savePlaylist } from '../../../lib/radio/autodj';
import { catalog, getTrack } from '../../../lib/radio/catalog';
import { getStore } from '../../../lib/radio/store';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const store = await getStore();
  const state = await store.read();
  return Response.json({
    playlist: state.playlist,
    nextSetIndex: state.nextSetIndex,
    catalog: catalog.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      year: track.year,
    })),
  });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: { name?: string; daypart?: string; trackIds?: string[] };
  try {
    body = (await request.json()) as { name?: string; daypart?: string; trackIds?: string[] };
  } catch {
    return Response.json({ ok: false, message: 'JSON body required' }, { status: 400 });
  }

  const trackIds = Array.isArray(body.trackIds) ? body.trackIds.filter((id) => typeof id === 'string') : [];
  if (trackIds.length === 0) {
    return Response.json({ ok: false, message: 'A day set needs at least one catalog track' }, { status: 400 });
  }
  const missing = trackIds.find((id) => !getTrack(id));
  if (missing) {
    return Response.json({ ok: false, message: `Unknown track: ${missing}` }, { status: 400 });
  }

  const store = await getStore();
  const state = await store.read();
  const next = savePlaylist(state, {
    id: state.playlist.id || 'day-set',
    name: body.name ?? state.playlist.name,
    daypart: body.daypart ?? state.playlist.daypart,
    trackIds,
  });
  await store.write(next);
  return Response.json({ ok: true, playlist: next.playlist });
};
