import { findTrack, stationTracks } from './catalog';
import { normalizeKey } from './rules';
import type { OnAirTrack } from '../live365/normalize';
import type { Play, StationState, Track } from './types';

const DUP_WINDOW_MS = 2 * 60 * 1000;

/** Fold artist/title so Live365 metadata can match the desk catalog. */
export function matchKey(artist: string, title: string): string {
  return `${foldMatchText(artist)}::${foldMatchText(title)}`;
}

export function airMatchesTrack(air: Pick<OnAirTrack, 'artist' | 'title'>, track: Pick<Track, 'artist' | 'title'>): boolean {
  const airKey = matchKey(air.artist, air.title);
  const catalogKey = matchKey(track.artist, track.title);
  if (airKey === catalogKey) return true;
  return matchKey(air.artist, stripSuffix(air.title)) === matchKey(track.artist, stripSuffix(track.title));
}

export function markPlayedFromAir(options: {
  state: StationState;
  air: OnAirTrack[];
  now: Date;
}): { state: StationState; marked: number } {
  let state = options.state;
  let marked = 0;
  const tracks = stationTracks(state);

  for (const air of options.air) {
    const pending = state.requests.filter((request) => request.status === 'queued' || request.status === 'scheduled');
    const hit = pending.find((request) => {
      const track = findTrack(request.trackId, state);
      return track ? airMatchesTrack(air, track) : false;
    });
    if (!hit) continue;

    const next = markRequestPlayed(state, hit.id, airTime(air, options.now), tracks);
    if (next !== state) {
      state = next;
      marked += 1;
    }
  }

  return { state, marked };
}

export function markRequestPlayed(state: StationState, requestId: string, at: Date, tracks = stationTracks(state)): StationState {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request || (request.status !== 'queued' && request.status !== 'scheduled')) return state;
  const track = tracks.find((item) => item.id === request.trackId) ?? findTrack(request.trackId, state);
  if (!track) return state;

  const requests = state.requests.map((item) => (item.id === requestId ? { ...item, status: 'played' as const } : item));
  const duplicate = state.plays.some(
    (play) => play.trackId === track.id && Math.abs(Date.parse(play.playedAt) - at.getTime()) < DUP_WINDOW_MS,
  );
  if (duplicate) return { ...state, requests };

  const play: Play = {
    id: crypto.randomUUID(),
    trackId: track.id,
    playedAt: at.toISOString(),
    source: 'request',
  };
  return { ...state, requests, plays: [...state.plays, play] };
}

function airTime(air: OnAirTrack, fallback: Date): Date {
  if (!air.startedAt) return fallback;
  const parsed = Date.parse(air.startedAt);
  return Number.isFinite(parsed) ? new Date(parsed) : fallback;
}

export function foldMatchText(value: string): string {
  return normalizeKey(
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/gi, ' '),
  );
}

function stripSuffix(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/g, '').trim();
}
