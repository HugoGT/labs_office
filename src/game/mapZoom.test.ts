import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_WHEEL_STATE,
  WHEEL_COOLDOWN_MS,
  WHEEL_IDLE_MS,
  WHEEL_NOTCH_IDLE_MS,
  WHEEL_NOTCH_MIN_PX,
  WHEEL_NOTCHES_PER_STEP,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STOPS,
  accumulateWheel,
  applyZoomAction,
  clampZoom,
  isPixelExactZoom,
  isZoomStop,
  nextZoomStop,
  restoreZoom,
  snapScrollToScreenPixels,
  zoomKeyAction,
  zoomLabel,
  zoomStep,
  zoomView,
  type WheelState,
  type ZoomStore,
} from './mapZoom';

/** Pure rules of the map zoom: stops, smoothing, wheel accumulation, keys. */

describe('zoom stops', () => {
  it('are 0.5x plus the integer stops up to 4x, with 2x as the default', () => {
    expect([...ZOOM_STOPS]).toEqual([0.5, 1, 2, 3, 4]);
    expect([ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT]).toEqual([0.5, 4, 2]);
  });

  it('every stop is pixel exact: a whole number of screen pixels per world unit, or of world units per screen pixel', () => {
    for (const stop of ZOOM_STOPS) expect(isPixelExactZoom(stop)).toBe(true);
  });

  it.each([
    { from: 2, direction: 1 as const, expected: [3, 4, 4] },
    { from: 2, direction: -1 as const, expected: [1, 0.5, 0.5] },
  ])('stepping from $from toward $direction clamps at the limit', ({ from, direction, expected }) => {
    const first = nextZoomStop(from, direction);
    const second = nextZoomStop(first, direction);
    const third = nextZoomStop(second, direction);

    expect([first, second, third]).toEqual(expected);
  });

  it('a value between stops moves to the first stop beyond it, out of range lands on the limit', () => {
    expect(nextZoomStop(1.5, 1)).toBe(2);
    expect(nextZoomStop(1.5, -1)).toBe(1);
    expect(nextZoomStop(2.25, 1)).toBe(3);
    expect(nextZoomStop(2.25, -1)).toBe(2);
    expect(nextZoomStop(3.5, 1)).toBe(4);
    expect(nextZoomStop(3.5, -1)).toBe(3);
    expect(nextZoomStop(5, 1)).toBe(4);
    expect(nextZoomStop(0.75, -1)).toBe(0.5);
    expect(nextZoomStop(0.75, 1)).toBe(1);
    expect(nextZoomStop(0.1, -1)).toBe(0.5);
    expect(nextZoomStop(Number.NaN, 1)).toBe(3);
  });

  it('applyZoomAction steps from the target; reset goes back to the default', () => {
    expect(applyZoomAction(2, 'in')).toBe(3);
    expect(applyZoomAction(2, 'out')).toBe(1);
    expect(applyZoomAction(3, 'in')).toBe(4);
    expect(applyZoomAction(4, 'in')).toBe(4);
    expect(applyZoomAction(4, 'out')).toBe(3);
    expect(applyZoomAction(1, 'out')).toBe(0.5);
    expect(applyZoomAction(0.5, 'out')).toBe(0.5);
    expect(applyZoomAction(0.5, 'in')).toBe(1);
    expect(applyZoomAction(4, 'reset')).toBe(2);
    expect(applyZoomAction(0.5, 'reset')).toBe(2);
  });
});

describe('clampZoom and isZoomStop', () => {
  it('clamps into the range, keeps in-range values and turns non-finite into the default', () => {
    expect(clampZoom(5)).toBe(4);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(Number.NaN)).toBe(2);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(2);
  });

  it('recognizes only the stops, and only numbers; the retired fractional stops are not stops anymore', () => {
    for (const stop of ZOOM_STOPS) expect(isZoomStop(stop)).toBe(true);
    for (const other of [0.25, 0.75, 1.5, 2.25, 1.25, '2', null, Number.NaN]) expect(isZoomStop(other)).toBe(false);
  });
});

describe('pixel-exact zoom', () => {
  it('is an integer zoom or the inverse of one; anything else spreads texels unevenly', () => {
    for (const zoom of [0.25, 0.5, 1, 2, 3, 4]) expect(isPixelExactZoom(zoom)).toBe(true);
    for (const zoom of [0.75, 0.6, 1.5, 2.25, 0, -1, Number.NaN]) expect(isPixelExactZoom(zoom)).toBe(false);
  });

  it('below 1x snaps the scroll down to whole screen pixels, so the map moves a screen pixel at a time', () => {
    expect(snapScrollToScreenPixels(101, 0.5)).toBe(100);
    expect(snapScrollToScreenPixels(100, 0.5)).toBe(100);
    expect(snapScrollToScreenPixels(-101, 0.5)).toBe(-102);
    expect(snapScrollToScreenPixels(103, 0.25)).toBe(100);
  });

  it('at 1x and above leaves the scroll alone: Phaser already floors it to a whole world unit', () => {
    expect(snapScrollToScreenPixels(101, 1)).toBe(101);
    expect(snapScrollToScreenPixels(101, 2)).toBe(101);
    expect(snapScrollToScreenPixels(101, 3)).toBe(101);
  });
});

describe('zoomStep: smoothing in log space', () => {
  it('moves by a fraction of the log distance: 0.5 to 2 at k=0.5 lands on 1', () => {
    const step = zoomStep(0.5, 2, 0.5);

    expect(step.value).toBeCloseTo(1, 10);
    expect(step.arrived).toBe(false);
  });

  it.each([
    { from: 2, to: 3 },
    { from: 2, to: 1 },
    { from: 1, to: 3 },
    { from: 1, to: 0.5 },
    { from: 3, to: 4 },
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
    expect(zoomStep(2, 2)).toEqual({ value: 2, arrived: true });
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

  const notches = (count: number, deltaY: number, gapMs = 16, deltaMode = 0): number[] => {
    let state: WheelState = INITIAL_WHEEL_STATE;
    return Array.from({ length: count }, (_, i) => {
      const result = wheel(state, { deltaY, deltaMode, now: 1000 + i * gapMs });
      state = result.state;
      return result.step;
    });
  };

  it('needs two notches the same way for one step', () => {
    expect(WHEEL_NOTCHES_PER_STEP).toBe(2);
  });

  it('one notch (Chrome on Linux sends 53 px) does not step, the second does: up in, down out', () => {
    expect(notches(2, -53)).toEqual([0, 1]);
    expect(notches(2, 53)).toEqual([0, -1]);
  });

  it.each([
    { name: 'a pixel-mode notch of 100 px', deltaY: 100, deltaMode: 0 },
    { name: 'a Firefox notch (3 lines)', deltaY: 3, deltaMode: 1 },
    { name: 'a page step', deltaY: 1, deltaMode: 2 },
  ])('$name counts as one notch, never as a step on its own', ({ deltaY, deltaMode }) => {
    expect(notches(2, -deltaY, 16, deltaMode)).toEqual([0, 1]);
    expect(notches(2, deltaY, 16, deltaMode)).toEqual([0, -1]);
  });

  it('two notches of a slow, deliberate turn (400 ms apart) still step', () => {
    expect(notches(2, -53, 400)).toEqual([0, 1]);
  });

  it('a pause longer than the notch idle window restarts the count', () => {
    const first = wheel(INITIAL_WHEEL_STATE, { deltaY: -53, now: 1000 });
    const soon = wheel(first.state, { deltaY: -53, now: 1000 + WHEEL_NOTCH_IDLE_MS });
    const late = wheel(first.state, { deltaY: -53, now: 1000 + WHEEL_NOTCH_IDLE_MS + 1 });
    const lateTwo = wheel(late.state, { deltaY: -53, now: 1100 + WHEEL_NOTCH_IDLE_MS });

    expect([first.step, soon.step]).toEqual([0, 1]);
    expect([late.step, lateTwo.step]).toEqual([0, 1]);
  });

  it('a stray single notch decays: one touch, a pause, then one more does not step', () => {
    const stray = wheel(INITIAL_WHEEL_STATE, { deltaY: -53, now: 1000 });
    const next = wheel(stray.state, { deltaY: -53, now: 2000 });

    expect([stray.step, next.step]).toEqual([0, 0]);
  });

  it('a direction flip restarts the notch count', () => {
    let state: WheelState = INITIAL_WHEEL_STATE;
    const steps = [-53, 53, 53].map((deltaY, i) => {
      const result = wheel(state, { deltaY, now: 1000 + i * 50 });
      state = result.state;
      return result.step;
    });

    expect(steps).toEqual([0, 0, -1]);
  });

  it('a single event counts as a notch from the notch threshold; one pixel under it accumulates instead', () => {
    expect(stepsOf([-WHEEL_NOTCH_MIN_PX, -WHEEL_NOTCH_MIN_PX])).toEqual([0, 1]);
    const under = -(WHEEL_NOTCH_MIN_PX - 1);
    expect(stepsOf([under, under])).toEqual([0, 0]);
    expect(wheel(INITIAL_WHEEL_STATE, { deltaY: under, now: 1000 }).state).toMatchObject({ sum: under, notches: 0 });
  });

  it('a notch clears the small-delta travel, and a small delta leaves the notch count alone', () => {
    const small = wheel(INITIAL_WHEEL_STATE, { deltaY: -30, now: 1000 });
    const notch = wheel(small.state, { deltaY: -53, now: 1016 });
    const smallAgain = wheel(notch.state, { deltaY: -30, now: 1032 });

    expect(notch.state).toMatchObject({ sum: 0, notches: -1 });
    expect(smallAgain.state).toMatchObject({ sum: -30, notches: -1 });
  });

  it('small trackpad deltas accumulate until the step threshold', () => {
    expect(stepsOf(Array.from({ length: 10 }, () => -10))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(stepsOf([-30, -30, -30, -30])).toEqual([0, 0, 0, 1]);
  });

  it('ctrl+wheel (pinch) is amplified: small deltas step with ctrl, not without', () => {
    expect(stepsOf([-10, -10, -10], true)).toEqual([0, 0, 1]);
    expect(stepsOf([-10, -10, -10], false)).toEqual([0, 0, 0]);
  });

  it('a step resets both counters and starts the cooldown, which drops notches right after it', () => {
    const turn = (state: WheelState, from: number) => {
      let current = state;
      const steps = [0, 1].map((i) => {
        const result = wheel(current, { deltaY: -53, now: from + i * 16 });
        current = result.state;
        return result.step;
      });
      return { state: current, steps };
    };
    const first = turn(INITIAL_WHEEL_STATE, 1000);
    const stepAt = 1016;
    const during = wheel(first.state, { deltaY: -53, now: stepAt + WHEEL_COOLDOWN_MS - 1 });
    const after = turn(first.state, stepAt + WHEEL_COOLDOWN_MS);

    expect(first.steps).toEqual([0, 1]);
    expect(first.state).toMatchObject({ sum: 0, notches: 0, cooldownUntil: stepAt + WHEEL_COOLDOWN_MS });
    expect(during).toEqual({ state: first.state, step: 0 });
    expect(after.steps).toEqual([0, 1]);
  });

  it('a trackpad step also starts the cooldown', () => {
    const first = wheel(INITIAL_WHEEL_STATE, { deltaY: -35, now: 1000 });
    const second = wheel(first.state, { deltaY: -35, now: 1016 });
    const stepped = wheel(second.state, { deltaY: -35, now: 1032 });
    const during = wheel(stepped.state, { deltaY: -35, now: 1032 + WHEEL_COOLDOWN_MS - 1 });

    expect([first.step, second.step, stepped.step, during.step]).toEqual([0, 0, 1, 0]);
    expect(stepped.state).toMatchObject({ sum: 0, notches: 0 });
  });

  it('a direction flip discards what was accumulated the other way', () => {
    // Without the rule, 60 down then 120 up sums to -60: no step.
    expect(stepsOf([30, 30, -30, -30, -30, -30])).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('a pause longer than the idle window discards what was accumulated', () => {
    const first = wheel(INITIAL_WHEEL_STATE, { deltaY: 35, now: 1000 });
    const second = wheel(first.state, { deltaY: 35, now: 1016 });
    const soon = wheel(second.state, { deltaY: 35, now: 1016 + WHEEL_IDLE_MS });
    const late = wheel(second.state, { deltaY: 35, now: 1016 + WHEEL_IDLE_MS + 1 });

    expect([soon.step, late.step]).toEqual([-1, 0]);
  });

  it('a wheel with no vertical delta changes nothing, and the given state is never mutated', () => {
    const half = wheel(INITIAL_WHEEL_STATE, { deltaY: 30, now: 1000 });
    const snapshot = { ...half.state };
    const sideways = wheel(half.state, { deltaY: 0, now: 1100 });

    expect(sideways).toEqual({ state: snapshot, step: 0 });
    expect(half.state).toEqual(snapshot);
  });

  it('never mutates the given state, through notches, steps and small deltas alike', () => {
    const initial = { ...INITIAL_WHEEL_STATE };
    let state: WheelState = INITIAL_WHEEL_STATE;
    for (const [i, deltaY] of [-53, -10, -53, -53, 53].entries()) {
      const before = { ...state };
      const given = state;
      state = wheel(state, { deltaY, now: 1000 + i * 300 }).state;
      expect(given).toEqual(before);
    }

    expect(INITIAL_WHEEL_STATE).toEqual(initial);
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

describe('zoomLabel and zoomView', () => {
  it('labels every stop with the camera zoom itself: 0.5x, 1x, 2x, 3x, 4x', () => {
    expect(ZOOM_STOPS.map(zoomLabel)).toEqual(['0.5x', '1x', '2x', '3x', '4x']);
    expect(zoomLabel(ZOOM_DEFAULT)).toBe('2x');
  });

  it('a value between stops gets at most two decimals', () => {
    expect(zoomLabel(1.5)).toBe('1.5x');
    expect(zoomLabel(4 / 3)).toBe('1.33x');
  });

  it('flags the limits: nothing further out at 0.5x, nothing further in at 4x', () => {
    expect(zoomView(0.5)).toEqual({ zoom: 0.5, canZoomIn: true, canZoomOut: false });
    expect(zoomView(1)).toEqual({ zoom: 1, canZoomIn: true, canZoomOut: true });
    expect(zoomView(2)).toEqual({ zoom: 2, canZoomIn: true, canZoomOut: true });
    expect(zoomView(3)).toEqual({ zoom: 3, canZoomIn: true, canZoomOut: true });
    expect(zoomView(4)).toEqual({ zoom: 4, canZoomIn: false, canZoomOut: true });
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
    ['the retired 0.75 stop', storeOf(() => 0.75)],
    ['the retired 1.5 stop', storeOf(() => 1.5)],
    ['the retired 2.25 stop', storeOf(() => 2.25)],
    ['zero, which would divide the bounds', storeOf(() => 0)],
    ['not a number', storeOf(() => Number.NaN)],
    ['a string', storeOf(() => '3')],
  ])('falls back to the default (2) with %s', (_name, store) => {
    expect(restoreZoom(store)).toBe(2);
  });
});
