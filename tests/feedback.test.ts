import { describe, expect, it } from 'vitest';
import { isNowPlayingPath, isFeedbackWritePath, corsPreflight } from '../src/lib/embed-origins';
import {
  ENSURE_VOTES_TABLE_SQL,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PREVIEW_QUERY,
  UPSERT_VOTE_SQL,
  cleanMessage,
  hasBadWord,
  hasLink,
  honeypotFilled,
  isValidSessionId,
  listMessagesSql,
  parseFeedbackVote,
  parseMessageQuery,
  parsePreviewChoice,
  stripHtml,
  summaryVotesSql,
} from '../src/lib/feedback';
import { feedbackAdminKeyMatches, readFeedbackAdminKey } from '../src/lib/feedback-auth';
import { allowFeedbackHit, rateKeys } from '../src/lib/feedback-rate';
import { clientIp, feedbackGeoFromRequest, hashClientIp } from '../src/lib/feedback-request';

describe('preview flag', () => {
  it('turns on only for ?preview=feedback and remembers that stored choice', () => {
    expect(parsePreviewChoice(new URLSearchParams('preview=feedback'), null)).toBe(true);
    expect(parsePreviewChoice(new URLSearchParams(''), FEEDBACK_PREVIEW_QUERY)).toBe(true);
    expect(parsePreviewChoice(new URLSearchParams('preview=off'), FEEDBACK_PREVIEW_QUERY)).toBe(false);
    expect(parsePreviewChoice(new URLSearchParams('preview=0'), FEEDBACK_PREVIEW_QUERY)).toBe(false);
    expect(parsePreviewChoice(new URLSearchParams('preview=none'), FEEDBACK_PREVIEW_QUERY)).toBe(false);
    expect(parsePreviewChoice(new URLSearchParams(''), null)).toBe(false);
    expect(parsePreviewChoice(new URLSearchParams('preview=widget'), null)).toBe(false);
  });
});

describe('votes', () => {
  it('parses thumbs up and down only', () => {
    expect(parseFeedbackVote(1)).toBe(1);
    expect(parseFeedbackVote('1')).toBe(1);
    expect(parseFeedbackVote('+1')).toBe(1);
    expect(parseFeedbackVote('up')).toBe(1);
    expect(parseFeedbackVote(-1)).toBe(-1);
    expect(parseFeedbackVote('-1')).toBe(-1);
    expect(parseFeedbackVote('down')).toBe(-1);
    expect(parseFeedbackVote(0)).toBeUndefined();
    expect(parseFeedbackVote(2)).toBeUndefined();
    expect(parseFeedbackVote('maybe')).toBeUndefined();
  });

  it('requires a 16–64 character anonymous session id', () => {
    expect(isValidSessionId('a'.repeat(16))).toBe(true);
    expect(isValidSessionId('abc-DEF_0123456789')).toBe(true);
    expect(isValidSessionId('short')).toBe(false);
    expect(isValidSessionId('a'.repeat(65))).toBe(false);
    expect(isValidSessionId('not valid spaces!!')).toBe(false);
  });

  it('uniques a vote per session + artist + title + started_at and replaces on conflict', () => {
    expect(ENSURE_VOTES_TABLE_SQL).toMatch(/CREATE TABLE IF NOT EXISTS votes/);
    expect(ENSURE_VOTES_TABLE_SQL).toMatch(/session_id/);
    expect(ENSURE_VOTES_TABLE_SQL).toMatch(/started_at/);
    expect(ENSURE_VOTES_TABLE_SQL).not.toMatch(/ip/i);
    expect(UPSERT_VOTE_SQL).toMatch(/ON CONFLICT\(session_id, artist, title, started_at\)/);
    expect(UPSERT_VOTE_SQL).toMatch(/vote = excluded\.vote/);
  });

  it('groups summary by airing, newest lastVoted first', () => {
    const { sql, values } = summaryVotesSql('Taylor');
    expect(sql).toMatch(/SUM\(CASE WHEN vote = 1/);
    expect(sql).toMatch(/SUM\(CASE WHEN vote = -1/);
    expect(sql).toMatch(/SUM\(vote\) AS net/);
    expect(sql).toMatch(/MAX\(created_at\) AS lastVoted/);
    expect(sql).toMatch(/GROUP BY artist, title, started_at/);
    expect(sql).toMatch(/ORDER BY lastVoted DESC/);
    expect(sql).toMatch(/LOWER\(artist\) LIKE/);
    expect(values).toEqual(['Taylor']);
    expect(summaryVotesSql().values).toEqual([]);
  });
});

describe('messages', () => {
  it('treats a filled honeypot as a bot', () => {
    expect(honeypotFilled('https://spam.test')).toBe(true);
    expect(honeypotFilled('  ')).toBe(false);
    expect(honeypotFilled('')).toBe(false);
    expect(honeypotFilled(undefined)).toBe(false);
  });

  it('strips HTML, rejects links, and keeps notes to 200 characters', () => {
    expect(stripHtml('<b>Chicago</b> &amp; home')).toBe('Chicago home');
    expect(hasLink('see https://evil.test')).toBe(true);
    expect(hasLink('www.spam.test/x')).toBe(true);
    expect(hasLink('click example.com later')).toBe(true);
    expect(hasLink('Listening from Chicago')).toBe(false);

    expect(cleanMessage('where_i_am', 'Chicago tonight')).toEqual({
      ok: true,
      kind: 'where_i_am',
      body: 'Chicago tonight',
    });
    expect(cleanMessage('request', '<script>alert(1)</script>Play Fire And Rain')).toMatchObject({
      ok: true,
      body: 'Play Fire And Rain',
    });
    expect(cleanMessage('dedication', 'For Jan — https://x.test').ok).toBe(false);
    expect(cleanMessage('request', 'x'.repeat(FEEDBACK_MESSAGE_MAX + 1)).ok).toBe(false);
    expect(cleanMessage('shout', 'Hello').ok).toBe(false);
    expect(cleanMessage('where_i_am', '   ').ok).toBe(false);
  });

  it('filters obvious slurs as whole tokens, not substrings', () => {
    expect(hasBadWord('this is porn')).toBe(true);
    expect(hasBadWord('grape harvest')).toBe(false);
    expect(hasBadWord('scrape the mix')).toBe(false);
    expect(cleanMessage('dedication', 'Please keep it porn free').ok).toBe(false);
    expect(cleanMessage('dedication', 'Please keep it friendly').ok).toBe(true);
  });

  it('filters recent notes by kind and clamps limit', () => {
    const parsed = parseMessageQuery(new URLSearchParams('kind=request&limit=9'));
    expect(parsed).toEqual({ kind: 'request', limit: 9 });
    expect(parseMessageQuery(new URLSearchParams('limit=999'))).toEqual({ limit: 200 });
    expect(parseMessageQuery(new URLSearchParams('kind=spam'))).toMatchObject({ error: expect.stringMatching(/kind/) });
    const { sql, values } = listMessagesSql({ kind: 'dedication', limit: 20 });
    expect(sql).toMatch(/WHERE kind = \?/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(values).toEqual(['dedication', 20]);
  });
});

describe('rate limits', () => {
  it('keys session and hashed IP windows, never a raw address', () => {
    const keys = rateKeys('vote', 'session-aaaaaaaa', 'deadbeef'.repeat(4));
    expect(keys).toEqual([
      'fb:rl:vote:s:session-aaaaaaaa',
      `fb:rl:vote:ip:${'deadbeef'.repeat(4)}`,
    ]);
    expect(keys.join(' ')).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('allows 30 votes and 5 messages per hour per key', async () => {
    const store = new Map<string, string>();
    const kv = {
      async get(key: string, type: 'json') {
        expect(type).toBe('json');
        const raw = store.get(key);
        return raw ? JSON.parse(raw) : null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    };

    for (let i = 0; i < 30; i++) {
      expect(await allowFeedbackHit(kv, 'vote', 'session-bbbbbbbbbbbb', 'abcd'.repeat(8))).toBe(true);
    }
    expect(await allowFeedbackHit(kv, 'vote', 'session-bbbbbbbbbbbb', 'abcd'.repeat(8))).toBe(false);

    for (let i = 0; i < 5; i++) {
      expect(await allowFeedbackHit(kv, 'message', 'session-cccccccccccc', null)).toBe(true);
    }
    expect(await allowFeedbackHit(kv, 'message', 'session-cccccccccccc', null)).toBe(false);
    expect(await allowFeedbackHit(undefined, 'message', 'session-dddddddddddd', null)).toBe(true);
  });
});

describe('geo and IP hash', () => {
  it('reads country and city from request.cf only', () => {
    const request = new Request('https://badradio.rocks/api/feedback/vote', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'x-real-ip': '198.51.100.4',
        'x-forwarded-for': '203.0.113.9',
      },
    });
    (request as Request & { cf?: { country?: string; city?: string } }).cf = {
      country: 'US',
      city: 'Chicago',
    };
    expect(feedbackGeoFromRequest(request)).toEqual({ country: 'US', city: 'Chicago' });
    expect(feedbackGeoFromRequest(new Request('https://badradio.rocks/'))).toEqual({
      country: null,
      city: null,
    });
    expect(JSON.stringify(feedbackGeoFromRequest(request))).not.toContain('203.0.113.9');
  });

  it('hashes the connecting IP and never returns the raw address', async () => {
    const request = new Request('https://badradio.rocks/api/feedback/vote', {
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(clientIp(request)).toBe('203.0.113.9');
    const hash = await hashClientIp(request);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain('203.0.113.9');
  });
});

describe('admin key', () => {
  it('reads the key from header, bearer, or query and never echoes it', async () => {
    const expected = 'test-feedback-admin-key-aaaa';
    expect(
      readFeedbackAdminKey(
        new Request('https://badradio.rocks/api/feedback/summary', {
          headers: { 'x-feedback-key': expected },
        }),
      ),
    ).toBe(expected);
    expect(
      readFeedbackAdminKey(
        new Request('https://badradio.rocks/api/feedback/summary', {
          headers: { authorization: `Bearer ${expected}` },
        }),
      ),
    ).toBe(expected);
    expect(
      readFeedbackAdminKey(new Request(`https://badradio.rocks/api/feedback/summary?key=${expected}`)),
    ).toBe(expected);

    expect(await feedbackAdminKeyMatches(expected, expected)).toBe(true);
    expect(await feedbackAdminKeyMatches('nope', expected)).toBe(false);
    expect(await feedbackAdminKeyMatches('', expected)).toBe(false);
  });
});

describe('existing surfaces stay separate', () => {
  it('does not treat now-playing as a feedback write path', () => {
    expect(isNowPlayingPath('/api/now-playing')).toBe(true);
    expect(isFeedbackWritePath('/api/now-playing')).toBe(false);
    expect(isFeedbackWritePath('/api/feedback/vote')).toBe(true);
    expect(isFeedbackWritePath('/api/feedback/message')).toBe(true);
    expect(isFeedbackWritePath('/api/feedback/summary')).toBe(false);
    expect(isFeedbackWritePath('/api/feedback/messages')).toBe(false);
  });

  it('answers widget CORS preflight for POST votes', () => {
    const ok = corsPreflight(
      new Request('https://badradio.rocks/api/feedback/vote', {
        method: 'OPTIONS',
        headers: { Origin: 'https://badradio.com' },
      }),
      'GET, POST, OPTIONS',
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Methods')).toMatch(/POST/);
  });
});
