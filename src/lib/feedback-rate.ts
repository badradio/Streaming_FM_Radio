import {
  FEEDBACK_MESSAGE_LIMIT_HOUR,
  FEEDBACK_VOTE_LIMIT_HOUR,
} from './feedback';

const HOUR_MS = 60 * 60 * 1000;

type RateKind = 'vote' | 'message';

type WindowCount = {
  n: number;
  start: number;
};

export type FeedbackKv = {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export function rateKeys(kind: RateKind, sessionId: string, ipHash: string | null): string[] {
  const keys = [`fb:rl:${kind}:s:${sessionId}`];
  if (ipHash) keys.push(`fb:rl:${kind}:ip:${ipHash}`);
  return keys;
}

export async function allowFeedbackHit(
  kv: FeedbackKv | undefined,
  kind: RateKind,
  sessionId: string,
  ipHash: string | null,
): Promise<boolean> {
  if (!kv) return true;
  const limit = kind === 'vote' ? FEEDBACK_VOTE_LIMIT_HOUR : FEEDBACK_MESSAGE_LIMIT_HOUR;
  const now = Date.now();
  for (const key of rateKeys(kind, sessionId, ipHash)) {
    const raw = (await kv.get(key, 'json')) as WindowCount | null;
    let n = 0;
    let start = now;
    if (raw && typeof raw.n === 'number' && typeof raw.start === 'number' && now - raw.start < HOUR_MS) {
      n = raw.n;
      start = raw.start;
    }
    if (n >= limit) return false;
    await kv.put(key, JSON.stringify({ n: n + 1, start }), { expirationTtl: 3600 });
  }
  return true;
}
