import { describe, expect, it } from 'vitest';
import { roomCapacityMax } from './roomCapacity';

describe('roomCapacityMax', () => {
  it.each([
    [9, 9, 10],
    [9, 6, 10],
    [6, 9, 10],
    [7, 6, 8],
    [6, 6, 7],
  ])('a %ix%i room holds at most %i people', (w, h, max) => {
    expect(roomCapacityMax(w, h)).toBe(max);
  });
});
