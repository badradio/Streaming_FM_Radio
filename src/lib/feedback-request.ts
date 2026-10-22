import { isPlayCue } from './plays';
import { reconcileDeskWithAir } from './radio/reconcile';
import { workerEnv } from './runtime';
import type { FeedbackGeo, FeedbackTrack } from './feedback';

type CfLike = {
  country?: string;
  city?: string;
};

export function feedbackGeoFromRequest(request: Request): FeedbackGeo {
  const cf = (request as Request & { cf?: CfLike }).cf;
  const country = typeof cf?.country === 'string' && cf.country.trim() ? cf.country.trim() : null;
  const city = typeof cf?.city === 'string' && cf.city.trim() ? cf.city.trim() : null;
  return { country, city };
}

export function clientIp(request: Request): string | null {
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = request.headers.get('x-real-ip')?.trim();
  return real || null;
}

export async function hashClientIp(request: Request): Promise<string | null> {
  const ip = clientIp(request);
  if (!ip) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function currentFeedbackTrack(): Promise<FeedbackTrack | null> {
  const { feed } = await reconcileDeskWithAir();
  if (!feed.ok || !feed.now) return null;
  const artist = feed.now.artist.trim();
  const title = feed.now.title.trim();
  if (!artist && !title) return null;
  if (isPlayCue(artist, title)) return null;
  return {
    artist: artist || 'Unknown artist',
    title: title || 'Unknown title',
    startedAt: feed.now.startedAt?.trim() || '',
  };
}

export async function feedbackStationKv() {
  const env = await workerEnv();
  return env?.STATION;
}
