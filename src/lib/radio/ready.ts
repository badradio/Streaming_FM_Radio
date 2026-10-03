import { catalog, getTrack } from './catalog';
import { checkPlay } from './rules';
import { playEvents } from './autodj';
import type { PlayEvent, Request, StationState, Track } from './types';

export type QueueInspection = {
  request: Request;
  track: Track | null;
  ready: boolean;
  blocked?: { code: string; message: string; delayRemainingMs?: number };
};

/** Queued/scheduled requests: ready if the hour has elapsed and SRPC passes against current air history. */
export function inspectQueue(options: {
  state: StationState;
  now: Date;
  tracks?: Track[];
  extraHistory?: PlayEvent[];
}): QueueInspection[] {
  const tracks = options.tracks ?? catalog;
  const history = [...playEvents(options.state, tracks), ...(options.extraHistory ?? [])].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );

  const pending = options.state.requests
    .filter((request) => request.status === 'queued' || request.status === 'scheduled')
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

  const out: QueueInspection[] = [];
  let clock = options.now.getTime();

  for (const request of pending) {
    const proposedAt = new Date(clock);
    const inspection = inspectOne(request, options.now, proposedAt, history, tracks);
    out.push(inspection);
    if (inspection.ready && inspection.track) {
      history.push({ track: inspection.track, at: proposedAt });
      clock += Math.max(inspection.track.durationSec ?? 0, 1) * 1000;
    }
  }

  return out;
}

export function readyRequests(inspections: QueueInspection[]): Array<QueueInspection & { track: Track; ready: true }> {
  return inspections.filter((item): item is QueueInspection & { track: Track; ready: true } => item.ready && !!item.track);
}

function inspectOne(
  request: Request,
  now: Date,
  proposedAt: Date,
  history: PlayEvent[],
  tracks: Track[],
): QueueInspection {
  const track = tracks.find((item) => item.id === request.trackId) ?? getTrack(request.trackId) ?? null;
  if (!track) {
    return {
      request,
      track: null,
      ready: false,
      blocked: { code: 'unknown_track', message: 'unknown_track — not in the station catalog' },
    };
  }

  const earliest = new Date(request.earliestPlayAt).getTime();
  if (now.getTime() < earliest) {
    const delayRemainingMs = earliest - now.getTime();
    const minutes = Math.max(1, Math.ceil(delayRemainingMs / 60_000));
    return {
      request,
      track,
      ready: false,
      blocked: {
        code: 'too_soon',
        message: `too soon — ${minutes} min left on the one-hour delay`,
        delayRemainingMs,
      },
    };
  }

  const result = checkPlay({
    track,
    proposedAt,
    history,
    request,
  });
  if (!result.ok) {
    return {
      request,
      track,
      ready: false,
      blocked: { code: result.code, message: result.message },
    };
  }

  return { request, track, ready: true };
}
