export type D1Like = {
  prepare(query: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
  };
  batch<T = unknown>(statements: unknown[]): Promise<T[]>;
};

export type WorkerEnv = {
  STATION?: KVNamespace;
  MASTER?: D1Like | string;
  ADMIN_PASSWORD?: string;
  PUBLIC_STREAM_URL?: string;
  LIVE365_STATION_ID?: string;
  PUBLIC_CF_BEACON_TOKEN?: string;
  PUBLIC_GA_MEASUREMENT_ID?: string;
  RESEND_API_KEY?: string;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
};

/** Astro 7 / Cloudflare: use importable env, not locals.runtime.env. */
export async function workerEnv(): Promise<WorkerEnv | undefined> {
  try {
    const mod = await import('cloudflare:workers');
    return mod.env;
  } catch {
    return undefined;
  }
}

/** Dashboard plaintext var first; Vite build-time env is only a local fallback. */
export async function getPublicStreamUrl(): Promise<string> {
  const env = await workerEnv();
  const fromRuntime = typeof env?.PUBLIC_STREAM_URL === 'string' ? env.PUBLIC_STREAM_URL.trim() : '';
  if (fromRuntime) return fromRuntime;
  const fromMeta = typeof import.meta.env.PUBLIC_STREAM_URL === 'string' ? import.meta.env.PUBLIC_STREAM_URL.trim() : '';
  return fromMeta;
}
