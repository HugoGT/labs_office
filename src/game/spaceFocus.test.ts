import { describe, expect, it } from 'vitest';
import { shadeAround, shadeKey } from './spaceFocus';

const BOUNDS = { x: 0, y: 0, w: 100, h: 80 };

function area(rects: readonly { w: number; h: number }[]): number {
  return rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
}

describe('shadeAround', () => {
  it('covers every point of the bounds except the space, with four rectangles', () => {
    const space = { x: 20, y: 10, w: 30, h: 20 };

    const rects = shadeAround(space, BOUNDS);

    expect(rects).toEqual([
      { x: 0, y: 0, w: 100, h: 10 },
      { x: 0, y: 30, w: 100, h: 50 },
      { x: 0, y: 10, w: 20, h: 20 },
      { x: 50, y: 10, w: 50, h: 20 },
    ]);
    expect(area(rects)).toBe(100 * 80 - 30 * 20);
  });

  it('drops the empty sides of a space against the edge', () => {
    const rects = shadeAround({ x: 0, y: 0, w: 40, h: 80 }, BOUNDS);

    expect(rects).toEqual([{ x: 40, y: 0, w: 60, h: 80 }]);
  });

  it('clamps a space that reaches past the bounds', () => {
    const rects = shadeAround({ x: -10, y: 60, w: 30, h: 40 }, BOUNDS);

    expect(area(rects)).toBe(100 * 80 - 20 * 20);
  });
});

describe('shadeKey', () => {
  it('is null on the open floor and changes when the space moves or resizes', () => {
    const space = { id: 'a', x: 0, y: 0, w: 10, h: 10 };

    expect(shadeKey(null)).toBeNull();
    expect(shadeKey(space)).toBe(shadeKey({ ...space }));
    expect(shadeKey(space)).not.toBe(shadeKey({ ...space, x: 32 }));
    expect(shadeKey(space)).not.toBe(shadeKey({ ...space, w: 20 }));
  });
});
