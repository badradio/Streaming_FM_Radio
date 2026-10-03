import { describe, expect, it } from 'vitest';
import { catalog, emptyState, getTrack } from '../src/lib/radio/catalog';
import { exportReadyChecklist, toJsonExport, toM3u } from '../src/lib/radio/export';
import { airMatchesTrack, markPlayedFromAir, matchKey } from '../src/lib/radio/match';
import { inspectQueue, readyRequests } from '../src/lib/radio/ready';
import { extraAirHistory } from '../src/lib/radio/reconcile';
import { MIN_REQUEST_DELAY_MS } from '../src/lib/radio/rules';
import type { Request, StationState } from '../src/lib/radio/types';

const now = new Date('2026-09-02T16:00:00.000Z');

function requestFor(
  trackId: string,
  options: { hoursAgo?: number; minutesUntilReady?: number; status?: Request['status']; id?: string } = {},
): Request {
  const requested =
    options.minutesUntilReady !== undefined
      ? new Date(now.getTime() - MIN_REQUEST_DELAY_MS + options.minutesUntilReady * 60_000)
      : new Date(now.getTime() - (options.hoursAgo ?? 2) * 60 * 60 * 1000);
  return {
    id: options.id ?? `req-${trackId}`,
    trackId,
    requesterLabel: 'kim',
    requestedAt: requested.toISOString(),
    earliestPlayAt: new Date(requested.getTime() + MIN_REQUEST_DELAY_MS).toISOString(),
    status: options.status ?? 'queued',
  };
}

function withRequests(requests: Request[], plays: StationState['plays'] = []): StationState {
  return { ...emptyState(), requests, plays };
}

describe('Live365 artist/title match', () => {
  const slits = getTrack('slits-typical')!;

  it('matches folded artist/title including curly apostrophes', () => {
    expect(airMatchesTrack({ artist: 'The Slits', title: 'Typical Girls' }, slits)).toBe(true);
    expect(airMatchesTrack({ artist: 'the slits', title: 'TYPICAL GIRLS' }, slits)).toBe(true);
    expect(matchKey("Howlin’ Wolf", 'Smokestack Lightnin’')).toBe(matchKey("Howlin' Wolf", 'Smokestack Lightnin\''));
  });

  it('matches Live365 titles that append a parenthetical version suffix', () => {
    expect(airMatchesTrack({ artist: 'The Slits', title: 'Typical Girls (Single Version)' }, slits)).toBe(true);
  });

  it('does not match a different title', () => {
    expect(airMatchesTrack({ artist: 'The Slits', title: 'Spent' }, slits)).toBe(false);
  });
});

describe('auto-mark played from Live365 air', () => {
  it('marks a queued request when current-track matches and appends desk history', () => {
    const slits = getTrack('slits-typical')!;
    const state = withRequests([requestFor('slits-typical')]);
    const result = markPlayedFromAir({
      state,
      air: [{ artist: 'The Slits', title: 'Typical Girls (Radio Edit)' }],
      now,
    });
    expect(result.marked).toBe(1);
    expect(result.state.requests[0]?.status).toBe('played');
    expect(result.state.plays).toHaveLength(1);
    expect(result.state.plays[0]?.trackId).toBe(slits.id);
    expect(result.state.plays[0]?.source).toBe('request');
  });

  it('is idempotent when the same air is seen again', () => {
    const state = withRequests([requestFor('slits-typical')]);
    const air = [{ artist: 'The Slits', title: 'Typical Girls' }];
    const first = markPlayedFromAir({ state, air, now });
    const second = markPlayedFromAir({ state: first.state, air, now });
    expect(first.marked).toBe(1);
    expect(second.marked).toBe(0);
    expect(second.state.plays).toHaveLength(1);
  });

  it('marks last-played and current-track against different queued requests', () => {
    const state = withRequests([
      requestFor('slits-typical', { id: 'r-slits' }),
      requestFor('can-tm-paperhouse', { id: 'r-can' }),
    ]);
    const result = markPlayedFromAir({
      state,
      air: [
        { artist: 'Can', title: 'Paperhouse' },
        { artist: 'The Slits', title: 'Typical Girls' },
      ],
      now,
    });
    expect(result.marked).toBe(2);
    expect(result.state.requests.every((item) => item.status === 'played')).toBe(true);
    expect(result.state.plays.map((play) => play.trackId).sort()).toEqual(['can-tm-paperhouse', 'slits-typical']);
  });

  it('does not mark a rejected request or an unrequested catalog track', () => {
    const state = withRequests([requestFor('slits-typical', { status: 'rejected' })]);
    const result = markPlayedFromAir({
      state,
      air: [{ artist: 'The Slits', title: 'Typical Girls' }],
      now,
    });
    expect(result.marked).toBe(0);
    expect(result.state.plays).toHaveLength(0);
  });
});

describe('ready-to-air delay and SRPC', () => {
  it('blocks a request still inside the one-hour delay', () => {
    const state = withRequests([requestFor('slits-typical', { minutesUntilReady: 17, id: 'soon' })]);
    const [item] = inspectQueue({ state, now });
    expect(item?.ready).toBe(false);
    expect(item?.blocked?.code).toBe('too_soon');
    expect(item?.blocked?.message).toMatch(/17 min left/i);
  });

  it('lists a request as ready once earliest_play_at has passed and SRPC is clean', () => {
    const state = withRequests([requestFor('slits-typical')]);
    const ready = readyRequests(inspectQueue({ state, now }));
    expect(ready).toHaveLength(1);
    expect(ready[0]?.track.id).toBe('slits-typical');
  });

  it('blocks a ready-delay request that would break album cap against recent air', () => {
    const jis = catalog.filter((track) => track.album === 'Journey in Satchidananda');
    expect(jis.length).toBeGreaterThanOrEqual(4);
    const slits = getTrack('slits-typical')!;
    const can = getTrack('can-tm-paperhouse')!;
    const state = withRequests([requestFor(jis[3]!.id, { id: 'fourth' })], [
      { id: 'p1', trackId: jis[0]!.id, playedAt: new Date(now.getTime() - 50 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p2', trackId: slits.id, playedAt: new Date(now.getTime() - 40 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p3', trackId: jis[1]!.id, playedAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p4', trackId: can.id, playedAt: new Date(now.getTime() - 20 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p5', trackId: jis[2]!.id, playedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(), source: 'set' },
    ]);
    const [item] = inspectQueue({ state, now });
    expect(item?.ready).toBe(false);
    expect(item?.blocked?.code).toBe('album_cap');
    expect(item?.blocked?.message).toMatch(/album cap/i);
  });

  it('blocks consecutive same-album requests in the ready sequence', () => {
    const jis = catalog.filter((track) => track.album === 'Journey in Satchidananda');
    const state = withRequests([
      requestFor(jis[0]!.id, { id: 'j1' }),
      requestFor(jis[1]!.id, { id: 'j2' }),
      requestFor(jis[2]!.id, { id: 'j3' }),
    ]);
    const inspections = inspectQueue({ state, now });
    expect(inspections[0]?.ready).toBe(true);
    expect(inspections[1]?.ready).toBe(true);
    expect(inspections[2]?.ready).toBe(false);
    expect(inspections[2]?.blocked?.code).toBe('album_consecutive');
  });

  it('uses unmatched Live365 air as extra SRPC history', () => {
    const jis = catalog.filter((track) => track.album === 'Journey in Satchidananda');
    const state = withRequests([requestFor(jis[2]!.id)]);
    const extra = extraAirHistory(
      state,
      [
        { artist: jis[0]!.artist, title: jis[0]!.title },
        { artist: jis[1]!.artist, title: jis[1]!.title },
      ],
      now,
    );
    const [item] = inspectQueue({ state, now, extraHistory: extra });
    expect(item?.ready).toBe(false);
    expect(item?.blocked?.code).toBe('album_consecutive');
  });
});

describe('operator export checklist', () => {
  it('exports ready-to-air as order only, with no play clocks', () => {
    const state = withRequests([requestFor('slits-typical'), requestFor('can-tm-paperhouse')]);
    const tracks = exportReadyChecklist({ state, now, includeDaySet: false });
    expect(tracks.map((track) => track.title)).toEqual(['Typical Girls', 'Paperhouse']);
    expect(tracks.every((track) => track.source === 'request')).toBe(true);

    const json = JSON.parse(toJsonExport(state.playlist, tracks, 'ready')) as {
      note: string;
      tracks: Array<Record<string, unknown>>;
    };
    expect(json.note).toMatch(/Live365 cannot import M3U/i);
    for (const track of json.tracks) {
      expect(track).not.toHaveProperty('playedAt');
      expect(track).not.toHaveProperty('airAt');
      expect(track).not.toHaveProperty('scheduledAt');
      expect(track).not.toHaveProperty('earliestPlayAt');
    }

    const m3u = toM3u(tracks);
    expect(m3u).toMatch(/Live365 cannot import M3U/);
    expect(m3u).not.toMatch(/2026-09-02T/);
    expect(m3u).toContain('The Slits - Typical Girls');
  });

  it('can append remaining day-set tracks after ready requests', () => {
    const state = withRequests([requestFor('slits-typical')]);
    const readyOnly = exportReadyChecklist({ state, now, includeDaySet: false });
    const withDay = exportReadyChecklist({ state, now, includeDaySet: true });
    expect(withDay.length).toBeGreaterThan(readyOnly.length);
    expect(withDay[0]?.title).toBe('Typical Girls');
    expect(withDay.some((track) => track.source === 'set')).toBe(true);
  });
});
