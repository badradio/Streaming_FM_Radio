import { describe, expect, it } from 'vitest';
import { corsPreflight, embedOriginFromHeader, frameAncestorsCsp, withCors, withWidgetFraming } from '../src/lib/embed-origins';
import { isJunkAirTrack, isPlaceholderArtUrl, stripPlaceholderArt } from '../src/lib/live365/junk';
import { normalizeLive365Station } from '../src/lib/live365/normalize';
import { relativeTime } from '../src/lib/relative-time';
import { hydrateWidgetRecent, mergeWidgetRecent } from '../src/lib/widget-recent';

describe('junk air tracks', () => {
  it('drops Live365 new-stop cues like j02', () => {
    expect(isJunkAirTrack({ artist: 'j02', title: 'new-stop' })).toBe(true);
    expect(isJunkAirTrack({ artist: 'J02', title: 'New-Stop' })).toBe(true);
    expect(isJunkAirTrack({ artist: 'id', title: '07-panther' })).toBe(true);
  });

  it('keeps real songs even when Live365 sent blankart', () => {
    expect(isJunkAirTrack({ artist: 'Triumph', title: 'Emply Inside' })).toBe(false);
    expect(isPlaceholderArtUrl('https://broadcaster.live365.com/static/assets/img/blankart.jpg')).toBe(true);
    expect(stripPlaceholderArt({ artist: 'Triumph', title: 'Emply Inside', art: 'https://broadcaster.live365.com/static/assets/img/blankart.jpg' }).art).toBeUndefined();
  });

  it('does not drop a real song titled Stop by a real artist', () => {
    expect(isJunkAirTrack({ artist: 'Jane’s Addiction', title: 'Stop' })).toBe(false);
    expect(isJunkAirTrack({ artist: 'The Breaks', title: 'Bad Breaks' })).toBe(false);
    expect(isJunkAirTrack({ artist: 'Live365', title: 'Ad Break' })).toBe(true);
  });
});

describe('Live365 normalize + junk', () => {
  it('strips new-stop from last-played and drops blankart', () => {
    const result = normalizeLive365Station({
      name: 'badradio rocks',
      is_playing: true,
      'current-track': {
        artist: 'Led Zeppelin',
        title: 'Trampled Under Foot',
        art: 'https://example.com/art.jpg',
        start: '2026-09-30T20:04:35.000Z',
      },
      'last-played': [
        { artist: 'Electric Light Orchestra', title: 'Need Her Love', start: '2026-09-30T19:59:26.000Z' },
        { artist: 'j02', title: 'new-stop', art: 'https://broadcaster.live365.com/static/assets/img/blankart.jpg' },
        { artist: 'Triumph', title: 'Emply Inside', art: 'https://broadcaster.live365.com/static/assets/img/blankart.jpg' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recent.map((track) => `${track.artist} — ${track.title}`)).toEqual([
      'Electric Light Orchestra — Need Her Love',
      'Triumph — Emply Inside',
    ]);
    expect(result.recent[1]?.art).toBeUndefined();
  });

  it('keeps up to 10 last-played rows when Live365 sends them', () => {
    const last = Array.from({ length: 12 }, (_, i) => ({ artist: `Artist ${i}`, title: `Song ${i}` }));
    const result = normalizeLive365Station({
      is_playing: true,
      'current-track': { artist: 'Now', title: 'Playing' },
      'last-played': last,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recent).toHaveLength(10);
    expect(result.recent[0]?.title).toBe('Song 0');
  });
});

describe('widget rolling recent', () => {
  it('fills to 10 from KV after Live365 last-played (5) scrolls off', () => {
    const now = { artist: 'Now', title: 'Current', startedAt: '2026-09-30T20:00:00.000Z' };
    const live365Recent = Array.from({ length: 5 }, (_, i) => ({
      artist: `Live ${i}`,
      title: `Hit ${i}`,
      startedAt: `2026-09-30T19:${50 - i}:00.000Z`,
    }));
    const stored = [
      now,
      ...live365Recent,
      ...Array.from({ length: 8 }, (_, i) => ({
        artist: `Older ${i}`,
        title: `Cut ${i}`,
        startedAt: `2026-09-30T18:${10 + i}:00.000Z`,
      })),
    ];
    const merged = mergeWidgetRecent({ now, live365Recent, stored, cap: 10 });
    expect(merged.recent).toHaveLength(10);
    expect(merged.recent.map((track) => track.title)).toEqual([
      'Hit 0',
      'Hit 1',
      'Hit 2',
      'Hit 3',
      'Hit 4',
      'Cut 0',
      'Cut 1',
      'Cut 2',
      'Cut 3',
      'Cut 4',
    ]);
    expect(merged.recent.some((track) => track.title === 'Current')).toBe(false);
    expect(merged.nextStored[0]?.title).toBe('Current');
  });

  it('filters stored junk if an older poll wrote it', () => {
    const merged = mergeWidgetRecent({
      now: { artist: 'Now', title: 'Song' },
      live365Recent: [],
      stored: [{ artist: 'j02', title: 'new-stop' }, { artist: 'Bessie Smith', title: 'Backwater Blues' }],
    });
    expect(merged.recent.map((track) => track.title)).toEqual(['Backwater Blues']);
  });

  it('hydrates stored JSON without inventing tracks', () => {
    expect(hydrateWidgetRecent(null)).toEqual([]);
    expect(hydrateWidgetRecent([{ artist: 'A', title: 'B', art: 'https://x.test/a.jpg' }])).toEqual([
      { artist: 'A', title: 'B', art: 'https://x.test/a.jpg' },
    ]);
  });
});

describe('embed origins', () => {
  it('allows badradio.com, www, and rocks only', () => {
    expect(embedOriginFromHeader('https://badradio.com')).toBe('https://badradio.com');
    expect(embedOriginFromHeader('https://www.badradio.com')).toBe('https://www.badradio.com');
    expect(embedOriginFromHeader('https://badradio.rocks')).toBe('https://badradio.rocks');
    expect(embedOriginFromHeader('https://evil.example')).toBeUndefined();
    expect(frameAncestorsCsp()).toContain("frame-ancestors 'self'");
    expect(frameAncestorsCsp()).toContain('https://badradio.com');
    expect(frameAncestorsCsp()).not.toContain('https://evil.example');
  });

  it('answers CORS preflight only for allowlisted Origins', () => {
    const ok = corsPreflight(new Request('https://badradio.rocks/api/now-playing', {
      method: 'OPTIONS',
      headers: { Origin: 'https://badradio.com' },
    }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://badradio.com');
    expect(ok.headers.get('Access-Control-Allow-Methods')).toMatch(/GET/);

    const denied = corsPreflight(new Request('https://badradio.rocks/api/now-playing', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS on GET and strips X-Frame-Options on the widget', () => {
    const json = withCors(
      new Request('https://badradio.rocks/api/now-playing', { headers: { Origin: 'https://www.badradio.com' } }),
      Response.json({ ok: true }),
    );
    expect(json.headers.get('Access-Control-Allow-Origin')).toBe('https://www.badradio.com');
    expect(json.headers.get('Vary')).toMatch(/Origin/);

    const framed = withWidgetFraming(
      new Response('<html></html>', { headers: { 'X-Frame-Options': 'DENY' } }),
    );
    expect(framed.headers.get('X-Frame-Options')).toBeNull();
    expect(framed.headers.get('Content-Security-Policy')).toBe(frameAncestorsCsp());
  });
});

describe('relative time', () => {
  const now = Date.parse('2026-09-30T20:00:00.000Z');
  it('formats minutes and hours', () => {
    expect(relativeTime('2026-09-30T19:58:00.000Z', now)).toBe('2m ago');
    expect(relativeTime('2026-09-30T18:00:00.000Z', now)).toBe('2h ago');
    expect(relativeTime('2026-09-30T19:59:40.000Z', now)).toBe('just now');
  });
});
