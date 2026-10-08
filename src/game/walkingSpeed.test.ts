import { describe, expect, it } from 'vitest';
import { advanceWalkingTime, walkingMultiplier } from './walkingSpeed';

describe('continuous walking speed', () => {
  it.each([
    [0, 1], [1499, 1], [1500, 2], [2999, 2], [3000, 3], [60000, 3],
  ])('uses %i ms -> %ix', (ms, multiplier) => {
    expect(walkingMultiplier(ms)).toBe(multiplier);
  });

  it('counts actual movement and caps the clock', () => {
    expect(advanceWalkingTime(1490, 0, true, 10)).toEqual({ continuousMs: 1500, idleMs: 0 });
    expect(advanceWalkingTime(3000, 0, true, 100)).toEqual({ continuousMs: 3000, idleMs: 0 });
    expect(advanceWalkingTime(0, 0, true, 100)).toEqual({ continuousMs: 100, idleMs: 0 });
  });

  it('holds the clock without crediting it for up to 1 s without movement, then resets', () => {
    expect(advanceWalkingTime(3000, 0, false, 100)).toEqual({ continuousMs: 3000, idleMs: 100 });
    expect(advanceWalkingTime(3000, 980, false, 10)).toEqual({ continuousMs: 3000, idleMs: 990 });
    expect(advanceWalkingTime(3000, 990, false, 10)).toEqual({ continuousMs: 0, idleMs: 0 });
    expect(advanceWalkingTime(3000, 900, false, 250)).toEqual({ continuousMs: 0, idleMs: 0 });
    expect(advanceWalkingTime(3000, 990, true, 10)).toEqual({ continuousMs: 3000, idleMs: 0 });
  });

  it.each([0, -1, NaN, Infinity, 251, 10000])('resets on discontinuous delta %s', (delta) => {
    expect(advanceWalkingTime(3000, 0, true, delta)).toEqual({ continuousMs: 0, idleMs: 0 });
    expect(advanceWalkingTime(3000, 500, false, delta)).toEqual({ continuousMs: 0, idleMs: 0 });
  });
});
