import type { APIRoute } from 'astro';
import { publicNow } from '../../lib/radio/autodj';
import { getStore } from '../../lib/radio/store';

export const prerender = false;

export const GET: APIRoute = async () => {
  const store = await getStore();
  const state = await store.read();
  const { now, recent } = publicNow(state);
  return Response.json({
    now: now ? publicTrack(now) : null,
    recent: recent.map(publicTrack),
    note: 'Requests play later, not next.',
  });
};

function publicTrack(track: { title: string; artist: string; album?: string; year?: number }) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album ?? '',
    year: track.year ?? 0,
  };
}
