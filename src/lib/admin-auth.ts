const COOKIE = 'br_desk';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function getAdminPassword(): Promise<string> {
  const { workerEnv } = await import('./runtime');
  const env = await workerEnv();
  if (env?.ADMIN_PASSWORD?.trim()) return env.ADMIN_PASSWORD.trim();
  // Bracket access so Vite does not inline a local .env value into the Worker bundle.
  const fromNode = globalThis.process?.env?.['ADMIN_PASSWORD'];
  return (fromNode ?? '').trim();
}

export async function passwordsMatch(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) {
    await crypto.subtle.digest('SHA-256', a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function makeSessionToken(secret: string): Promise<string> {
  const exp = Date.now() + MAX_AGE_MS;
  const payload = `ok.${exp}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function isValidSession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot < 0) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const [flag, expRaw] = payload.split('.');
  if (flag !== 'ok') return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = await hmacHex(secret, payload);
  return timingSafeEqual(encodeUtf8(sig), encodeUtf8(expected));
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return undefined;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const subtle = crypto.subtle as unknown as {
    timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(a as BufferSource, b as BufferSource);
  }
  let out = 0;
  for (let i = 0; i < a.byteLength; i++) out |= a[i]! ^ b[i]!;
  return out === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
