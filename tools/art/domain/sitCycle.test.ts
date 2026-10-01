import { test } from 'vitest';
import assert from 'node:assert/strict';
import { FACINGS, SEAT_HEIGHT } from './seating.ts';
import {
  SIT_DOWN_FRAME_COUNT,
  SIT_FRAME_COUNT,
  SIT_IDLE_FRAME_COUNT,
  SIT_ROWS,
  STAND_OFFSET,
  sitDownPose,
  sitIdlePose,
  sitPose,
  type SeatedPose,
} from './sitCycle.ts';
import { STANDING_POSE } from './walkCycle.ts';

const transition = Array.from({ length: SIT_DOWN_FRAME_COUNT }, (_, frame) => sitDownPose(frame));

function sitOf(pose: ReturnType<typeof sitDownPose>): SeatedPose['sit'] {
  return 'sit' in pose ? pose.sit : { lower: 0, lean: 0, hands: 0, breath: 0 };
}

test('the sit sheet has a short sit-down transition followed by a seated idle loop', () => {
  assert.ok(SIT_DOWN_FRAME_COUNT >= 5 && SIT_DOWN_FRAME_COUNT <= 6);
  assert.ok(SIT_IDLE_FRAME_COUNT >= 1 && SIT_IDLE_FRAME_COUNT <= 4);
  assert.equal(SIT_FRAME_COUNT, SIT_DOWN_FRAME_COUNT + SIT_IDLE_FRAME_COUNT);
  assert.deepEqual(SIT_ROWS, FACINGS);
  for (let column = 0; column < SIT_FRAME_COUNT; column += 1) {
    const expected = column < SIT_DOWN_FRAME_COUNT ? sitDownPose(column) : sitIdlePose(column - SIT_DOWN_FRAME_COUNT);
    assert.deepEqual(sitPose(column), expected, `column ${column}`);
  }
});

test('the transition starts standing and ends on the first seated idle frame', () => {
  assert.deepEqual(transition[0], STANDING_POSE);
  assert.deepEqual(transition[SIT_DOWN_FRAME_COUNT - 1], sitIdlePose(0));
});

test('the body lowers and the hands settle steadily, so the transition also plays backward', () => {
  for (let frame = 1; frame < SIT_DOWN_FRAME_COUNT; frame += 1) {
    const before = sitOf(transition[frame - 1] ?? STANDING_POSE);
    const now = sitOf(transition[frame] ?? STANDING_POSE);
    assert.ok(now.lower >= before.lower, `frame ${frame} rises`);
    assert.ok(now.hands >= before.hands, `frame ${frame} lifts the hands`);
    assert.ok(now.lower > before.lower || now.lean !== before.lean || now.hands !== before.hands, `frame ${frame} repeats`);
  }
  const middle = transition.slice(1, -1).map(sitOf);
  assert.ok(middle.some((sit) => sit.lean > 0), 'the torso leans forward to balance while lowering');
});

test('every seated idle frame sits fully upright on the seat', () => {
  for (let frame = 0; frame < SIT_IDLE_FRAME_COUNT; frame += 1) {
    const { sit } = sitIdlePose(frame);
    assert.equal(sit.lower, 1);
    assert.equal(sit.lean, 0);
    assert.equal(sit.hands, 1);
  }
  assert.deepEqual(sitIdlePose(SIT_IDLE_FRAME_COUNT), sitIdlePose(0));
});

test('the standing spot is in front of the seat, on the floor, the way the chair faces', () => {
  assert.equal(STAND_OFFSET.up.x, 0);
  assert.equal(STAND_OFFSET.down.x, 0);
  assert.ok(STAND_OFFSET.right.x > 0);
  assert.equal(STAND_OFFSET.left.x, -STAND_OFFSET.right.x);
  assert.equal(STAND_OFFSET.left.y, SEAT_HEIGHT);
  assert.equal(STAND_OFFSET.right.y, SEAT_HEIGHT);
  assert.ok(STAND_OFFSET.down.y > SEAT_HEIGHT, 'facing down, the character stands below the seat');
  assert.ok(STAND_OFFSET.up.y < SEAT_HEIGHT, 'facing up, the character stands above the floor under the seat');
  for (const facing of FACINGS) {
    assert.ok(Number.isInteger(STAND_OFFSET[facing].x) && Number.isInteger(STAND_OFFSET[facing].y), facing);
  }
});
