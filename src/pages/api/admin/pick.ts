import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { pickNext } from '../../../lib/radio/autodj';
import { stationTracks } from '../../../lib/radio/catalog';
import { getStore } from '../../../lib/radio/store';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const store = await getStore();
  const state = await store.read();
  const result = pickNext({ state, now: new Date(), tracks: stationTracks(state) });
  if ('refused' in result) {
    return Response.json({ ok: false, code: result.refused.code, message: result.refused.message }, { status: 409 });
  }
  await store.write(result.state);
  return Response.json({
    ok: true,
    play: result.play,
    track: {
      id: result.track.id,
      title: result.track.title,
      artist: result.track.artist,
      album: result.track.album ?? '',
      year: result.track.year ?? 0,
    },
  });
};
