import { test } from 'vitest';
import assert from 'node:assert/strict';
import { STANDING_POSE, WALK_FRAME_COUNT, walkPose } from './walkCycle.ts';

const frames = Array.from({ length: WALK_FRAME_COUNT }, (_, frame) => walkPose(frame));

test('the walk cycle has 10 frames and wraps around seamlessly', () => {
  assert.equal(WALK_FRAME_COUNT, 10);
  assert.deepEqual(walkPose(10), walkPose(0));
  assert.deepEqual(walkPose(-1), walkPose(9));
  assert.deepEqual(walkPose(23), walkPose(3));
});

test('frames 0 and 5 are the contact poses with legs fully spread', () => {
  assert.equal(frames[0]?.legs.left.swing, 1);
  assert.equal(frames[5]?.legs.left.swing, -1);
  for (const pose of frames) {
    assert.ok(Math.abs(pose.legs.left.swing) <= 1 + 1e-9);
  }
});

test('legs mirror each other and arms swing against the legs', () => {
  for (const pose of frames) {
    assert.ok(Math.abs(pose.legs.left.swing + pose.legs.right.swing) < 1e-9);
    assert.ok(pose.arms.left * pose.legs.left.swing <= 1e-9);
    assert.ok(pose.arms.right * pose.legs.right.swing <= 1e-9);
  }
});

test('the second half of the cycle is the first half with sides swapped', () => {
  for (let frame = 0; frame < 5; frame += 1) {
    const a = walkPose(frame);
    const b = walkPose(frame + 5);
    assert.ok(Math.abs(a.legs.left.swing - b.legs.right.swing) < 1e-9);
    assert.ok(Math.abs(a.legs.left.lift - b.legs.right.lift) < 1e-9);
    assert.ok(Math.abs(a.bob - b.bob) < 1e-9);
  }
});

test('consecutive frames are evenly spaced, including the 9 to 0 wrap', () => {
  const steps = frames.map((pose, frame) => {
    const next = walkPose(frame + 1);
    return Math.abs(next.legs.left.swing - pose.legs.left.swing) + Math.abs(next.bob - pose.bob);
  });
  const wrapStep = steps[9] ?? 0;
  const maxStep = Math.max(...steps);
  assert.ok(wrapStep > 0 && wrapStep <= maxStep + 1e-9);
});

test('the body is lowest at contact and highest while the legs pass', () => {
  assert.equal(frames[0]?.bob, 0);
  assert.equal(frames[5]?.bob, 0);
  const passing = Math.max(...frames.map((pose) => pose.bob));
  assert.ok(passing > 0.9);
});

test('only the leg swinging forward lifts its foot', () => {
  for (let frame = 0; frame < WALK_FRAME_COUNT; frame += 1) {
    const pose = walkPose(frame);
    const next = walkPose(frame + 1);
    for (const side of ['left', 'right'] as const) {
      if (pose.legs[side].lift > 0) {
        assert.ok(next.legs[side].swing > pose.legs[side].swing, `frame ${frame} ${side}`);
      }
    }
    assert.ok(pose.legs.left.lift === 0 || pose.legs.right.lift === 0, `frame ${frame}`);
  }
});

test('the standing pose is neutral', () => {
  assert.equal(STANDING_POSE.legs.left.swing, 0);
  assert.equal(STANDING_POSE.legs.right.swing, 0);
  assert.equal(STANDING_POSE.arms.left, 0);
  assert.equal(STANDING_POSE.bob, 0);
});
