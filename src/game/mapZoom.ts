/**
 * Pure rules of the map zoom (map-zoom): the fixed stops, how the effective
 * zoom approaches a stop, how wheel deltas become steps and which keys zoom.
 * Import-free on purpose (no Phaser, no DOM): `CameraZoomLayer` is the only
 * caller that touches real input and the camera, and `pnpm test` covers this.
 *
 * The zoom is client-only: it never reaches the server, the proximity radius
 * or the walking speed.
 */

/**
 * The only zooms the office offers, shown as 1x, 2x and 3x (`zoomLabel`); the
 * office opens at 2x. Integers on purpose: the game renders with `pixelArt`
 * and `roundPixels`, and Phaser only renders pixel-exact at an integer camera
 * zoom (`renderRoundPixels`). Fractional stops (0.75, 1.5, 2.25) showed seams
 * between tiles and flickering character details. A stored zoom that is not
 * one of these restores to the default.
 */
export const ZOOM_STOPS: readonly number[] = [1, 2, 3];
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ZOOM_DEFAULT = 2;

/**
 * Smoothing, in log space so zooming in and out feel the same: each frame
 * covers `ZOOM_SMOOTHING` of the remaining log distance (same idea as
 * `glideStep`). About 24 to 27 frames from one stop to the next.
 */
export const ZOOM_SMOOTHING = 0.2;
/** Under this log distance to the target the zoom lands exactly on it. */
export const ZOOM_ARRIVE_LOG = 0.002;

/**
 * A single plain-wheel event this large is a mouse notch: notches differ per
 * browser and OS (Chrome on Linux sends about 53 px, not 100), so a notch
 * counts as one whatever the device reports.
 */
export const WHEEL_NOTCH_MIN_PX = 40;
/**
 * Notches in the same direction that make one step. One notch alone never
 * zooms (the slightest touch of the wheel sends one), and three felt slow.
 */
export const WHEEL_NOTCHES_PER_STEP = 2;
/**
 * A pause between notches longer than this restarts the count: long enough for
 * a slow, deliberate turn, short enough that a stray touch decays.
 */
export const WHEEL_NOTCH_IDLE_MS = 600;
/** Accumulated travel of smaller deltas (trackpad, pinch) that makes one step. */
export const WHEEL_STEP_PX = 100;
/**
 * Pixels per line and per page for the wheel delta modes that are not pixels.
 * A Firefox notch reports 3 lines, which must count as one notch on its own.
 */
export const WHEEL_LINE_PX = 40;
export const WHEEL_PAGE_PX = 800;
/**
 * A trackpad pinch reaches the page as ctrl+wheel with deltas of a few pixels:
 * amplified so a natural pinch crosses the step threshold.
 */
export const PINCH_GAIN = 4;
/** A pause longer than this forgets the accumulated small-delta travel. */
export const WHEEL_IDLE_MS = 250;
/** After a step, wheel input is dropped for this long (inertia, fast spins). */
export const WHEEL_COOLDOWN_MS = 180;

export type ZoomAction = 'in' | 'out' | 'reset';

/** What the UI needs to know: the TARGET stop, never the animated value. */
export interface ZoomView {
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/** Persistence seam of the chosen zoom; `zoomStore.ts` is the adapter. */
export interface ZoomStore {
  load(): number;
  save(zoom: number): void;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function isZoomStop(zoom: unknown): zoom is number {
  return typeof zoom === 'number' && ZOOM_STOPS.includes(zoom);
}

/**
 * The first stop strictly beyond `target` in the direction asked, or the limit
 * when there is none. Stepping starts from the TARGET, not the animated zoom,
 * so presses during an animation chain stops.
 */
export function nextZoomStop(target: number, direction: 1 | -1): number {
  const from = clampZoom(target);
  if (direction === 1) return ZOOM_STOPS.find((stop) => stop > from) ?? ZOOM_MAX;
  return [...ZOOM_STOPS].reverse().find((stop) => stop < from) ?? ZOOM_MIN;
}

/**
 * The zoom to start at. A store is an outside boundary: whatever it returns
 * that is not a stop (or a `load` that throws) means the default, because the
 * camera bounds divide by the zoom.
 */
export function restoreZoom(store?: ZoomStore): number {
  try {
    const stored = store?.load();
    return isZoomStop(stored) ? stored : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

export function applyZoomAction(target: number, action: ZoomAction): number {
  if (action === 'reset') return ZOOM_DEFAULT;
  return nextZoomStop(target, action === 'in' ? 1 : -1);
}

/** One frame of the approach to `target`; lands exactly on it once close enough. */
export function zoomStep(
  current: number,
  target: number,
  smoothing: number = ZOOM_SMOOTHING,
): { value: number; arrived: boolean } {
  const next = current * Math.exp(smoothing * Math.log(target / current));
  if (Math.abs(Math.log(target / next)) < ZOOM_ARRIVE_LOG) return { value: target, arrived: true };
  return { value: next, arrived: false };
}

export interface WheelState {
  /** Small-delta travel (trackpad, pinch) accumulated toward the next step, signed like `deltaY`. */
  sum: number;
  /** Mouse notches counted toward the next step, signed like `deltaY`. */
  notches: number;
  /** Clock of the last accepted event, to forget stale accumulation and notches. */
  lastAt: number;
  /** Events before this clock are dropped. */
  cooldownUntil: number;
}

export const INITIAL_WHEEL_STATE: Readonly<WheelState> = { sum: 0, notches: 0, lastAt: 0, cooldownUntil: 0 };

export interface WheelInput {
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  now: number;
}

type WheelResult = { state: WheelState; step: -1 | 0 | 1 };

const ignored = (state: WheelState): WheelResult => ({ state, step: 0 });

/** A step: both counters start over and the cooldown begins. Scroll up (negative) zooms in. */
const stepped = (now: number, signed: number): WheelResult => ({
  state: { sum: 0, notches: 0, lastAt: now, cooldownUntil: now + WHEEL_COOLDOWN_MS },
  step: signed < 0 ? 1 : -1,
});

/**
 * Turns wheel events into zoom steps (`1` in, `-1` out, `0` nothing yet). The
 * delta is normalized across delta modes. A plain notch counts toward
 * `WHEEL_NOTCHES_PER_STEP` in the same direction (a flip or a pause over
 * `WHEEL_NOTCH_IDLE_MS` restarts the count) and clears the small-delta travel;
 * smaller deltas (trackpad, pinch) accumulate to `WHEEL_STEP_PX` and leave the
 * notch count alone. The cooldown after a step keeps a fast spin to one step
 * at a time. The given state is never mutated.
 */
export function accumulateWheel(
  state: WheelState,
  { deltaY, deltaMode, ctrlKey, now }: WheelInput,
): WheelResult {
  if (!Number.isFinite(deltaY) || deltaY === 0) return ignored(state);
  if (now < state.cooldownUntil) return ignored(state);

  const perUnit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  const travel = deltaY * perUnit * (ctrlKey ? PINCH_GAIN : 1);
  const direction = Math.sign(travel);

  if (!ctrlKey && Math.abs(travel) >= WHEEL_NOTCH_MIN_PX) {
    const stale = now - state.lastAt > WHEEL_NOTCH_IDLE_MS;
    const flipped = Math.sign(state.notches) * direction < 0;
    const notches = (stale || flipped ? 0 : state.notches) + direction;
    if (Math.abs(notches) >= WHEEL_NOTCHES_PER_STEP) return stepped(now, notches);
    return { state: { ...state, sum: 0, notches, lastAt: now }, step: 0 };
  }

  const idle = now - state.lastAt > WHEEL_IDLE_MS;
  const flipped = Math.sign(state.sum) * direction < 0;
  const sum = (idle || flipped ? 0 : state.sum) + travel;
  if (Math.abs(sum) >= WHEEL_STEP_PX) return stepped(now, sum);
  return { state: { ...state, sum, lastAt: now }, step: 0 };
}

export interface ZoomKeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

/**
 * The zoom action a keydown asks for, if any. Shift is deliberately not an
 * input: `+` is shift+`=` on many layouts. Ctrl/meta/alt belong to browser
 * shortcuts, and a held key must not race to the limit.
 */
export function zoomKeyAction(event: ZoomKeyInput): ZoomAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
  if (event.key === '-' || event.code === 'NumpadSubtract') return 'out';
  if (event.key === '0' || event.code === 'Numpad0') return 'reset';
  return null;
}

/**
 * The control's readout: the camera zoom itself, so the stops read 1x, 2x and
 * 3x. A value between stops keeps at most two decimals.
 */
export function zoomLabel(zoom: number): string {
  return `${Number(zoom.toFixed(2))}x`;
}

export function zoomView(target: number): ZoomView {
  return { zoom: target, canZoomIn: target < ZOOM_MAX, canZoomOut: target > ZOOM_MIN };
}
