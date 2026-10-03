/** Station programming types. Catalog lives in git; queue/plays persist at runtime. */

export type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  year?: number;
  isrc?: string;
  durationSec?: number;
  audioUrl?: string;
};

/** Harvested Live365 on-air metadata. Unique by folded artist/title match key — not a library sync. */
export type AirLogEntry = {
  key: string;
  artist: string;
  title: string;
  art?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  plays: number;
  promotedTrackId?: string;
};

export type Playlist = {
  id: string;
  name: string;
  daypart: string;
  trackIds: string[];
};

export type RequestStatus = 'queued' | 'scheduled' | 'played' | 'rejected';

export type Request = {
  id: string;
  trackId: string;
  requesterLabel: string;
  requestedAt: string;
  earliestPlayAt: string;
  status: RequestStatus;
  rejectReason?: string;
  scheduledAt?: string;
};

export type PlaySource = 'set' | 'request' | 'autodj';

export type Play = {
  id: string;
  trackId: string;
  playedAt: string;
  source: PlaySource;
};

export type PlayEvent = {
  track: Track;
  at: Date;
};

export type StationState = {
  playlist: Playlist;
  nextSetIndex: number;
  requests: Request[];
  plays: Play[];
  airLog: Record<string, AirLogEntry>;
  promotedTracks: Track[];
};

export type RuleCode =
  | 'too_soon'
  | 'album_cap'
  | 'album_consecutive'
  | 'artist_cap'
  | 'artist_consecutive'
  | 'unknown_track'
  | 'already_queued'
  | 'no_slot'
  | 'no_legal_pick';

export type RuleOk = { ok: true };
export type RuleFail = { ok: false; code: RuleCode; message: string };
export type RuleResult = RuleOk | RuleFail;
