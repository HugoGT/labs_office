import { describe, expect, it } from 'vitest';
import { walkingSweepFraction } from './walkingCollision';

describe('between-sample walking contacts', () => {
  const body = { x: 0, y: 0, width: 22, height: 14 };

  it('clips a diagonal corner graze even when the endpoint is clear', () => {
    expect(walkingSweepFraction(body, 3, 3, { x: 2, y: 16, width: 1, height: 1 })).toBeCloseTo(2 / 3);
  });

  it('handles both negative axes', () => {
    expect(walkingSweepFraction(body, -3, -3, { x: -3, y: 11, width: 1, height: 1 })).toBeCloseTo(2 / 3);
  });

  it('leaves endpoint overlaps to Arcade for normal separation and wall sliding', () => {
    expect(walkingSweepFraction(body, 3, 0, { x: 23, y: 0, width: 1, height: 14 })).toBe(1);
    expect(walkingSweepFraction(body, 0, 3, { x: 0, y: 15, width: 22, height: 1 })).toBe(1);
  });

  it('does not block a parallel slide, a tangent, moving away, or an existing overlap', () => {
    expect(walkingSweepFraction(body, 0, 3, { x: 22, y: 0, width: 1, height: 14 })).toBe(1);
    expect(walkingSweepFraction(body, 3, 3, { x: 2, y: 17, width: 1, height: 1 })).toBe(1);
    expect(walkingSweepFraction(body, -3, 0, { x: 22, y: 0, width: 1, height: 14 })).toBe(1);
    expect(walkingSweepFraction(body, 3, 3, { x: 1, y: 1, width: 1, height: 1 })).toBe(1);
  });
});
