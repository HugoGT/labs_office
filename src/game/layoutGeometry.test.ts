/** Shared half-open placement geometry for server validation and editor ghosts. */

import { describe, expect, it } from 'vitest';
import { boundsOverlap } from './layoutGeometry';

describe('boundsOverlap', () => {
  it('detecta solape real (dos rectangulos que comparten area)', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('NO detecta solape en rectangulos separados por un hueco', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 11, y: 0, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(false);
  });

  it.each([{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }])('allows edge and corner adjacency: %j', (position) => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { ...position, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(false);
    expect(boundsOverlap(b, a)).toBe(false);
  });

  it('rejects even a one-tile positive-area overlap and containment', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(boundsOverlap(a, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
    expect(boundsOverlap(a, { x: 1, y: 1, w: 1, h: 1 })).toBe(true);
  });

  it('es simetrico: da el mismo resultado en cualquier orden de los argumentos', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(boundsOverlap(b, a));
  });
});
