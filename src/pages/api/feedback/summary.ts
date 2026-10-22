import type { APIRoute } from 'astro';
import { requireFeedbackAdmin } from '../../../lib/feedback-auth';
import { getFeedbackDb, listVoteSummary } from '../../../lib/feedback-db';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const denied = await requireFeedbackAdmin(request);
  if (denied) return denied;

  const artist = new URL(request.url).searchParams.get('artist')?.trim() ?? '';
  const db = await getFeedbackDb();
  if (!db) {
    return Response.json(
      { ok: false, error: 'Feedback is offline right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const tracks = await listVoteSummary(db, artist || undefined);
    return Response.json(
      { ok: true, count: tracks.length, tracks },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { ok: false, error: 'Feedback is offline right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
