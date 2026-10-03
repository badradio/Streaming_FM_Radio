/** Origins allowed to frame `/widget` and to call `/api/now-playing` from a script. */

export const EMBED_ORIGINS = [
  'https://badradio.com',
  'https://www.badradio.com',
  'https://badradio.rocks',
  'https://www.badradio.rocks',
] as const;

export type EmbedOrigin = (typeof EMBED_ORIGINS)[number];

export function embedOriginFromHeader(origin: string | null | undefined): EmbedOrigin | undefined {
  if (!origin) return undefined;
  const trimmed = origin.trim();
  return (EMBED_ORIGINS as readonly string[]).includes(trimmed) ? (trimmed as EmbedOrigin) : undefined;
}

export function frameAncestorsCsp(): string {
  return `frame-ancestors 'self' ${EMBED_ORIGINS.join(' ')}`;
}

export function isNowPlayingPath(pathname: string): boolean {
  return pathname === '/api/now-playing' || pathname === '/api/now-playing/';
}

export function isWidgetPath(pathname: string): boolean {
  return pathname === '/widget' || pathname === '/widget/';
}

export function isManifestPath(pathname: string): boolean {
  return pathname === '/manifest.webmanifest' || pathname === '/manifest.webmanifest/';
}

export function corsHeadersForOrigin(origin: EmbedOrigin): Headers {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Origin');
  return headers;
}

export function corsHeadersForRequest(request: Request): Headers | undefined {
  const origin = embedOriginFromHeader(request.headers.get('Origin'));
  if (!origin) return undefined;
  return corsHeadersForOrigin(origin);
}

export function applyHeaders(response: Response, extra: Headers): Response {
  const headers = new Headers(response.headers);
  extra.forEach((value, key) => {
    if (key.toLowerCase() === 'vary') {
      headers.set('Vary', mergeVary(headers.get('Vary'), value));
      return;
    }
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function mergeVary(existing: string | null, add: string): string {
  const parts = new Set(
    `${existing ?? ''},${add}`
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return [...parts].join(', ');
}

export function withCors(request: Request, response: Response): Response {
  const cors = corsHeadersForRequest(request);
  if (!cors) return response;
  return applyHeaders(response, cors);
}

export function withWidgetFraming(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', frameAncestorsCsp());
  headers.delete('X-Frame-Options');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflight(request: Request): Response {
  const cors = corsHeadersForRequest(request);
  if (!cors) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors });
}
