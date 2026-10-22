import type { APIRoute } from 'astro';
import { corsPreflight } from '../../../lib/embed-origins';
import { getFeedbackDb, readMineVote, upsertVote } from '../../../lib/feedback-db';
import { currentFeedbackTrack, feedbackGeoFromRequest, feedbackStationKv, hashClientIp } from '../../../lib/feedback-request';
import { allowFeedbackHit } from '../../../lib/feedback-rate';
import {
  feedbackNow,
  honeypotFilled,
  isValidSessionId,
  parseFeedbackVote,
} from '../../../lib/feedback';

export const prerender = false;

export const OPTIONS: APIRoute = async ({ request }) => corsPreflight(request, 'GET, POST, OPTIONS');

export const GET: APIRoute = async ({ request }) => {
  const sessionId = new URL(request.url).searchParams.get('session_id')?.trim() ?? '';
  if (!isValidSessionId(sessionId)) {
    return json({ ok: false, error: 'Missing listener id.' }, 400);
  }
  const track = await currentFeedbackTrack();
  if (!track) return json({ ok: true, vote: null, track: null });
  const db = await getFeedbackDb();
  if (!db) return json({ ok: false, error: 'Feedback is offline right now.' }, 503);
  try {
    const vote = await readMineVote(db, sessionId, track);
    return json({ ok: true, vote, track });
  } catch {
    return json({ ok: false, error: 'Feedback is offline right now.' }, 503);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (honeypotFilled(body.website ?? body.company ?? body.url)) {
    return json({ ok: true, vote: parseFeedbackVote(body.vote) ?? 1 });
  }
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!isValidSessionId(sessionId)) {
    return json({ ok: false, error: 'Refresh and try that vote again.' }, 400);
  }
  const vote = parseFeedbackVote(body.vote);
  if (!vote) return json({ ok: false, error: 'Choose thumbs up or thumbs down.' }, 400);

  const track = await currentFeedbackTrack();
  if (!track) {
    return json({ ok: false, error: "Nothing on air to vote on yet — wait for the next song." }, 409);
  }

  const kv = await feedbackStationKv();
  const ipHash = await hashClientIp(request);
  if (!(await allowFeedbackHit(kv, 'vote', sessionId, ipHash))) {
    return json({ ok: false, error: 'Slow down — try voting again in a bit.' }, 429);
  }

  const db = await getFeedbackDb();
  if (!db) return json({ ok: false, error: 'Feedback is offline right now. Play still works.' }, 503);

  try {
    const when = feedbackNow();
    await upsertVote(db, {
      sessionId,
      track,
      vote,
      createdAt: when.createdAt,
      createdCt: when.createdCt,
      geo: feedbackGeoFromRequest(request),
    });
    return json({ ok: true, vote, track });
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
