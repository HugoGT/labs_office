import { describe, expect, it } from 'vitest';
import { mergeColliderRects } from './colliderMerge';

describe('mergeColliderRects', () => {
  it('fusiona un tramo contiguo de tiles solidos en un solo rectangulo (app.js:392-408)', () => {
    const solid = [[false, true, true, true, false]];

    const rects = mergeColliderRects(solid);

    expect(rects).toEqual([{ x: 1, y: 0, w: 3, h: 1 }]);
  });

  it('separa dos rectangulos cuando un hueco transitable interrumpe la fila', () => {
    const solid = [[true, true, false, true, false]];

    const rects = mergeColliderRects(solid);

    expect(rects).toEqual([
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 3, y: 0, w: 1, h: 1 },
    ]);
  });

  it('no fusiona filas solidas verticalmente adyacentes', () => {
    const solid = [
      [true, false],
      [true, false],
    ];

    const rects = mergeColliderRects(solid);

    expect(rects).toEqual([
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 1, w: 1, h: 1 },
    ]);
  });
});
