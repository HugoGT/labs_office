/**
 * Shared contract between furniture sprites and seated character sprites, so a character sits on
 * any chair without per-chair tweaks.
 *
 * - A chair fits in a SEAT_BLOCK x SEAT_BLOCK box (its largest width and height, not a square),
 *   so four chairs fit in one floor tile.
 * - A chair faces one of four ways: the way a seated character looks.
 * - A chair sprite is split in two layers of the same size and origin: `back` is drawn before the
 *   sitter, `front` after it (a backrest seen in front of the sitter, an armrest over the legs).
 * - `seat` is the pixel inside the chair sprite where the sitter's pelvis center lands. Seated
 *   frames mark the same point with their own anchor, so drawing a sitter is
 *   `chair origin + seat - sit anchor`.
 */
import type { Direction } from './directions.ts';

export const SEAT_BLOCK = 36;

/**
 * Screen pixels between the floor under a chair's seat and the seat surface the pelvis rests on.
 * Chairs draw their legs this long; seated poses put the pelvis this high.
 */
export const SEAT_HEIGHT = 9;

export const FACINGS = ['up', 'down', 'left', 'right'] as const;
export type Facing = (typeof FACINGS)[number];

/** Sprite direction a seated character uses for each chair facing. */
export const FACING_DIRECTION: Readonly<Record<Facing, Direction>> = {
  up: 'N',
  down: 'S',
  left: 'W',
  right: 'E',
};

export interface SeatPoint {
  readonly x: number;
  readonly y: number;
}
