import { getLive365StationId } from '../live365/config';
import { fetchLive365Station } from '../live365/fetch';
import { attachWidgetRecent } from '../widget-recent';
import { upsertAirLog } from './airlog';
import { stationTracks, findTrack } from './catalog';
import { airMatchesTrack, markPlayedFromAir, matchKey } from './match';
import { getStore } from './store';
import type { OnAirTrack, Live365Result } from '../live365/normalize';
import type { PlayEvent, StationState } from './types';

export async function reconcileDeskWithAir(now = new Date()): Promise<{
  feed: Live365Result;
  state: StationState;
  marked: number;
}> {
  const store = await getStore();
  const state = await store.read();
  const stationId = await getLive365StationId();
  if (!stationId) {
    return { feed: { ok: false, reason: 'no_station', now: null, recent: [] }, state, marked: 0 };
  }

  const feed = await fetchLive365Station(stationId);
  if (!feed.ok) return { feed, state, marked: 0 };

  const air = [feed.now, ...feed.recent].filter((item): item is OnAirTrack => !!item);
  const logged = upsertAirLog({ state, air, now });
  const result = markPlayedFromAir({ state: logged.state, air, now });
  if (logged.changed || result.marked > 0) await store.write(result.state);

  // Air log uses this Live365 snapshot only. KV rolling history is for the public
  // widget/listen recent list (Live365 last-played is 5; we keep 10 unique).
  const publicFeed = await attachWidgetRecent(feed, now);
  return { feed: publicFeed, state: result.state, marked: result.marked };
}

/** Live365 air that is not already a cataloged desk play, for SRPC artist-cap context. */
export function extraAirHistory(state: StationState, air: OnAirTrack[], now: Date): PlayEvent[] {
  const playedTracks = state.plays.flatMap((play) => {
    const track = findTrack(play.trackId, state);
    return track ? [track] : [];
  });
  const tracks = stationTracks(state);

  return air.flatMap((item, index) => {
    if (playedTracks.some((track) => airMatchesTrack(item, track))) return [];
    const matched = tracks.find((track) => airMatchesTrack(item, track));
    const at = item.startedAt && Number.isFinite(Date.parse(item.startedAt))
      ? new Date(item.startedAt)
      : new Date(now.getTime() - index * 4 * 60 * 1000);
    const track = matched ?? {
      id: `air:${matchKey(item.artist, item.title)}`,
      title: item.title,
      artist: item.artist,
      album: '—',
      year: 0,
      durationSec: 180,
    };
    return [{ track, at }];
  });
}
