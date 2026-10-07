import { LIVE365_AAC, LIVE365_MP3 } from './stream-redirect';

export const STREAM_STORAGE_KEY = 'br_stream';
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_CAP_MS = 30_000;
export const STALL_CHECK_MS = 4_000;
export const STALL_FOR_MS = 8_000;

export type StreamId = 'aac' | 'mp3';
export type PlayerStatus = 'connecting' | 'onair' | 'paused' | 'reconnecting';

export const STREAMS: Record<StreamId, { id: StreamId; url: string; type: string; label: string }> = {
  aac: { id: 'aac', url: LIVE365_AAC, type: 'audio/aacp', label: 'aac 96k' },
  mp3: { id: 'mp3', url: LIVE365_MP3, type: 'audio/mpeg', label: 'mp3 192k' },
};

export type Clock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

const defaultClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => window.clearTimeout(id),
};

export function nextBackoffMs(prevMs: number): number {
  if (prevMs < BACKOFF_START_MS) return BACKOFF_START_MS;
  return Math.min(prevMs * 2, BACKOFF_CAP_MS);
}

export function cacheBust(url: string, now: number): string {
  const glue = url.includes('?') ? '&' : '?';
  return `${url}${glue}t=${now}`;
}

export function canPlayAac(audio: { canPlayType(type: string): string }): boolean {
  const types = ['audio/aacp', 'audio/aac'];
  return types.some((type) => {
    const result = audio.canPlayType(type);
    return result === 'probably' || result === 'maybe';
  });
}

export function resolveStreamId(stored: string | null | undefined, aacOk: boolean): StreamId {
  if (!aacOk) return 'mp3';
  if (stored === 'mp3' || stored === 'aac') return stored;
  return 'aac';
}

export function readStoredStream(storage: { getItem(key: string): string | null } | null | undefined): string | null {
  try {
    return storage?.getItem(STREAM_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredStream(
  storage: { setItem(key: string, value: string): void } | null | undefined,
  id: StreamId,
): void {
  try {
    storage?.setItem(STREAM_STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
}

export function stallDetected(input: {
  want: boolean;
  paused: boolean;
  currentTime: number;
  lastCurrentTime: number;
  lastAdvanceAt: number;
  now: number;
  stallForMs?: number;
}): { stalled: boolean; lastCurrentTime: number; lastAdvanceAt: number } {
  if (!input.want || input.paused) {
    return { stalled: false, lastCurrentTime: input.lastCurrentTime, lastAdvanceAt: input.lastAdvanceAt };
  }
  const advanced = input.currentTime > input.lastCurrentTime + 1e-4;
  if (advanced) {
    return { stalled: false, lastCurrentTime: input.currentTime, lastAdvanceAt: input.now };
  }
  const limit = input.stallForMs ?? STALL_FOR_MS;
  return {
    stalled: input.now - input.lastAdvanceAt >= limit,
    lastCurrentTime: input.lastCurrentTime,
    lastAdvanceAt: input.lastAdvanceAt,
  };
}

type WatchdogAudio = {
  src: string;
  paused: boolean;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener?(type: string, listener: () => void): void;
};

export class StreamWatchdog {
  want = false;
  backoffMs = BACKOFF_START_MS;
  private retryId: number | undefined;
  private stallId: number | undefined;
  private connecting = false;
  private lastCurrentTime = 0;
  private lastAdvanceAt = 0;
  private generation = 0;
  private readonly clock: Clock;

  constructor(
    private readonly audio: WatchdogAudio,
    private readonly options: {
      getUrl: () => string;
      clock?: Clock;
      onStatus?: (status: PlayerStatus) => void;
      onWant?: (want: boolean) => void;
    },
  ) {
    this.clock = options.clock ?? defaultClock;
  }

  bind(): void {
    const events = ['playing', 'waiting', 'error', 'ended', 'stalled', 'emptied', 'pause'] as const;
    for (const event of events) {
      this.audio.addEventListener?.(event, () => this.notify(event));
    }
  }

  start(): void {
    this.want = true;
    this.backoffMs = BACKOFF_START_MS;
    this.generation += 1;
    this.clearRetry();
    this.options.onWant?.(true);
    this.connect();
    this.ensureStallLoop();
  }

  pause(): void {
    this.want = false;
    this.connecting = false;
    this.generation += 1;
    this.clearRetry();
    this.clearStall();
    this.options.onWant?.(false);
    this.audio.pause();
    this.options.onStatus?.('paused');
  }

  notify(event: 'playing' | 'waiting' | 'error' | 'ended' | 'stalled' | 'emptied' | 'pause'): void {
    if (event === 'playing') {
      this.connecting = false;
      this.backoffMs = BACKOFF_START_MS;
      this.lastCurrentTime = this.audio.currentTime;
      this.lastAdvanceAt = this.clock.now();
      if (this.want) this.options.onStatus?.('onair');
      return;
    }
    if (event === 'waiting') {
      if (this.want && !this.connecting) this.options.onStatus?.('connecting');
      return;
    }
    if (event === 'pause') return;
    if (!this.want || this.connecting) return;
    if (event === 'error' || event === 'ended' || event === 'stalled' || event === 'emptied') {
      this.scheduleRetry();
    }
  }

  checkStall(): boolean {
    const result = stallDetected({
      want: this.want,
      paused: this.audio.paused,
      currentTime: this.audio.currentTime,
      lastCurrentTime: this.lastCurrentTime,
      lastAdvanceAt: this.lastAdvanceAt,
      now: this.clock.now(),
    });
    this.lastCurrentTime = result.lastCurrentTime;
    this.lastAdvanceAt = result.lastAdvanceAt;
    if (result.stalled) this.scheduleRetry();
    return result.stalled;
  }

  private connect(): void {
    if (!this.want) return;
    this.clearRetry();
    this.connecting = true;
    this.lastCurrentTime = 0;
    this.lastAdvanceAt = this.clock.now();
    this.options.onStatus?.('connecting');
    const gen = this.generation;
    this.audio.src = cacheBust(this.options.getUrl(), this.clock.now());
    this.audio.load();
    void this.audio.play().then(
      () => {
        if (gen !== this.generation) return;
        this.connecting = false;
      },
      () => {
        if (gen !== this.generation || !this.want) return;
        this.connecting = false;
        this.scheduleRetry();
      },
    );
  }

  private scheduleRetry(): void {
    if (!this.want) return;
    this.options.onStatus?.('reconnecting');
    this.clearRetry();
    const wait = this.backoffMs;
    this.backoffMs = nextBackoffMs(this.backoffMs);
    this.retryId = this.clock.setTimeout(() => {
      this.retryId = undefined;
      this.connect();
    }, wait);
  }

  private ensureStallLoop(): void {
    if (this.stallId !== undefined) return;
    const tick = () => {
      this.stallId = this.clock.setTimeout(() => {
        this.stallId = undefined;
        if (!this.want) return;
        this.checkStall();
        if (this.want) tick();
      }, STALL_CHECK_MS);
    };
    tick();
  }

  private clearRetry(): void {
    if (this.retryId === undefined) return;
    this.clock.clearTimeout(this.retryId);
    this.retryId = undefined;
  }

  private clearStall(): void {
    if (this.stallId === undefined) return;
    this.clock.clearTimeout(this.stallId);
    this.stallId = undefined;
  }
}
