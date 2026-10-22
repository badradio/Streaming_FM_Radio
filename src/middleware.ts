import { defineMiddleware } from 'astro:middleware';
import {
  applyHeaders,
  corsHeadersForRequest,
  corsPreflight,
  isFeedbackWritePath,
  isManifestPath,
  isNowPlayingPath,
  isWidgetPath,
  withCors,
  withWidgetFraming,
} from './lib/embed-origins';
import { streamRedirectForRequest } from './lib/stream-redirect';

export const onRequest = defineMiddleware(async ({ request }, next) => {
  const redirect = streamRedirectForRequest(request);
  if (redirect) return redirect;

  const pathname = new URL(request.url).pathname;
  if (request.method === 'OPTIONS' && isNowPlayingPath(pathname)) {
    return corsPreflight(request);
  }
  if (request.method === 'OPTIONS' && isFeedbackWritePath(pathname)) {
    return corsPreflight(request, 'GET, POST, OPTIONS');
  }

  const response = await next();

  if (pathname === '/sw.js' || pathname === '/sw.js/') {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (isNowPlayingPath(pathname)) return withCors(request, response);
  if (isFeedbackWritePath(pathname)) {
    const cors = corsHeadersForRequest(request, 'GET, POST, OPTIONS');
    return cors ? applyHeaders(response, cors) : response;
  }
  if (isWidgetPath(pathname)) return withWidgetFraming(response);
  if (isManifestPath(pathname)) {
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/manifest+json; charset=utf-8');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
});
