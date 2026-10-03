import { describe, expect, it } from 'vitest';
import { checkDelay, checkPlay, earliestPlayAt, MIN_REQUEST_DELAY_MS } from '../src/lib/radio/rules';
import { pickNext, queueRequest } from '../src/lib/radio/autodj';
import { emptyState } from '../src/lib/radio/catalog';
import { resolveTrack } from '../src/lib/radio/search';
import { catalog } from '../src/lib/radio/catalog';
import type { Track } from '../src/lib/radio/types';

const now = new Date('2026-09-02T15:00:00.000Z');

const sample: Track = {
  id: 'x',
  title: 'Typical Girls',
  artist: 'The Slits',
  album: 'Cut',
  year: 1979,
  durationSec: 235,
};

describe('1-hour request delay', () => {
  it('sets earliest_play_at to request time plus at least one hour', () => {
    const earliest = earliestPlayAt(now);
    expect(earliest.getTime() - now.getTime()).toBe(MIN_REQUEST_DELAY_MS);
  });

  it('refuses a proposed play inside the hour (too soon)', () => {
    const result = checkDelay(now, new Date(now.getTime() + 59 * 60 * 1000));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_soon');
      expect(result.message).toMatch(/too soon/i);
    }
  });

  it('allows a play at exactly one hour', () => {
    expect(checkDelay(now, earliestPlayAt(now)).ok).toBe(true);
  });

  it('checkPlay applies delay before SRPC when a request is present', () => {
    const result = checkPlay({
      track: sample,
      proposedAt: new Date(now.getTime() + 30 * 60 * 1000),
      history: [],
      request: { requestedAt: now },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too_soon');
  });

  it('queue insert stores queued status and does not air immediately', () => {
    const queued = queueRequest({
      state: emptyState(),
      trackId: 'slits-typical',
      requesterLabel: 'kim',
      now,
      tracks: catalog,
      resolveTrack,
    });
    expect(queued.request.status).toBe('queued');
    expect(new Date(queued.request.earliestPlayAt).getTime()).toBe(now.getTime() + MIN_REQUEST_DELAY_MS);
    expect('rejected' in queued).toBe(false);

    const immediate = pickNext({ state: queued.state, now });
    expect('play' in immediate && immediate.play.trackId === 'slits-typical').toBe(false);
  });

  it('AutoDJ will not pick a request before earliest_play_at', () => {
    const queued = queueRequest({
      state: emptyState(),
      trackId: 'slits-typical',
      requesterLabel: 'kim',
      now,
      tracks: catalog,
      resolveTrack,
    });
    const tooEarly = pickNext({ state: queued.state, now: new Date(now.getTime() + 30 * 60 * 1000) });
    if ('play' in tooEarly) {
      expect(tooEarly.play.source).not.toBe('request');
      expect(tooEarly.play.trackId).not.toBe('slits-typical');
    }

    const ready = pickNext({ state: queued.state, now: earliestPlayAt(now) });
    expect('play' in ready).toBe(true);
    if ('play' in ready) {
      expect(ready.play.trackId).toBe('slits-typical');
      expect(ready.play.source).toBe('request');
    }
  });

  it('rejects an unknown paste', () => {
    const result = queueRequest({
      state: emptyState(),
      trackQuery: 'not a real artist - fake title',
      requesterLabel: 'kim',
      now,
      tracks: catalog,
      resolveTrack,
    });
    expect(result.request.status).toBe('rejected');
    expect(result.request.rejectReason).toMatch(/unknown_track/);
  });
});
