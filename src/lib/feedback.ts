import { toChicagoLocal } from './plays';

export const FEEDBACK_PREVIEW_QUERY = 'feedback';
export const FEEDBACK_PREVIEW_STORAGE = 'br_preview';
export const FEEDBACK_SESSION_STORAGE = 'br_feedback_session';

export const FEEDBACK_MESSAGE_MAX = 200;
export const FEEDBACK_VOTE_LIMIT_HOUR = 30;
export const FEEDBACK_MESSAGE_LIMIT_HOUR = 5;
export const FEEDBACK_MESSAGES_DEFAULT = 50;
export const FEEDBACK_MESSAGES_MAX = 200;

export const MESSAGE_KINDS = ['where_i_am', 'request', 'dedication'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  where_i_am: 'Where I am',
  request: 'Request',
  dedication: 'Dedication',
};

export type FeedbackVote = 1 | -1;

export type FeedbackGeo = {
  country: string | null;
  city: string | null;
};

export type FeedbackTrack = {
  artist: string;
  title: string;
  startedAt: string;
};

export function isMessageKind(value: string): value is MessageKind {
  return (MESSAGE_KINDS as readonly string[]).includes(value);
}

export function parseFeedbackVote(value: unknown): FeedbackVote | undefined {
  if (value === 1 || value === '1' || value === '+1' || value === 'up') return 1;
  if (value === -1 || value === '-1' || value === 'down') return -1;
  return undefined;
}

export function isValidSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

export function newFeedbackSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function feedbackNow(): { createdAt: string; createdCt: string } {
  const createdAt = new Date().toISOString();
  return { createdAt, createdCt: toChicagoLocal(createdAt) };
}

export function parsePreviewChoice(search: URLSearchParams, stored: string | null): boolean {
  const raw = (search.get('preview') ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'none') return false;
  if (raw === FEEDBACK_PREVIEW_QUERY) return true;
  return stored === FEEDBACK_PREVIEW_QUERY;
}

export function honeypotFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const SCRIPT_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAGS = /<\/?[^>]+>/g;
const ENTITIES = /&(#\d+|#x[0-9a-f]+|[a-z]+);/gi;
const LINK = /https?:\/\/|www\.|\/\/|\b[a-z0-9-]+\.(com|net|org|io|co|me|tv|xyz|info|gg)\b|\bt\.co\b/i;

export function stripHtml(value: string): string {
  return value
    .replace(SCRIPT_STYLE, ' ')
    .replace(TAGS, ' ')
    .replace(ENTITIES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasLink(value: string): boolean {
  return LINK.test(value);
}

/** Small station-side list — blocks obvious abuse, not a full moderator. */
const BAD_WORDS = [
  'nigger',
  'nigga',
  'faggot',
  'kike',
  'spic',
  'retard',
  'rape',
  'rapist',
  'porn',
  'onlyfans',
];

export function hasBadWord(value: string): boolean {
  const fold = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
  const tokens = new Set(fold.split(' ').filter(Boolean));
  return BAD_WORDS.some((word) => tokens.has(word));
}

export type CleanMessage =
  | { ok: true; kind: MessageKind; body: string }
  | { ok: false; error: string };

export function cleanMessage(kindRaw: unknown, bodyRaw: unknown): CleanMessage {
  const kind = typeof kindRaw === 'string' ? kindRaw.trim() : '';
  if (!isMessageKind(kind)) {
    return { ok: false, error: 'Pick where you are, a request, or a dedication.' };
  }
  const raw = typeof bodyRaw === 'string' ? bodyRaw : '';
  const body = stripHtml(raw);
  if (!body) return { ok: false, error: 'Write a short note first.' };
  if (body.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, error: `Keep it to ${FEEDBACK_MESSAGE_MAX} characters.` };
  }
  if (hasLink(body)) return { ok: false, error: 'No links, please — just a short note.' };
  if (hasBadWord(body)) return { ok: false, error: 'Please keep it friendly.' };
  return { ok: true, kind, body };
}

export const ENSURE_VOTES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at TEXT NOT NULL,
  vote INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_ct TEXT NOT NULL,
  country TEXT,
  city TEXT
)`;

export const ENSURE_VOTES_UNIQUE_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_session_track ON votes(session_id, artist, title, started_at)';

export const ENSURE_VOTES_CREATED_SQL = 'CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes(created_at)';

export const ENSURE_MESSAGES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  artist TEXT,
  title TEXT,
  started_at TEXT,
  created_at TEXT NOT NULL,
  created_ct TEXT NOT NULL,
  country TEXT,
  city TEXT
)`;

export const ENSURE_MESSAGES_CREATED_SQL = 'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)';
export const ENSURE_MESSAGES_KIND_SQL = 'CREATE INDEX IF NOT EXISTS idx_messages_kind ON messages(kind)';

export const UPSERT_VOTE_SQL = `INSERT INTO votes (
  session_id, artist, title, started_at, vote, created_at, created_ct, country, city
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id, artist, title, started_at) DO UPDATE SET
  vote = excluded.vote,
  created_at = excluded.created_at,
  created_ct = excluded.created_ct,
  country = excluded.country,
  city = excluded.city`;

export const INSERT_MESSAGE_SQL = `INSERT INTO messages (
  session_id, kind, body, artist, title, started_at, created_at, created_ct, country, city
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const SELECT_MINE_VOTE_SQL = `SELECT vote FROM votes
  WHERE session_id = ? AND artist = ? AND title = ? AND started_at = ?
  LIMIT 1`;

export function summaryVotesSql(artist?: string): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  let where = '';
  if (artist) {
    where = "WHERE LOWER(artist) LIKE '%' || LOWER(?) || '%'";
    values.push(artist);
  }
  return {
    sql: `SELECT artist, title, started_at AS startedAt,
        SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS up,
        SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down,
        SUM(vote) AS net,
        MAX(created_at) AS lastVoted
      FROM votes
      ${where}
      GROUP BY artist, title, started_at
      ORDER BY lastVoted DESC`,
    values,
  };
}

export function listMessagesSql(options: { kind?: MessageKind; limit: number }): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const where = options.kind ? 'WHERE kind = ?' : '';
  if (options.kind) values.push(options.kind);
  values.push(options.limit);
  return {
    sql: `SELECT id, kind, body, artist, title, started_at AS startedAt,
        created_at AS createdAt, created_ct AS createdCt, country, city
      FROM messages
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    values,
  };
}

export function parseMessageQuery(search: URLSearchParams): { kind?: MessageKind; limit: number } | { error: string } {
  const kindRaw = (search.get('kind') ?? '').trim();
  if (kindRaw && !isMessageKind(kindRaw)) return { error: 'kind must be where_i_am, request, or dedication' };
  let limit = FEEDBACK_MESSAGES_DEFAULT;
  const limitRaw = search.get('limit');
  if (limitRaw !== null && limitRaw.trim() !== '') {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 1) return { error: 'limit must be a positive number' };
    limit = Math.min(FEEDBACK_MESSAGES_MAX, Math.floor(n));
  }
  return {
    ...(kindRaw && isMessageKind(kindRaw) ? { kind: kindRaw } : {}),
    limit,
  };
}
