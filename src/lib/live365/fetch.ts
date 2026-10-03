import { normalizeLive365Station, type Live365Result } from './normalize';

const LIVE365_STATION = 'https://api.live365.com/station';

export async function fetchLive365Station(stationId: string): Promise<Live365Result> {
  const url = `${LIVE365_STATION}/${encodeURIComponent(stationId)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return { ok: false, reason: 'unavailable', now: null, recent: [] };
    }
    const raw: unknown = await response.json();
    return normalizeLive365Station(raw);
  } catch {
    return { ok: false, reason: 'unavailable', now: null, recent: [] };
  }
}
