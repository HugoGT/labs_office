/**
 * Pure description of sitting down on a chair and of the seated idle loop.
 *
 * The feet stay planted where the character stood: the pelvis travels SEAT_BACK units backward
 * and down onto the seat while the torso leans forward to balance, then straightens up with the
 * hands resting on the thighs. Played backward, the transition stands the character up.
 *
 * Sit sheet: SIT_FRAME_COUNT columns (SIT_DOWN_FRAME_COUNT transition frames, then the idle
 * loop) by 4 rows in SIT_ROWS order: up (N), down (S), left (W), right (E). Frames are
 * SIT_FRAME_WIDTH x SIT_FRAME_HEIGHT. In every seated frame (the last transition frame and all
 * idle frames) the point where the pelvis rests on the seat is exactly at (SIT_ANCHOR_X,
 * SIT_ANCHOR_Y), so a sitter is drawn at `chair origin + seat - SIT_ANCHOR`.
 */
import { CAMERA_PITCH, type FrameGeometry } from './camera.ts';
import { facingYaw } from './directions.ts';
import { FACING_DIRECTION, FACINGS, SEAT_HEIGHT, type Facing } from './seating.ts';
import { STANDING_POSE, type WalkPose } from './walkCycle.ts';

export const SIT_DOWN_FRAME_COUNT = 6;
export const SIT_IDLE_FRAME_COUNT = 2;
export const SIT_FRAME_COUNT = SIT_DOWN_FRAME_COUNT + SIT_IDLE_FRAME_COUNT;

/** Suggested playback: the transition at a steady pace, the idle loop slow like breathing. */
export const SIT_DOWN_FRAME_MS = 90;
export const SIT_IDLE_FRAME_MS: readonly number[] = [900, 700];

/** Row order of every sit sheet: the chair facings of seating.ts. */
export const SIT_ROWS: readonly Facing[] = FACINGS;

export const SIT_FRAME_WIDTH = 44;
export const SIT_FRAME_HEIGHT = 58;

/** Pixel position (inside a sit frame) of the point where the pelvis rests on the seat. */
export const SIT_ANCHOR_X = 22;
export const SIT_ANCHOR_Y = 42;

/** Floor distance from the planted feet back to the pelvis, in sprite units (world, not screen). */
export const SEAT_BACK = 9;

/**
 * SEAT_BACK for one facing. Facing up or down the distance is foreshortened by the camera pitch,
 * so it is nudged to 3 / sin(pitch) (about 8.8) to keep the standing spot on whole pixels.
 */
export function seatBack(facing: Facing): number {
  return facing === 'up' || facing === 'down' ? 3 / Math.sin(CAMERA_PITCH) : SEAT_BACK;
}

/** Height of the seat surface in character space: SEAT_HEIGHT screen pixels after projection. */
export const SEAT_SURFACE_Y = SEAT_HEIGHT / Math.cos(CAMERA_PITCH);

export interface SitPose {
  /** 0 standing, 1 resting on the seat. Moves the pelvis back by SEAT_BACK and down. */
  readonly lower: number;
  /** Forward torso lean around the hips, in radians. */
  readonly lean: number;
  /** 0 arms as when standing, 1 hands resting on the thighs. */
  readonly hands: number;
  /** 0 at rest, 1 breathing in: the chest, arms and head rise by one screen pixel. */
  readonly breath: number;
}

export interface SeatedPose extends WalkPose {
  readonly sit: SitPose;
}

const DEG = Math.PI / 180;

function seated(sit: SitPose): SeatedPose {
  return { ...STANDING_POSE, sit };
}

const SEATED = seated({ lower: 1, lean: 0, hands: 1, breath: 0 });
const INHALE = seated({ lower: 1, lean: 0, hands: 1, breath: 1 });

const TRANSITION: readonly (WalkPose | SeatedPose)[] = [
  STANDING_POSE,
  seated({ lower: 0.16, lean: 12 * DEG, hands: 0.1, breath: 0 }),
  seated({ lower: 0.45, lean: 24 * DEG, hands: 0.3, breath: 0 }),
  seated({ lower: 0.78, lean: 27 * DEG, hands: 0.6, breath: 0 }),
  seated({ lower: 1, lean: 12 * DEG, hands: 0.9, breath: 0 }),
  SEATED,
];

const IDLE: readonly SeatedPose[] = [SEATED, INHALE];

function wrap(frame: number, count: number): number {
  const whole = Math.floor(frame);
  return ((whole % count) + count) % count;
}

/** Frame 0 is the standing idle pose, the last frame is the first seated idle frame. */
export function sitDownPose(frame: number): WalkPose | SeatedPose {
  const index = Math.min(SIT_DOWN_FRAME_COUNT - 1, Math.max(0, Math.floor(frame)));
  return TRANSITION[index] as WalkPose | SeatedPose;
}

export function sitIdlePose(frame: number): SeatedPose {
  return IDLE[wrap(frame, SIT_IDLE_FRAME_COUNT)] as SeatedPose;
}

/** Pose drawn in a sit sheet column. */
export function sitPose(column: number): WalkPose | SeatedPose {
  return column < SIT_DOWN_FRAME_COUNT ? sitDownPose(column) : sitIdlePose(column - SIT_DOWN_FRAME_COUNT);
}

/**
 * Where a character stands before sitting down, relative to the chair's seat point, in floor
 * pixels: the screen offset from the seated pelvis to the ground under the planted feet. Walk
 * the feet anchor to `chair origin + seat + STAND_OFFSET[facing]`, face FACING_DIRECTION[facing]
 * and play the transition: its first frame is the idle sprite, pixel for pixel.
 */
export const STAND_OFFSET: Readonly<Record<Facing, { readonly x: number; readonly y: number }>> = Object.fromEntries(
  FACINGS.map((facing) => {
    const yaw = facingYaw(FACING_DIRECTION[facing]);
    const back = seatBack(facing);
    const x = back * Math.sin(yaw);
    const y = SEAT_HEIGHT + back * Math.cos(yaw) * Math.sin(CAMERA_PITCH);
    // Whole pixels by construction; rounding only drops float noise (and the -0 of a tiny sine).
    return [facing, { x: Math.round(x) || 0, y: Math.round(y) }];
  }),
) as Record<Facing, { x: number; y: number }>;

/** Frame used to render one sit sheet row: the planted feet at STAND_OFFSET from the seat point. */
export function sitFrameGeometry(facing: Facing): FrameGeometry {
  return {
    width: SIT_FRAME_WIDTH,
    height: SIT_FRAME_HEIGHT,
    anchorX: SIT_ANCHOR_X + STAND_OFFSET[facing].x,
    anchorY: SIT_ANCHOR_Y + STAND_OFFSET[facing].y,
  };
}
