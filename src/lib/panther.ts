/** Prepare official Panther SVG markup for inline Easter eggs. */

export function pantherSvgMarkup(raw: string, className: string): string {
  const extra = className.trim();
  return raw
    .replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/i, '')
    .replace(/<svg\b([^>]*)>/i, (_full, attrs: string) => {
      const cleaned = attrs
        .replace(/\s+width="[^"]*"/g, '')
        .replace(/\s+height="[^"]*"/g, '')
        .replace(/\s+role="img"/g, '')
        .replace(/\s+aria-label="[^"]*"/g, '');
      const cls = extra ? ` class="panther ${extra}"` : ' class="panther"';
      return `<svg${cls} aria-hidden="true" focusable="false"${cleaned}>`;
    });
}
