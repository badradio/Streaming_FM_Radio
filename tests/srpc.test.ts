import { describe, expect, it } from 'vitest';
import { checkSrpc, MAX_ALBUM_CONSECUTIVE, MAX_ALBUM_IN_WINDOW, MAX_ARTIST_CONSECUTIVE, MAX_ARTIST_IN_WINDOW } from '../src/lib/radio/rules';
import type { PlayEvent, Track } from '../src/lib/radio/types';

function track(partial: Partial<Track> & Pick<Track, 'id' | 'title' | 'artist'>): Track {
  return {
    year: 1971,
    durationSec: 180,
    ...partial,
  };
}

const t0 = new Date('2026-09-02T12:00:00.000Z');

function minutes(offset: number): Date {
  return new Date(t0.getTime() + offset * 60 * 1000);
}

function play(item: Track, offsetMin: number): PlayEvent {
  return { track: item, at: minutes(offsetMin) };
}

const jis1 = track({ id: '1', title: 'A', artist: 'Alice Coltrane', album: 'Journey in Satchidananda' });
const jis2 = track({ id: '2', title: 'B', artist: 'Alice Coltrane', album: 'Journey in Satchidananda' });
const jis3 = track({ id: '3', title: 'C', artist: 'Alice Coltrane', album: 'Journey in Satchidananda' });
const jis4 = track({ id: '4', title: 'D', artist: 'Alice Coltrane', album: 'Journey in Satchidananda' });
const ptah = track({ id: '5', title: 'Ptah', artist: 'Alice Coltrane', album: 'Ptah, the El Daoud' });
const can1 = track({ id: '6', title: 'Paperhouse', artist: 'Can', album: 'Tago Mago' });
const slits = track({ id: '8', title: 'Typical Girls', artist: 'The Slits', album: 'Cut' });

describe('Sound Recording Performance Complement', () => {
  it('allows a legal mixed sequence', () => {
    const history = [play(jis1, 0), play(can1, 6), play(slits, 12)];
    expect(checkSrpc(ptah, minutes(18), history).ok).toBe(true);
  });

  it(`refuses a ${MAX_ALBUM_IN_WINDOW + 1}th track from the same album in a 3-hour window`, () => {
    const history = [play(jis1, 0), play(can1, 8), play(jis2, 16), play(slits, 24), play(jis3, 32)];
    const result = checkSrpc(jis4, minutes(40), history);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('album_cap');
      expect(result.message).toMatch(/album cap/i);
    }
  });

  it(`allows ${MAX_ALBUM_IN_WINDOW} tracks from one album when they are not consecutive beyond the cap`, () => {
    const history = [play(jis1, 0), play(can1, 8), play(jis2, 16), play(slits, 24)];
    expect(checkSrpc(jis3, minutes(32), history).ok).toBe(true);
  });

  it('allows the 4th album track once the oldest falls outside the 3-hour window', () => {
    const history = [play(jis1, 0), play(can1, 10), play(jis2, 20), play(slits, 30), play(jis3, 40)];
    const later = new Date(t0.getTime() + SRPC_PLUS);
    const result = checkSrpc(jis4, later, history);
    expect(result.ok).toBe(true);
  });

  it(`refuses a ${MAX_ALBUM_CONSECUTIVE + 1}rd consecutive album track`, () => {
    const history = [play(jis1, 0), play(jis2, 5)];
    const result = checkSrpc(jis3, minutes(10), history);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('album_consecutive');
      expect(result.message).toMatch(/album cap/i);
    }
  });

  it('counts consecutive album tracks across an insertion between scheduled plays', () => {
    const history = [play(jis1, 0), play(jis3, 12)];
    const result = checkSrpc(jis2, minutes(6), history);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('album_consecutive');
  });

  it(`refuses a ${MAX_ARTIST_IN_WINDOW + 1}th track from one featured artist in 3 hours`, () => {
    const a = track({ id: 'a1', title: '1', artist: 'Can', album: 'Tago Mago' });
    const b = track({ id: 'a2', title: '2', artist: 'Can', album: 'Tago Mago' });
    const c = track({ id: 'a3', title: '3', artist: 'Can', album: 'Ege Bamyasi' });
    const d = track({ id: 'a4', title: '4', artist: 'Can', album: 'Ege Bamyasi' });
    const e = track({ id: 'a5', title: '5', artist: 'Can', album: 'Future Days' });
    const history = [
      play(a, 0),
      play(slits, 8),
      play(b, 16),
      play(jis1, 24),
      play(c, 32),
      play(slits, 40),
      play(d, 48),
    ];
    const result = checkSrpc(e, minutes(56), history);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('artist_cap');
      expect(result.message).toMatch(/artist cap/i);
    }
  });

  it(`allows ${MAX_ARTIST_IN_WINDOW} tracks from one featured artist`, () => {
    const a = track({ id: 'a1', title: '1', artist: 'Can', album: 'Tago Mago' });
    const b = track({ id: 'a2', title: '2', artist: 'Can', album: 'Tago Mago' });
    const c = track({ id: 'a3', title: '3', artist: 'Can', album: 'Ege Bamyasi' });
    const d = track({ id: 'a4', title: '4', artist: 'Can', album: 'Future Days' });
    const history = [play(a, 0), play(slits, 8), play(b, 16), play(jis1, 24), play(c, 32)];
    expect(checkSrpc(d, minutes(40), history).ok).toBe(true);
  });

  it(`refuses a ${MAX_ARTIST_CONSECUTIVE + 1}th consecutive featured artist`, () => {
    const a = track({ id: 'a1', title: '1', artist: 'Can', album: 'Tago Mago' });
    const b = track({ id: 'a2', title: '2', artist: 'Can', album: 'Ege Bamyasi' });
    const c = track({ id: 'a3', title: '3', artist: 'Can', album: 'Future Days' });
    const d = track({ id: 'a4', title: '4', artist: 'Can', album: 'Soon Over Babaluma' });
    const history = [play(a, 0), play(b, 6), play(c, 12)];
    const result = checkSrpc(d, minutes(18), history);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('artist_consecutive');
      expect(result.message).toMatch(/artist cap/i);
    }
  });

  it('does not treat a different album with the same title as the same album', () => {
    const one = track({ id: 'p1', title: 'Pendulum', artist: 'Broadcast', album: 'The Noise Made by People' });
    const two = track({ id: 'p2', title: 'Pendulum', artist: 'Broadcast', album: 'Haha Sound' });
    const three = track({ id: 'p3', title: 'Long Was the Year', artist: 'Broadcast', album: 'The Noise Made by People' });
    const history = [play(one, 0), play(two, 6)];
    expect(checkSrpc(three, minutes(12), history).ok).toBe(true);
  });

  it('does not apply album caps when album is unknown', () => {
    const a = track({ id: 'u1', title: 'One', artist: 'SOJA', album: '' });
    const b = track({ id: 'u2', title: 'Two', artist: 'SOJA', album: undefined });
    const c = track({ id: 'u3', title: 'Three', artist: 'Pepper' });
    const d = track({ id: 'u4', title: 'Four', artist: 'SOJA' });
    const history = [play(a, 0), play(c, 6), play(b, 12)];
    const result = checkSrpc(d, minutes(18), history);
    expect(result.ok).toBe(true);
  });
});

const SRPC_PLUS = 3 * 60 * 60 * 1000 + 60 * 1000;
