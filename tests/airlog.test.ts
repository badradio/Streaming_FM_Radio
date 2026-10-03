import { describe, expect, it } from 'vitest';
import {
  AIR_COUNT_WINDOW_MS,
  airEntryToTrack,
  listAirLog,
  promoteAirKeys,
  toAirLogCsv,
  toAirLogJson,
  upsertAirLog,
} from '../src/lib/radio/airlog';
import { emptyState } from '../src/lib/radio/catalog';
import { queueRequest } from '../src/lib/radio/autodj';
import { stationTracks } from '../src/lib/radio/catalog';
import { resolveTrack } from '../src/lib/radio/search';
import { matchKey } from '../src/lib/radio/match';

const t0 = new Date('2026-09-08T15:00:00.000Z');

describe('Live365 air log upsert', () => {
  it('inserts current-track and last-played as unique match keys', () => {
    const result = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [
        { artist: 'SOJA', title: 'Your Song', startedAt: '2026-09-08T14:58:00.000Z' },
        { artist: 'Pepper', title: 'Office' },
      ],
    });
    expect(result.changed).toBe(true);
    const rows = listAirLog(result.state);
    expect(rows).toHaveLength(2);
    const soja = result.state.airLog[matchKey('SOJA', 'Your Song')];
    expect(soja?.plays).toBe(1);
    expect(soja?.firstSeenAt).toBe('2026-09-08T14:58:00.000Z');
    expect(soja?.lastSeenAt).toBe('2026-09-08T14:58:00.000Z');
  });

  it('does not double-count the same title in one payload', () => {
    const result = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [
        { artist: 'SOJA', title: 'Your Song', startedAt: '2026-09-08T14:58:00.000Z' },
        { artist: 'SOJA', title: 'Your Song', startedAt: '2026-09-08T14:58:00.000Z' },
      ],
    });
    expect(result.state.airLog[matchKey('SOJA', 'Your Song')]?.plays).toBe(1);
  });

  it('is idempotent when the same start timestamp is polled again', () => {
    const first = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'Pepper', title: 'Office', startedAt: '2026-09-08T14:50:00.000Z' }],
    });
    const second = upsertAirLog({
      state: first.state,
      now: new Date(t0.getTime() + 20_000),
      air: [{ artist: 'Pepper', title: 'Office', startedAt: '2026-09-08T14:50:00.000Z' }],
    });
    expect(second.changed).toBe(false);
    expect(second.state.airLog[matchKey('Pepper', 'Office')]?.plays).toBe(1);
  });

  it('does not increment within the count window when Live365 omits start', () => {
    const first = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'Etta James', title: "I'd Rather Go Blind" }],
    });
    const second = upsertAirLog({
      state: first.state,
      now: new Date(t0.getTime() + 30_000),
      air: [{ artist: 'Etta James', title: "I'd Rather Go Blind" }],
    });
    expect(second.changed).toBe(false);
    expect(Object.values(second.state.airLog)[0]?.plays).toBe(1);
  });

  it('increments after the count window for a later airing', () => {
    const first = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'Pearl Jam', title: 'Infallible', startedAt: t0.toISOString() }],
    });
    const later = new Date(t0.getTime() + AIR_COUNT_WINDOW_MS + 60_000);
    const second = upsertAirLog({
      state: first.state,
      now: later,
      air: [{ artist: 'Pearl Jam', title: 'Infallible', startedAt: later.toISOString() }],
    });
    expect(second.state.airLog[matchKey('Pearl Jam', 'Infallible')]?.plays).toBe(2);
    expect(second.state.airLog[matchKey('Pearl Jam', 'Infallible')]?.lastSeenAt).toBe(later.toISOString());
    expect(second.state.airLog[matchKey('Pearl Jam', 'Infallible')]?.firstSeenAt).toBe(t0.toISOString());
  });

  it('drops the oldest lastSeenAt when over the unique-key cap', () => {
    let state = emptyState();
    const times = [0, 10, 20, 30].map((min) => new Date(t0.getTime() + min * 60_000));
    const titles = ['One', 'Two', 'Three', 'Four'];
    times.forEach((now, i) => {
      const result = upsertAirLog({
        state,
        now,
        maxEntries: 3,
        air: [{ artist: 'Can', title: titles[i]!, startedAt: now.toISOString() }],
      });
      state = result.state;
    });
    const titlesLeft = Object.values(state.airLog).map((entry) => entry.title).sort();
    expect(titlesLeft).toEqual(['Four', 'Three', 'Two']);
  });
});

describe('promote air log into the request catalog', () => {
  it('creates a minimal Track without inventing album or duration', () => {
    const logged = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'Cowboy Junkies', title: "Don't Need You" }],
    });
    const key = matchKey('Cowboy Junkies', "Don't Need You");
    const result = promoteAirKeys(logged.state, [key]);
    expect(result.promoted).toHaveLength(1);
    const track = result.promoted[0]!;
    expect(track.artist).toBe('Cowboy Junkies');
    expect(track.title).toBe("Don't Need You");
    expect(track.album).toBeUndefined();
    expect(track.durationSec).toBeUndefined();
    expect(track.year).toBeUndefined();
    expect(track.id.startsWith('air:')).toBe(true);
    expect(airEntryToTrack(logged.state.airLog[key]!).album).toBeUndefined();
  });

  it('lets the request desk resolve a promoted title instead of unknown_track', () => {
    const logged = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'SOJA', title: 'Your Song' }],
    });
    const key = matchKey('SOJA', 'Your Song');
    const promoted = promoteAirKeys(logged.state, [key]);
    const tracks = stationTracks(promoted.state);
    expect(resolveTrack(tracks, 'SOJA - Your Song')?.title).toBe('Your Song');

    const queued = queueRequest({
      state: promoted.state,
      trackQuery: 'SOJA - Your Song',
      requesterLabel: 'mark',
      now: t0,
      tracks,
      resolveTrack,
    });
    expect(queued.request.status).toBe('queued');
    expect(queued.request.trackId.startsWith('air:')).toBe(true);
  });

  it('does not duplicate a title already in the git catalog', () => {
    const logged = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'The Slits', title: 'Typical Girls' }],
    });
    const key = matchKey('The Slits', 'Typical Girls');
    const result = promoteAirKeys(logged.state, [key]);
    expect(result.promoted).toHaveLength(0);
    expect(result.state.promotedTracks).toHaveLength(0);
    expect(result.state.airLog[key]?.promotedTrackId).toBe('slits-typical');
  });
});

describe('air log export', () => {
  it('exports artist/title/seen/plays without fake albums or play clocks', () => {
    const logged = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'SOJA', title: 'Your Song', startedAt: t0.toISOString() }],
    });
    const entries = listAirLog(logged.state);
    const json = JSON.parse(toAirLogJson(entries)) as {
      note: string;
      cap: number;
      tracks: Array<Record<string, unknown>>;
    };
    expect(json.note).toMatch(/not a full library sync/i);
    expect(json.cap).toBe(4000);
    expect(json.tracks[0]).toEqual({
      artist: 'SOJA',
      title: 'Your Song',
      firstSeenAt: t0.toISOString(),
      lastSeenAt: t0.toISOString(),
      plays: 1,
    });
    expect(json.tracks[0]).not.toHaveProperty('album');
    expect(json.tracks[0]).not.toHaveProperty('durationSec');

    const csv = toAirLogCsv(entries);
    expect(csv.split('\n')[0]).toBe('artist,title,firstSeenAt,lastSeenAt,plays');
    expect(csv).toContain('SOJA,Your Song,');
    expect(csv).not.toMatch(/album/i);
  });

  it('quotes CSV fields that contain commas', () => {
    const logged = upsertAirLog({
      state: emptyState(),
      now: t0,
      air: [{ artist: 'Earth, Wind & Fire', title: "That's the Way of the World" }],
    });
    const csv = toAirLogCsv(listAirLog(logged.state));
    expect(csv).toContain('"Earth, Wind & Fire"');
  });
});
