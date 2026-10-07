import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SHELL_CACHE_NAME,
  isHashedAstroPath,
  isPagePath,
  isServiceWorkerPath,
  normalizePagePath,
  planServiceWorkerFetch,
} from '../src/lib/sw-policy';

const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('service worker policy', () => {
  const origin = 'https://badradio.rocks';

  it('uses the v3 cache name and matches public/sw.js', () => {
    expect(SHELL_CACHE_NAME).toBe('badradio-shell-v3');
    expect(swSource).toContain(`const CACHE = '${SHELL_CACHE_NAME}'`);
    expect(swSource).not.toContain('badradio-shell-v1');
    expect(swSource).not.toContain('badradio-shell-v2');
    expect(swSource).toContain('skipWaiting');
    expect(swSource).toContain('clients.claim');
    expect(swSource).toMatch(/keys\.filter\(\(key\) => key !== CACHE\)/);
  });

  it('treats home and widget navigations as network-first, not cache-first', () => {
    expect(
      planServiceWorkerFetch({ method: 'GET', url: `${origin}/`, mode: 'navigate' }, origin),
    ).toEqual({ action: 'network-first-page', cacheKey: '/' });
    expect(
      planServiceWorkerFetch(
        { method: 'GET', url: `${origin}/widget`, mode: 'navigate', destination: 'document' },
        origin,
      ),
    ).toEqual({ action: 'network-first-page', cacheKey: '/widget' });
    expect(
      planServiceWorkerFetch({ method: 'GET', url: `${origin}/?outpost=ok`, mode: 'navigate' }, origin),
    ).toEqual({ action: 'network-first-page', cacheKey: '/' });
    expect(swSource).toContain('networkFirstPage');
    expect(swSource).not.toMatch(/if \(cached\) return cached;\s*const response = await fetch\(event\.request\)/);
  });

  it('lets hashed Astro assets and sw.js go to the network', () => {
    expect(isHashedAstroPath('/_astro/SiteFooter.BIW2GJQa.css')).toBe(true);
    expect(isHashedAstroPath('/icons/icon-192.png')).toBe(false);
    expect(isServiceWorkerPath('/sw.js')).toBe(true);
    expect(
      planServiceWorkerFetch(
        { method: 'GET', url: `${origin}/_astro/SiteFooter.BIW2GJQa.css`, destination: 'style' },
        origin,
      ),
    ).toEqual({ action: 'network' });
    expect(planServiceWorkerFetch({ method: 'GET', url: `${origin}/sw.js` }, origin)).toEqual({
      action: 'network',
    });
    expect(swSource).toContain("url.pathname.startsWith('/_astro/')");
    expect(swSource).toContain("/sw.js'");
  });

  it('does not intercept APIs, streams, or other origins', () => {
    expect(planServiceWorkerFetch({ method: 'GET', url: `${origin}/api/now-playing` }, origin)).toEqual({
      action: 'bypass',
    });
    expect(planServiceWorkerFetch({ method: 'POST', url: `${origin}/` }, origin)).toEqual({ action: 'bypass' });
    expect(
      planServiceWorkerFetch({ method: 'GET', url: 'https://streaming.live365.com/a58480' }, origin),
    ).toEqual({ action: 'bypass' });
  });

  it('keeps icons and manifest on the static shell cache', () => {
    expect(isPagePath('/widget/')).toBe(true);
    expect(normalizePagePath('/widget/')).toBe('/widget');
    expect(
      planServiceWorkerFetch({ method: 'GET', url: `${origin}/manifest.webmanifest` }, origin),
    ).toEqual({ action: 'cache-shell', cacheKey: '/manifest.webmanifest' });
    expect(planServiceWorkerFetch({ method: 'GET', url: `${origin}/embed.js` }, origin)).toEqual({
      action: 'cache-shell',
      cacheKey: '/embed.js',
    });
  });
});
