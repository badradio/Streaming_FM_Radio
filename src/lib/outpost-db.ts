import {
  planSignupUpsert,
  planUnsubscribe,
  type SignupParse,
  type SignupRow,
  type SignupStatus,
} from './outpost';
import { getMasterDb } from './radio/master-db';
import type { D1Like } from './runtime';

export async function getSignupDb(): Promise<D1Like | undefined> {
  return getMasterDb();
}

export async function signupTableReady(db: D1Like): Promise<boolean> {
  try {
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .bind('outpost_signups')
      .all<{ name: string }>();
    return results.some((row) => row.name === 'outpost_signups');
  } catch {
    return false;
  }
}

export async function signupHasSocialColumns(db: D1Like): Promise<boolean> {
  try {
    const { results } = await db
      .prepare('PRAGMA table_info(outpost_signups)')
      .bind()
      .all<{ name?: string }>();
    const names = new Set(results.map((row) => (typeof row.name === 'string' ? row.name : '')));
    return names.has('x_handle') && names.has('facebook_handle') && names.has('shoutout_ok');
  } catch {
    return false;
  }
}

export function upsertSignupSql(social: boolean): string {
  if (!social) {
    return `INSERT INTO outpost_signups (
        id, email, email_norm, name, source, status, consent_at, created_at, updated_at, unsub_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email_norm) DO UPDATE SET
        email = excluded.email,
        name = COALESCE(excluded.name, outpost_signups.name),
        source = excluded.source,
        status = 'subscribed',
        consent_at = excluded.consent_at,
        updated_at = excluded.updated_at`;
  }
  return `INSERT INTO outpost_signups (
        id, email, email_norm, name, source, status, consent_at, created_at, updated_at, unsub_token,
        x_handle, facebook_handle, shoutout_ok
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email_norm) DO UPDATE SET
        email = excluded.email,
        name = COALESCE(excluded.name, outpost_signups.name),
        source = excluded.source,
        status = 'subscribed',
        consent_at = excluded.consent_at,
        updated_at = excluded.updated_at,
        x_handle = COALESCE(excluded.x_handle, outpost_signups.x_handle),
        facebook_handle = COALESCE(excluded.facebook_handle, outpost_signups.facebook_handle),
        shoutout_ok = CASE
          WHEN excluded.shoutout_ok = 1 THEN 1
          ELSE outpost_signups.shoutout_ok
        END`;
}

export async function upsertSignup(
  db: D1Like,
  parsed: Extract<SignupParse, { ok: true }>,
  now: string,
  ids: { id: string; unsubToken: string },
): Promise<{ action: 'insert' | 'update'; row: SignupRow; socialColumns: boolean }> {
  const existing = await loadByEmail(db, parsed.emailNorm);
  const planned = planSignupUpsert(existing, parsed, now, ids);
  const social = await signupHasSocialColumns(db);
  try {
    await runUpsert(db, planned.row, social);
  } catch (error) {
    if (!social) throw error;
    // Columns vanished or Mark has not applied 0003 — keep the old insert path.
    await runUpsert(db, planned.row, false);
    return { action: planned.action, row: planned.row, socialColumns: false };
  }
  return { action: planned.action, row: planned.row, socialColumns: social };
}

async function runUpsert(db: D1Like, row: SignupRow, social: boolean): Promise<void> {
  const values: unknown[] = [
    row.id,
    row.email,
    row.emailNorm,
    row.name ?? null,
    row.source,
    row.status,
    row.consentAt,
    row.createdAt,
    row.updatedAt,
    row.unsubToken,
  ];
  if (social) {
    values.push(row.xHandle ?? null, row.facebookHandle ?? null, row.shoutoutOk ? 1 : 0);
  }
  await db.prepare(upsertSignupSql(social)).bind(...values).run();
}

export async function unsubscribeByToken(db: D1Like, token: string, now: string) {
  const existing = await loadByToken(db, token);
  const planned = planUnsubscribe(existing, now);
  if (!planned.ok) return planned;
  if (!planned.already) {
    await db
      .prepare(`UPDATE outpost_signups SET status = ?, updated_at = ? WHERE unsub_token = ?`)
      .bind('unsubscribed', now, token)
      .run();
  }
  return planned;
}

export async function listSignups(db: D1Like): Promise<SignupRow[]> {
  const social = await signupHasSocialColumns(db);
  const extra = social
    ? ', x_handle AS xHandle, facebook_handle AS facebookHandle, shoutout_ok AS shoutoutOk'
    : '';
  const { results } = await db
    .prepare(
      `SELECT id, email, email_norm AS emailNorm, name, source, status,
              consent_at AS consentAt, created_at AS createdAt, updated_at AS updatedAt,
              unsub_token AS unsubToken${extra}
       FROM outpost_signups ORDER BY created_at ASC`,
    )
    .bind()
    .all<Record<string, unknown>>();
  return results.flatMap((row) => {
    const mapped = mapRow(row);
    return mapped ? [mapped] : [];
  });
}

async function loadByEmail(db: D1Like, emailNorm: string): Promise<SignupRow | undefined> {
  return loadOne(db, 'email_norm', emailNorm);
}

async function loadByToken(db: D1Like, token: string): Promise<SignupRow | undefined> {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  return loadOne(db, 'unsub_token', trimmed);
}

async function loadOne(db: D1Like, column: 'email_norm' | 'unsub_token', value: string): Promise<SignupRow | undefined> {
  const social = await signupHasSocialColumns(db);
  const extra = social
    ? ', x_handle AS xHandle, facebook_handle AS facebookHandle, shoutout_ok AS shoutoutOk'
    : '';
  const { results } = await db
    .prepare(
      `SELECT id, email, email_norm AS emailNorm, name, source, status,
              consent_at AS consentAt, created_at AS createdAt, updated_at AS updatedAt,
              unsub_token AS unsubToken${extra}
       FROM outpost_signups WHERE ${column} = ? LIMIT 1`,
    )
    .bind(value)
    .all<Record<string, unknown>>();
  return mapRow(results[0]);
}

function mapRow(row: Record<string, unknown> | undefined): SignupRow | undefined {
  if (!row) return undefined;
  if (typeof row.id !== 'string' || typeof row.email !== 'string' || typeof row.emailNorm !== 'string') return undefined;
  if (typeof row.unsubToken !== 'string' || typeof row.source !== 'string') return undefined;
  if (typeof row.status !== 'string' || (row.status !== 'subscribed' && row.status !== 'unsubscribed')) return undefined;
  const status: SignupStatus = row.status;
  return {
    id: row.id,
    email: row.email,
    emailNorm: row.emailNorm,
    ...(typeof row.name === 'string' && row.name ? { name: row.name } : {}),
    source: row.source,
    status,
    consentAt: typeof row.consentAt === 'string' ? row.consentAt : '',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    unsubToken: row.unsubToken,
    ...(typeof row.xHandle === 'string' && row.xHandle ? { xHandle: row.xHandle } : {}),
    ...(typeof row.facebookHandle === 'string' && row.facebookHandle ? { facebookHandle: row.facebookHandle } : {}),
    shoutoutOk: row.shoutoutOk === 1 || row.shoutoutOk === true || row.shoutoutOk === '1',
  };
}
