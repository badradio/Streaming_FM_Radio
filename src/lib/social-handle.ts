/** Optional Outpost social handles. Empty is fine. */

export const HANDLE_MAX = 40;

const SITE_PREFIX =
  /^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|facebook\.com|fb\.com|m\.facebook\.com)\//i;

export function normalizeSocialHandle(value: string | undefined | null):
  | { ok: true; handle?: string }
  | { ok: false; code: 'handle_invalid' } {
  if (typeof value !== 'string') return { ok: true };
  let raw = value.trim();
  if (!raw) return { ok: true };
  raw = raw.replace(SITE_PREFIX, '');
  raw = raw.replace(/^@+/, '');
  raw = raw.split(/[/?#]/)[0] ?? '';
  raw = raw.replace(/\/+$/, '').trim();
  if (!raw) return { ok: true };
  if (raw.length > HANDLE_MAX) return { ok: false, code: 'handle_invalid' };
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return { ok: false, code: 'handle_invalid' };
  return { ok: true, handle: raw };
}

export function parseShoutoutOk(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'on') return true;
  return false;
}
