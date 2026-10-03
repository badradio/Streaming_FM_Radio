const STREAM_HOST = 'streaming.live365.com';

/** Live365 station ids look like `a58480`. */
const STATION_ID = /^a[a-z0-9]+$/i;

export function live365StationId(options: { streamUrl?: string; override?: string }): string | undefined {
  const override = normalizeStationId(options.override);
  if (override) return override;
  return stationIdFromStreamUrl(options.streamUrl ?? '');
}

export function stationIdFromStreamUrl(streamUrl: string): string | undefined {
  const raw = streamUrl.trim();
  if (!raw) return undefined;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.hostname.toLowerCase() !== STREAM_HOST) return undefined;
      return mountFromPath(url.pathname);
    } catch {
      return undefined;
    }
  }

  if (raw.startsWith('/')) return mountFromPath(raw);
  return mountFromPath(`/${raw}`);
}

function mountFromPath(pathname: string): string | undefined {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) return undefined;
  return normalizeStationId(segment);
}

export function normalizeStationId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/_live$/i, '').replace(/_aac$/i, '');
  if (!STATION_ID.test(cleaned)) return undefined;
  return cleaned;
}
