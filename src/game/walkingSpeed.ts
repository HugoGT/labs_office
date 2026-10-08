/** Continuous, collision-resolved walking; direction and input source do not reset it. */
export const MAX_WALK_FRAME_MS = 250;
/** One more multiple of the base speed every 1.5 s of continuous walking, up to 3x. */
const WALK_RAMP_STEP_MS = 1500;
const MAX_WALK_MULTIPLIER = 3;
const MAX_WALK_RAMP_MS = (MAX_WALK_MULTIPLIER - 1) * WALK_RAMP_STEP_MS;

export function walkingMultiplier(continuousMs: number): number {
  return 1 + Math.floor(Math.min(MAX_WALK_RAMP_MS, Math.max(0, continuousMs)) / WALK_RAMP_STEP_MS);
}

/** A bump, a turn between keys or a short stop keeps the speed; only this long without moving drops it. */
const WALK_GRACE_MS = 1000;

export interface WalkingTime {
  continuousMs: number;
  idleMs: number;
}

export function advanceWalkingTime(continuousMs: number, idleMs: number, moved: boolean, deltaMs: number): WalkingTime {
  // A suspended tab must restart, not credit wall-clock time or catch up a sprint.
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > MAX_WALK_FRAME_MS) return { continuousMs: 0, idleMs: 0 };
  if (moved) return { continuousMs: Math.min(MAX_WALK_RAMP_MS, continuousMs + deltaMs), idleMs: 0 };
  // Held, never credited: time spent blocked or standing does not ramp.
  const idle = idleMs + deltaMs;
  return idle >= WALK_GRACE_MS ? { continuousMs: 0, idleMs: 0 } : { continuousMs, idleMs: idle };
}
