import { describe, expect, it } from 'vitest';
import { deskAt } from './deskLayout';

const DESKS = [
  { id: 'a', x: 0, y: 0, w: 96, h: 96 },
  { id: 'b', x: 96, y: 0, w: 96, h: 96 },
];

describe('deskAt', () => {
  it('finds the desk whose area holds the point, its right and bottom edges excluded', () => {
    expect(deskAt({ x: 10, y: 10 }, DESKS)?.id).toBe('a');
    expect(deskAt({ x: 96, y: 50 }, DESKS)?.id).toBe('b');
    expect(deskAt({ x: 191.5, y: 95.5 }, DESKS)?.id).toBe('b');
  });

  it('is null off every desk', () => {
    expect(deskAt({ x: 10, y: 96 }, DESKS)).toBeNull();
    expect(deskAt({ x: -1, y: 10 }, DESKS)).toBeNull();
    expect(deskAt({ x: 10, y: 10 }, [])).toBeNull();
  });
});
