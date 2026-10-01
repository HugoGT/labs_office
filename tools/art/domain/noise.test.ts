import { describe, expect, it } from 'vitest';
import { periodicNoise } from './noise.ts';

describe('periodicNoise', () => {
  const noise = periodicNoise(42, 96, 8);

  it('repeats every period in both axes, so a 96px motif stays seamless', () => {
    for (const [x, y] of [
      [0, 0],
      [13, 71],
      [95, 2],
    ] as const) {
      expect(noise(x + 96, y)).toBeCloseTo(noise(x, y), 10);
      expect(noise(x, y + 96)).toBeCloseTo(noise(x, y), 10);
      expect(noise(x - 96, y - 192)).toBeCloseTo(noise(x, y), 10);
    }
  });

  it('stays in [0, 1] and moves smoothly: blobs, not per-pixel static', () => {
    let largestStep = 0;
    for (let y = 0; y < 96; y += 1) {
      for (let x = 0; x < 96; x += 1) {
        const value = noise(x, y);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        largestStep = Math.max(largestStep, Math.abs(noise(x + 1, y) - value), Math.abs(noise(x, y + 1) - value));
      }
    }
    expect(largestStep).toBeLessThan(0.2);
  });

  it('is deterministic per seed', () => {
    expect(periodicNoise(42, 96, 8)(10, 20)).toBe(noise(10, 20));
    expect(periodicNoise(43, 96, 8)(10, 20)).not.toBe(noise(10, 20));
  });

  it('rejects a lattice that does not divide the period', () => {
    expect(() => periodicNoise(1, 96, 7)).toThrow(/divide/);
  });
});
