/**
 * The eight walking directions in screen space (x grows right, y grows down).
 * The order is also the row order of every walk sprite sheet.
 */
export const DIRECTIONS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;

export type Direction = (typeof DIRECTIONS)[number];

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

const D = Math.SQRT1_2;
const STEP = Math.PI / 4;

const VECTORS: Readonly<Record<Direction, Vec2>> = {
  S: { x: 0, y: 1 },
  SE: { x: D, y: D },
  E: { x: 1, y: 0 },
  NE: { x: D, y: -D },
  N: { x: 0, y: -1 },
  NW: { x: -D, y: -D },
  W: { x: -1, y: 0 },
  SW: { x: -D, y: D },
};

export function directionIndex(direction: Direction): number {
  return DIRECTIONS.indexOf(direction);
}

export function directionAt(index: number): Direction {
  const count = DIRECTIONS.length;
  return DIRECTIONS[((Math.round(index) % count) + count) % count] as Direction;
}

export function directionVector(direction: Direction): Vec2 {
  return VECTORS[direction];
}

/** Snaps any screen-space vector to the nearest of the 8 directions. A zero vector faces the viewer. */
export function directionFromVector(dx: number, dy: number): Direction {
  if (dx === 0 && dy === 0) return 'S';
  return directionAt(Math.atan2(dx, dy) / STEP);
}

export function oppositeDirection(direction: Direction): Direction {
  return directionAt(directionIndex(direction) + DIRECTIONS.length / 2);
}

/**
 * Rotation of the character around the vertical axis, in radians.
 * 0 faces the viewer (S), PI/2 faces screen right (E), PI faces away (N).
 */
export function facingYaw(direction: Direction): number {
  return directionIndex(direction) * STEP;
}
