/** Live365 public mounts. Ticket 184530 — redirect only, never proxy audio bytes. */
export const LIVE365_MP3 = 'https://streaming.live365.com/a58480';
export const LIVE365_AAC = 'https://streaming.live365.com/a58480_2';

const HOSTS: Record<string, string> = {
  'stream.badradio.rocks': LIVE365_MP3,
  'stream-aac.badradio.rocks': LIVE365_AAC,
};

/** Return a Live365 Location for short stream hostnames. Undefined for apex/www. */
export function streamRedirectLocation(hostname: string): string | undefined {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '').split(':')[0] ?? '';
  return HOSTS[host];
}

/** 302 Location only. Do not fetch() the Live365 body. */
export function streamRedirectResponse(hostname: string): Response | undefined {
  const location = streamRedirectLocation(hostname);
  if (!location) return undefined;
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'public, max-age=60',
    },
  });
}

/** Prefer Host (custom domain) over the URL hostname (wrangler local is 127.0.0.1). */
export function streamRedirectForRequest(request: Request): Response | undefined {
  const hostHeader = request.headers.get('host');
  const hostname = hostHeader && hostHeader.trim() ? hostHeader : new URL(request.url).hostname;
  return streamRedirectResponse(hostname);
}
