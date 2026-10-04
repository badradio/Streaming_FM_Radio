/* badradio PWA — app shell only. Never the Live365 stream or /api/*.
   Page navigations are network-first so hashed /_astro CSS/JS cannot go stale. */
const CACHE = 'badradio-shell-v2';
const SHELL = [
  '/',
  '/widget',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/embed.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
];

function normalizePagePath(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function isNavigation(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isPagePath(pathname) {
  const path = normalizePagePath(pathname);
  return path === '/' || path === '/widget';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            const response = await fetch(path, { cache: 'reload' });
            if (response.ok) await cache.put(path, response);
          } catch {
            /* shell pieces are best-effort */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (normalizePagePath(url.pathname) === '/sw.js') return;
  if (url.pathname.startsWith('/_astro/')) return;

  if (isNavigation(event.request) || isPagePath(url.pathname)) {
    event.respondWith(networkFirstPage(event.request, normalizePagePath(url.pathname)));
    return;
  }

  const key = normalizePagePath(url.pathname);
  if (!SHELL.includes(url.pathname) && !SHELL.includes(key)) return;

  event.respondWith(cacheFirstShell(event.request, key));
});

async function networkFirstPage(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(cacheKey)) || (await cache.match(request));
    if (cached) return cached;
    throw new TypeError('Failed to fetch');
  }
}

async function cacheFirstShell(request, cacheKey) {
  const cache = await caches.open(CACHE);
  const cached = (await cache.match(cacheKey)) || (await cache.match(request));
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(cacheKey, response.clone());
  return response;
}
