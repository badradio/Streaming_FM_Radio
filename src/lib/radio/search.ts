import { normalizeKey } from './rules';
import type { Track } from './types';

export function searchTracks(tracks: Track[], query: string, limit = 20): Track[] {
  const q = normalizeKey(query);
  if (!q) return [];

  const scored = tracks
    .map((track) => ({ track, score: scoreTrack(track, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.track.artist.localeCompare(b.track.artist));

  return scored.slice(0, limit).map((row) => row.track);
}

export function resolveTrack(tracks: Track[], query: string): Track | undefined {
  const q = normalizeKey(query);
  if (!q) return undefined;

  const exactId = tracks.find((track) => track.id === query.trim());
  if (exactId) return exactId;

  const hits = searchTracks(tracks, query, 50);
  const exact = hits.find((track) => {
    const pair = normalizeKey(`${track.artist} ${track.title}`);
    const dashed = normalizeKey(`${track.artist} - ${track.title}`);
    return pair === q || dashed === q || normalizeKey(track.title) === q;
  });
  if (exact) return exact;
  if (hits.length === 1) return hits[0];
  return undefined;
}

function scoreTrack(track: Track, q: string): number {
  const title = normalizeKey(track.title);
  const artist = normalizeKey(track.artist);
  const album = normalizeKey(track.album ?? '');
  const pair = `${artist} ${title}`;
  const dashed = `${artist} - ${title}`;

  if (pair === q || dashed === q) return 100;
  if (title === q) return 90;
  if (artist === q) return 70;
  if (album && album === q) return 50;
  if (pair.includes(q) || dashed.includes(q)) return 40;
  if (title.includes(q)) return 30;
  if (artist.includes(q)) return 20;
  if (album && album.includes(q)) return 10;
  return 0;
}
