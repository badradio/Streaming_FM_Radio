import { workerEnv } from './runtime';

export const ANALYTICS_EVENTS = ['play_click', 'signup_submit'] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsConfig = {
  beaconToken?: string;
  gaMeasurementId?: string;
};

export function isAnalyticsEvent(name: string): name is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

function looksLikeSnippet(value: string): boolean {
  return /<script/i.test(value) || /data-cf-beacon/i.test(value);
}

/** Pull the hex token out of a pasted Web Analytics `<script>` blob. */
export function extractBeaconTokenFromSnippet(value: string): string | undefined {
  const attr = value.match(/data-cf-beacon\s*=\s*(['"])([\s\S]*?)\1/i);
  if (attr?.[2]) {
    const payload = attr[2].replace(/&quot;/g, '"').replace(/&#34;/g, '"');
    try {
      const parsed = JSON.parse(payload) as { token?: unknown };
      if (typeof parsed.token === 'string' && parsed.token.trim()) return parsed.token.trim();
    } catch {
      /* fall through to hex scan */
    }
    const fromAttr = payload.match(/[A-Fa-f0-9]{16,64}/);
    if (fromAttr) return fromAttr[0];
  }
  const jsonToken = value.match(/["']token["']\s*:\s*["']([A-Fa-f0-9]{16,64})["']/);
  if (jsonToken?.[1]) return jsonToken[1];
  const hex = value.match(/\b[A-Fa-f0-9]{32}\b/);
  return hex?.[0];
}

/**
 * Token-only hex (or a short dashboard token). If Mark pasted the full
 * Cloudflare Web Analytics script, extract `data-cf-beacon` token hex.
 */
export function sanitizeBeaconToken(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const candidate = looksLikeSnippet(raw) ? extractBeaconTokenFromSnippet(raw) : raw;
  if (!candidate) return undefined;
  const token = candidate.trim();
  if (!token || token.length > 128) return undefined;
  if (looksLikeSnippet(token)) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return undefined;
  return token;
}

export function sanitizeGaMeasurementId(value: string): string | undefined {
  const id = value.trim();
  if (/^G-[A-Z0-9]+$/i.test(id) || /^GT-[A-Z0-9]+$/i.test(id)) return id;
  return undefined;
}

export async function getAnalyticsConfig(): Promise<AnalyticsConfig> {
  const env = await workerEnv();
  const beaconRaw =
    (typeof env?.PUBLIC_CF_BEACON_TOKEN === 'string' && env.PUBLIC_CF_BEACON_TOKEN) ||
    (typeof import.meta.env.PUBLIC_CF_BEACON_TOKEN === 'string' && import.meta.env.PUBLIC_CF_BEACON_TOKEN) ||
    '';
  const gaRaw =
    (typeof env?.PUBLIC_GA_MEASUREMENT_ID === 'string' && env.PUBLIC_GA_MEASUREMENT_ID) ||
    (typeof import.meta.env.PUBLIC_GA_MEASUREMENT_ID === 'string' && import.meta.env.PUBLIC_GA_MEASUREMENT_ID) ||
    '';
  const beaconToken = sanitizeBeaconToken(beaconRaw);
  const gaMeasurementId = sanitizeGaMeasurementId(gaRaw);
  return {
    ...(beaconToken ? { beaconToken } : {}),
    ...(gaMeasurementId ? { gaMeasurementId } : {}),
  };
}
