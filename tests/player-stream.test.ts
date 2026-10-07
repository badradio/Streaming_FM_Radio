import { describe, expect, it } from 'vitest';
import { LIVE365_AAC, LIVE365_MP3 } from '../src/lib/stream-redirect';
import {
  BACKOFF_CAP_MS,
  BACKOFF_START_MS,
  STREAM_STORAGE_KEY,
  STREAMS,
  STALL_FOR_MS,
  StreamWatchdog,
  cacheBust,
  canPlayAac,
  nextBackoffMs,
  readStoredStream,
  resolveStreamId,
  stallDetected,
  writeStoredStream,
} from '../src/lib/player-stream';

describe('stream picker', () => {
  it('defaults to AAC 96k and falls back to MP3 when AAC cannot play', () => {
    expect(STREAMS.aac.url).toBe(LIVE365_AAC);
    expect(STREAMS.aac.type).toBe('audio/aacp');
    expect(STREAMS.mp3.url).toBe(LIVE365_MP3);
    expect(resolveStreamId(null, true)).toBe('aac');
    expect(resolveStreamId('mp3', true)).toBe('mp3');
    expect(resolveStreamId('aac', false)).toBe('mp3');
    expect(canPlayAac({ canPlayType: (type) => (type === 'audio/aacp' ? 'maybe' : '') })).toBe(true);
    expect(canPlayAac({ canPlayType: () => '' })).toBe(false);
  });

  it('remembers the choice under br_stream', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    };
    writeStoredStream(storage, 'mp3');
    expect(store[STREAM_STORAGE_KEY]).toBe('mp3');
    expect(readStoredStream(storage)).toBe('mp3');
  });
});

describe('reconnect backoff', () => {
  it('steps 1, 2, 4 seconds and caps at 30', () => {
    const steps = [0];
    let delay = 0;
    for (let i = 0; i < 8; i += 1) {
      delay = nextBackoffMs(delay);
      steps.push(delay);
    }
    expect(steps.slice(1, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(nextBackoffMs(16_000)).toBe(BACKOFF_CAP_MS);
    expect(nextBackoffMs(BACKOFF_CAP_MS)).toBe(BACKOFF_CAP_MS);
    expect(BACKOFF_START_MS).toBe(1_000);
  });
});

describe('stall detection', () => {
  it('fires after 8s without currentTime advancing while want and not paused', () => {
    const base = {
      want: true,
      paused: false,
      currentTime: 12,
      lastCurrentTime: 12,
      lastAdvanceAt: 1_000,
      now: 1_000 + STALL_FOR_MS,
    };
    expect(stallDetected(base).stalled).toBe(true);
    expect(stallDetected({ ...base, now: 1_000 + 7_999 }).stalled).toBe(false);
    expect(stallDetected({ ...base, paused: true }).stalled).toBe(false);
    expect(stallDetected({ ...base, want: false }).stalled).toBe(false);
    expect(stallDetected({ ...base, currentTime: 12.5 }).stalled).toBe(false);
    expect(stallDetected({ ...base, currentTime: 12.5 }).lastAdvanceAt).toBe(base.now);
  });
});

describe('cache-bust and watchdog', () => {
  it('appends a time query without breaking an existing query', () => {
    expect(cacheBust('https://streaming.live365.com/a58480_2', 99)).toBe(
      'https://streaming.live365.com/a58480_2?t=99',
    );
    expect(cacheBust('https://example.com/s?x=1', 7)).toBe('https://example.com/s?x=1&t=7');
  });

  it('does not set src until start, retries play reject with backoff, ignores emptied while connecting', () => {
    const timers = new Map<number, { fn: () => void; ms: number }>();
    let nextId = 1;
    let now = 10_000;
    const clock = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id: number) => {
        timers.delete(id);
      },
    };
    const flush = (id: number) => {
      const timer = timers.get(id);
      timers.delete(id);
      timer?.fn();
    };

    let playImpl: () => Promise<void> = () => Promise.reject(new Error('dead'));
    const audio = {
      src: '',
      paused: true,
      currentTime: 0,
      play: () => playImpl(),
      pause: () => {
        audio.paused = true;
      },
      load: () => {
        watchdog.notify('emptied');
      },
    };
    const statuses: string[] = [];
    const watchdog = new StreamWatchdog(audio, {
      getUrl: () => LIVE365_AAC,
      clock,
      onStatus: (status) => statuses.push(status),
    });

    expect(audio.src).toBe('');
    watchdog.start();
    expect(audio.src).toContain('t=10000');
    expect(watchdog.want).toBe(true);
    expect(statuses).toContain('connecting');

    return Promise.resolve()
      .then(() => {
        expect(statuses).toContain('reconnecting');
        expect(watchdog.backoffMs).toBe(2_000);
        const retry = [...timers.values()].find((timer) => timer.ms === 1_000);
        expect(retry).toBeTruthy();
        playImpl = () => {
          audio.paused = false;
          return Promise.resolve();
        };
        now = 11_000;
        flush([...timers.entries()].find(([, timer]) => timer.ms === 1_000)?.[0] ?? 0);
        expect(audio.src).toContain('t=11000');
        watchdog.notify('playing');
        expect(watchdog.backoffMs).toBe(BACKOFF_START_MS);
        expect(statuses.at(-1)).toBe('onair');

        audio.paused = false;
        audio.currentTime = 3;
        watchdog.notify('playing');
        now += STALL_FOR_MS;
        expect(watchdog.checkStall()).toBe(true);
        expect(statuses.at(-1)).toBe('reconnecting');

        watchdog.pause();
        expect(watchdog.want).toBe(false);
        expect(statuses.at(-1)).toBe('paused');
      });
  });
});
