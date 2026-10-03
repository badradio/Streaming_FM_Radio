import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { playEvents, publicNow, rejectRequest } from '../../../lib/radio/autodj';
import { findTrack, stationTracks } from '../../../lib/radio/catalog';
import { markRequestPlayed } from '../../../lib/radio/match';
import { getStore } from '../../../lib/radio/store';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const store = await getStore();
  const state = await store.read();
  const { now, recent } = publicNow(state);
  const remaining = state.playlist.trackIds.slice(state.nextSetIndex).flatMap((id) => {
    const track = findTrack(id, state);
    return track ? [{ id: track.id, title: track.title, artist: track.artist, album: track.album ?? '' }] : [];
  });
  return Response.json({
    now,
    recent,
    playlist: state.playlist,
    nextSetIndex: state.nextSetIndex,
    remainingSet: remaining,
    requests: state.requests,
    plays: state.plays,
    history: playEvents(state, stationTracks(state)).map((event) => ({
      at: event.at.toISOString(),
      title: event.track.title,
      artist: event.track.artist,
      album: event.track.album ?? '',
    })),
  });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json()) as { requestId?: string; reason?: string; action?: string };
  if (!body.requestId) {
    return Response.json({ ok: false, message: 'requestId required' }, { status: 400 });
  }
  const store = await getStore();
  const state = await store.read();
  if (body.action === 'played') {
    const next = markRequestPlayed(state, body.requestId, new Date());
    await store.write(next);
    return Response.json({ ok: true });
  }
  const next = rejectRequest(state, body.requestId, body.reason ?? 'rejected by desk');
  await store.write(next);
  return Response.json({ ok: true });
};
