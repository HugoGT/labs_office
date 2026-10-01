import { describe, expect, it } from 'vitest';
import { hexToRgba, makeRamp, mixRgba, OUTLINE_INK, OUTLINE_INK_MIX, recolorPixels, TONES } from './artColor';

function pixels(...colors: readonly (readonly [number, number, number, number])[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function rgbaOf(data: Uint8ClampedArray, index: number): [number, number, number, number] {
  return [data[index * 4], data[index * 4 + 1], data[index * 4 + 2], data[index * 4 + 3]];
}

describe('recolorPixels', () => {
  it('maps every tone of the source ramp onto the same tone of the target ramp', () => {
    const from = makeRamp('#4f9a8a');
    const to = makeRamp('#c0392b');
    const source = pixels(...TONES.map((tone) => [from[tone].r, from[tone].g, from[tone].b, 255] as const));

    const out = recolorPixels(source, '#4f9a8a', '#c0392b');

    TONES.forEach((tone, index) => {
      expect(rgbaOf(out, index)).toEqual([to[tone].r, to[tone].g, to[tone].b, 255]);
    });
  });

  it('follows the mixes between two tones and the outline ink the exporter paints with', () => {
    const from = makeRamp('#b9c3cc');
    const to = makeRamp('#2c3e50');
    const bevel = mixRgba(from.base, from.light, 0.55);
    const outline = mixRgba(from.base, OUTLINE_INK, OUTLINE_INK_MIX.opaque);
    const out = recolorPixels(
      pixels([bevel.r, bevel.g, bevel.b, 255], [outline.r, outline.g, outline.b, 255]),
      '#b9c3cc',
      '#2c3e50',
    );

    const expected = [mixRgba(to.base, to.light, 0.55), mixRgba(to.base, OUTLINE_INK, OUTLINE_INK_MIX.opaque)];
    expected.forEach((color, index) => {
      const [r, g, b] = rgbaOf(out, index);
      expect(Math.abs(r - color.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(g - color.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(b - color.b)).toBeLessThanOrEqual(1);
    });
  });

  it('keeps colors that do not belong to the paint, transparent pixels and alpha as they are', () => {
    const chrome = hexToRgba('#d8dde3');
    const base = makeRamp('#4f9a8a').base;
    const source = pixels([chrome.r, chrome.g, chrome.b, 255], [0, 0, 0, 0], [base.r, base.g, base.b, 120]);

    const out = recolorPixels(source, '#4f9a8a', '#c0392b');

    expect(rgbaOf(out, 0)).toEqual([chrome.r, chrome.g, chrome.b, 255]);
    expect(rgbaOf(out, 1)).toEqual([0, 0, 0, 0]);
    expect(rgbaOf(out, 2)[3]).toBe(120);
    expect(rgbaOf(out, 2).slice(0, 3)).not.toEqual([base.r, base.g, base.b]);
  });

  it('is the identity when the color does not change, and never touches its input', () => {
    const ramp = makeRamp('#4f9a8a');
    const source = pixels([ramp.shadow.r, ramp.shadow.g, ramp.shadow.b, 255], [12, 200, 40, 255]);
    const copy = new Uint8ClampedArray(source);

    const out = recolorPixels(source, '#4f9a8a', '#4f9a8a');

    expect(Array.from(out)).toEqual(Array.from(copy));
    expect(out).not.toBe(source);
    expect(Array.from(source)).toEqual(Array.from(copy));
  });
});
