/**
 * Sitting without an E key: walking into a free chair from right next to it
 * (push) or standing still next to one (idle) sits the player. Pure and
 * import-free, so the rules are tested without Phaser; `OfficeScene` feeds it
 * the keyboard input, whether an auto-walk is running, the feet and the free
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
 * The idle rule's "next to", tighter than the push one: chairs in a row stand
 * one tile (32 px) apart, so 40 px would reach the neighbours of the chair
 * the player stands in front of. At 28 px only a strip between two chairs
 * reaches both, and the closest one wins there.
 */
export const SIT_IDLE_NEAR_PX = 28;
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
/** After a push sit request, movement input is ignored this long, then it stands the player up. */
export const SIT_LOCK_MS = 1000;
/**
 * Standing still (no key, no auto-walk) this long next to the same free
 * chair sits on it: someone who walks up to a chair and stops, or whose
 * double-click walk ends by one, means to sit. Long enough that a pause on
 * the way past a chair does not.
 */
export const SIT_IDLE_MS = 500;
/**
 * After standing up, the idle rule sits on no chair for `SIT_AGAIN_OTHER_MS`
 * and skips the chair left for `SIT_AGAIN_SAME_MS`: whoever stands up beside
 * a row of chairs gets a moment to walk off before any chair takes them, and
 * a longer one before the same chair does. Time only, never the reach, so
 * stepping out and back in does not lift it early.
 */
export const SIT_AGAIN_SAME_MS = 3000;
export const SIT_AGAIN_OTHER_MS = 1000;

/** Which rule asked for the seat: only a push holds keys that need `SIT_LOCK_MS`. */
export type SitVia = 'push' | 'idle';

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
  /** The seat closest to still feet, since when (game clock). */
  readonly idle: { readonly seatId: string; readonly sinceMs: number } | null;
  /**
   * The seat just left and when (game clock), for the idle rule: no idle sit
   * until `SIT_AGAIN_OTHER_MS` later, and none on that seat until
   * `SIT_AGAIN_SAME_MS` later. Releasing the keys does not lift it (standing
   * still is exactly what the idle rule waits for); only time does.
   */
  readonly rest: { readonly seatId: string; readonly sinceMs: number } | null;
}

/** Nothing in progress and nothing guarded (not "standing still"). */
export const IDLE_AUTO_SIT: AutoSitState = { push: null, guard: null, idle: null, rest: null };

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

/** The closest seat in reach whose ground point is within `SIT_IDLE_NEAR_PX` of the feet. */
export function idleTarget<T extends SitCandidate>(feet: SitPoint, candidates: readonly T[]): T | null {
  if (!Number.isFinite(feet.x) || !Number.isFinite(feet.y)) return null;
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const seat of candidates) {
    if (!seat.inReach) continue;
    const distance = Math.hypot(seat.ground.x - feet.x, seat.ground.y - feet.y);
    if (!(distance <= SIT_IDLE_NEAR_PX) || distance >= bestDistance) continue;
    best = seat;
    bestDistance = distance;
  }
  return best;
}

export interface AutoSitFrame<T extends SitCandidate> {
  readonly nowMs: number;
  readonly feet: SitPoint;
  /** Keyboard only. */
  readonly input: SitInput;
  /** An auto-walk (double click, walk to a peer) is steering the player: not standing still. */
  readonly walking: boolean;
  readonly candidates: readonly T[];
}

export type AutoSitStep<T extends SitCandidate> =
  | { readonly state: AutoSitState; readonly sit: T; readonly via: SitVia }
  | { readonly state: AutoSitState; readonly sit: null; readonly via: null };

/** The guard still holds while its seat is offered and in reach. */
function heldGuard(guard: string | null, candidates: readonly SitCandidate[]): string | null {
  if (guard === null) return null;
  return candidates.find((seat) => seat.id === guard)?.inReach === true ? guard : null;
}

/**
 * One frame while standing and free to sit. With input, returns the seat to
 * ask for once the push toward it has lasted `SIT_PUSH_MS`, or as soon as a
 * push that began off the chair reaches it; a stop, a turn or another target
 * starts over. Standing still (no input, no auto-walk), returns the closest
 * seat next to the feet once it has stayed the closest for `SIT_IDLE_MS`;
 * any input, an auto-walk or another closest seat starts over.
 */
export function stepAutoSit<T extends SitCandidate>(state: AutoSitState, frame: AutoSitFrame<T>): AutoSitStep<T> {
  const noInput = frame.input.vx === 0 && frame.input.vy === 0;
  const guard = noInput ? null : heldGuard(state.guard, frame.candidates);
  const restedMs = state.rest === null ? Number.POSITIVE_INFINITY : frame.nowMs - state.rest.sinceMs;
  const rest = restedMs < SIT_AGAIN_SAME_MS ? state.rest : null;
  const none = (push: AutoSitState['push'], idle: AutoSitState['idle']): AutoSitStep<T> =>
    ({ state: { push, guard, idle, rest }, sit: null, via: null });
  const sit = (seat: T, via: SitVia): AutoSitStep<T> =>
    ({ state: { push: null, guard, idle: null, rest }, sit: seat, via });

  if (noInput) {
    if (frame.walking || restedMs < SIT_AGAIN_OTHER_MS) return none(null, null);
    // The closest chair only: while it is the seat left and still resting,
    // the player waits for it instead of landing on the one beside it.
    const target = idleTarget(frame.feet, frame.candidates);
    if (target === null || target.id === rest?.seatId) return none(null, null);
    if (state.idle === null || state.idle.seatId !== target.id) return none(null, { seatId: target.id, sinceMs: frame.nowMs });
    if (frame.nowMs - state.idle.sinceMs < SIT_IDLE_MS) return none(null, state.idle);
    return sit(target, 'idle');
  }

  const target = pushTarget(frame.feet, frame.input, frame.candidates, guard);
  if (target === null) return none(null, null);
  const onSeat = Math.hypot(target.ground.x - frame.feet.x, target.ground.y - frame.feet.y) <= SIT_ON_SEAT_PX;
  if (state.push === null || state.push.seatId !== target.id) {
    return none({ seatId: target.id, sinceMs: frame.nowMs, fromOff: !onSeat }, null);
  }
  const arrived = state.push.fromOff && onSeat;
  if (!arrived && frame.nowMs - state.push.sinceMs < SIT_PUSH_MS) return none(state.push, null);
  return sit(target, 'push');
}

/** The player stood up from `seatId` at `nowMs`: guard it against an immediate re-sit by either rule and drop any dwell. */
export function guardLeftSeat(seatId: string, nowMs: number): AutoSitState {
  return { push: null, guard: seatId, idle: null, rest: { seatId, sinceMs: nowMs } };
}

/** Walking was interrupted or sitting is not possible right now: both dwells start over, both guards stay. */
export function dropSitDwells(state: AutoSitState): AutoSitState {
  return { push: null, guard: state.guard, idle: null, rest: state.rest };
}

/** Whether movement is still locked after a sit request (`lockUntilMs` is request time + `SIT_LOCK_MS`). */
export function sitLockActive(lockUntilMs: number | null, nowMs: number): boolean {
  return lockUntilMs !== null && nowMs < lockUntilMs;
}
