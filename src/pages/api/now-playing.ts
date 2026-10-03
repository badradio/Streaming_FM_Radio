import type { APIRoute } from 'astro';
import { corsPreflight } from '../../lib/embed-origins';
import { reconcileDeskWithAir } from '../../lib/radio/reconcile';

export const prerender = false;

export const OPTIONS: APIRoute = async ({ request }) => corsPreflight(request);

export const GET: APIRoute = async () => {
  const { feed } = await reconcileDeskWithAir();
  if (!feed.ok) {
    const status = feed.reason === 'no_station' ? 404 : 502;
    return Response.json(feed, { status, headers: { 'Cache-Control': 'no-store' } });
  }

  return Response.json(feed, {
    headers: {
      'Cache-Control': 'private, max-age=8',
    },
  });
};
