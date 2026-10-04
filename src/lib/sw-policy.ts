/** Must match `public/sw.js`. Bump both when the shell cache strategy changes. */
export const SHELL_CACHE_NAME = 'badradio-shell-v2';

export const SHELL_PATHS = [
  '/',
  '/widget',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/embed.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
] as const;

export type SwFetchPlan =
  | { action: 'bypass' }
  | { action: 'network' }
  | { action: 'network-first-page'; cacheKey: string }
  | { action: 'cache-shell'; cacheKey: string };

export function normalizePagePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function isHashedAstroPath(pathname: string): boolean {
  return pathname.startsWith('/_astro/');
}

export function isServiceWorkerPath(pathname: string): boolean {
  return normalizePagePath(pathname) === '/sw.js';
}

export function isPagePath(pathname: string): boolean {
  const path = normalizePagePath(pathname);
  return path === '/' || path === '/widget';
}

export function isShellPath(pathname: string): boolean {
  const path = normalizePagePath(pathname);
  return (SHELL_PATHS as readonly string[]).includes(pathname) || (SHELL_PATHS as readonly string[]).includes(path);
}

export function planServiceWorkerFetch(
  request: { method: string; url: string; mode?: string; destination?: string },
  origin: string,
): SwFetchPlan {
  if (request.method !== 'GET') return { action: 'bypass' };
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { action: 'bypass' };
  }
  if (url.origin !== origin) return { action: 'bypass' };
  if (url.pathname.startsWith('/api/')) return { action: 'bypass' };
  if (isServiceWorkerPath(url.pathname)) return { action: 'network' };
  if (isHashedAstroPath(url.pathname)) return { action: 'network' };

  const navigation = request.mode === 'navigate' || request.destination === 'document';
  if (navigation || isPagePath(url.pathname)) {
    return { action: 'network-first-page', cacheKey: normalizePagePath(url.pathname) };
  }
  if (isShellPath(url.pathname)) {
    return { action: 'cache-shell', cacheKey: normalizePagePath(url.pathname) };
  }
  return { action: 'bypass' };
}
