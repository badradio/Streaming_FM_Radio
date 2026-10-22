import type { APIRoute } from 'astro';
import { requireFeedbackAdmin } from '../../../lib/feedback-auth';
import { getFeedbackDb, listMessages } from '../../../lib/feedback-db';
import { parseMessageQuery } from '../../../lib/feedback';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const denied = await requireFeedbackAdmin(request);
  if (denied) return denied;

  const parsed = parseMessageQuery(new URL(request.url).searchParams);
  if ('error' in parsed) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const db = await getFeedbackDb();
  if (!db) {
    return Response.json(
      { ok: false, error: 'Feedback is offline right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const messages = await listMessages(db, parsed);
    return Response.json(
      { ok: true, count: messages.length, messages },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { ok: false, error: 'Feedback is offline right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
