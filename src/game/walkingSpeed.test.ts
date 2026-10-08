import { describe, expect, it } from 'vitest';
import { advanceWalkingTime, walkingMultiplier } from './walkingSpeed';

describe('continuous walking speed', () => {
  it.each([
    [0, 1], [1499, 1], [1500, 2], [2999, 2], [3000, 3], [60000, 3],
  ])('uses %i ms -> %ix', (ms, multiplier) => {
    expect(walkingMultiplier(ms)).toBe(multiplier);
  });

  it('counts actual movement, caps the clock, and resets on a stop', () => {
    expect(advanceWalkingTime(1490, true, 10)).toBe(1500);
    expect(advanceWalkingTime(3000, true, 100)).toBe(3000);
    expect(advanceWalkingTime(3000, false, 100)).toBe(0);
    expect(advanceWalkingTime(0, true, 100)).toBe(100);
  });

  it.each([0, -1, NaN, Infinity, 251, 10000])('resets on discontinuous delta %s', (delta) => {
    expect(advanceWalkingTime(3000, true, delta)).toBe(0);
  });
});
