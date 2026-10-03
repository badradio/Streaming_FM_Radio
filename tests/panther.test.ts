import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pantherSvgMarkup } from '../src/lib/panther';

const poses = ['lounge', 'peek', 'loaf'] as const;

describe('panther official eggs', () => {
  it('uses charcoal fill, amber outline, and amber eyes', () => {
    for (const pose of poses) {
      const raw = readFileSync(new URL(`../src/assets/panther/panther-${pose}.svg`, import.meta.url), 'utf8');
      expect(raw).toContain('fill="#2c2c32"');
      expect(raw).toContain('stroke="#e8b030"');
      expect(raw).toContain('stroke-width="18"');
      expect(raw).toContain('stroke-linejoin="round"');
      expect(raw).toContain('paint-order="stroke fill"');
      expect(raw).not.toContain('#0c0c0e');
      expect(raw).toContain('class="eye"');
      expect(raw).toContain('fill="#e8b030"');
      const markup = pantherSvgMarkup(raw, `panther-${pose}`);
      expect(markup).toContain(`class="panther panther-${pose}"`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toMatch(/\swidth="1200"/);
    }
  });
});
