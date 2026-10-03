import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isValidEmail,
  normalizeEmail,
  parseSignup,
  planSignupUpsert,
  planUnsubscribe,
  signupMessage,
  signupFlashForError,
  outpostFlashMessage,
  outpostListenRedirect,
  toSignupCsv,
  type SignupRow,
} from '../src/lib/outpost';
import { isAnalyticsEvent, sanitizeBeaconToken, sanitizeGaMeasurementId } from '../src/lib/analytics';
import { detectClientOs, highlightGroup } from '../src/lib/client-os';
import {
  DEFAULT_NOTIFY_FROM,
  DEFAULT_NOTIFY_TO,
  formatFromAddress,
  notifyNewSignup,
  notifyNewSignupIfNeeded,
  readNotifyFrom,
  readNotifyTo,
  shouldNotifySignup,
} from '../src/lib/outpost-mail';
import { upsertSignupSql } from '../src/lib/outpost-db';
import { normalizeSocialHandle } from '../src/lib/social-handle';

function row(overrides: Partial<SignupRow> = {}): SignupRow {
  return {
    id: 'id-1',
    email: 'Mark@Example.com',
    emailNorm: 'mark@example.com',
    name: 'Mark',
    source: 'listen',
    status: 'subscribed',
    consentAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    unsubToken: 'token-keep',
    shoutoutOk: false,
    ...overrides,
  };
}

describe('outpost validation', () => {
  it('normalizes email without logging', () => {
    expect(normalizeEmail('  Mark@Example.COM ')).toBe('mark@example.com');
  });

  it('requires a usable email and treats name as optional', () => {
    expect(parseSignup({ email: '' }).ok).toBe(false);
    expect(parseSignup({ email: 'not-an-email' }).ok).toBe(false);
    expect(parseSignup({ email: 'a@b' }).ok).toBe(false);
    expect(signupMessage('email_required')).toMatch(/email/i);

    const named = parseSignup({ email: 'dj@example.com', name: '  Beacon  ', source: 'listen' });
    expect(named).toMatchObject({ ok: true, emailNorm: 'dj@example.com', name: 'Beacon', source: 'listen' });

    const nameless = parseSignup({ email: 'dj@example.com' });
    expect(nameless.ok).toBe(true);
    if (nameless.ok) expect(nameless.name).toBeUndefined();
  });

  it('rejects an overlong name and keeps email validity tight', () => {
    expect(isValidEmail('listen@badradio.rocks')).toBe(true);
    expect(isValidEmail('.leading@x.com')).toBe(false);
    expect(parseSignup({ email: 'ok@example.com', name: 'x'.repeat(81) })).toEqual({
      ok: false,
      code: 'name_too_long',
    });
  });

  it('normalizes optional social handles and shout-out', () => {
    const parsed = parseSignup({
      email: 'dj@example.com',
      xHandle: 'https://x.com/@BadRadio',
      facebookHandle: 'facebook.com/mybadradio/',
      shoutoutOk: 'on',
    });
    expect(parsed).toMatchObject({
      ok: true,
      xHandle: 'BadRadio',
      facebookHandle: 'mybadradio',
      shoutoutOk: true,
    });
    expect(parseSignup({ email: 'dj@example.com', xHandle: 'no spaces allowed' }).ok).toBe(false);
  });
});

describe('outpost upsert plan', () => {
  const parsed = parseSignup({ email: 'Mark@Example.com', name: 'Mark', source: 'listen' });
  if (!parsed.ok) throw new Error('fixture');

  it('inserts a new subscribed row with a fresh unsub token', () => {
    const planned = planSignupUpsert(undefined, parsed, '2026-09-16T12:00:00.000Z', {
      id: 'new-id',
      unsubToken: 'new-token',
    });
    expect(planned.action).toBe('insert');
    expect(planned.row.status).toBe('subscribed');
    expect(planned.row.emailNorm).toBe('mark@example.com');
    expect(planned.row.unsubToken).toBe('new-token');
    expect(planned.row.consentAt).toBe('2026-09-16T12:00:00.000Z');
  });

  it('upserts the same email in place and re-subscribes without rotating the token', () => {
    const existing = row({ status: 'unsubscribed', name: 'Old' });
    const planned = planSignupUpsert(existing, parsed, '2026-09-16T13:00:00.000Z', {
      id: 'ignored',
      unsubToken: 'ignored',
    });
    expect(planned.action).toBe('update');
    expect(planned.row.id).toBe('id-1');
    expect(planned.row.unsubToken).toBe('token-keep');
    expect(planned.row.status).toBe('subscribed');
    expect(planned.row.name).toBe('Mark');
    expect(planned.row.consentAt).toBe('2026-09-16T13:00:00.000Z');
    expect(planned.row.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('outpost unsubscribe', () => {
  it('marks a subscribed row unsubscribed and is idempotent', () => {
    const first = planUnsubscribe(row(), '2026-09-16T14:00:00.000Z');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.already).toBe(false);
    expect(first.row.status).toBe('unsubscribed');
    expect(first.row.updatedAt).toBe('2026-09-16T14:00:00.000Z');
    expect(first.row.unsubToken).toBe('token-keep');

    const second = planUnsubscribe(first.row, '2026-09-16T15:00:00.000Z');
    expect(second).toMatchObject({ ok: true, already: true });
  });

  it('rejects an unknown token without inventing a row', () => {
    expect(planUnsubscribe(undefined, '2026-09-16T14:00:00.000Z')).toEqual({
      ok: false,
      code: 'unknown_token',
    });
  });
});

describe('outpost browser flash', () => {
  it('maps errors to a query code that never includes an email', () => {
    expect(signupFlashForError('email_required')).toBe('needed');
    expect(signupFlashForError('email_invalid')).toBe('invalid');
    expect(outpostListenRedirect('ok')).toBe('/?outpost=ok');
    expect(outpostListenRedirect('offline')).toBe('/?outpost=offline');
    expect(outpostFlashMessage('ok')).toBe('You are on the list.');
    expect(outpostFlashMessage('offline')).toMatch(/Play still works/i);
    expect(outpostListenRedirect('ok')).not.toMatch(/@/);
  });
});

describe('outpost csv export', () => {
  it('exports migration-friendly columns and omits the unsubscribe token', () => {
    const csv = toSignupCsv([row({ email: 'mark@example.com' })]);
    expect(csv.startsWith('created_at,updated_at,status,source,email,name,x_handle,facebook_handle,shoutout_ok\n')).toBe(true);
    expect(csv).toContain('mark@example.com');
    expect(csv).not.toContain('unsub_token');
    expect(csv).not.toContain('token-keep');
  });
});

describe('analytics allowlist', () => {
  it('only tracks play and signup events, never PII-shaped tokens', () => {
    expect(isAnalyticsEvent('play_click')).toBe(true);
    expect(isAnalyticsEvent('signup_submit')).toBe(true);
    expect(isAnalyticsEvent('email')).toBe(false);
    expect(sanitizeBeaconToken('not a token')).toBeUndefined();
    expect(sanitizeBeaconToken('abc_def-1234567890')).toBe('abc_def-1234567890');
    expect(sanitizeGaMeasurementId('G-ABCDEF12')).toBe('G-ABCDEF12');
    expect(sanitizeGaMeasurementId('UA-123')).toBeUndefined();
  });

  it('extracts hex from a pasted Web Analytics script blob', () => {
    const hex = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const blob = `<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${hex}"}'></script>`;
    expect(sanitizeBeaconToken(blob)).toBe(hex);
    expect(sanitizeBeaconToken(`  ${hex}  `)).toBe(hex);
  });
});

describe('social handles', () => {
  it('strips @ and profile URLs to a bare handle', () => {
    expect(normalizeSocialHandle('@mark')).toEqual({ ok: true, handle: 'mark' });
    expect(normalizeSocialHandle('https://x.com/mark?s=20')).toEqual({ ok: true, handle: 'mark' });
    expect(normalizeSocialHandle('')).toEqual({ ok: true });
    expect(normalizeSocialHandle('nope nope').ok).toBe(false);
  });
});

describe('signup SQL fallback', () => {
  it('keeps the old column list when 0003 is not applied', () => {
    const legacy = upsertSignupSql(false);
    expect(legacy).toContain('unsub_token');
    expect(legacy).not.toContain('x_handle');
    expect(upsertSignupSql(true)).toContain('x_handle');
    expect(upsertSignupSql(true)).toContain('shoutout_ok');
  });
});

describe('signup mail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('notifies only first-time inserts and is inert without a secret', async () => {
    expect(shouldNotifySignup('insert')).toBe(true);
    expect(shouldNotifySignup('update')).toBe(false);
    const result = await notifyNewSignup(undefined, row());
    expect(result).toBe('skipped');
    const empty = await notifyNewSignup({ RESEND_API_KEY: '   ' }, row());
    expect(empty).toBe('skipped');
    expect(await notifyNewSignupIfNeeded({ RESEND_API_KEY: 're_test' }, row(), 'update')).toBe('skipped');
  });

  it('defaults recipient/sender and accepts NOTIFY_TO / NOTIFY_FROM', () => {
    expect(readNotifyTo(undefined)).toBe(DEFAULT_NOTIFY_TO);
    expect(readNotifyTo({})).toBe('support@badradio.com');
    expect(readNotifyTo({ NOTIFY_TO: '  desk@badradio.com  ' })).toBe('desk@badradio.com');
    expect(readNotifyFrom(undefined)).toBe(`badradio outpost <${DEFAULT_NOTIFY_FROM}>`);
    expect(readNotifyFrom({ NOTIFY_FROM: 'outpost@send.badradio.com' })).toBe(
      'badradio outpost <outpost@send.badradio.com>',
    );
    expect(formatFromAddress('badradio outpost <outpost@badradio.com>')).toBe(
      'badradio outpost <outpost@badradio.com>',
    );
  });

  it('POSTs Resend on insert and logs status/body without the key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          statusCode: 403,
          name: 'validation_error',
          message:
            'You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });

    const result = await notifyNewSignupIfNeeded(
      {
        RESEND_API_KEY: 're_secret_must_not_log',
        NOTIFY_TO: 'support@badradio.com',
        NOTIFY_FROM: 'onboarding@resend.dev',
      },
      row(),
      'insert',
    );
    expect(result).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
    const payload = JSON.parse(String(init.body));
    expect(payload.to).toEqual(['support@badradio.com']);
    expect(payload.from).toBe('badradio outpost <onboarding@resend.dev>');
    expect(String(init.headers && (init.headers as Record<string, string>).Authorization)).toContain(
      're_secret_must_not_log',
    );
    expect(logged.some((args) => args[0] === 'outpost-mail' && args[1] === 403)).toBe(true);
    expect(JSON.stringify(logged)).toContain('verify a domain');
    expect(JSON.stringify(logged)).not.toContain('re_secret_must_not_log');
  });

  it('column-missing fallback still uses the planned insert/update (mail is not skipped)', () => {
    expect(shouldNotifySignup('insert')).toBe(true);
    expect(upsertSignupSql(false)).not.toContain('x_handle');
  });
});

describe('listen-anywhere OS highlight', () => {
  it('maps common user agents to the matching install card', () => {
    expect(detectClientOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(highlightGroup('ios')).toBe('ios');
    expect(detectClientOs('Mozilla/5.0 (Linux; Android 14)')).toBe('android');
    expect(detectClientOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(highlightGroup('windows')).toBe('desktop');
    expect(detectClientOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', { platform: 'MacIntel', maxTouchPoints: 5 })).toBe(
      'ios',
    );
  });
});
