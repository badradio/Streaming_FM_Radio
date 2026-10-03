import { describe, expect, it } from 'vitest';
import {
  LIVE365_AAC,
  LIVE365_MP3,
  streamRedirectForRequest,
  streamRedirectLocation,
  streamRedirectResponse,
} from '../src/lib/stream-redirect';

describe('short stream URL redirects', () => {
  it('sends MP3 and AAC hosts to the Live365 mounts', () => {
    expect(streamRedirectLocation('stream.badradio.rocks:443')).toBe(LIVE365_MP3);
    expect(streamRedirectLocation('stream.badradio.rocks')).toBe(LIVE365_MP3);
    expect(streamRedirectLocation('STREAM.BADRADIO.ROCKS')).toBe(LIVE365_MP3);
    expect(streamRedirectLocation('stream-aac.badradio.rocks')).toBe(LIVE365_AAC);
    expect(LIVE365_MP3).toBe('https://streaming.live365.com/a58480');
    expect(LIVE365_AAC).toBe('https://streaming.live365.com/a58480_2');
  });

  it('does not redirect the listen app hosts', () => {
    expect(streamRedirectLocation('badradio.rocks')).toBeUndefined();
    expect(streamRedirectLocation('www.badradio.rocks')).toBeUndefined();
    expect(streamRedirectLocation('badradio.mweiss.workers.dev')).toBeUndefined();
    expect(streamRedirectLocation('badradio.com')).toBeUndefined();
  });

  it('returns 302 Location only — no body, no Live365 fetch', () => {
    const response = streamRedirectResponse('stream.badradio.rocks');
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe(LIVE365_MP3);
    expect(response?.body).toBeNull();
  });

  it('uses the Host header when the request URL is local', () => {
    const request = new Request('http://127.0.0.1:43777/', {
      headers: { Host: 'stream.badradio.rocks' },
    });
    expect(streamRedirectForRequest(request)?.headers.get('Location')).toBe(LIVE365_MP3);
  });
});
