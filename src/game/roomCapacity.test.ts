import { describe, expect, it } from 'vitest';
import { defaultRoomCapacity } from './roomCapacity';

describe('defaultRoomCapacity', () => {
  it.each([
    [9, 9, 10],
    [9, 6, 10],
    [6, 9, 10],
    [7, 6, 8],
    [6, 6, 7],
  ])('a %ix%i room is offered for %i people', (w, h, capacity) => {
    expect(defaultRoomCapacity(w, h)).toBe(capacity);
  });
});
