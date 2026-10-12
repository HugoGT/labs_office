import { describe, expect, it } from 'vitest';
import {
  IDLE_AUTO_SIT,
  SIT_AGAIN_OTHER_MS,
  SIT_AGAIN_SAME_MS,
  SIT_DIRECTION_MIN_COS,
  SIT_LOCK_MS,
  SIT_NEAR_PX,
  SIT_IDLE_MS,
  SIT_IDLE_NEAR_PX,
  SIT_ON_SEAT_PX,
  SIT_PUSH_MS,
  dropSitDwells,
  guardLeftSeat,
  idleTarget,
  pushTarget,
  sitLockActive,
  stepAutoSit,
  type AutoSitState,
  type SitCandidate,
} from './autoSit';

const chair: SitCandidate = { id: 'map-0', ground: { x: 100, y: 100 }, inReach: true };
const NORTH = { x: 100, y: 80 };
const DOWN = { vx: 0, vy: 1 };
const RIGHT = { vx: 1, vy: 0 };
const NONE = { vx: 0, vy: 0 };

interface Step {
  nowMs: number;
  feet?: { x: number; y: number };
  input?: { vx: number; vy: number };
  walking?: boolean;
  candidates?: readonly SitCandidate[];
}

function run(state: AutoSitState, steps: Step[], defaultInput = DOWN) {
  let current = state;
  const sits: (string | null)[] = [];
  const vias: (string | null)[] = [];
  for (const step of steps) {
    const result = stepAutoSit(current, {
      nowMs: step.nowMs,
      feet: step.feet ?? NORTH,
      input: step.input ?? defaultInput,
      walking: step.walking ?? false,
      candidates: step.candidates ?? [chair],
    });
    current = result.state;
    sits.push(result.sit?.id ?? null);
    vias.push(result.via);
    expect(result.via === null).toBe(result.sit === null);
  }
  return { state: current, sits, vias };
}

/** Standing still: the steps default to no input. */
function still(state: AutoSitState, steps: Step[]) {
  return run(state, steps, NONE);
}

describe('autoSit constants', () => {
  it('keeps the tuned values: next to within 1.25 tiles, a short push, a one second lock', () => {
    expect(SIT_NEAR_PX).toBe(40);
    expect(SIT_ON_SEAT_PX).toBe(10);
    expect(SIT_DIRECTION_MIN_COS).toBe(0.7);
    expect(SIT_PUSH_MS).toBe(150);
    expect(SIT_LOCK_MS).toBe(1000);
    expect(SIT_IDLE_MS).toBe(500);
    expect(SIT_IDLE_NEAR_PX).toBe(28);
    expect(SIT_AGAIN_SAME_MS).toBe(3000);
    expect(SIT_AGAIN_OTHER_MS).toBe(1000);
  });
});

describe('pushTarget', () => {
  it('is the seat the input points at when the feet are next to it', () => {
    expect(pushTarget(NORTH, DOWN, [chair], null)).toBe(chair);
  });

  it('ignores a seat out of reach, too far, or one the input does not point at', () => {
    expect(pushTarget(NORTH, DOWN, [{ ...chair, inReach: false }], null)).toBeNull();
    expect(pushTarget({ x: 100, y: 100 - SIT_NEAR_PX - 1 }, DOWN, [chair], null)).toBeNull();
    expect(pushTarget(NORTH, RIGHT, [chair], null)).toBeNull();
    expect(pushTarget(NORTH, { vx: 0, vy: -1 }, [chair], null)).toBeNull();
  });

  it('accepts a diagonal push within the cosine and refuses a wider one', () => {
    // Diagonal input toward a seat straight below: cos 0.707.
    expect(pushTarget(NORTH, { vx: 1, vy: 1 }, [chair], null)).toBe(chair);
    // Feet up-left of the seat, pushing right: cos 0.6.
    expect(pushTarget({ x: 88, y: 84 }, RIGHT, [chair], null)).toBeNull();
  });

  it('counts any push while the feet are on the seat, where the direction means nothing', () => {
    expect(pushTarget({ x: 100, y: 100 - SIT_ON_SEAT_PX }, { vx: 0, vy: -1 }, [chair], null)).toBe(chair);
    expect(pushTarget({ x: 100, y: 100 - SIT_ON_SEAT_PX - 1 }, { vx: 0, vy: -1 }, [chair], null)).toBeNull();
  });

  it('never targets without input or the ignored seat', () => {
    expect(pushTarget(NORTH, NONE, [chair], null)).toBeNull();
    expect(pushTarget(NORTH, DOWN, [chair], 'map-0')).toBeNull();
  });

  it('picks the closest qualifying seat', () => {
    const far: SitCandidate = { id: 'map-1', ground: { x: 100, y: 115 }, inReach: true };
    expect(pushTarget(NORTH, DOWN, [far, chair], null)).toBe(chair);
  });

  it('rejects non finite feet or input', () => {
    expect(pushTarget({ x: Number.NaN, y: 80 }, DOWN, [chair], null)).toBeNull();
    expect(pushTarget(NORTH, { vx: Number.POSITIVE_INFINITY, vy: 1 }, [chair], null)).toBeNull();
  });
});

describe('stepAutoSit', () => {
  it('sits after a continuous push toward the same seat lasts SIT_PUSH_MS', () => {
    const { sits, state } = run(IDLE_AUTO_SIT, [
      { nowMs: 1000 },
      { nowMs: 1000 + SIT_PUSH_MS - 1 },
      { nowMs: 1000 + SIT_PUSH_MS },
    ]);
    expect(sits).toEqual([null, null, 'map-0']);
    expect(state.push).toBeNull();
  });

  it('reports a push sit as such', () => {
    const { vias } = run(IDLE_AUTO_SIT, [{ nowMs: 0 }, { nowMs: SIT_PUSH_MS }]);
    expect(vias).toEqual([null, 'push']);
  });

  it('a brief push that stops, or turns away, starts over', () => {
    const released = run(IDLE_AUTO_SIT, [
      { nowMs: 0 },
      { nowMs: 100, input: NONE },
      { nowMs: 120 },
      { nowMs: 120 + SIT_PUSH_MS - 1 },
    ]);
    expect(released.sits).toEqual([null, null, null, null]);
    const turned = run(IDLE_AUTO_SIT, [
      { nowMs: 0 },
      { nowMs: 100, input: RIGHT },
      { nowMs: 120 },
      { nowMs: 200 },
    ]);
    expect(turned.sits).toEqual([null, null, null, null]);
  });

  it('switching target restarts the dwell for the new seat', () => {
    const other: SitCandidate = { id: 'map-1', ground: { x: 140, y: 100 }, inReach: true };
    const { sits } = run(IDLE_AUTO_SIT, [
      { nowMs: 0, candidates: [chair, other] },
      { nowMs: 100, feet: { x: 140, y: 80 }, candidates: [chair, other] },
      { nowMs: 100 + SIT_PUSH_MS - 1, feet: { x: 140, y: 80 }, candidates: [chair, other] },
      { nowMs: 100 + SIT_PUSH_MS, feet: { x: 140, y: 80 }, candidates: [chair, other] },
    ]);
    expect(sits).toEqual([null, null, null, 'map-1']);
  });

  it('a push that began off the chair sits on arriving at its ground point, before the dwell', () => {
    const { sits } = run(IDLE_AUTO_SIT, [
      { nowMs: 0, feet: { x: 100, y: 86 } },
      { nowMs: 20, feet: { x: 100, y: 100 - SIT_ON_SEAT_PX } },
    ]);
    expect(sits).toEqual([null, 'map-0']);
  });

  it('a push that began on the chair (stepping off it) needs the full dwell', () => {
    const UP = { vx: 0, vy: -1 };
    const { sits } = run(IDLE_AUTO_SIT, [
      { nowMs: 0, feet: { x: 100, y: 100 }, input: UP },
      { nowMs: 20, feet: { x: 100, y: 96 }, input: UP },
      { nowMs: SIT_PUSH_MS - 1, feet: { x: 100, y: 96 }, input: UP },
      { nowMs: SIT_PUSH_MS, feet: { x: 100, y: 96 }, input: UP },
    ]);
    expect(sits).toEqual([null, null, null, 'map-0']);
  });

  it('a seat that stops being a candidate (taken, gone) drops the dwell', () => {
    const { sits } = run(IDLE_AUTO_SIT, [
      { nowMs: 0 },
      { nowMs: 50, candidates: [] },
      { nowMs: SIT_PUSH_MS },
    ]);
    expect(sits).toEqual([null, null, null]);
  });
});

describe('the re-sit guard', () => {
  it('ignores the seat just left while the input is held and it is still in reach', () => {
    const guarded = guardLeftSeat('map-0', 0);
    const { sits, state } = run(guarded, [
      { nowMs: 0, feet: { x: 100, y: 100 } },
      { nowMs: SIT_PUSH_MS * 4, feet: { x: 100, y: 100 } },
    ]);
    expect(sits).toEqual([null, null]);
    expect(state.guard).toBe('map-0');
  });

  it('is lifted by releasing the input; a fresh push then sits again', () => {
    const guarded = guardLeftSeat('map-0', 0);
    const { sits, state } = run(guarded, [
      { nowMs: 0 },
      { nowMs: 20, input: NONE },
      { nowMs: 40 },
      { nowMs: 40 + SIT_PUSH_MS },
    ]);
    expect(sits).toEqual([null, null, null, 'map-0']);
    expect(state.guard).toBeNull();
  });

  it('is lifted by leaving the seat reach, even with the input held', () => {
    const guarded = guardLeftSeat('map-0', 0);
    const { state } = run(guarded, [{ nowMs: 0, candidates: [{ ...chair, inReach: false }] }]);
    expect(state.guard).toBeNull();
  });

  it('only guards that seat: another one in front of the input still sits', () => {
    const other: SitCandidate = { id: 'map-1', ground: { x: 100, y: 110 }, inReach: true };
    const guarded = guardLeftSeat('map-0', 0);
    const { sits } = run(guarded, [
      { nowMs: 0, candidates: [chair, other] },
      { nowMs: SIT_PUSH_MS, candidates: [chair, other] },
    ]);
    expect(sits).toEqual([null, 'map-1']);
  });

  it('a guarded state starts with no dwell and guards the seat for both rules', () => {
    expect(guardLeftSeat('map-0', 1000)).toEqual({ push: null, idle: null, guard: 'map-0', rest: { seatId: 'map-0', sinceMs: 1000 } });
  });
});

describe('idleTarget', () => {
  it('is the closest seat in reach whose ground point is next to the feet', () => {
    const far: SitCandidate = { id: 'map-1', ground: { x: 100, y: 115 }, inReach: true };
    expect(idleTarget(NORTH, [far, chair])).toBe(chair);
  });

  it('ignores a seat out of reach or beyond SIT_IDLE_NEAR_PX, a tighter circle than the push one', () => {
    expect(idleTarget(NORTH, [{ ...chair, inReach: false }])).toBeNull();
    expect(idleTarget({ x: 100, y: 100 - SIT_IDLE_NEAR_PX }, [chair])).toBe(chair);
    expect(idleTarget({ x: 100, y: 100 - SIT_IDLE_NEAR_PX - 1 }, [chair])).toBeNull();
    expect(SIT_IDLE_NEAR_PX).toBeLessThan(SIT_NEAR_PX);
  });

  it('standing in front of a chair in a row of chairs one tile apart, the neighbours are out of range', () => {
    const left: SitCandidate = { id: 'map-1', ground: { x: 68, y: 100 }, inReach: true };
    const right: SitCandidate = { id: 'map-2', ground: { x: 132, y: 100 }, inReach: true };
    expect(idleTarget({ x: 100, y: 120 }, [left, right])).toBeNull();
    expect(idleTarget({ x: 100, y: 120 }, [left, chair, right])).toBe(chair);
  });

  it('rejects non finite feet', () => {
    expect(idleTarget({ x: Number.NaN, y: 80 }, [chair])).toBeNull();
  });
});

describe('stepAutoSit: standing still next to a chair', () => {
  it('sits after SIT_IDLE_MS of stillness, not before, and reports it as an idle sit', () => {
    const { sits, vias, state } = still(IDLE_AUTO_SIT, [
      { nowMs: 1000 },
      { nowMs: 1000 + SIT_IDLE_MS - 1 },
      { nowMs: 1000 + SIT_IDLE_MS },
    ]);
    expect(sits).toEqual([null, null, 'map-0']);
    expect(vias).toEqual([null, null, 'idle']);
    expect(state.idle).toBeNull();
  });

  it('sits standing right on the chair too', () => {
    const { sits } = still(IDLE_AUTO_SIT, [
      { nowMs: 0, feet: chair.ground },
      { nowMs: SIT_IDLE_MS, feet: chair.ground },
    ]);
    expect(sits).toEqual([null, 'map-0']);
  });

  it('any input restarts the dwell, even one that does not point at the chair', () => {
    const { sits } = still(IDLE_AUTO_SIT, [
      { nowMs: 0 },
      { nowMs: 300, input: RIGHT },
      { nowMs: 320 },
      { nowMs: 320 + SIT_IDLE_MS - 1 },
      { nowMs: 320 + SIT_IDLE_MS },
    ]);
    expect(sits).toEqual([null, null, null, null, 'map-0']);
  });

  it('never dwells while an auto-walk is in progress', () => {
    const { sits, state } = still(IDLE_AUTO_SIT, [
      { nowMs: 0, walking: true },
      { nowMs: SIT_IDLE_MS, walking: true },
      { nowMs: SIT_IDLE_MS * 3, walking: true },
    ]);
    expect(sits).toEqual([null, null, null]);
    expect(state.idle).toBeNull();
  });

  it('an auto-walk starting drops the dwell', () => {
    const { sits } = still(IDLE_AUTO_SIT, [
      { nowMs: 0 },
      { nowMs: 400, walking: true },
      { nowMs: 420 },
      { nowMs: 420 + SIT_IDLE_MS - 1 },
    ]);
    expect(sits).toEqual([null, null, null, null]);
  });

  it('an auto-walk that ends next to a chair sits SIT_IDLE_MS after it ends', () => {
    const { sits } = still(IDLE_AUTO_SIT, [
      { nowMs: 0, walking: true, feet: { x: 100, y: 20 } },
      { nowMs: 200, walking: true },
      { nowMs: 220 },
      { nowMs: 220 + SIT_IDLE_MS - 1 },
      { nowMs: 220 + SIT_IDLE_MS },
    ]);
    expect(sits).toEqual([null, null, null, null, 'map-0']);
  });

  it('the closest seat wins, and a change of closest restarts the dwell', () => {
    const other: SitCandidate = { id: 'map-1', ground: { x: 115, y: 100 }, inReach: true };
    const both = [other, chair];
    const { sits } = still(IDLE_AUTO_SIT, [
      { nowMs: 0, candidates: both },
      // The chair is taken: the other seat is now the closest one.
      { nowMs: 300, candidates: [other] },
      { nowMs: 300 + SIT_IDLE_MS - 1, candidates: [other] },
      { nowMs: 300 + SIT_IDLE_MS, candidates: [other] },
    ]);
    expect(sits).toEqual([null, null, null, 'map-1']);
    const steady = still(IDLE_AUTO_SIT, [{ nowMs: 0, candidates: both }, { nowMs: SIT_IDLE_MS, candidates: both }]);
    expect(steady.sits).toEqual([null, 'map-0']);
  });

  it('the closest seat disappearing drops the dwell', () => {
    const { sits } = still(IDLE_AUTO_SIT, [
      { nowMs: 0 },
      { nowMs: 300, candidates: [] },
      { nowMs: SIT_IDLE_MS },
    ]);
    expect(sits).toEqual([null, null, null]);
  });

  it('never sits on a seat out of reach or beyond SIT_IDLE_NEAR_PX', () => {
    const outOfReach = still(IDLE_AUTO_SIT, [
      { nowMs: 0, candidates: [{ ...chair, inReach: false }] },
      { nowMs: SIT_IDLE_MS * 4, candidates: [{ ...chair, inReach: false }] },
    ]);
    expect(outOfReach.sits).toEqual([null, null]);
    const tooFar = { x: 100, y: 100 - SIT_IDLE_NEAR_PX - 1 };
    const far = still(IDLE_AUTO_SIT, [{ nowMs: 0, feet: tooFar }, { nowMs: SIT_IDLE_MS * 4, feet: tooFar }]);
    expect(far.sits).toEqual([null, null]);
  });
});

describe('the idle rest after standing up', () => {
  const next: SitCandidate = { id: 'map-1', ground: { x: 132, y: 100 }, inReach: true };
  const row = [chair, next];

  it('sits on no chair for SIT_AGAIN_OTHER_MS, then on a closer neighbour after a full SIT_IDLE_MS', () => {
    const nearNext = { x: 124, y: 100 };
    const { sits, vias } = still(guardLeftSeat('map-0', 0), [
      { nowMs: 0, feet: nearNext, candidates: row },
      { nowMs: SIT_AGAIN_OTHER_MS - 1, feet: nearNext, candidates: row },
      { nowMs: SIT_AGAIN_OTHER_MS, feet: nearNext, candidates: row },
      { nowMs: SIT_AGAIN_OTHER_MS + SIT_IDLE_MS - 1, feet: nearNext, candidates: row },
      { nowMs: SIT_AGAIN_OTHER_MS + SIT_IDLE_MS, feet: nearNext, candidates: row },
    ]);
    expect(sits).toEqual([null, null, null, null, 'map-1']);
    expect(vias).toEqual([null, null, null, null, 'idle']);
  });

  it('skips the seat left for SIT_AGAIN_SAME_MS, released keys or not, then sits on it after SIT_IDLE_MS', () => {
    const { sits, state } = run(guardLeftSeat('map-0', 0), [
      { nowMs: 0, feet: chair.ground, input: DOWN },
      { nowMs: 20, feet: chair.ground, input: NONE },
      { nowMs: SIT_AGAIN_SAME_MS - 1, feet: chair.ground, input: NONE },
      { nowMs: SIT_AGAIN_SAME_MS, feet: chair.ground, input: NONE },
      { nowMs: SIT_AGAIN_SAME_MS + SIT_IDLE_MS - 1, feet: chair.ground, input: NONE },
      { nowMs: SIT_AGAIN_SAME_MS + SIT_IDLE_MS, feet: chair.ground, input: NONE },
    ]);
    expect(sits).toEqual([null, null, null, null, null, 'map-0']);
    expect(state.rest).toBeNull();
    // The push guard keeps today's meaning: the release lifted it.
    expect(state.guard).toBeNull();
  });

  it('waits for the seat left when it is the closest one, never falling back to a neighbour', () => {
    const between = { x: 112, y: 100 };
    const steps = [0, SIT_AGAIN_OTHER_MS, SIT_AGAIN_OTHER_MS + SIT_IDLE_MS, SIT_AGAIN_SAME_MS - 1, SIT_AGAIN_SAME_MS, SIT_AGAIN_SAME_MS + SIT_IDLE_MS]
      .map((nowMs) => ({ nowMs, feet: between, candidates: row }));
    const { sits } = still(guardLeftSeat('map-0', 0), steps);
    expect(sits).toEqual([null, null, null, null, null, 'map-0']);
  });

  it('is time only: leaving the reach and coming back does not lift it early', () => {
    const { sits } = still(guardLeftSeat('map-0', 0), [
      { nowMs: 1500, candidates: [{ ...chair, inReach: false }] },
      { nowMs: 1600 },
      { nowMs: 1600 + SIT_IDLE_MS },
      { nowMs: SIT_AGAIN_SAME_MS },
      { nowMs: SIT_AGAIN_SAME_MS + SIT_IDLE_MS },
    ]);
    expect(sits).toEqual([null, null, null, null, 'map-0']);
  });

  it('does not hold the push rule back: a fresh push into the seat left still sits', () => {
    const { sits, vias } = run(guardLeftSeat('map-0', 0), [
      { nowMs: 0, input: NONE },
      { nowMs: 20 },
      { nowMs: 20 + SIT_PUSH_MS },
    ]);
    expect(sits).toEqual([null, null, 'map-0']);
    expect(vias).toEqual([null, null, 'push']);
  });
});

describe('dropSitDwells', () => {
  it('drops both dwells and keeps both guards', () => {
    const state: AutoSitState = {
      push: { seatId: 'map-0', sinceMs: 0, fromOff: true },
      idle: { seatId: 'map-1', sinceMs: 0 },
      guard: 'map-2',
      rest: { seatId: 'map-3', sinceMs: 0 },
    };
    expect(dropSitDwells(state)).toEqual({ push: null, idle: null, guard: 'map-2', rest: { seatId: 'map-3', sinceMs: 0 } });
  });
});

describe('sitLockActive', () => {
  it('holds from the request until SIT_LOCK_MS later, and never without a lock', () => {
    expect(sitLockActive(null, 0)).toBe(false);
    expect(sitLockActive(1000 + SIT_LOCK_MS, 1000)).toBe(true);
    expect(sitLockActive(1000 + SIT_LOCK_MS, 1000 + SIT_LOCK_MS - 1)).toBe(true);
    expect(sitLockActive(1000 + SIT_LOCK_MS, 1000 + SIT_LOCK_MS)).toBe(false);
  });
});
