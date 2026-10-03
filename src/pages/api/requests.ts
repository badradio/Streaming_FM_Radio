import type { APIRoute } from 'astro';
import { queueRequest } from '../../lib/radio/autodj';
import { stationTracks } from '../../lib/radio/catalog';
import { listenerRejectCode } from '../../lib/radio/rules';
import { resolveTrack } from '../../lib/radio/search';
import { getStore } from '../../lib/radio/store';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { trackId?: string; query?: string; requesterLabel?: string };
  try {
    body = (await request.json()) as { trackId?: string; query?: string; requesterLabel?: string };
  } catch {
    return Response.json({ ok: false, code: 'unknown_track', message: 'Send JSON with trackId or artist/title' }, { status: 400 });
  }

  const store = await getStore();
  const state = await store.read();
  const result = queueRequest({
    state,
    trackId: body.trackId,
    trackQuery: body.query,
    requesterLabel: body.requesterLabel ?? 'listener',
    now: new Date(),
    tracks: stationTracks(state),
    resolveTrack,
  });
  await store.write(result.state);

  if (result.request.status === 'rejected') {
    const raw = result.request.rejectReason ?? 'rejected';
    const code = listenerRejectCode(raw.split(' — ')[0] ?? 'no_slot');
    return Response.json(
      {
        ok: false,
        code,
        message: raw,
      },
      { status: 409 },
    );
  }

  return Response.json({
    ok: true,
    status: 'queued',
    message: 'Queued. Requests play later, not next — at least one hour after you ask.',
  });
};
