import { describe, expect, it } from 'vitest';
import { normalizeLive365Station } from '../src/lib/live365/normalize';
import {
  ENSURE_PLAYS_TABLE_SQL,
  INSERT_PLAY_SQL,
  UPDATE_PLAYS_AD_CUES_SQL,
  collectPlayRows,
  isPlayCue,
  listPlaysSql,
  parseDurationSeconds,
  parsePlayQuery,
  parsePlayTrack,
  toChicagoLocal,
} from '../src/lib/plays';

const sample = {
  'current-track': {
    title: 'Fire And Rain',
    artist: 'James Taylor',
    art: 'https://example.com/fire.jpg',
    start: '2026-10-15 16:32:16.62+00:00',
    duration: 223.7,
    end: '2026-10-15 16:36:00.36+00:00',
    source: 'ls',
    status: 'playing',
  },
  'last-played': [
    {
      title: 'Hey Big Brother',
      artist: 'Rare Earth',
      start: '2026-10-15 16:27:34.71+00:00',
      duration: 284.8,
      source: '',
    },
    {
      title: 'patreon sting',
      artist: 'j12',
      start: '2026-10-15 16:26:00.00+00:00',
      duration: 8,
    },
    {
      title: '07-panther',
      artist: 'id',
      start: '2026-10-15 16:25:00+00:00',
    },
    {
      title: 'liner',
      artist: '',
      start: '2026-10-15 16:24:00+00:00',
    },
    {
      title: 'Fire And Rain',
      artist: 'James Taylor',
      start: '2026-10-15 16:32:16.62+00:00',
    },
    {
      title: '120 Second Ad Break',
      artist: 'Live365',
      start: '2026-10-15 16:36:00.24+00:00',
      duration: 120,
    },
  ],
};

describe('play cue detection', () => {
  it('marks j-number, patreon, station id, empty artist, and Live365 ad breaks as cues', () => {
    expect(isPlayCue('j12', 'patreon sting')).toBe(true);
    expect(isPlayCue('J02', 'new-stop')).toBe(true);
    expect(isPlayCue('station', 'Support us on Patreon')).toBe(true);
    expect(isPlayCue('id', '07-panther')).toBe(true);
    expect(isPlayCue('', 'liner')).toBe(true);
    expect(isPlayCue('Live365', '120 Second Ad Break')).toBe(true);
    expect(isPlayCue('live365', 'network ID')).toBe(true);
    expect(isPlayCue('Some Network', '30 Second Ad Break')).toBe(true);
    expect(isPlayCue('James Taylor', 'Fire And Rain')).toBe(false);
  });
});

describe('play row parse', () => {
  it('maps Live365 current-track fields and Chicago local time', () => {
    const row = parsePlayTrack(sample['current-track']);
    expect(row).toMatchObject({
      artist: 'James Taylor',
      title: 'Fire And Rain',
      album: null,
      art: 'https://example.com/fire.jpg',
      source: 'ls',
      isCue: false,
      duration: 224,
    });
    expect(row?.startedAt).toBe('2026-10-15T16:32:16.620Z');
    expect(row?.startedCt).toBe(toChicagoLocal('2026-10-15T16:32:16.620Z'));
    expect(row?.startedCt).toMatch(/^2026-10-15T11:32:16$/);
    expect(parseDurationSeconds(284.8)).toBe(285);
  });

  it('writes current-track and backfills last-played without duplicating the same start', () => {
    const rows = collectPlayRows(sample);
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.title === 'Fire And Rain')).toHaveLength(1);
    expect(rows.some((row) => row.artist === 'j12' && row.isCue)).toBe(true);
    expect(rows.some((row) => row.artist === 'id' && row.isCue)).toBe(true);
    expect(rows.some((row) => row.artist === '' && row.isCue)).toBe(true);
    expect(rows.some((row) => row.artist === 'Live365' && row.title.includes('Ad Break') && row.isCue)).toBe(true);
    expect(INSERT_PLAY_SQL).toMatch(/INSERT OR IGNORE/);
    expect(UPDATE_PLAYS_AD_CUES_SQL).toMatch(/LOWER\(TRIM\(artist\)\) = 'live365'/);
    expect(UPDATE_PLAYS_AD_CUES_SQL).toMatch(/ad break/);
    expect(ENSURE_PLAYS_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS plays/);
  });
});

describe('plays query', () => {
  it('defaults limit 50, caps at 500, and hides cues unless asked', () => {
    expect(parsePlayQuery(new URLSearchParams())).toEqual({
      limit: 50,
      includeCues: false,
    });
    const parsed = parsePlayQuery(
      new URLSearchParams('limit=999&include_cues=true&artist=Taylor&since=2026-10-15T00:00:00.000Z'),
    );
    expect(parsed).toMatchObject({
      limit: 500,
      includeCues: true,
      artist: 'Taylor',
      since: '2026-10-15T00:00:00.000Z',
    });
    expect(parsePlayQuery(new URLSearchParams('since=not-a-date'))).toEqual({
      error: 'since must be an ISO date',
    });

    const hidden = listPlaysSql({ limit: 50, includeCues: false, artist: 'Taylor' });
    expect(hidden.sql).toMatch(/is_cue = 0/);
    expect(hidden.sql).toMatch(/ORDER BY started_at DESC/);
    expect(hidden.values).toEqual(['Taylor', 50]);
    const shown = listPlaysSql({ limit: 5, includeCues: true });
    expect(shown.sql).not.toMatch(/is_cue = 0/);
    expect(shown.values).toEqual([5]);
  });
});

describe('now-playing normalize is unchanged', () => {
  it('still drops cue rows from the public feed', () => {
    const feed = normalizeLive365Station({
      is_playing: true,
      'current-track': sample['current-track'],
      'last-played': sample['last-played'],
    });
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    expect(feed.now?.title).toBe('Fire And Rain');
    expect(feed.recent.some((track) => track.artist === 'Rare Earth')).toBe(true);
    expect(feed.ok).toBe(true);
  });
});
