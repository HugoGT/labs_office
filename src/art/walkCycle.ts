/**
 * Pure description of a 10-frame walk cycle.
 *
 * Frame 0: contact, left leg forward. Frame 5: contact, right leg forward.
 * Frames 2-3 and 7-8: passing poses, legs together and the body at its highest point.
 * The cycle is a sampled sine wave, so frame 9 flows back into frame 0 without a seam.
 */
export const WALK_FRAME_COUNT = 10;

/** Hip joint to ankle, in sprite units (1 unit is about 1 pixel). */
export const LEG_LENGTH = 18;
/** Largest hip rotation during the stride, in radians. */
export const MAX_HIP_SWING = (22 * Math.PI) / 180;
/**
 * Ground covered by one full cycle (two steps). Each step moves the body by the distance
 * between both feet at contact, so advancing frames by distance keeps feet planted.
 */
export const STRIDE_PER_CYCLE = 4 * LEG_LENGTH * Math.sin(MAX_HIP_SWING);

export interface LegPose {
  /** -1 fully back, 0 under the hip, 1 fully forward. */
  readonly swing: number;
  /** 0 planted, 1 highest foot lift. Only the leg swinging forward lifts. */
  readonly lift: number;
}

export interface WalkPose {
  readonly legs: { readonly left: LegPose; readonly right: LegPose };
  /** Arm swing, same scale as leg swing, always opposite to the leg on the same side. */
  readonly arms: { readonly left: number; readonly right: number };
  /** 0 at contact (lowest), 1 at passing (highest). */
  readonly bob: number;
}

export const STANDING_POSE: WalkPose = {
  legs: { left: { swing: 0, lift: 0 }, right: { swing: 0, lift: 0 } },
  arms: { left: 0, right: 0 },
  bob: 0,
};

function clean(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

export function normalizeFrame(frame: number): number {
  const whole = Math.floor(frame);
  return ((whole % WALK_FRAME_COUNT) + WALK_FRAME_COUNT) % WALK_FRAME_COUNT;
}

export function walkPose(frame: number): WalkPose {
  const phase = (normalizeFrame(frame) / WALK_FRAME_COUNT) * Math.PI * 2;
  const swing = clean(Math.cos(phase));
  const velocity = clean(Math.sin(phase));
  return {
    legs: {
      left: { swing, lift: Math.max(0, -velocity) },
      right: { swing: clean(-swing), lift: Math.max(0, velocity) },
    },
    arms: { left: clean(-swing), right: swing },
    bob: Math.abs(velocity),
  };
}
