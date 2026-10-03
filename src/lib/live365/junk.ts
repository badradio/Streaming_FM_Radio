/** Drop Live365 cue / placeholder rows that are not real songs. */

const JUNK_TITLES = new Set(['newstop', 'newstart']);

const J_CUE_TITLES = new Set(['stop', 'start', 'newstop', 'newstart']);

export function foldCue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Non-track filter used on the public now-playing feed and widget.
 *
 * Drops:
 * - folded title `newstop` / `newstart` (Live365 `new-stop` cues)
 * - artist `j` + 1–3 digits (e.g. `j02`) when the title is a stop/start cue
 * - artist `id` with a numbered liner title (e.g. `07-panther`)
 * - obvious ad-break / advertisement / commercial titles (word-boundary on the raw title)
 *
 * Does not drop real songs that happen to use Live365 `blankart.jpg` — those
 * keep the row and lose only the placeholder art (see `stripPlaceholderArt`).
 */
export function isJunkAirTrack(track: { artist: string; title: string }): boolean {
  const titleFold = foldCue(track.title);
  const artistFold = foldCue(track.artist);
  if (!titleFold && !artistFold) return true;
  if (JUNK_TITLES.has(titleFold)) return true;
  if (isAdCueTitle(track.title)) return true;
  if (isStationIdCue(artistFold, track.title)) return true;

  const jArtist = /^j\d{1,3}$/.test(artistFold);
  if (jArtist && (J_CUE_TITLES.has(titleFold) || /^(new)?(stop|start)$/.test(titleFold))) return true;
  return false;
}

export function isPlaceholderArtUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('blankart') || lower.includes('/static/assets/img/blank');
}

export function stripPlaceholderArt<T extends { art?: string }>(track: T): Omit<T, 'art'> & { art?: string } {
  if (!track.art || !isPlaceholderArtUrl(track.art)) return track;
  const { art: _drop, ...rest } = track;
  return rest;
}

function isAdCueTitle(title: string): boolean {
  return /\bad\s*break\b/i.test(title) || /\badvertisement\b/i.test(title) || /\bpaid\s*programming\b/i.test(title);
}

/** Live365 liners such as artist `id` / title `07-panther`. */
function isStationIdCue(artistFold: string, title: string): boolean {
  return artistFold === 'id' && /^\d{1,3}-[a-z0-9-]+$/i.test(title.trim());
}
