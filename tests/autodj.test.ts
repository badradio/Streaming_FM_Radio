import { describe, expect, it } from 'vitest';
import { pickNext, queueRequest, savePlaylist } from '../src/lib/radio/autodj';
import { catalog, emptyState } from '../src/lib/radio/catalog';
import { resolveTrack } from '../src/lib/radio/search';
import { MIN_REQUEST_DELAY_MS } from '../src/lib/radio/rules';
import type { Play, StationState, Track } from '../src/lib/radio/types';

const t0 = new Date('2026-09-02T12:00:00.000Z');

function albumTracks(album: string, artist: string): Track[] {
  return catalog.filter((track) => track.album === album && track.artist === artist);
}

function withPlays(state: StationState, plays: Play[]): StationState {
  return { ...state, plays };
}

describe('queue insert and AutoDJ refuse SRPC violations', () => {
  it('starts the day from the set playlist', () => {
    const state = emptyState();
    const first = pickNext({ state, now: t0 });
    expect('play' in first).toBe(true);
    if ('play' in first) {
      expect(first.play.source).toBe('set');
      expect(first.play.trackId).toBe(state.playlist.trackIds[0]);
      expect(first.state.nextSetIndex).toBe(1);
    }
  });

  it('queue insert refuses a 4th album track when the window is already full', () => {
    const jis = albumTracks('Journey in Satchidananda', 'Alice Coltrane');
    expect(jis.length).toBeGreaterThanOrEqual(4);

    const state = withPlays(emptyState(), [
      { id: 'p1', trackId: jis[0]!.id, playedAt: new Date(t0.getTime() - 40 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p2', trackId: jis[1]!.id, playedAt: new Date(t0.getTime() - 25 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p3', trackId: jis[2]!.id, playedAt: new Date(t0.getTime() - 10 * 60 * 1000).toISOString(), source: 'set' },
    ]);

    const result = queueRequest({
      state,
      trackId: jis[3]!.id,
      requesterLabel: 'lee',
      now: t0,
      tracks: catalog,
      resolveTrack,
    });

    expect(result.request.status).toBe('rejected');
    expect(result.request.rejectReason).toMatch(/album cap/i);
  });

  it('AutoDJ skips a set track that would break consecutive album cap', () => {
    const jis = albumTracks('Journey in Satchidananda', 'Alice Coltrane');
    const state = savePlaylist(emptyState(), {
      id: 'test',
      name: 'Trap',
      daypart: 'day',
      trackIds: [jis[2]!.id, 'slits-typical'],
    });
    const primed = withPlays(state, [
      { id: 'p1', trackId: jis[0]!.id, playedAt: new Date(t0.getTime() - 12 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p2', trackId: jis[1]!.id, playedAt: new Date(t0.getTime() - 6 * 60 * 1000).toISOString(), source: 'set' },
    ]);

    const result = pickNext({ state: primed, now: t0 });
    expect('play' in result).toBe(true);
    if ('play' in result) {
      expect(result.play.trackId).toBe('slits-typical');
      expect(result.play.trackId).not.toBe(jis[2]!.id);
    }
  });

  it('eligible request wins over the set list once the hour has passed and SRPC is clean', () => {
    const requestedAt = new Date(t0.getTime() - MIN_REQUEST_DELAY_MS);
    const queued = queueRequest({
      state: emptyState(),
      trackId: 'gof-natural',
      requesterLabel: 'pat',
      now: requestedAt,
      tracks: catalog,
      resolveTrack,
    });
    const result = pickNext({ state: queued.state, now: t0 });
    expect('play' in result).toBe(true);
    if ('play' in result) {
      expect(result.play.source).toBe('request');
      expect(result.play.trackId).toBe('gof-natural');
    }
  });

  it('refuses AutoDJ when every remaining pick violates SRPC', () => {
    const jis = albumTracks('Journey in Satchidananda', 'Alice Coltrane');
    const state = savePlaylist(emptyState(), {
      id: 'only-jis',
      name: 'Only JIS',
      daypart: 'day',
      trackIds: [jis[2]!.id],
    });
    const primed = withPlays(state, [
      { id: 'p1', trackId: jis[0]!.id, playedAt: new Date(t0.getTime() - 12 * 60 * 1000).toISOString(), source: 'set' },
      { id: 'p2', trackId: jis[1]!.id, playedAt: new Date(t0.getTime() - 6 * 60 * 1000).toISOString(), source: 'set' },
    ]);
    const result = pickNext({ state: primed, now: t0 });
    expect('refused' in result).toBe(true);
    if ('refused' in result) expect(result.refused.code).toBe('no_legal_pick');
  });
});
