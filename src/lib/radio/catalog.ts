import catalogJson from '../../data/catalog.json';
import daySetJson from '../../data/playlists/day-set.json';
import type { Playlist, StationState, Track } from './types';

type CatalogRow = {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: number;
  isrc: string | null;
  durationSec: number;
  audioUrl: string | null;
};

export const catalog: Track[] = (catalogJson.tracks as CatalogRow[]).map((track) => ({
  id: track.id,
  title: track.title,
  artist: track.artist,
  album: track.album,
  year: track.year,
  durationSec: track.durationSec,
  ...(track.isrc ? { isrc: track.isrc } : {}),
  ...(track.audioUrl ? { audioUrl: track.audioUrl } : {}),
}));

export const seedPlaylist: Playlist = {
  id: daySetJson.id,
  name: daySetJson.name,
  daypart: daySetJson.daypart,
  trackIds: [...daySetJson.trackIds],
};

const byId = new Map(catalog.map((track) => [track.id, track]));

export function getTrack(id: string): Track | undefined {
  return byId.get(id);
}

/** Git starter catalog plus titles promoted from the Live365 air log. */
export function stationTracks(state: Pick<StationState, 'promotedTracks'>): Track[] {
  const extra = state.promotedTracks ?? [];
  if (extra.length === 0) return catalog;
  const ids = new Set(catalog.map((track) => track.id));
  return [...catalog, ...extra.filter((track) => !ids.has(track.id))];
}

export function findTrack(id: string, state?: Pick<StationState, 'promotedTracks'>): Track | undefined {
  return getTrack(id) ?? state?.promotedTracks?.find((track) => track.id === id);
}

export function requireTrack(id: string): Track {
  const track = byId.get(id);
  if (!track) throw new Error(`Unknown track: ${id}`);
  return track;
}

export function tracksForPlaylist(playlist: Playlist): Track[] {
  return playlist.trackIds.map(requireTrack);
}

export function emptyState(playlist: Playlist = seedPlaylist): import('./types').StationState {
  return {
    playlist: {
      id: playlist.id,
      name: playlist.name,
      daypart: playlist.daypart,
      trackIds: [...playlist.trackIds],
    },
    nextSetIndex: 0,
    requests: [],
    plays: [],
    airLog: {},
    promotedTracks: [],
  };
}
