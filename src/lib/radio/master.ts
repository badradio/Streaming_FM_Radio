import { matchKey } from './match';
import { trackIdFromMatchKey } from './airlog';
import { airMatchesTrack } from './match';
import { stationTracks } from './catalog';
import type { StationState, Track } from './types';

/** One row from Mark’s Dropbox scanner (master.csv / NDJSON). */
export type MasterTrack = {
  id: string;
  artist: string;
  album?: string;
  title: string;
  durationSec?: number;
  format?: string;
  sizeBytes?: number;
  relativePath?: string;
  folderRoot?: string;
  contentHash?: string;
  tagSource?: string;
  scannedAt?: string;
};

export type MasterParseResult = {
  rows: MasterTrack[];
  skipped: number;
  duplicatesInFile: number;
};

export type UpsertPlan = {
  insert: MasterTrack[];
  update: MasterTrack[];
  skipped: number;
};

export type DiffBuckets = {
  masterTotal: number;
  airTotal: number;
  intersection: string[];
  masterOnly: string[];
  airOnly: string[];
};

const HEADER_ALIASES: Record<string, keyof Omit<MasterTrack, 'id'> | 'match_key'> = {
  artist: 'artist',
  album: 'album',
  title: 'title',
  duration_sec: 'durationSec',
  duration: 'durationSec',
  durationsec: 'durationSec',
  length: 'durationSec',
  format: 'format',
  ext: 'format',
  size_bytes: 'sizeBytes',
  size: 'sizeBytes',
  filesize: 'sizeBytes',
  relative_path: 'relativePath',
  relpath: 'relativePath',
  path: 'relativePath',
  filepath: 'relativePath',
  folder_root: 'folderRoot',
  folder: 'folderRoot',
  root: 'folderRoot',
  source_folder: 'folderRoot',
  content_hash: 'contentHash',
  hash: 'contentHash',
  sha256: 'contentHash',
  md5: 'contentHash',
  tag_source: 'tagSource',
  tagsource: 'tagSource',
  scanned_at: 'scannedAt',
  scannedat: 'scannedAt',
  mtime: 'scannedAt',
  match_key: 'match_key',
  matchkey: 'match_key',
};

export function parseMasterUpload(text: string, filename = ''): MasterParseResult {
  const trimmed = stripBom(text).trim();
  if (!trimmed) return { rows: [], skipped: 0, duplicatesInFile: 0 };

  if (filename.endsWith('.ndjson') || looksLikeNdjson(trimmed)) {
    return normalizeIncoming(parseNdjson(trimmed));
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return normalizeIncoming(parseJson(trimmed));
  }
  return normalizeIncoming(parseCsvRecords(trimmed));
}

export function planMasterUpsert(
  existing: Iterable<{ id: string; contentHash?: string; relativePath?: string; sizeBytes?: number }>,
  incoming: MasterTrack[],
): UpsertPlan {
  const have = new Map<string, { contentHash?: string; relativePath?: string; sizeBytes?: number }>();
  for (const row of existing) have.set(row.id, row);

  const insert: MasterTrack[] = [];
  const update: MasterTrack[] = [];
  let skipped = 0;

  for (const row of incoming) {
    const prior = have.get(row.id);
    if (!prior) {
      insert.push(row);
      have.set(row.id, row);
      continue;
    }
    if (sameFingerprint(prior, row)) {
      skipped += 1;
      continue;
    }
    update.push(row);
    have.set(row.id, row);
  }

  return { insert, update, skipped };
}

export function diffMasterVsAir(masterIds: string[], airKeys: string[]): DiffBuckets {
  const master = new Set(masterIds);
  const air = new Set(airKeys);
  const intersection: string[] = [];
  const masterOnly: string[] = [];
  const airOnly: string[] = [];

  for (const id of masterIds) {
    if (air.has(id)) intersection.push(id);
    else masterOnly.push(id);
  }
  for (const key of airKeys) {
    if (!master.has(key)) airOnly.push(key);
  }

  return {
    masterTotal: master.size,
    airTotal: air.size,
    intersection,
    masterOnly,
    airOnly,
  };
}

export function pageIds(ids: string[], page: number, pageSize: number): { slice: string[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(ids.length / pageSize));
  const safe = Math.min(Math.max(1, page), pages);
  const start = (safe - 1) * pageSize;
  return { slice: ids.slice(start, start + pageSize), pages, page: safe };
}

export function promoteMasterTracks(
  state: StationState,
  rows: Array<Pick<MasterTrack, 'id' | 'artist' | 'title' | 'album' | 'durationSec'>>,
): { state: StationState; promoted: Track[]; skipped: string[] } {
  const tracks = stationTracks(state);
  const promotedTracks = [...state.promotedTracks];
  const airLog = { ...state.airLog };
  const promoted: Track[] = [];
  const skipped: string[] = [];
  const seenIds = new Set(tracks.map((track) => track.id));

  for (const row of rows) {
    const existing = tracks.find(
      (track) => track.id === trackIdFromMatchKey(row.id) || airMatchesTrack(row, track),
    );
    if (existing) {
      if (airLog[row.id] && airLog[row.id]?.promotedTrackId !== existing.id) {
        airLog[row.id] = { ...airLog[row.id]!, promotedTrackId: existing.id };
      }
      skipped.push(row.id);
      continue;
    }

    const track: Track = {
      id: trackIdFromMatchKey(row.id),
      artist: row.artist,
      title: row.title,
      ...(row.album && row.album.trim() && row.album.trim() !== '—' ? { album: row.album.trim() } : {}),
      ...(row.durationSec && row.durationSec > 0 ? { durationSec: row.durationSec } : {}),
    };
    if (seenIds.has(track.id)) {
      skipped.push(row.id);
      continue;
    }
    promotedTracks.push(track);
    promoted.push(track);
    seenIds.add(track.id);
    if (airLog[row.id]) {
      airLog[row.id] = { ...airLog[row.id]!, promotedTrackId: track.id };
    }
  }

  if (promoted.length === 0) {
    const logChanged = Object.keys(airLog).some((key) => airLog[key] !== state.airLog[key]);
    if (!logChanged) return { state, promoted, skipped };
  }

  return { state: { ...state, promotedTracks, airLog }, promoted, skipped };
}

export function toMasterDiffCsv(
  rows: Array<{ artist: string; title: string; album?: string; folderRoot?: string; relativePath?: string; plays?: number }>,
): string {
  const lines = ['artist,title,album,folder_root,relative_path,plays'];
  for (const row of rows) {
    lines.push(
      [
        row.artist,
        row.title,
        row.album ?? '',
        row.folderRoot ?? '',
        row.relativePath ?? '',
        row.plays !== undefined ? String(row.plays) : '',
      ]
        .map(csvField)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function normalizeIncoming(raw: Array<Record<string, unknown>>): MasterParseResult {
  const byId = new Map<string, MasterTrack>();
  let skipped = 0;
  let duplicatesInFile = 0;

  for (const record of raw) {
    const mapped = mapRecord(record);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    if (byId.has(mapped.id)) duplicatesInFile += 1;
    byId.set(mapped.id, mapped);
  }

  return { rows: [...byId.values()], skipped, duplicatesInFile };
}

function mapRecord(record: Record<string, unknown>): MasterTrack | null {
  const get = (names: string[]): string => {
    for (const name of names) {
      const value = record[name];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
  };

  const artist = get(['artist', 'Artist', 'ARTIST']);
  const title = get(['title', 'Title', 'TITLE', 'track', 'Track']);
  if (!artist || !title) return null;

  const id = matchKey(artist, title);
  if (!id || id === '::') return null;

  const album = emptyToUndef(get(['album', 'Album', 'ALBUM']));
  const durationSec = parseIntish(get(['duration_sec', 'durationSec', 'duration', 'length']));
  const sizeBytes = parseIntish(get(['size_bytes', 'sizeBytes', 'size', 'filesize']));
  const format = emptyToUndef(get(['format', 'ext', 'Format']));
  const relativePath = emptyToUndef(get(['relative_path', 'relativePath', 'path', 'filepath', 'relpath']));
  const folderRoot = emptyToUndef(get(['folder_root', 'folderRoot', 'folder', 'root', 'source_folder']));
  const contentHash = emptyToUndef(get(['content_hash', 'contentHash', 'hash', 'sha256', 'md5']));
  const tagSource = emptyToUndef(get(['tag_source', 'tagSource']));
  const scannedAt = emptyToUndef(get(['scanned_at', 'scannedAt', 'mtime']));

  return {
    id,
    artist,
    title,
    ...(album ? { album } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(format ? { format } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(folderRoot ? { folderRoot } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(tagSource ? { tagSource } : {}),
    ...(scannedAt ? { scannedAt } : {}),
  };
}

function parseCsvRecords(text: string): Array<Record<string, unknown>> {
  const table = parseCsv(text);
  const header = table[0];
  if (!header || header.length === 0) return [];
  const keys = header.map((cell) => normalizeHeader(cell));
  const out: Array<Record<string, unknown>> = [];
  for (const cells of table.slice(1)) {
    if (cells.every((cell) => !cell.trim())) continue;
    const record: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      const alias = HEADER_ALIASES[key] ?? key;
      record[String(alias)] = cells[i] ?? '';
      record[key] = cells[i] ?? '';
    });
    out.push(record);
  }
  return out;
}

function parseNdjson(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) out.push(value as Record<string, unknown>);
    } catch {
      // skip bad line
    }
  }
  return out;
}

function parseJson(text: string): Array<Record<string, unknown>> {
  const value = JSON.parse(text) as unknown;
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }
  if (value && typeof value === 'object') {
    const obj = value as { tracks?: unknown; rows?: unknown };
    const list = Array.isArray(obj.tracks) ? obj.tracks : Array.isArray(obj.rows) ? obj.rows : [];
    return list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }
  return [];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function looksLikeNdjson(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  return first.startsWith('{') && !text.trim().startsWith('[');
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/^\ufeff/, '').replace(/[\s-]+/g, '_');
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function emptyToUndef(value: string): string | undefined {
  return value ? value : undefined;
}

function parseIntish(value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function sameFingerprint(
  a: { contentHash?: string; relativePath?: string; sizeBytes?: number },
  b: MasterTrack,
): boolean {
  if (a.contentHash && b.contentHash) return a.contentHash === b.contentHash && a.relativePath === b.relativePath;
  return a.relativePath === b.relativePath && a.sizeBytes === b.sizeBytes;
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
