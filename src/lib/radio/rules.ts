import type { PlayEvent, Request, RuleResult, Track } from './types';

/** DMCA webcasting: not within 1 hour of the request, not at a time the requester designates. */
export const MIN_REQUEST_DELAY_MS = 60 * 60 * 1000;

/** Sound Recording Performance Complement — rolling 3-hour window. */
export const SRPC_WINDOW_MS = 3 * 60 * 60 * 1000;
export const MAX_ALBUM_IN_WINDOW = 3;
export const MAX_ALBUM_CONSECUTIVE = 2;
export const MAX_ARTIST_IN_WINDOW = 4;
export const MAX_ARTIST_CONSECUTIVE = 3;

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function artistKey(track: Pick<Track, 'artist'>): string {
  return normalizeKey(track.artist);
}

/** Album identity is artist + album so two LPs with the same title do not collide. */
export function albumKey(track: Pick<Track, 'artist' | 'album'>): string {
  return `${artistKey(track)}::${normalizeKey(track.album ?? '')}`;
}

/** Promoted air-log tracks omit album on purpose — SRPC album caps must not invent one. */
export function hasAlbum(track: Pick<Track, 'album'>): boolean {
  const album = track.album?.trim();
  return Boolean(album && album !== '—');
}

export function earliestPlayAt(requestedAt: Date, minDelayMs = MIN_REQUEST_DELAY_MS): Date {
  return new Date(requestedAt.getTime() + minDelayMs);
}

export function checkDelay(
  requestedAt: Date,
  proposedAt: Date,
  minDelayMs = MIN_REQUEST_DELAY_MS,
): RuleResult {
  if (proposedAt.getTime() < requestedAt.getTime() + minDelayMs) {
    return {
      ok: false,
      code: 'too_soon',
      message: 'too soon — not within 1 hour of the request, and not at a time the requester designates',
    };
  }
  return { ok: true };
}

export function listenerRejectCode(code: string): string {
  if (code === 'album_consecutive') return 'album_cap';
  if (code === 'artist_consecutive') return 'artist_cap';
  return code;
}

/**
 * SRPC against recent + scheduled plays. Consecutive is the run touching `proposedAt`.
 * Window: any rolling 3-hour span that would include this play.
 */
export function checkSrpc(track: Track, proposedAt: Date, history: PlayEvent[]): RuleResult {
  const sequence = [...history, { track, at: proposedAt }].sort((a, b) => a.at.getTime() - b.at.getTime());
  const index = sequence.findIndex((event) => event.at.getTime() === proposedAt.getTime() && event.track.id === track.id);
  const at = index === -1 ? sequence.length - 1 : index;

  const albumRun = consecutiveRun(
    sequence,
    at,
    (event) => hasAlbum(track) && hasAlbum(event.track) && albumKey(event.track) === albumKey(track),
  );
  if (albumRun > MAX_ALBUM_CONSECUTIVE) {
    return {
      ok: false,
      code: 'album_consecutive',
      message: 'album cap — max 2 consecutive tracks from one album',
    };
  }

  const artistRun = consecutiveRun(sequence, at, (event) => artistKey(event.track) === artistKey(track));
  if (artistRun > MAX_ARTIST_CONSECUTIVE) {
    return {
      ok: false,
      code: 'artist_consecutive',
      message: 'artist cap — max 3 consecutive tracks from one featured artist',
    };
  }

  const albumTimes = sameKeyTimes(
    sequence,
    proposedAt,
    (event) => hasAlbum(track) && hasAlbum(event.track) && albumKey(event.track) === albumKey(track),
  );
  if (maxInRollingWindow(albumTimes, SRPC_WINDOW_MS) > MAX_ALBUM_IN_WINDOW) {
    return {
      ok: false,
      code: 'album_cap',
      message: 'album cap — max 3 tracks from one album in any rolling 3-hour window',
    };
  }

  const artistTimes = sameKeyTimes(sequence, proposedAt, (event) => artistKey(event.track) === artistKey(track));
  if (maxInRollingWindow(artistTimes, SRPC_WINDOW_MS) > MAX_ARTIST_IN_WINDOW) {
    return {
      ok: false,
      code: 'artist_cap',
      message: 'artist cap — max 4 tracks from one featured artist in any rolling 3-hour window',
    };
  }

  return { ok: true };
}

export function checkPlay(options: {
  track: Track;
  proposedAt: Date;
  history: PlayEvent[];
  request?: Pick<Request, 'requestedAt'> | { requestedAt: Date | string };
}): RuleResult {
  if (options.request) {
    const requestedAt =
      options.request.requestedAt instanceof Date
        ? options.request.requestedAt
        : new Date(options.request.requestedAt);
    const delay = checkDelay(requestedAt, options.proposedAt);
    if (!delay.ok) return delay;
  }
  return checkSrpc(options.track, options.proposedAt, options.history);
}

export function findLegalSlot(options: {
  track: Track;
  earliest: Date;
  history: PlayEvent[];
  horizon: Date;
  stepMs?: number;
  request?: { requestedAt: Date | string };
}): { at: Date } | { at: null; reason: RuleResult & { ok: false } } {
  const stepMs = options.stepMs ?? 60 * 1000;
  let firstFail: (RuleResult & { ok: false }) | null = null;

  for (let t = options.earliest.getTime(); t <= options.horizon.getTime(); t += stepMs) {
    const proposedAt = new Date(t);
    const result = checkPlay({
      track: options.track,
      proposedAt,
      history: options.history,
      request: options.request,
    });
    if (result.ok) return { at: proposedAt };
    firstFail ??= result;
  }

  return {
    at: null,
    reason: firstFail ?? {
      ok: false,
      code: 'no_slot',
      message: 'no legal slot in the planning horizon',
    },
  };
}

function consecutiveRun(
  sequence: PlayEvent[],
  index: number,
  matches: (event: PlayEvent) => boolean,
): number {
  let count = 0;
  for (let i = index; i >= 0 && matches(sequence[i]!); i--) count++;
  for (let i = index + 1; i < sequence.length && matches(sequence[i]!); i++) count++;
  return count;
}

function sameKeyTimes(sequence: PlayEvent[], proposedAt: Date, matches: (event: PlayEvent) => boolean): number[] {
  const start = proposedAt.getTime() - SRPC_WINDOW_MS;
  const end = proposedAt.getTime() + SRPC_WINDOW_MS;
  return sequence
    .filter((event) => matches(event) && event.at.getTime() >= start && event.at.getTime() <= end)
    .map((event) => event.at.getTime())
    .sort((a, b) => a - b);
}

/** Largest number of timestamps that fit in any window of `windowMs`. */
export function maxInRollingWindow(times: number[], windowMs: number): number {
  if (times.length === 0) return 0;
  let max = 0;
  let left = 0;
  for (let right = 0; right < times.length; right++) {
    while (times[right]! - times[left]! > windowMs) left++;
    max = Math.max(max, right - left + 1);
  }
  return max;
}
