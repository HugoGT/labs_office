import { describe, expect, it } from 'vitest';
import { GLYPH_HEIGHT, GLYPH_WIDTH, LINE_HEIGHT, drawText, textWidth } from './pixelFont.ts';
import { PixelBuffer, rgba } from './pixelBuffer.ts';

const INK = rgba(10, 20, 30);

function inked(buffer: PixelBuffer): string[] {
  const rows: string[] = [];
  for (let y = 0; y < buffer.height; y += 1) {
    let row = '';
    for (let x = 0; x < buffer.width; x += 1) row += buffer.alphaAt(x, y) === 0 ? '.' : '#';
    rows.push(row);
  }
  return rows;
}

describe('pixel font', () => {
  it('uses 3x5 glyphs with one pixel between letters and lines', () => {
    expect(GLYPH_WIDTH).toBe(3);
    expect(GLYPH_HEIGHT).toBe(5);
    expect(LINE_HEIGHT).toBe(6);
    expect(textWidth('')).toBe(0);
    expect(textWidth('S')).toBe(3);
    expect(textWidth('SE')).toBe(7);
    expect(textWidth('IDLE 7')).toBe(23);
  });

  it('draws the glyphs at the given top-left corner', () => {
    const buffer = new PixelBuffer(9, 7);
    drawText(buffer, 1, 1, 'L1', INK);
    expect(inked(buffer)).toEqual([
      '.........',
      '.#....#..',
      '.#...##..',
      '.#....#..',
      '.#....#..',
      '.###.###.',
      '.........',
    ]);
    expect(buffer.getPixel(1, 1)).toEqual(INK);
  });

  it('has a glyph for every letter and digit, each one different', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const shapes = new Set<string>();
    for (const char of alphabet) {
      const buffer = new PixelBuffer(GLYPH_WIDTH, GLYPH_HEIGHT);
      drawText(buffer, 0, 0, char, INK);
      expect(buffer.countOpaque(), char).toBeGreaterThan(0);
      shapes.add(inked(buffer).join('/'));
    }
    expect(shapes.size).toBe(alphabet.length);
  });

  it('refuses a character it cannot draw instead of skipping it', () => {
    expect(() => drawText(new PixelBuffer(8, 8), 0, 0, 'a', INK)).toThrow(/a/);
  });
});
