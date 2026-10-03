import { catalog, findTrack } from './catalog';
import { checkPlay, earliestPlayAt, findLegalSlot, listenerRejectCode } from './rules';
import type { Play, PlayEvent, Playlist, Request, RuleFail, StationState, Track } from './types';

const PLANNING_HORIZON_MS = 12 * 60 * 60 * 1000;

export function playEvents(state: StationState, tracks: Track[] = catalog): PlayEvent[] {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const fromPlays: PlayEvent[] = state.plays.flatMap((play) => {
    const track = byId.get(play.trackId);
    return track ? [{ track, at: new Date(play.playedAt) }] : [];
  });
  const fromScheduled: PlayEvent[] = state.requests.flatMap((request) => {
    if (request.status !== 'scheduled' || !request.scheduledAt) return [];
    const track = byId.get(request.trackId);
    return track ? [{ track, at: new Date(request.scheduledAt) }] : [];
  });
  return [...fromPlays, ...fromScheduled].sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function queueRequest(options: {
  state: StationState;
  trackQuery?: string;
  trackId?: string;
  requesterLabel: string;
  now: Date;
  tracks?: Track[];
  resolveTrack: (tracks: Track[], query: string) => Track | undefined;
}): { state: StationState; request: Request } | { state: StationState; request: Request; rejected: true } {
  const tracks = options.tracks ?? catalog;
  const label = options.requesterLabel.trim().slice(0, 40) || 'listener';
  const track = options.trackId
    ? tracks.find((item) => item.id === options.trackId)
    : options.trackQuery
      ? options.resolveTrack(tracks, options.trackQuery)
      : undefined;

  const requestedAt = options.now;
  const earliest = earliestPlayAt(requestedAt);
  const id = crypto.randomUUID();

  if (!track) {
    const request: Request = {
      id,
      trackId: options.trackId ?? '',
      requesterLabel: label,
      requestedAt: requestedAt.toISOString(),
      earliestPlayAt: earliest.toISOString(),
      status: 'rejected',
      rejectReason: 'unknown_track — not in the station catalog',
    };
    return { state: appendRequest(options.state, request), request, rejected: true };
  }

  const pendingSame = options.state.requests.some(
    (item) => item.trackId === track.id && (item.status === 'queued' || item.status === 'scheduled'),
  );
  if (pendingSame) {
    const request: Request = {
      id,
      trackId: track.id,
      requesterLabel: label,
      requestedAt: requestedAt.toISOString(),
      earliestPlayAt: earliest.toISOString(),
      status: 'rejected',
      rejectReason: 'too soon — that track is already waiting in the queue',
    };
    return { state: appendRequest(options.state, request), request, rejected: true };
  }

  const history = playEvents(options.state, tracks);
  const slot = findLegalSlot({
    track,
    earliest,
    history,
    horizon: new Date(earliest.getTime() + PLANNING_HORIZON_MS),
    request: { requestedAt },
  });

  if (!slot.at) {
    const code = listenerRejectCode(slot.reason.code);
    const request: Request = {
      id,
      trackId: track.id,
      requesterLabel: label,
      requestedAt: requestedAt.toISOString(),
      earliestPlayAt: earliest.toISOString(),
      status: 'rejected',
      rejectReason: `${code} — ${slot.reason.message}`,
    };
    return { state: appendRequest(options.state, request), request, rejected: true };
  }

  const request: Request = {
    id,
    trackId: track.id,
    requesterLabel: label,
    requestedAt: requestedAt.toISOString(),
    earliestPlayAt: earliest.toISOString(),
    status: 'queued',
  };
  return { state: appendRequest(options.state, request), request };
}

export function pickNext(options: {
  state: StationState;
  now: Date;
  tracks?: Track[];
}): { state: StationState; play: Play; track: Track } | { state: StationState; refused: RuleFail } {
  const tracks = options.tracks ?? catalog;
  const history = playEvents(options.state, tracks);

  const eligible = options.state.requests
    .filter((request) => request.status === 'queued' && new Date(request.earliestPlayAt).getTime() <= options.now.getTime())
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

  for (const request of eligible) {
    const track = tracks.find((item) => item.id === request.trackId);
    if (!track) continue;
    const result = checkPlay({
      track,
      proposedAt: options.now,
      history,
      request,
    });
    if (result.ok) {
      return applyPlay(options.state, track, options.now, 'request', request.id);
    }
  }

  const playlist = options.state.playlist;
  for (let i = options.state.nextSetIndex; i < playlist.trackIds.length; i++) {
    const track = tracks.find((item) => item.id === playlist.trackIds[i]);
    if (!track) continue;
    const result = checkPlay({ track, proposedAt: options.now, history });
    if (result.ok) {
      const applied = applyPlay(options.state, track, options.now, 'set');
      return {
        ...applied,
        state: { ...applied.state, nextSetIndex: i + 1 },
      };
    }
  }

  return {
    state: options.state,
    refused: {
      ok: false,
      code: 'no_legal_pick',
      message: 'AutoDJ refused — no set-list or queued track is legal at this time',
    },
  };
}

export function savePlaylist(state: StationState, playlist: Playlist): StationState {
  return {
    ...state,
    playlist: {
      id: playlist.id,
      name: playlist.name.trim() || 'Day set',
      daypart: playlist.daypart.trim() || 'day',
      trackIds: [...playlist.trackIds],
    },
    nextSetIndex: 0,
  };
}

export function rejectRequest(state: StationState, requestId: string, reason: string): StationState {
  return {
    ...state,
    requests: state.requests.map((request) =>
      request.id === requestId && (request.status === 'queued' || request.status === 'scheduled')
        ? { ...request, status: 'rejected', rejectReason: reason }
        : request,
    ),
  };
}

export function publicNow(state: StationState): { now: Track | null; recent: Track[] } {
  const ordered = [...state.plays].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const last = ordered.at(-1);
  const now = last ? (findTrack(last.trackId, state) ?? null) : null;
  const recent = ordered
    .slice(0, -1)
    .slice(-5)
    .reverse()
    .flatMap((play) => {
      const track = findTrack(play.trackId, state);
      return track ? [track] : [];
    });
  return { now, recent };
}

function appendRequest(state: StationState, request: Request): StationState {
  return { ...state, requests: [...state.requests, request] };
}

function applyPlay(
  state: StationState,
  track: Track,
  now: Date,
  source: Play['source'],
  requestId?: string,
): { state: StationState; play: Play; track: Track } {
  const play: Play = {
    id: crypto.randomUUID(),
    trackId: track.id,
    playedAt: now.toISOString(),
    source,
  };
  const requests = requestId
    ? state.requests.map((request) => (request.id === requestId ? { ...request, status: 'played' as const } : request))
    : state.requests;
  return {
    state: {
      ...state,
      plays: [...state.plays, play],
      requests,
    },
    play,
    track,
  };
}
