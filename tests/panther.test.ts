import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pantherSvgMarkup } from '../src/lib/panther';

function pngSize(path: string): { width: number; height: number } {
  const data = readFileSync(new URL(path, import.meta.url));
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return { width, height };
}

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

describe('panther walk sheet', () => {
  it('ships 12 frames at 106x80 and a 211x160 @2x sheet', () => {
    const one = pngSize('../src/assets/panther/panther_walk_sheet.png');
    const two = pngSize('../src/assets/panther/panther_walk_sheet_2x.png');
    const publicOne = pngSize('../public/panther/panther_walk_sheet.png');
    const publicTwo = pngSize('../public/panther/panther_walk_sheet@2x.png');
    expect(publicOne).toEqual(one);
    expect(publicTwo).toEqual(two);
    expect(one).toEqual({ width: 1272, height: 80 });
    expect(two).toEqual({ width: 2532, height: 160 });
    expect(one.width / 12).toBe(106);
    expect(two.width / 12).toBe(211);
  });

  it('walks with steps(12), clips the strip, and sits still when motion is reduced', () => {
    const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('panther-steps 0.996s steps(12) infinite');
    expect(css).toContain('panther-cross 21s linear infinite');
    expect(css).toContain("url('../assets/panther/panther_walk_sheet.png')");
    expect(css).toContain("url('../assets/panther/panther_walk_sheet_2x.png')");
    expect(css).toContain('min-resolution: 2dppx');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toMatch(/\.panther-strip[^{]*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.panther-strip[^{]*\{[^}]*pointer-events:\s*none/);
    expect(css).toContain('left: 0.75rem');

    const walk = readFileSync(new URL('../src/components/PantherWalk.astro', import.meta.url), 'utf8');
    expect(walk).toContain('aria-hidden="true"');
    expect(walk).toContain('data-panther-walk');

    const onAir = readFileSync(new URL('../src/components/OnAir.astro', import.meta.url), 'utf8');
    expect(onAir).toContain('<PantherWalk');
    expect(onAir.indexOf('<PantherWalk')).toBeLessThan(onAir.indexOf('recent-heading'));

    const widget = readFileSync(new URL('../src/pages/widget.astro', import.meta.url), 'utf8');
    expect(widget).toContain('<PantherWalk compact');
    expect(widget.indexOf('<PantherWalk')).toBeGreaterThan(widget.indexOf('data-widget-title'));
    expect(widget.indexOf('<PantherWalk')).toBeLessThan(widget.indexOf('widget-recent-heading'));
  });
});
