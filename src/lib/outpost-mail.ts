import type { SignupRow } from './outpost';
import type { WorkerEnv } from './runtime';

export const DEFAULT_NOTIFY_TO = 'support@badradio.com';
export const DEFAULT_NOTIFY_FROM = 'onboarding@resend.dev';
export const RESEND_SECRET_NAME = 'RESEND_API_KEY';
/** @deprecated use DEFAULT_NOTIFY_TO */
export const SIGNUP_MAIL_TO = DEFAULT_NOTIFY_TO;

export function shouldNotifySignup(action: 'insert' | 'update'): boolean {
  return action === 'insert';
}

export function readNotifyTo(env: WorkerEnv | undefined): string {
  const raw = typeof env?.NOTIFY_TO === 'string' ? env.NOTIFY_TO.trim() : '';
  return raw || DEFAULT_NOTIFY_TO;
}

export function readNotifyFrom(env: WorkerEnv | undefined): string {
  const raw = typeof env?.NOTIFY_FROM === 'string' ? env.NOTIFY_FROM.trim() : '';
  return formatFromAddress(raw || DEFAULT_NOTIFY_FROM);
}

export function formatFromAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return `badradio outpost <${DEFAULT_NOTIFY_FROM}>`;
  if (trimmed.includes('<') && trimmed.includes('>')) return trimmed;
  return `badradio outpost <${trimmed}>`;
}

function redactedMailBody(raw: string): string {
  return raw.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 800);
}

export async function notifyNewSignup(env: WorkerEnv | undefined, row: SignupRow): Promise<'sent' | 'skipped' | 'failed'> {
  const key = typeof env?.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  if (!key) {
    console.error('outpost-mail', 'skipped-no-secret');
    return 'skipped';
  }

  const to = readNotifyTo(env);
  const from = readNotifyFrom(env);
  const lines = [
    'New Outpost signup on badradio.rocks',
    `email: ${row.email}`,
    `name: ${row.name ?? ''}`,
    `x: ${row.xHandle ?? ''}`,
    `facebook: ${row.facebookHandle ?? ''}`,
    `shoutout_ok: ${row.shoutoutOk ? '1' : '0'}`,
    `source: ${row.source}`,
    `created_at: ${row.createdAt}`,
  ];

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'badradio outpost signup',
        text: lines.join('\n'),
      }),
    });
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    if (!response.ok) {
      console.error('outpost-mail', response.status, redactedMailBody(body));
      return 'failed';
    }
    console.error('outpost-mail', response.status, redactedMailBody(body));
    return 'sent';
  } catch {
    console.error('outpost-mail', 'fetch-failed');
    return 'failed';
  }
}

/** Await this on the request path. Do not void-and-forget: a late waitUntil is dropped. */
export async function notifyNewSignupIfNeeded(
  env: WorkerEnv | undefined,
  row: SignupRow,
  action: 'insert' | 'update',
): Promise<'sent' | 'skipped' | 'failed'> {
  if (!shouldNotifySignup(action)) return 'skipped';
  return notifyNewSignup(env, row);
}
