export type ClientOs = 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'other';

export function detectClientOs(
  userAgent: string,
  options: { platform?: string; maxTouchPoints?: number } = {},
): ClientOs {
  const ua = userAgent || '';
  const platform = options.platform ?? '';
  const touch = options.maxTouchPoints ?? 0;

  const iPadOs = platform === 'MacIntel' && touch > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Win(dows|32|64)/i.test(ua) || /Win/i.test(platform)) return 'windows';
  if (/Mac OS X|Macintosh/.test(ua) || /Mac/i.test(platform)) return 'mac';
  if (/Linux/.test(ua) || /Linux/i.test(platform)) return 'linux';
  return 'other';
}

export function highlightGroup(os: ClientOs): 'ios' | 'android' | 'desktop' {
  if (os === 'ios') return 'ios';
  if (os === 'android') return 'android';
  return 'desktop';
}
