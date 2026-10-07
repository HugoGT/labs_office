import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_WHEEL_STATE,
  WHEEL_COOLDOWN_MS,
  WHEEL_IDLE_MS,
  WHEEL_STEP_PX,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STOPS,
  accumulateWheel,
  applyZoomAction,
  clampZoom,
  isZoomStop,
  nextZoomStop,
  restoreZoom,
  zoomKeyAction,
  zoomPercent,
  zoomStep,
  zoomView,
  type WheelState,
  type ZoomStore,
} from './mapZoom';

/** Pure rules of the map zoom: stops, smoothing, wheel accumulation, keys. */

describe('zoom stops', () => {
  it('are the five fixed stops, with 100% as the default', () => {
    expect([...ZOOM_STOPS]).toEqual([0.5, 0.75, 1, 1.5, 2]);
    expect([ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT]).toEqual([0.5, 2, 1]);
  });

  it.each([
    { from: 1, direction: 1 as const, expected: [1.5, 2, 2] },
    { from: 1, direction: -1 as const, expected: [0.75, 0.5, 0.5] },
  ])('stepping from $from toward $direction clamps at the limit', ({ from, direction, expected }) => {
    const first = nextZoomStop(from, direction);
    const second = nextZoomStop(first, direction);
    const third = nextZoomStop(second, direction);

    expect([first, second, third]).toEqual(expected);
  });

  it('a value between stops moves to the first stop beyond it, out of range lands on the limit', () => {
    expect(nextZoomStop(1.2, 1)).toBe(1.5);
    expect(nextZoomStop(1.2, -1)).toBe(1);
    expect(nextZoomStop(3, 1)).toBe(2);
    expect(nextZoomStop(0.1, -1)).toBe(0.5);
    expect(nextZoomStop(Number.NaN, 1)).toBe(1.5);
  });

  it('applyZoomAction steps from the target; reset goes back to 100%', () => {
    expect(applyZoomAction(1, 'in')).toBe(1.5);
    expect(applyZoomAction(1, 'out')).toBe(0.75);
    expect(applyZoomAction(2, 'in')).toBe(2);
    expect(applyZoomAction(0.5, 'out')).toBe(0.5);
    expect(applyZoomAction(2, 'reset')).toBe(1);
  });
});

describe('clampZoom and isZoomStop', () => {
  it('clamps into the range, keeps in-range values and turns non-finite into the default', () => {
    expect(clampZoom(5)).toBe(2);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('recognizes only the stops, and only numbers', () => {
    for (const stop of ZOOM_STOPS) expect(isZoomStop(stop)).toBe(true);
    for (const other of [1.25, '1', null, Number.NaN]) expect(isZoomStop(other)).toBe(false);
  });
});

describe('zoomStep: smoothing in log space', () => {
  it('moves by a fraction of the log distance: 0.5 to 2 at k=0.5 lands on 1', () => {
    const step = zoomStep(0.5, 2, 0.5);

    expect(step.value).toBeCloseTo(1, 10);
    expect(step.arrived).toBe(false);
  });

  it.each([
    { from: 1, to: 2 },
    { from: 1, to: 0.5 },
  ])('goes monotonically from $from to $to over several frames and lands exactly on it', ({ from, to }) => {
    const direction = Math.sign(to - from);
    let current = from;
    let frames = 0;

    for (let arrived = false; !arrived && frames < 60; frames++) {
      const step = zoomStep(current, to);
      expect(Math.sign(step.value - current)).toBe(direction);
      expect(Math.sign(to - step.value)).not.toBe(-direction);
      current = step.value;
      arrived = step.arrived;
    }

    expect(current).toBe(to);
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThanOrEqual(30);
  });

  it('on the target, or under the arrival threshold, it is arrived exactly there', () => {
    expect(zoomStep(1.5, 1.5)).toEqual({ value: 1.5, arrived: true });
    expect(zoomStep(1.999, 2)).toEqual({ value: 2, arrived: true });
  });
});

describe('accumulateWheel', () => {
  const wheel = (
    state: WheelState,
    event: { deltaY: number; deltaMode?: number; ctrlKey?: boolean; now: number },
  ) => accumulateWheel(state, { deltaMode: 0, ctrlKey: false, ...event });
  const stepsOf = (deltas: number[], ctrlKey = false): number[] => {
    let state: WheelState = INITIAL_WHEEL_STATE;
    return deltas.map((deltaY, i) => {
      const result = wheel(state, { deltaY, ctrlKey, now: 1000 + i * 16 });
      state = result.state;
      return result.step;
    });
  };

  it.each([
    { name: 'a pixel-mode notch', deltaY: 100, deltaMode: 0 },
    { name: 'a Firefox notch (3 lines)', deltaY: 3, deltaMode: 1 },
    { name: 'a page step', deltaY: 1, deltaMode: 2 },
  ])('$name is one step: up zooms in, down zooms out', ({ deltaY, deltaMode }) => {
    expect(wheel(INITIAL_WHEEL_STATE, { deltaY: -deltaY, deltaMode, now: 1000 }).step).toBe(1);
    expect(wheel(INITIAL_WHEEL_STATE, { deltaY, deltaMode, now: 1000 }).step).toBe(-1);
  });

  it('small trackpad deltas accumulate; exactly the threshold steps, one pixel under does not', () => {
    expect(stepsOf([-30, -30, -30, -30])).toEqual([0, 0, 0, 1]);
    expect(stepsOf([WHEEL_STEP_PX - 1])).toEqual([0]);
    expect(stepsOf([WHEEL_STEP_PX])).toEqual([-1]);
  });

  it('ctrl+wheel (pinch) is amplified: small deltas step with ctrl, not without', () => {
    expect(stepsOf([-10, -10, -10], true)).toEqual([0, 0, 1]);
    expect(stepsOf([-10, -10, -10], false)).toEqual([0, 0, 0]);
  });

  it('a notch inside the cooldown is dropped and one right after it steps again', () => {
    const first = wheel(INITIAL_WHEEL_STATE, { deltaY: -WHEEL_STEP_PX, now: 1000 });
    const during = wheel(first.state, { deltaY: -WHEEL_STEP_PX, now: 1000 + WHEEL_COOLDOWN_MS - 1 });
    const after = wheel(first.state, { deltaY: -WHEEL_STEP_PX, now: 1000 + WHEEL_COOLDOWN_MS });

    expect([first.step, during.step, after.step]).toEqual([1, 0, 1]);
  });

  it('a direction flip discards what was accumulated the other way', () => {
    // Without the rule, half a notch down then a full notch up sums to -40: no step.
    const half = wheel(INITIAL_WHEEL_STATE, { deltaY: 60, now: 1000 });
    const flipped = wheel(half.state, { deltaY: -WHEEL_STEP_PX, now: 1016 });

    expect([half.step, flipped.step]).toEqual([0, 1]);
  });

  it('a pause longer than the idle window discards what was accumulated', () => {
    const first = wheel(INITIAL_WHEEL_STATE, { deltaY: 60, now: 1000 });
    const soon = wheel(first.state, { deltaY: 60, now: 1000 + WHEEL_IDLE_MS });
    const late = wheel(first.state, { deltaY: 60, now: 1000 + WHEEL_IDLE_MS + 1 });

    expect([soon.step, late.step]).toEqual([-1, 0]);
  });

  it('a wheel with no vertical delta changes nothing, and the given state is never mutated', () => {
    const half = wheel(INITIAL_WHEEL_STATE, { deltaY: 60, now: 1000 });
    const snapshot = { ...half.state };
    const sideways = wheel(half.state, { deltaY: 0, now: 1100 });

    expect(sideways).toEqual({ state: snapshot, step: 0 });
    expect(half.state).toEqual(snapshot);
  });
});

describe('zoomKeyAction', () => {
  const press = (
    key: string,
    extra: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {},
  ) => zoomKeyAction({ key, code: '', ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra });

  it.each([
    { key: '+', code: '', action: 'in' },
    { key: '=', code: 'Equal', action: 'in' },
    { key: '+', code: 'NumpadAdd', action: 'in' },
    { key: '-', code: '', action: 'out' },
    { key: '-', code: 'NumpadSubtract', action: 'out' },
    { key: '0', code: '', action: 'reset' },
    { key: 'Insert', code: 'Numpad0', action: 'reset' },
    { key: 'a', code: 'KeyA', action: null },
    { key: '1', code: 'Digit1', action: null },
  ])('key "$key" ($code) maps to $action', ({ key, code, action }) => {
    expect(press(key, { code })).toBe(action);
  });

  it('is null with ctrl, meta or alt held, or on a held key', () => {
    expect(press('+', { ctrlKey: true })).toBeNull();
    expect(press('-', { metaKey: true })).toBeNull();
    expect(press('0', { altKey: true })).toBeNull();
    expect(press('+', { repeat: true })).toBeNull();
  });
});

describe('zoomPercent and zoomView', () => {
  it('formats every stop as a rounded percent', () => {
    expect(ZOOM_STOPS.map(zoomPercent)).toEqual(['50%', '75%', '100%', '150%', '200%']);
    expect(zoomPercent(1 / 3)).toBe('33%');
  });

  it('flags the limits: nothing further out at 50%, nothing further in at 200%', () => {
    expect(zoomView(0.5)).toEqual({ zoom: 0.5, canZoomIn: true, canZoomOut: false });
    expect(zoomView(1)).toEqual({ zoom: 1, canZoomIn: true, canZoomOut: true });
    expect(zoomView(2)).toEqual({ zoom: 2, canZoomIn: false, canZoomOut: true });
  });
});

describe('restoreZoom: never trusts what the store gives (map-zoom)', () => {
  const storeOf = (load: () => unknown): ZoomStore => ({ load: load as () => number, save: vi.fn() });

  it('restores every stop the store returns', () => {
    expect(ZOOM_STOPS.map((stop) => restoreZoom(storeOf(() => stop)))).toEqual([...ZOOM_STOPS]);
  });

  it.each([
    ['no store', undefined],
    ['a store that throws', storeOf(() => { throw new Error('blocked'); })],
    ['a value that is not a stop', storeOf(() => 1.3)],
    ['zero, which would divide the bounds', storeOf(() => 0)],
    ['not a number', storeOf(() => Number.NaN)],
    ['a string', storeOf(() => '1.5')],
  ])('falls back to the default with %s', (_name, store) => {
    expect(restoreZoom(store)).toBe(1);
  });
});
