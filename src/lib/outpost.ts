import { normalizeSocialHandle, parseShoutoutOk } from './social-handle';

export const SIGNUP_STATUSES = ['subscribed', 'unsubscribed'] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

export type SignupInput = {
  email: string;
  name?: string;
  source?: string;
  xHandle?: string;
  facebookHandle?: string;
  shoutoutOk?: unknown;
};

export type SignupRow = {
  id: string;
  email: string;
  emailNorm: string;
  name?: string;
  source: string;
  status: SignupStatus;
  consentAt: string;
  createdAt: string;
  updatedAt: string;
  unsubToken: string;
  xHandle?: string;
  facebookHandle?: string;
  shoutoutOk: boolean;
};

export type SignupParse =
  | {
      ok: true;
      email: string;
      emailNorm: string;
      name?: string;
      source: string;
      xHandle?: string;
      facebookHandle?: string;
      shoutoutOk: boolean;
    }
  | { ok: false; code: 'email_required' | 'email_invalid' | 'name_too_long' | 'handle_invalid' };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length < 5 || email.length > 254) return false;
  if (email.includes('..') || email.startsWith('.') || email.endsWith('.')) return false;
  return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(email);
}

export function parseSignup(input: SignupInput): SignupParse {
  const emailRaw = typeof input.email === 'string' ? input.email.trim() : '';
  if (!emailRaw) return { ok: false, code: 'email_required' };
  if (!isValidEmail(emailRaw)) return { ok: false, code: 'email_invalid' };

  const nameRaw = typeof input.name === 'string' ? input.name.trim() : '';
  if (nameRaw.length > 80) return { ok: false, code: 'name_too_long' };

  const x = normalizeSocialHandle(input.xHandle);
  const facebook = normalizeSocialHandle(input.facebookHandle);
  if (!x.ok || !facebook.ok) return { ok: false, code: 'handle_invalid' };

  const sourceRaw = typeof input.source === 'string' ? input.source.trim().slice(0, 40) : '';
  return {
    ok: true,
    email: emailRaw,
    emailNorm: normalizeEmail(emailRaw),
    ...(nameRaw ? { name: nameRaw } : {}),
    source: sourceRaw || 'listen',
    ...(x.handle ? { xHandle: x.handle } : {}),
    ...(facebook.handle ? { facebookHandle: facebook.handle } : {}),
    shoutoutOk: parseShoutoutOk(input.shoutoutOk),
  };
}

export function signupMessage(code: SignupParse extends { ok: false; code: infer C } ? C : never): string {
  if (code === 'email_required') return 'Need an email for transmissions.';
  if (code === 'name_too_long') return 'Name is too long.';
  if (code === 'handle_invalid') return 'That social handle does not look usable.';
  return 'That email does not look usable.';
}

export const OUTPOST_FLASH_CODES = ['ok', 'offline', 'invalid', 'needed', 'name', 'handle'] as const;
export type OutpostFlash = (typeof OUTPOST_FLASH_CODES)[number];

export function signupFlashForError(
  code: Extract<SignupParse, { ok: false }>['code'],
): OutpostFlash {
  if (code === 'email_required') return 'needed';
  if (code === 'name_too_long') return 'name';
  if (code === 'handle_invalid') return 'handle';
  return 'invalid';
}

/** Status copy for /?outpost=<code> — never put an email in that query. */
export function outpostFlashMessage(code: string | null | undefined): string {
  if (code === 'ok') return 'You are on the list.';
  if (code === 'offline') return 'Outpost is offline. Play still works — try again later.';
  if (code === 'needed') return signupMessage('email_required');
  if (code === 'name') return signupMessage('name_too_long');
  if (code === 'handle') return signupMessage('handle_invalid');
  if (code === 'invalid') return signupMessage('email_invalid');
  return '';
}

export function outpostListenRedirect(flash: OutpostFlash): string {
  return `/?outpost=${flash}`;
}

export function planSignupUpsert(
  existing: SignupRow | undefined,
  parsed: Extract<SignupParse, { ok: true }>,
  now: string,
  ids: { id: string; unsubToken: string },
): { action: 'insert' | 'update'; row: SignupRow } {
  if (!existing) {
    return {
      action: 'insert',
      row: {
        id: ids.id,
        email: parsed.email,
        emailNorm: parsed.emailNorm,
        ...(parsed.name ? { name: parsed.name } : {}),
        source: parsed.source,
        status: 'subscribed',
        consentAt: now,
        createdAt: now,
        updatedAt: now,
        unsubToken: ids.unsubToken,
        ...(parsed.xHandle ? { xHandle: parsed.xHandle } : {}),
        ...(parsed.facebookHandle ? { facebookHandle: parsed.facebookHandle } : {}),
        shoutoutOk: parsed.shoutoutOk,
      },
    };
  }

  const name = parsed.name ?? existing.name;
  return {
    action: 'update',
    row: {
      ...existing,
      email: parsed.email,
      ...(name ? { name } : {}),
      source: parsed.source,
      status: 'subscribed',
      consentAt: now,
      updatedAt: now,
      ...(parsed.xHandle ? { xHandle: parsed.xHandle } : {}),
      ...(parsed.facebookHandle ? { facebookHandle: parsed.facebookHandle } : {}),
      shoutoutOk: parsed.shoutoutOk || existing.shoutoutOk,
    },
  };
}

export function planUnsubscribe(
  existing: SignupRow | undefined,
  now: string,
): { ok: true; already: boolean; row: SignupRow } | { ok: false; code: 'unknown_token' } {
  if (!existing) return { ok: false, code: 'unknown_token' };
  if (existing.status === 'unsubscribed') return { ok: true, already: true, row: existing };
  return {
    ok: true,
    already: false,
    row: { ...existing, status: 'unsubscribed', updatedAt: now },
  };
}

export function newSignupIds(): { id: string; unsubToken: string } {
  return { id: crypto.randomUUID(), unsubToken: crypto.randomUUID() };
}

export function toSignupCsv(rows: SignupRow[]): string {
  const header = 'created_at,updated_at,status,source,email,name,x_handle,facebook_handle,shoutout_ok';
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.updatedAt,
      row.status,
      row.source,
      row.email,
      row.name ?? '',
      row.xHandle ?? '',
      row.facebookHandle ?? '',
      row.shoutoutOk ? '1' : '0',
    ]
      .map(csvField)
      .join(','),
  );
  return `${[header, ...lines].join('\n')}\n`;
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
