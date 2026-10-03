import type { APIRoute } from 'astro';
import { stationTracks } from '../../lib/radio/catalog';
import { searchTracks } from '../../lib/radio/search';
import { getStore } from '../../lib/radio/store';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  const store = await getStore();
  const state = await store.read();
  const tracks = searchTracks(stationTracks(state), q).map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album ?? '',
    year: track.year ?? 0,
  }));
  return Response.json({ tracks });
};
