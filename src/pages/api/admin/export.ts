import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { exportOrderedTracks, exportReadyChecklist, toJsonExport, toM3u } from '../../../lib/radio/export';
import { extraAirHistory, reconcileDeskWithAir } from '../../../lib/radio/reconcile';
import type { OnAirTrack } from '../../../lib/live365/normalize';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const { feed, state } = await reconcileDeskWithAir();
  const now = new Date();
  const air: OnAirTrack[] = feed.ok
    ? [feed.now, ...feed.recent].filter((item): item is OnAirTrack => !!item)
    : [];
  const extra = extraAirHistory(state, air, now);

  const format = url.searchParams.get('format') ?? 'json';
  const scope = url.searchParams.get('scope') ?? 'ready';
  const tracks =
    scope === 'autodj'
      ? exportOrderedTracks(state, now)
      : exportReadyChecklist({
          state,
          now,
          includeReady: scope !== 'day',
          includeDaySet: scope === 'ready+day' || scope === 'day',
          extraHistory: extra,
        });

  const filename =
    format === 'm3u'
      ? `badradio-${scope.replace('+', '-')}.m3u`
      : `badradio-${scope.replace('+', '-')}.json`;

  if (format === 'm3u') {
    return new Response(toM3u(tracks), {
      headers: {
        'Content-Type': 'audio/x-mpegurl; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return new Response(toJsonExport(state.playlist, tracks, scope), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
