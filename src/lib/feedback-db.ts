import { asMasterDb } from './radio/master-db';
import type { D1Like } from './runtime';
import {
  ENSURE_MESSAGES_CREATED_SQL,
  ENSURE_MESSAGES_KIND_SQL,
  ENSURE_MESSAGES_TABLE_SQL,
  ENSURE_VOTES_CREATED_SQL,
  ENSURE_VOTES_TABLE_SQL,
  ENSURE_VOTES_UNIQUE_SQL,
  INSERT_MESSAGE_SQL,
  SELECT_MINE_VOTE_SQL,
  UPSERT_VOTE_SQL,
  listMessagesSql,
  summaryVotesSql,
  type FeedbackGeo,
  type FeedbackTrack,
  type FeedbackVote,
  type MessageKind,
} from './feedback';

export async function getFeedbackDb(): Promise<D1Like | undefined> {
  const { workerEnv } = await import('./runtime');
  const env = await workerEnv();
  return asMasterDb(env?.MASTER);
}

export async function ensureFeedbackTables(db: D1Like): Promise<void> {
  await db.prepare(ENSURE_VOTES_TABLE_SQL).bind().run();
  await db.prepare(ENSURE_VOTES_UNIQUE_SQL).bind().run();
  await db.prepare(ENSURE_VOTES_CREATED_SQL).bind().run();
  await db.prepare(ENSURE_MESSAGES_TABLE_SQL).bind().run();
  await db.prepare(ENSURE_MESSAGES_CREATED_SQL).bind().run();
  await db.prepare(ENSURE_MESSAGES_KIND_SQL).bind().run();
}

export async function upsertVote(
  db: D1Like,
  input: {
    sessionId: string;
    track: FeedbackTrack;
    vote: FeedbackVote;
    createdAt: string;
    createdCt: string;
    geo: FeedbackGeo;
  },
): Promise<void> {
  await ensureFeedbackTables(db);
  await db
    .prepare(UPSERT_VOTE_SQL)
    .bind(
      input.sessionId,
      input.track.artist,
      input.track.title,
      input.track.startedAt,
      input.vote,
      input.createdAt,
      input.createdCt,
      input.geo.country,
      input.geo.city,
    )
    .run();
}

export async function insertMessage(
  db: D1Like,
  input: {
    sessionId: string;
    kind: MessageKind;
    body: string;
    track: FeedbackTrack | null;
    createdAt: string;
    createdCt: string;
    geo: FeedbackGeo;
  },
): Promise<void> {
  await ensureFeedbackTables(db);
  await db
    .prepare(INSERT_MESSAGE_SQL)
    .bind(
      input.sessionId,
      input.kind,
      input.body,
      input.track?.artist ?? null,
      input.track?.title ?? null,
      input.track?.startedAt ?? null,
      input.createdAt,
      input.createdCt,
      input.geo.country,
      input.geo.city,
    )
    .run();
}

export async function readMineVote(
  db: D1Like,
  sessionId: string,
  track: FeedbackTrack,
): Promise<FeedbackVote | null> {
  await ensureFeedbackTables(db);
  const { results } = await db
    .prepare(SELECT_MINE_VOTE_SQL)
    .bind(sessionId, track.artist, track.title, track.startedAt)
    .all<{ vote: number }>();
  const vote = results[0]?.vote;
  return vote === 1 || vote === -1 ? vote : null;
}

export type VoteSummaryRow = {
  artist: string;
  title: string;
  startedAt: string;
  up: number;
  down: number;
  net: number;
  lastVoted: string;
};

export async function listVoteSummary(db: D1Like, artist?: string): Promise<VoteSummaryRow[]> {
  await ensureFeedbackTables(db);
  const { sql, values } = summaryVotesSql(artist);
  const { results } = await db.prepare(sql).bind(...values).all<Record<string, unknown>>();
  return results.map((row) => ({
    artist: String(row.artist ?? ''),
    title: String(row.title ?? ''),
    startedAt: String(row.startedAt ?? ''),
    up: Number(row.up ?? 0),
    down: Number(row.down ?? 0),
    net: Number(row.net ?? 0),
    lastVoted: String(row.lastVoted ?? ''),
  }));
}

export type StoredMessage = {
  id: number;
  kind: string;
  body: string;
  artist: string | null;
  title: string | null;
  startedAt: string | null;
  createdAt: string;
  createdCt: string;
  country: string | null;
  city: string | null;
};

export async function listMessages(
  db: D1Like,
  options: { kind?: MessageKind; limit: number },
): Promise<StoredMessage[]> {
  await ensureFeedbackTables(db);
  const { sql, values } = listMessagesSql(options);
  const { results } = await db.prepare(sql).bind(...values).all<Record<string, unknown>>();
  return results.map((row) => ({
    id: Number(row.id),
    kind: String(row.kind ?? ''),
    body: String(row.body ?? ''),
    artist: typeof row.artist === 'string' && row.artist ? row.artist : null,
    title: typeof row.title === 'string' && row.title ? row.title : null,
    startedAt: typeof row.startedAt === 'string' && row.startedAt ? row.startedAt : null,
    createdAt: String(row.createdAt ?? ''),
    createdCt: String(row.createdCt ?? ''),
    country: typeof row.country === 'string' && row.country ? row.country : null,
    city: typeof row.city === 'string' && row.city ? row.city : null,
  }));
}
