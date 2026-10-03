import { catalog } from './catalog';
import { pickNext, playEvents } from './autodj';
import { checkPlay } from './rules';
import { inspectQueue, readyRequests } from './ready';
import type { PlayEvent, Playlist, StationState, Track } from './types';

export type ExportTrack = {
  title: string;
  artist: string;
  album: string;
  year: number;
  isrc?: string;
  durationSec: number;
  audioUrl?: string;
  source: 'set' | 'request' | 'autodj';
};

function toExport(track: Track, source: ExportTrack['source']): ExportTrack {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album ?? '',
    year: track.year ?? 0,
    durationSec: track.durationSec ?? 0,
    source,
    ...(track.isrc ? { isrc: track.isrc } : {}),
    ...(track.audioUrl ? { audioUrl: track.audioUrl } : {}),
  };
}

/** Ready-to-air requests, then optional remaining day set. Order only — no play clocks. */
export function exportReadyChecklist(options: {
  state: StationState;
  now: Date;
  includeDaySet: boolean;
  includeReady?: boolean;
  extraHistory?: PlayEvent[];
  tracks?: Track[];
}): ExportTrack[] {
  const tracks = options.tracks ?? catalog;
  const includeReady = options.includeReady !== false;
  const history: PlayEvent[] = [...playEvents(options.state, tracks), ...(options.extraHistory ?? [])].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );
  const out: ExportTrack[] = [];
  let clock = options.now.getTime();

  const ready = includeReady
    ? readyRequests(
        inspectQueue({
          state: options.state,
          now: options.now,
          tracks,
          extraHistory: options.extraHistory,
        }),
      )
    : [];

  for (const item of ready) {
    const proposedAt = new Date(clock);
    const result = checkPlay({
      track: item.track,
      proposedAt,
      history,
      request: item.request,
    });
    if (!result.ok) continue;
    out.push(toExport(item.track, 'request'));
    history.push({ track: item.track, at: proposedAt });
    clock += Math.max(item.track.durationSec ?? 0, 1) * 1000;
  }

  if (!options.includeDaySet) return out;

  for (let i = options.state.nextSetIndex; i < options.state.playlist.trackIds.length; i++) {
    const track = tracks.find((item) => item.id === options.state.playlist.trackIds[i]);
    if (!track) continue;
    const proposedAt = new Date(clock);
    const result = checkPlay({ track, proposedAt, history });
    if (!result.ok) continue;
    out.push(toExport(track, 'set'));
    history.push({ track, at: proposedAt });
    clock += Math.max(track.durationSec ?? 0, 1) * 1000;
  }

  return out;
}

/** Ordered remaining air — no clock times. Safe to hand to the operator; do not publish as a timed grid. */
export function exportOrderedTracks(state: StationState, now: Date, tracks: Track[] = catalog): ExportTrack[] {
  let cursor: StationState = {
    ...state,
    playlist: { ...state.playlist, trackIds: [...state.playlist.trackIds] },
    requests: state.requests.map((request) => ({ ...request })),
    plays: [...state.plays],
  };
  const out: ExportTrack[] = [];
  let clock = now.getTime();

  for (let i = 0; i < 80; i++) {
    const result = pickNext({ state: cursor, now: new Date(clock), tracks });
    if ('refused' in result) break;
    cursor = result.state;
    out.push(toExport(result.track, result.play.source));
    clock += Math.max(result.track.durationSec ?? 0, 1) * 1000;
  }

  return out;
}

export function toJsonExport(playlist: Playlist, tracks: ExportTrack[], scope: string): string {
  return `${JSON.stringify(
    {
      station: 'Bad Radio',
      note: 'Checklist for rebuilding order in the Live365 dashboard. Live365 cannot import M3U. Order only — not an advance timed playlist.',
      scope,
      playlist: { name: playlist.name, daypart: playlist.daypart },
      tracks,
    },
    null,
    2,
  )}\n`;
}

export function toM3u(tracks: ExportTrack[]): string {
  const lines = [
    '#EXTM3U',
    '# Bad Radio desk checklist. Live365 cannot import M3U — rebuild this order in their library UI.',
  ];
  for (const track of tracks) {
    const name = `${track.artist} - ${track.title}`;
    lines.push(`#EXTINF:${track.durationSec},${name}`);
    lines.push(track.audioUrl?.trim() || `# no audio_url — match this row in the Live365 media library`);
  }
  return `${lines.join('\n')}\n`;
}
