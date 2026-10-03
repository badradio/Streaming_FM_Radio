import { describe, expect, it } from 'vitest';
import { foldMatchText, matchKey } from '../src/lib/radio/match';
import { emptyState } from '../src/lib/radio/catalog';
import { stationTracks } from '../src/lib/radio/catalog';
import { resolveTrack } from '../src/lib/radio/search';
import { queueRequest } from '../src/lib/radio/autodj';
import {
  diffMasterVsAir,
  parseMasterUpload,
  planMasterUpsert,
  promoteMasterTracks,
  toMasterDiffCsv,
} from '../src/lib/radio/master';
import { asMasterDb, openMasterLibrary } from '../src/lib/radio/master-db';
import type { D1Like } from '../src/lib/runtime';

describe('master match_key join', () => {
  it('folds artist/title the same way as Live365 air-log keys', () => {
    expect(foldMatchText("Howlin’ Wolf")).toBe(foldMatchText("Howlin' Wolf"));
    const csv = parseMasterUpload(
      'artist,title,album\n"Howlin’ Wolf",Smokestack Lightnin’,The Real Folk Blues\n',
    );
    expect(csv.rows).toHaveLength(1);
    expect(csv.rows[0]?.id).toBe(matchKey("Howlin' Wolf", 'Smokestack Lightnin\''));
    expect(csv.rows[0]?.id).toBe(matchKey('Howlin’ Wolf', 'Smokestack Lightnin’'));
  });

  it('splits master vs air into intersection, master-only, and air-only', () => {
    const soja = matchKey('SOJA', 'Your Song');
    const slits = matchKey('The Slits', 'Typical Girls');
    const pepper = matchKey('Pepper', 'Office');
    const diff = diffMasterVsAir([soja, slits], [soja, pepper]);
    expect(diff.masterTotal).toBe(2);
    expect(diff.airTotal).toBe(2);
    expect(diff.intersection).toEqual([soja]);
    expect(diff.masterOnly).toEqual([slits]);
    expect(diff.airOnly).toEqual([pepper]);
  });
});

describe('master import upsert plan', () => {
  it('inserts new keys, updates changed fingerprints, skips identical re-import', () => {
    const first = parseMasterUpload(
      'artist,title,relative_path,size_bytes,content_hash\nCan,Spoon,45000_Songs/can-spoon.mp3,123,abc\n',
    );
    const plan1 = planMasterUpsert([], first.rows);
    expect(plan1.insert).toHaveLength(1);
    expect(plan1.update).toHaveLength(0);

    const same = planMasterUpsert(plan1.insert, first.rows);
    expect(same.insert).toHaveLength(0);
    expect(same.update).toHaveLength(0);
    expect(same.skipped).toBe(1);

    const moved = parseMasterUpload(
      'artist,title,relative_path,size_bytes,content_hash\nCan,Spoon,Shared Music/can-spoon.mp3,123,abc\n',
    );
    const plan2 = planMasterUpsert(plan1.insert, moved.rows);
    expect(plan2.update).toHaveLength(1);
    expect(plan2.insert).toHaveLength(0);
  });

  it('skips rows without artist/title and collapses duplicate keys in one file', () => {
    const parsed = parseMasterUpload(`artist,title,folder_root
Can,Spoon,45000_Songs
Can,Spoon,Concert Vault
,No Artist,x
Ghost,
`);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.duplicatesInFile).toBe(1);
    expect(parsed.skipped).toBe(2);
    expect(parsed.rows[0]?.folderRoot).toBe('Concert Vault');
  });

  it('accepts JSON lines', () => {
    const parsed = parseMasterUpload(
      '{"artist":"Pepper","title":"Office","folder_root":"Amazon MP3"}\n{"artist":"SOJA","title":"Your Song"}\n',
      'master.ndjson',
    );
    expect(parsed.rows.map((row) => row.title).sort()).toEqual(['Office', 'Your Song']);
  });
});

describe('promote master rows into the request catalog', () => {
  it('keeps album and duration when the scanner provided them', () => {
    const id = matchKey('Cowboy Junkies', "Don't Need You");
    const result = promoteMasterTracks(emptyState(), [
      { id, artist: 'Cowboy Junkies', title: "Don't Need You", album: 'The Caution Horses', durationSec: 241 },
    ]);
    expect(result.promoted[0]?.album).toBe('The Caution Horses');
    expect(result.promoted[0]?.durationSec).toBe(241);
    const tracks = stationTracks(result.state);
    expect(resolveTrack(tracks, 'Cowboy Junkies - Don\'t Need You')?.album).toBe('The Caution Horses');
    const queued = queueRequest({
      state: result.state,
      trackQuery: 'Cowboy Junkies - Don\'t Need You',
      requesterLabel: 'mark',
      now: new Date('2026-09-10T15:00:00.000Z'),
      tracks,
      resolveTrack,
    });
    expect(queued.request.status).toBe('queued');
  });
});

describe('master diff CSV', () => {
  it('exports upload-candidate columns without inventing Live365 play clocks', () => {
    const csv = toMasterDiffCsv([
      { artist: 'Can', title: 'Spoon', album: 'Ege Bamyasi', folderRoot: '45000_Songs', relativePath: 'can/spoon.mp3' },
    ]);
    expect(csv.split('\n')[0]).toBe('artist,title,album,folder_root,relative_path,plays');
    expect(csv).toContain('Can,Spoon,Ege Bamyasi,45000_Songs,can/spoon.mp3,');
    expect(csv).not.toMatch(/2026-09-10T/);
  });
});

describe('MASTER binding duck-type', () => {
  it('does not treat a plaintext dashboard var as D1', async () => {
    expect(asMasterDb('MASTER')).toBeUndefined();
    expect(asMasterDb(undefined)).toBeUndefined();
    const opened = await openMasterLibrary('MASTER', []);
    expect(opened.bound).toBe(false);
    expect(opened.note).toMatch(/plaintext/i);
  });

  it('degrades when master_tracks is missing instead of throwing', async () => {
    const db = mockD1({ tables: [] });
    const opened = await openMasterLibrary(db, [matchKey('SOJA', 'Your Song')]);
    expect(opened.bound).toBe(false);
    expect(opened.note).toMatch(/master_tracks/);
    expect(opened.diff.airTotal).toBe(1);
  });

  it('loads ids when the table exists', async () => {
    const soja = matchKey('SOJA', 'Your Song');
    const db = mockD1({ tables: ['master_tracks'], ids: [{ id: soja }] });
    const opened = await openMasterLibrary(db, [soja]);
    expect(opened.bound).toBe(true);
    expect(opened.masterIds).toEqual([soja]);
    expect(opened.diff.intersection).toEqual([soja]);
  });

  it('swallows D1 query failures so the desk can still render', async () => {
    const db = mockD1({ fail: 'no such table: master_tracks' });
    await expect(openMasterLibrary(db, [])).resolves.toMatchObject({ bound: false });
  });
});

function mockD1(opts: { tables?: string[]; ids?: Array<{ id: string }>; fail?: string }): D1Like {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async all() {
              if (opts.fail) throw new Error(opts.fail);
              if (sql.includes('sqlite_master')) {
                return { results: (opts.tables ?? []).map((name) => ({ name })) };
              }
              return { results: opts.ids ?? [] };
            },
            async run() {
              return {};
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}
