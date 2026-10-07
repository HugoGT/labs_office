import { describe, expect, it } from 'vitest';
import { advanceWalkingTime, walkingMultiplier } from './walkingSpeed';

describe('continuous walking speed', () => {
  it.each([
    [0, 1], [1999, 1], [2000, 2], [3999, 2], [4000, 3],
    [5999, 3], [6000, 4], [7999, 4], [8000, 5], [60000, 5],
  ])('uses %i ms -> %ix', (ms, multiplier) => {
    expect(walkingMultiplier(ms)).toBe(multiplier);
  });

  it('counts actual movement, caps the clock, and resets on a stop', () => {
    expect(advanceWalkingTime(1990, true, 10)).toBe(2000);
    expect(advanceWalkingTime(8000, true, 100)).toBe(8000);
    expect(advanceWalkingTime(8000, false, 100)).toBe(0);
    expect(advanceWalkingTime(0, true, 100)).toBe(100);
  });

  it.each([0, -1, NaN, Infinity, 251, 10000])('resets on discontinuous delta %s', (delta) => {
    expect(advanceWalkingTime(8000, true, delta)).toBe(0);
  });
});
