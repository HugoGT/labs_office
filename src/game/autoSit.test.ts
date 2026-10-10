import { describe, expect, it } from 'vitest';
import {
  IDLE_AUTO_SIT,
  SIT_DIRECTION_MIN_COS,
  SIT_LOCK_MS,
  SIT_NEAR_PX,
  SIT_ON_SEAT_PX,
  SIT_PUSH_MS,
  guardLeftSeat,
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

function run(state: AutoSitState, steps: { nowMs: number; feet?: { x: number; y: number }; input?: { vx: number; vy: number }; candidates?: readonly SitCandidate[] }[]) {
  let current = state;
  const sits: (string | null)[] = [];
  for (const step of steps) {
    const result = stepAutoSit(current, {
      nowMs: step.nowMs,
      feet: step.feet ?? NORTH,
      input: step.input ?? DOWN,
      candidates: step.candidates ?? [chair],
    });
    current = result.state;
    sits.push(result.sit?.id ?? null);
  }
  return { state: current, sits };
}

describe('autoSit constants', () => {
  it('keeps the tuned values: next to within 1.25 tiles, a short push, a one second lock', () => {
    expect(SIT_NEAR_PX).toBe(40);
    expect(SIT_ON_SEAT_PX).toBe(10);
    expect(SIT_DIRECTION_MIN_COS).toBe(0.7);
    expect(SIT_PUSH_MS).toBe(150);
    expect(SIT_LOCK_MS).toBe(1000);
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
    const guarded = guardLeftSeat('map-0');
    const { sits, state } = run(guarded, [
      { nowMs: 0, feet: { x: 100, y: 100 } },
      { nowMs: SIT_PUSH_MS * 4, feet: { x: 100, y: 100 } },
    ]);
    expect(sits).toEqual([null, null]);
    expect(state.guard).toBe('map-0');
  });

  it('is lifted by releasing the input; a fresh push then sits again', () => {
    const guarded = guardLeftSeat('map-0');
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
    const guarded = guardLeftSeat('map-0');
    const { state } = run(guarded, [{ nowMs: 0, candidates: [{ ...chair, inReach: false }] }]);
    expect(state.guard).toBeNull();
  });

  it('only guards that seat: another one in front of the input still sits', () => {
    const other: SitCandidate = { id: 'map-1', ground: { x: 100, y: 110 }, inReach: true };
    const guarded = guardLeftSeat('map-0');
    const { sits } = run(guarded, [
      { nowMs: 0, candidates: [chair, other] },
      { nowMs: SIT_PUSH_MS, candidates: [chair, other] },
    ]);
    expect(sits).toEqual([null, 'map-1']);
  });

  it('a guarded state starts with no dwell', () => {
    expect(guardLeftSeat('map-0')).toEqual({ push: null, guard: 'map-0' });
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
