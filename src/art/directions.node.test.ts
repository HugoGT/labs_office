import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  DIRECTIONS,
  directionFromVector,
  directionIndex,
  directionVector,
  facingYaw,
  oppositeDirection,
} from './directions.ts';

test('there are exactly 8 directions in sheet row order', () => {
  assert.deepEqual([...DIRECTIONS], ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']);
  DIRECTIONS.forEach((direction, index) => assert.equal(directionIndex(direction), index));
});

test('direction vectors are unit length in screen space (y grows downward)', () => {
  for (const direction of DIRECTIONS) {
    const v = directionVector(direction);
    assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9, direction);
  }
  assert.deepEqual(directionVector('S'), { x: 0, y: 1 });
  assert.deepEqual(directionVector('E'), { x: 1, y: 0 });
  assert.deepEqual(directionVector('N'), { x: 0, y: -1 });
  assert.deepEqual(directionVector('W'), { x: -1, y: 0 });
});

test('vector quantization snaps to the nearest of the 8 directions', () => {
  assert.equal(directionFromVector(0, 5), 'S');
  assert.equal(directionFromVector(3, 3.2), 'SE');
  assert.equal(directionFromVector(10, 1), 'E');
  assert.equal(directionFromVector(2, -2), 'NE');
  assert.equal(directionFromVector(0.1, -4), 'N');
  assert.equal(directionFromVector(-1, -1), 'NW');
  assert.equal(directionFromVector(-7, 0.5), 'W');
  assert.equal(directionFromVector(-2, 2.1), 'SW');
  for (const direction of DIRECTIONS) {
    const v = directionVector(direction);
    assert.equal(directionFromVector(v.x, v.y), direction);
  }
});

test('a zero vector falls back to facing the viewer', () => {
  assert.equal(directionFromVector(0, 0), 'S');
});

test('opposite directions are 180 degrees apart', () => {
  for (const direction of DIRECTIONS) {
    const a = directionVector(direction);
    const b = directionVector(oppositeDirection(direction));
    assert.ok(Math.abs(a.x + b.x) < 1e-9 && Math.abs(a.y + b.y) < 1e-9, direction);
  }
});

test('facing yaw is 0 toward the viewer and increases clockwise on screen', () => {
  assert.equal(facingYaw('S'), 0);
  assert.ok(Math.abs(facingYaw('E') - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(facingYaw('N')) - Math.PI) < 1e-9);
  for (const direction of DIRECTIONS) {
    const yaw = facingYaw(direction);
    const v = directionVector(direction);
    assert.ok(Math.abs(Math.sin(yaw) - v.x) < 1e-9 && Math.abs(Math.cos(yaw) - v.y) < 1e-9, direction);
  }
});
