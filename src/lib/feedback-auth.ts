import { workerEnv } from './runtime';

export async function getFeedbackAdminKey(): Promise<string> {
  const env = await workerEnv();
  const fromEnv = typeof env?.FEEDBACK_ADMIN_KEY === 'string' ? env.FEEDBACK_ADMIN_KEY.trim() : '';
  if (fromEnv) return fromEnv;
  const fromNode = globalThis.process?.env?.['FEEDBACK_ADMIN_KEY'];
  return (fromNode ?? '').trim();
}

export function readFeedbackAdminKey(request: Request): string {
  const header = request.headers.get('x-feedback-key')?.trim() ?? '';
  if (header) return header;
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
  if (bearer) return bearer;
  return new URL(request.url).searchParams.get('key')?.trim() ?? '';
}

export async function feedbackAdminKeyMatches(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) {
    await crypto.subtle.digest('SHA-256', a);
    return false;
  }
  let out = 0;
  for (let i = 0; i < a.byteLength; i++) out |= a[i]! ^ b[i]!;
  return out === 0;
}

export async function requireFeedbackAdmin(request: Request): Promise<Response | null> {
  const expected = await getFeedbackAdminKey();
  if (!expected) {
    return Response.json(
      { ok: false, error: 'Feedback desk is not configured yet.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const provided = readFeedbackAdminKey(request);
  if (!(await feedbackAdminKeyMatches(provided, expected))) {
    return Response.json(
      { ok: false, error: 'That key is not right.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return null;
}
