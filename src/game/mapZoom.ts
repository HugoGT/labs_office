/**
 * Pure rules of the map zoom (map-zoom): the fixed stops, how the effective
 * zoom approaches a stop, how wheel deltas become steps and which keys zoom.
 * Import-free on purpose (no Phaser, no DOM): `CameraZoomLayer` is the only
 * caller that touches real input and the camera, and `pnpm test` covers this.
 *
 * The zoom is client-only: it never reaches the server, the proximity radius
 * or the walking speed.
 */

/** The only zooms the office offers; 100% is where it always was. */
export const ZOOM_STOPS: readonly number[] = [0.5, 0.75, 1, 1.5, 2];
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_DEFAULT = 1;

/**
 * Smoothing, in log space so zooming in and out feel the same: each frame
 * covers `ZOOM_SMOOTHING` of the remaining log distance (same idea as
 * `glideStep`). About 27 frames from 1 to 2.
 */
export const ZOOM_SMOOTHING = 0.2;
/** Under this log distance to the target the zoom lands exactly on it. */
export const ZOOM_ARRIVE_LOG = 0.002;

/** Normalized wheel travel that makes one step (one classic mouse notch). */
export const WHEEL_STEP_PX = 100;
/**
 * Pixels per line and per page for the wheel delta modes that are not pixels.
 * A Firefox notch reports 3 lines, which must reach the step on its own.
 */
export const WHEEL_LINE_PX = 40;
export const WHEEL_PAGE_PX = 800;
/**
 * A trackpad pinch reaches the page as ctrl+wheel with deltas of a few pixels:
 * amplified so a natural pinch crosses the step threshold.
 */
export const PINCH_GAIN = 4;
/** A pause longer than this forgets what was accumulated. */
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
 * that is not a stop (or a `load` that throws) means 100%, because the camera
 * bounds divide by the zoom.
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
  /** Normalized travel accumulated toward the next step (signed, like `deltaY`). */
  sum: number;
  /** Clock of the last accepted event, to forget stale accumulation. */
  lastAt: number;
  /** Events before this clock are dropped. */
  cooldownUntil: number;
}

export const INITIAL_WHEEL_STATE: Readonly<WheelState> = { sum: 0, lastAt: 0, cooldownUntil: 0 };

export interface WheelInput {
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  now: number;
}

const ignored = (state: WheelState): { state: WheelState; step: 0 } => ({ state, step: 0 });

/**
 * Turns wheel events into zoom steps (`1` in, `-1` out, `0` nothing yet): the
 * delta is normalized across delta modes and accumulated, so one notch gives
 * at most one step whatever the device reports.
 */
export function accumulateWheel(
  state: WheelState,
  { deltaY, deltaMode, ctrlKey, now }: WheelInput,
): { state: WheelState; step: -1 | 0 | 1 } {
  if (!Number.isFinite(deltaY) || deltaY === 0) return ignored(state);
  if (now < state.cooldownUntil) return ignored(state);

  const perUnit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  const travel = deltaY * perUnit * (ctrlKey ? PINCH_GAIN : 1);

  const idle = now - state.lastAt > WHEEL_IDLE_MS;
  const flipped = Math.sign(state.sum) * Math.sign(travel) < 0;
  const sum = (idle || flipped ? 0 : state.sum) + travel;

  if (Math.abs(sum) >= WHEEL_STEP_PX) {
    return {
      state: { sum: 0, lastAt: now, cooldownUntil: now + WHEEL_COOLDOWN_MS },
      step: sum < 0 ? 1 : -1,
    };
  }
  return { state: { sum, lastAt: now, cooldownUntil: state.cooldownUntil }, step: 0 };
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

export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function zoomView(target: number): ZoomView {
  return { zoom: target, canZoomIn: target < ZOOM_MAX, canZoomOut: target > ZOOM_MIN };
}
