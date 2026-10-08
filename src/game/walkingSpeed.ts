/** Continuous, collision-resolved walking; direction and input source do not reset it. */
export const MAX_WALK_FRAME_MS = 250;
/** One more multiple of the base speed every 1.5 s of continuous walking, up to 3x. */
const WALK_RAMP_STEP_MS = 1500;
const MAX_WALK_MULTIPLIER = 3;
const MAX_WALK_RAMP_MS = (MAX_WALK_MULTIPLIER - 1) * WALK_RAMP_STEP_MS;

export function walkingMultiplier(continuousMs: number): number {
  return 1 + Math.floor(Math.min(MAX_WALK_RAMP_MS, Math.max(0, continuousMs)) / WALK_RAMP_STEP_MS);
}

export function advanceWalkingTime(continuousMs: number, moved: boolean, deltaMs: number): number {
  // A suspended tab must restart, not credit wall-clock time or catch up a sprint.
  if (!moved || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > MAX_WALK_FRAME_MS) return 0;
  return Math.min(MAX_WALK_RAMP_MS, continuousMs + deltaMs);
}
