/** Continuous, collision-resolved walking; direction and input source do not reset it. */
export const MAX_WALK_FRAME_MS = 250;

export function walkingMultiplier(continuousMs: number): number {
  return 1 + Math.floor(Math.min(8000, Math.max(0, continuousMs)) / 2000);
}

export function advanceWalkingTime(continuousMs: number, moved: boolean, deltaMs: number): number {
  // A suspended tab must restart, not credit wall-clock time or catch up a sprint.
  if (!moved || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > MAX_WALK_FRAME_MS) return 0;
  return Math.min(8000, continuousMs + deltaMs);
}
