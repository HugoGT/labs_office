import { describe, expect, it } from 'vitest';
import { COLLISION_COORD_LIMIT } from './pieceCollisions';
import { dragRect, hitRect, newRectToward, rectFromDrag, snapValue } from './collisionEditor';

const RECT = { x: -10, y: -20, w: 20, h: 10 };

describe('collisionEditor: snapping', () => {
  it('rounds to whole pixels or to even ones', () => {
    expect(snapValue(3.4, 1)).toBe(3);
    expect(snapValue(3.4, 2)).toBe(4);
    expect(snapValue(-3.2, 2)).toBe(-4);
    expect(snapValue(-0.4, 1)).toBe(0);
  });
});

describe('collisionEditor: hit testing', () => {
  it('names the edge or corner within the tolerance, the inside as a move, and misses outside', () => {
    expect(hitRect(RECT, { x: -10, y: -20 }, 3)).toBe('nw');
    expect(hitRect(RECT, { x: 11, y: -9 }, 3)).toBe('se');
    expect(hitRect(RECT, { x: 0, y: -21 }, 3)).toBe('n');
    expect(hitRect(RECT, { x: 0, y: -10 }, 3)).toBe('s');
    expect(hitRect(RECT, { x: -11, y: -15 }, 3)).toBe('w');
    expect(hitRect(RECT, { x: 9, y: -15 }, 3)).toBe('e');
    expect(hitRect(RECT, { x: 0, y: -15 }, 3)).toBe('move');
    expect(hitRect(RECT, { x: 30, y: -15 }, 3)).toBeNull();
  });
});

describe('collisionEditor: dragging', () => {
  it('moves a rectangle by whole snapped steps', () => {
    expect(dragRect(RECT, 'move', 3.4, -1.2, 1)).toEqual({ x: -7, y: -21, w: 20, h: 10 });
    expect(dragRect(RECT, 'move', 3.4, -1.2, 2)).toEqual({ x: -6, y: -22, w: 20, h: 10 });
  });

  it('resizes from an edge or a corner, keeping the opposite side', () => {
    expect(dragRect(RECT, 'e', 5, 0, 1)).toEqual({ x: -10, y: -20, w: 25, h: 10 });
    expect(dragRect(RECT, 'nw', 4, 2, 1)).toEqual({ x: -6, y: -18, w: 16, h: 8 });
    expect(dragRect(RECT, 's', 0, -3, 1)).toEqual({ x: -10, y: -20, w: 20, h: 7 });
  });

  it('never collapses a rectangle and flips past the opposite side instead', () => {
    expect(dragRect(RECT, 'e', -20, 0, 1)).toEqual({ x: -10, y: -20, w: 1, h: 10 });
    expect(dragRect(RECT, 'e', -25, 0, 1)).toEqual({ x: -15, y: -20, w: 5, h: 10 });
  });

  it('stays within the bounds the server accepts', () => {
    const far = dragRect(RECT, 'move', 10_000, 0, 1);
    expect(far.x + far.w).toBe(COLLISION_COORD_LIMIT);
    expect(far.w).toBe(20);
  });
});

describe('collisionEditor: drawing', () => {
  it('spans two points in either order, snapped, and ignores a click', () => {
    expect(rectFromDrag({ x: 4.2, y: -3 }, { x: -6, y: -15.6 }, 1)).toEqual({ x: -6, y: -16, w: 10, h: 13 });
    expect(rectFromDrag({ x: 0, y: 0 }, { x: 0.3, y: 0.2 }, 1)).toBeNull();
  });

  it('offers a small rectangle above the anchor for the add button', () => {
    expect(newRectToward([])).toEqual({ x: -8, y: -16, w: 16, h: 16 });
    // Next to the last one, so a second click shows something new.
    expect(newRectToward([{ x: -8, y: -16, w: 16, h: 16 }])).toEqual({ x: 0, y: -8, w: 16, h: 16 });
  });
});
