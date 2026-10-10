/**
 * Push-to-sit (no E key): walking into a free chair from right next to it
 * sits the player. Pure and import-free, so the rules are tested without
 * Phaser; `OfficeScene` feeds it the keyboard input, the feet and the free
 * seats every frame and does the sitting.
 */

export interface SitPoint {
  readonly x: number;
  readonly y: number;
}

/** Keyboard direction this frame, each axis -1, 0 or 1 (auto-walk never counts). */
export interface SitInput {
  readonly vx: number;
  readonly vy: number;
}

/**
 * A free seat (nobody on it, a desk the player may use). `inReach` is
 * `inSeatReach` for the player's position, the room's own rule, so the
 * scene never asks for a seat the room would refuse.
 */
export interface SitCandidate {
  readonly id: string;
  /** Chair ground point, where the sitter's feet go. */
  readonly ground: SitPoint;
  readonly inReach: boolean;
}

/** "Next to" the chair: feet within 1.25 tiles of its ground point. */
export const SIT_NEAR_PX = 40;
/**
 * Feet this close to the ground point are on the chair. There the push has
 * no meaningful direction, and a push that began off the chair has arrived:
 * chairs do not collide by default, so a push from the next tile walks onto
 * (and over) the chair well before `SIT_PUSH_MS`, and arriving sits at once.
 */
export const SIT_ON_SEAT_PX = 10;
/** The input must point at the chair: cosine with feet-to-ground of at least this (about 45 degrees). */
export const SIT_DIRECTION_MIN_COS = 0.7;
/**
 * How long the push must last toward the same chair when it does not arrive
 * on it, for a chair the player is pushed against (a collision, a table). A
 * brush past a desk is shorter, and so is stepping off a chair.
 */
export const SIT_PUSH_MS = 150;
/** After asking to sit, movement input is ignored this long, then it stands the player up. */
export const SIT_LOCK_MS = 1000;

export interface AutoSitState {
  /**
   * The seat being pushed toward, since when (game clock) and whether the
   * push began on it: only a push from off the chair can arrive.
   */
  readonly push: { readonly seatId: string; readonly sinceMs: number; readonly fromOff: boolean } | null;
  /**
   * The seat just left. Standing up by walking keeps the key held, often
   * still toward the chair; this seat is ignored until the input is released
   * or the player leaves its reach, so standing up never sits again at once.
   */
  readonly guard: string | null;
}

export const IDLE_AUTO_SIT: AutoSitState = { push: null, guard: null };

/** The closest seat the input pushes into, skipping `ignore`; `null` without input. */
export function pushTarget<T extends SitCandidate>(
  feet: SitPoint,
  input: SitInput,
  candidates: readonly T[],
  ignore: string | null,
): T | null {
  const inputLength = Math.hypot(input.vx, input.vy);
  if (!Number.isFinite(inputLength) || inputLength === 0 || !Number.isFinite(feet.x) || !Number.isFinite(feet.y)) return null;
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const seat of candidates) {
    if (seat.id === ignore || !seat.inReach) continue;
    const dx = seat.ground.x - feet.x;
    const dy = seat.ground.y - feet.y;
    const distance = Math.hypot(dx, dy);
    if (!(distance <= SIT_NEAR_PX) || distance >= bestDistance) continue;
    const onSeat = distance <= SIT_ON_SEAT_PX;
    if (!onSeat && (input.vx * dx + input.vy * dy) / (inputLength * distance) < SIT_DIRECTION_MIN_COS) continue;
    best = seat;
    bestDistance = distance;
  }
  return best;
}

/**
 * One frame while standing and free to sit. Returns the seat to ask for once
 * the push toward it has lasted `SIT_PUSH_MS`, or as soon as a push that
 * began off the chair reaches it; a stop, a turn or another target starts
 * over.
 */
export function stepAutoSit<T extends SitCandidate>(
  state: AutoSitState,
  frame: { readonly nowMs: number; readonly feet: SitPoint; readonly input: SitInput; readonly candidates: readonly T[] },
): { state: AutoSitState; sit: T | null } {
  const idle = frame.input.vx === 0 && frame.input.vy === 0;
  const guarded = state.guard === null ? undefined : frame.candidates.find((seat) => seat.id === state.guard);
  const guard = idle || guarded === undefined || !guarded.inReach ? null : state.guard;
  const target = pushTarget(frame.feet, frame.input, frame.candidates, guard);
  if (target === null) return { state: { push: null, guard }, sit: null };
  const onSeat = Math.hypot(target.ground.x - frame.feet.x, target.ground.y - frame.feet.y) <= SIT_ON_SEAT_PX;
  if (state.push === null || state.push.seatId !== target.id) {
    return { state: { push: { seatId: target.id, sinceMs: frame.nowMs, fromOff: !onSeat }, guard }, sit: null };
  }
  const arrived = state.push.fromOff && onSeat;
  if (!arrived && frame.nowMs - state.push.sinceMs < SIT_PUSH_MS) return { state: { push: state.push, guard }, sit: null };
  return { state: { push: null, guard }, sit: target };
}

/** The player stood up from `seatId`: guard it against an immediate re-sit and drop any dwell. */
export function guardLeftSeat(seatId: string): AutoSitState {
  return { push: null, guard: seatId };
}

/** Whether movement is still locked after a sit request (`lockUntilMs` is request time + `SIT_LOCK_MS`). */
export function sitLockActive(lockUntilMs: number | null, nowMs: number): boolean {
  return lockUntilMs !== null && nowMs < lockUntilMs;
}
