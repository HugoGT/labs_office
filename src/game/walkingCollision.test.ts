import { describe, expect, it } from 'vitest';
import { slideWalking, WALKING_SKIN_PX } from './walkingCollision';

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x + a.width > b.x && a.x < b.x + b.width && a.y + a.height > b.y && a.y < b.y + b.height;

describe('between-sample walking contacts', () => {
  const body = { x: 0, y: 0, width: 22, height: 14 };

  it('clips the axis that grazes a corner and keeps the other one even when the endpoint is clear', () => {
    const step = slideWalking(body, 3, 3, [{ x: 2, y: 16, width: 1, height: 1 }]);
    expect(step.dx).toBe(3);
    expect(step.dy).toBeCloseTo(2 - WALKING_SKIN_PX, 9);
  });

  it('handles both negative axes', () => {
    const step = slideWalking(body, -3, -3, [{ x: -3, y: 11, width: 1, height: 1 }]);
    // The obstacle shares the body's rows from the start: it is X that enters it.
    expect(step.dx).toBeCloseTo(-2 + WALKING_SKIN_PX, 9);
    expect(step.dy).toBe(-3);
  });

  it('stops a straight walk at the wall, a skin short of touching it', () => {
    expect(slideWalking(body, 3, 0, [{ x: 23, y: 0, width: 1, height: 14 }]).dx).toBeCloseTo(1 - WALKING_SKIN_PX, 9);
    expect(slideWalking(body, 0, 3, [{ x: 0, y: 15, width: 22, height: 1 }]).dy).toBeCloseTo(1 - WALKING_SKIN_PX, 9);
  });

  it('does not block a parallel slide, a tangent, moving away, or an existing overlap', () => {
    expect(slideWalking(body, 0, 3, [{ x: 22, y: 0, width: 1, height: 14 }])).toEqual({ dx: 0, dy: 3 });
    expect(slideWalking(body, 3, 3, [{ x: 2, y: 17, width: 1, height: 1 }])).toEqual({ dx: 3, dy: 3 });
    expect(slideWalking(body, -3, 0, [{ x: 22, y: 0, width: 1, height: 14 }])).toEqual({ dx: -3, dy: 0 });
    expect(slideWalking(body, 3, 3, [{ x: 1, y: 1, width: 1, height: 1 }])).toEqual({ dx: 3, dy: 3 });
  });
});

describe('sliding along walls and around corners (#252)', () => {
  const body = { x: 0, y: 0, width: 22, height: 14 };

  it('keeps the component along the wall when walking diagonally into it', () => {
    const step = slideWalking(body, 3, 3, [{ x: 23, y: -100, width: 4, height: 200 }]);
    expect(step.dx).toBeCloseTo(1 - WALKING_SKIN_PX, 9);
    expect(step.dy).toBe(3);
  });

  it('slides across the seam between two rectangles of one wall', () => {
    const resting = { ...body, x: -WALKING_SKIN_PX };
    const wall = [{ x: 22, y: -100, width: 4, height: 115 }, { x: 22, y: 15, width: 4, height: 100 }];
    expect(slideWalking(resting, 3, 3, wall)).toEqual({ dx: 0, dy: 3 });
    expect(slideWalking({ ...resting, y: 15 - 14 - WALKING_SKIN_PX }, 3, 3, wall)).toEqual({ dx: 0, dy: 3 });
  });

  it('slides off the end of a desk instead of sticking to its corner', () => {
    const desk = { x: 22, y: -20, width: 30, height: 21 };
    const step = slideWalking({ ...body, x: -WALKING_SKIN_PX }, 3, 3, [desk]);
    expect(step.dy).toBe(3);
    expect(overlaps({ ...body, x: -WALKING_SKIN_PX + step.dx, y: step.dy }, desk)).toBe(false);
  });

  it('slides around a corner hit dead on instead of stopping', () => {
    const corner = { x: 22 + WALKING_SKIN_PX * 2, y: 14 + WALKING_SKIN_PX * 2, width: 10, height: 10 };
    const step = slideWalking(body, 3, 3, [corner]);
    expect(Math.max(Math.abs(step.dx), Math.abs(step.dy))).toBe(3);
    expect(overlaps({ ...body, x: step.dx, y: step.dy }, corner)).toBe(false);
  });

  it('stops both axes in an inner corner', () => {
    const step = slideWalking(body, 3, 3, [
      { x: 23, y: -100, width: 4, height: 200 },
      { x: -100, y: 15, width: 200, height: 4 },
    ]);
    expect(step.dx).toBeCloseTo(1 - WALKING_SKIN_PX, 9);
    expect(step.dy).toBeCloseTo(1 - WALKING_SKIN_PX, 9);
  });
});
