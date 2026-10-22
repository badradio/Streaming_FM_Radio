import type { APIRoute } from 'astro';
import { corsPreflight } from '../../../lib/embed-origins';
import { getFeedbackDb, insertMessage } from '../../../lib/feedback-db';
import { currentFeedbackTrack, feedbackGeoFromRequest, feedbackStationKv, hashClientIp } from '../../../lib/feedback-request';
import { allowFeedbackHit } from '../../../lib/feedback-rate';
import { cleanMessage, feedbackNow, honeypotFilled, isValidSessionId } from '../../../lib/feedback';

export const prerender = false;

export const OPTIONS: APIRoute = async ({ request }) => corsPreflight(request, 'GET, POST, OPTIONS');

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (honeypotFilled(body.website ?? body.company ?? body.url)) {
    return json({ ok: true });
  }
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!isValidSessionId(sessionId)) {
    return json({ ok: false, error: 'Refresh and try that note again.' }, 400);
  }
  const cleaned = cleanMessage(body.kind, body.body ?? body.text);
  if (!cleaned.ok) return json({ ok: false, error: cleaned.error }, 400);

  const kv = await feedbackStationKv();
  const ipHash = await hashClientIp(request);
  if (!(await allowFeedbackHit(kv, 'message', sessionId, ipHash))) {
    return json({ ok: false, error: 'Slow down — you can send another note later.' }, 429);
  }

  const db = await getFeedbackDb();
  if (!db) return json({ ok: false, error: 'Feedback is offline right now. Play still works.' }, 503);

  try {
    const when = feedbackNow();
    await insertMessage(db, {
      sessionId,
      kind: cleaned.kind,
      body: cleaned.body,
      track: await currentFeedbackTrack(),
      createdAt: when.createdAt,
      createdCt: when.createdCt,
      geo: feedbackGeoFromRequest(request),
    });
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: 'Feedback is offline right now. Play still works.' }, 503);
  }
};

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
