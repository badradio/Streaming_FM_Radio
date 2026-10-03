import { describe, expect, it } from 'vitest';
import { live365StationId, stationIdFromStreamUrl } from '../src/lib/live365/station-id';
import { normalizeLive365Station } from '../src/lib/live365/normalize';

describe('Live365 station id', () => {
  it('derives the mount from https://streaming.live365.com/<id>', () => {
    expect(stationIdFromStreamUrl('https://streaming.live365.com/a58480')).toBe('a58480');
    expect(stationIdFromStreamUrl('https://streaming.live365.com/a58480/playlist.m3u8')).toBe('a58480');
  });

  it('strips a _live suffix used on some Live365 mounts', () => {
    expect(stationIdFromStreamUrl('https://streaming.live365.com/a58480_live')).toBe('a58480');
    expect(stationIdFromStreamUrl('/a58480_live')).toBe('a58480');
  });

  it('ignores a non-Live365 origin', () => {
    expect(stationIdFromStreamUrl('https://ice1.somafm.com/groovesalad-128-mp3')).toBeUndefined();
  });

  it('lets LIVE365_STATION_ID override the stream URL', () => {
    expect(
      live365StationId({
        streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3',
        override: 'a58480',
      }),
    ).toBe('a58480');
  });
});

describe('Live365 payload normalize', () => {
  it('maps current-track and last-played without inventing fields', () => {
    const result = normalizeLive365Station({
      name: 'badradio rocks',
      is_playing: true,
      'current-track': {
        artist: 'Bessie Smith',
        title: 'Backwater Blues (78rpm Version)',
        art: 'https://example.com/art.jpg',
        status: 'playing',
        start: '2026-09-02T15:44:00.000Z',
      },
      'last-played': [
        { artist: 'Bessie Smith', title: 'Backwater Blues (78rpm Version)' },
        { artist: 'Bo Diddley', title: 'Little Girl Blue' },
        { artist: '', title: '' },
        { artist: 'Howlin’ Wolf', title: 'Smokestack Lightnin’' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.now).toEqual({
      artist: 'Bessie Smith',
      title: 'Backwater Blues (78rpm Version)',
      art: 'https://example.com/art.jpg',
      startedAt: '2026-09-02T15:44:00.000Z',
    });
    expect(result.recent.map((track) => `${track.artist} — ${track.title}`)).toEqual([
      'Bo Diddley — Little Girl Blue',
      'Howlin’ Wolf — Smokestack Lightnin’',
    ]);
    expect(result.isPlaying).toBe(true);
    expect(result.stationName).toBe('badradio rocks');
  });

  it('refuses junk payloads instead of inventing a track', () => {
    expect(normalizeLive365Station(null)).toEqual({
      ok: false,
      reason: 'unavailable',
      now: null,
      recent: [],
    });
    const empty = normalizeLive365Station({ 'current-track': {}, 'last-played': [] });
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.now).toBeNull();
      expect(empty.recent).toEqual([]);
    }
  });
});
