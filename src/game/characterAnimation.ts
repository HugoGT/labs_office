/**
 * Which frame of a character's sheets to draw (art migration, step 6). Pure
 * and Phaser-free: the scene feeds it how far an avatar moved this frame and
 * whether the server has it seated, and copies the answer into the sprite.
 *
 * Nothing here travels over the network. Each client derives the walk from
 * the movement it sees (its own velocity, a peer's interpolated position),
 * so peers only share what they already did: position, facing and seat.
 *
 * The walk sheet has eight direction rows in screen space; the seated sheet
 * has four facing rows in the pack order. They are two separate orders, so
 * each has its own frame function and neither is indexed by hand.
 */

import {
  CHARACTER_SEATED,
  CHARACTER_WALK,
  FACING_WALK_DIRECTION,
  WALK_DIRECTIONS,
  seatedRowForFacing,
  type ArtFacing,
  type WalkDirection,
} from './artContract';

/** Ten steps per cycle at this pace is about the stride of `PLAYER_SPEED`. */
export const WALK_FRAME_MS = 80;
export const SEAT_TRANSITION_FRAME_MS = 70;
export const SEATED_IDLE_FRAME_MS = 700;
/**
 * A peer's position arrives at 10 Hz and is tweened in between, so a late
 * update leaves a frame or two without movement. Walking survives that long,
 * or the peer would blink to idle mid-stride.
 */
export const WALK_GRACE_MS = 150;
/** Smaller per-frame movement is noise (a tween settling), not a step. */
const MOVE_EPSILON = 0.01;

/** Octants by `atan2` (y grows down): east, then clockwise. */
const OCTANTS: readonly WalkDirection[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

export function walkDirectionFrom(dx: number, dy: number, previous: WalkDirection): WalkDirection {
  if (Math.abs(dx) < MOVE_EPSILON && Math.abs(dy) < MOVE_EPSILON) return previous;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return OCTANTS[(octant + OCTANTS.length) % OCTANTS.length];
}

export function walkFrame(direction: WalkDirection, step: number | 'idle'): number {
  const column = step === 'idle' ? CHARACTER_WALK.idleColumn : step % CHARACTER_WALK.stepColumns;
  return WALK_DIRECTIONS.indexOf(direction) * CHARACTER_WALK.columns + column;
}

export function seatedFrame(facing: ArtFacing, column: number): number {
  return seatedRowForFacing(facing) * CHARACTER_SEATED.columns + column;
}

export type SeatPhase = 'sitting' | 'seated' | 'standing';

export interface CharacterAnimation {
  readonly direction: WalkDirection;
  /** Time spent walking; 0 means idle. */
  readonly walkMs: number;
  /** Time since the last movement, for `WALK_GRACE_MS`. */
  readonly stillMs: number;
  readonly seat: { readonly facing: ArtFacing; readonly phase: SeatPhase; readonly ms: number } | null;
}

export interface AnimationInput {
  readonly dx: number;
  readonly dy: number;
  readonly dtMs: number;
  /** Facing of the seat the server has this avatar on, or `null` standing. */
  readonly seatFacing: ArtFacing | null;
  /** A facing to turn to while standing still (a peer turning in place). */
  readonly turnTo?: ArtFacing;
}

export function initialAnimation(direction: WalkDirection): CharacterAnimation {
  return { direction, walkMs: 0, stillMs: 0, seat: null };
}

const TRANSITION_MS = CHARACTER_SEATED.transitionColumns * SEAT_TRANSITION_FRAME_MS;

export function stepAnimation(state: CharacterAnimation, input: AnimationInput): CharacterAnimation {
  const moved = Math.abs(input.dx) >= MOVE_EPSILON || Math.abs(input.dy) >= MOVE_EPSILON;
  const { seat } = state;

  if (input.seatFacing !== null) {
    // Sitting wins over movement: the frame a sitter is put on the seat is a
    // jump, not a step.
    if (seat === null || seat.phase === 'standing' || seat.facing !== input.seatFacing) {
      return { ...state, walkMs: 0, stillMs: 0, seat: { facing: input.seatFacing, phase: 'sitting', ms: 0 } };
    }
    const ms = seat.ms + input.dtMs;
    if (seat.phase === 'sitting' && ms >= TRANSITION_MS) {
      return { ...state, seat: { facing: seat.facing, phase: 'seated', ms: ms - TRANSITION_MS } };
    }
    return { ...state, seat: { ...seat, ms } };
  }

  if (seat !== null && !moved) {
    if (seat.phase !== 'standing') return { ...state, seat: { facing: seat.facing, phase: 'standing', ms: 0 } };
    const ms = seat.ms + input.dtMs;
    if (ms < TRANSITION_MS) return { ...state, seat: { ...seat, ms } };
    return initialAnimation(FACING_WALK_DIRECTION[seat.facing]);
  }

  if (moved) {
    return {
      direction: walkDirectionFrom(input.dx, input.dy, state.direction),
      walkMs: state.walkMs + input.dtMs,
      stillMs: 0,
      seat: null,
    };
  }

  const stillMs = state.stillMs + input.dtMs;
  const walking = state.walkMs > 0 && stillMs <= WALK_GRACE_MS;
  const direction = !walking && input.turnTo !== undefined ? FACING_WALK_DIRECTION[input.turnTo] : state.direction;
  return { direction, walkMs: walking ? state.walkMs + input.dtMs : 0, stillMs, seat: null };
}

export function animationFrame(state: CharacterAnimation): { sheet: 'walk' | 'seated'; frame: number } {
  const { seat } = state;
  if (seat !== null) {
    const step = Math.floor(seat.ms / SEAT_TRANSITION_FRAME_MS);
    const last = CHARACTER_SEATED.transitionColumns - 1;
    if (seat.phase === 'sitting') return { sheet: 'seated', frame: seatedFrame(seat.facing, Math.min(last, step)) };
    if (seat.phase === 'standing') return { sheet: 'seated', frame: seatedFrame(seat.facing, Math.max(0, last - step)) };
    const idle = CHARACTER_SEATED.idleColumns;
    return { sheet: 'seated', frame: seatedFrame(seat.facing, idle[Math.floor(seat.ms / SEATED_IDLE_FRAME_MS) % idle.length]) };
  }
  if (state.walkMs <= 0) return { sheet: 'walk', frame: walkFrame(state.direction, 'idle') };
  return { sheet: 'walk', frame: walkFrame(state.direction, Math.floor(state.walkMs / WALK_FRAME_MS)) };
}
