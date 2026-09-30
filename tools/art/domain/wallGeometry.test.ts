import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  BODY_LENGTH,
  classifyJoint,
  groupWallGeometry,
  JOINT_SIZE,
  maskOf,
  resolveWallGeometry,
  SEGMENT_LENGTH,
  WALL_THICKNESS,
  wallFootprint,
  WallMaterialConflictError,
  type Rect,
} from './wallGeometry.ts';
import { demoWallMap } from './wallDemo.ts';
import { edgeFrom, edgeVertices, WallMap } from './wallMap.ts';
import { WALL, wallBodyRect, wallJointRect } from '../../../src/game/artContract.ts';

test('walls are 16px thick and vertices are one 32px office tile apart, as the art contract fixes', () => {
  assert.equal(WALL_THICKNESS, 16);
  assert.equal(JOINT_SIZE, 16);
  assert.equal(SEGMENT_LENGTH, 32);
  assert.equal(BODY_LENGTH, 16);
  assert.deepEqual(
    [WALL_THICKNESS, JOINT_SIZE, SEGMENT_LENGTH, BODY_LENGTH],
    [WALL.thickness, WALL.jointSize, WALL.segmentLength, WALL.bodyLength],
  );
});

test('connections classify into end, straight, corner, tee and cross in every orientation', () => {
  const expected: Record<number, [string, number] | undefined> = {
    0: undefined,
    [maskOf(['north'])]: ['end', 0],
    [maskOf(['east'])]: ['end', 1],
    [maskOf(['south'])]: ['end', 2],
    [maskOf(['west'])]: ['end', 3],
    [maskOf(['north', 'south'])]: ['straight', 0],
    [maskOf(['east', 'west'])]: ['straight', 1],
    [maskOf(['north', 'east'])]: ['corner', 0],
    [maskOf(['east', 'south'])]: ['corner', 1],
    [maskOf(['south', 'west'])]: ['corner', 2],
    [maskOf(['west', 'north'])]: ['corner', 3],
    [maskOf(['north', 'east', 'south'])]: ['tee', 0],
    [maskOf(['east', 'south', 'west'])]: ['tee', 1],
    [maskOf(['south', 'west', 'north'])]: ['tee', 2],
    [maskOf(['west', 'north', 'east'])]: ['tee', 3],
    [maskOf(['north', 'east', 'south', 'west'])]: ['cross', 0],
  };
  assert.equal(Object.keys(expected).length, 16);
  for (const [mask, kind] of Object.entries(expected)) {
    const actual = classifyJoint(Number(mask));
    assert.deepEqual(actual && [actual.shape, actual.rotation], kind, `mask ${mask}`);
  }
  assert.throws(() => classifyJoint(16));
});

test('each wall is stored once, whichever vertex it is placed from', () => {
  const map = new WallMap(4, 4);
  map.set(edgeFrom({ col: 2, row: 1 }, 'west'), 'brick');
  map.set(edgeFrom({ col: 1, row: 1 }, 'east'), 'brick');
  map.set(edgeFrom({ col: 1, row: 2 }, 'north'), 'brick');
  map.set(edgeFrom({ col: 1, row: 1 }, 'south'), 'brick');
  assert.equal(map.walls().length, 2);
  assert.throws(() => map.set(edgeFrom({ col: 0, row: 0 }, 'west'), 'brick'));
  assert.throws(() => map.set(edgeFrom({ col: 4, row: 4 }, 'south'), 'brick'));
});

test('joints are derived from the walls that meet at each vertex', () => {
  const map = new WallMap(4, 4);
  for (const direction of ['north', 'east', 'south', 'west'] as const) map.set(edgeFrom({ col: 2, row: 2 }, direction), 'stone');
  const { joints, bodies } = resolveWallGeometry(map);
  assert.equal(bodies.length, 4);
  assert.equal(joints.length, 5);
  const center = joints.find((joint) => joint.vertex.col === 2 && joint.vertex.row === 2);
  assert.equal(center?.shape, 'cross');
  assert.deepEqual(joints.filter((joint) => joint.shape === 'end').map((joint) => joint.rotation).sort(), [0, 1, 2, 3]);
});

test('a vertical wall on x = 32 spans x 24 to 40, with its body 8px clear of each vertex', () => {
  const map = new WallMap(3, 3);
  map.set({ axis: 'vertical', col: 1, row: 1 }, 'plaster');
  const { joints, bodies } = resolveWallGeometry(map);
  assert.deepEqual(bodies[0]?.rect, { x: 24, y: 40, width: 16, height: 16 });
  assert.deepEqual(joints.map((joint) => joint.rect).sort((a, b) => a.y - b.y), [
    { x: 24, y: 24, width: 16, height: 16 },
    { x: 24, y: 56, width: 16, height: 16 },
  ]);
  const horizontal = new WallMap(3, 3);
  horizontal.set({ axis: 'horizontal', col: 1, row: 1 }, 'plaster');
  assert.deepEqual(resolveWallGeometry(horizontal).bodies[0]?.rect, { x: 40, y: 24, width: 16, height: 16 });
});

test('pieces land where the art contract places them', () => {
  const map = new WallMap(4, 4);
  map.run({ col: 1, row: 1 }, 'east', 2, 'brick');
  map.run({ col: 1, row: 1 }, 'south', 2, 'brick');
  const { joints, bodies } = resolveWallGeometry(map);
  for (const joint of joints) assert.deepEqual(joint.rect, wallJointRect(joint.vertex));
  for (const body of bodies) assert.deepEqual(body.rect, wallBodyRect(body.edge));
});

test('walls meeting at a joint must share a material', () => {
  const map = new WallMap(4, 4);
  map.run({ col: 1, row: 1 }, 'east', 1, 'brick');
  map.run({ col: 2, row: 1 }, 'east', 1, 'glass');
  assert.throws(() => resolveWallGeometry(map), WallMaterialConflictError);
  const apart = new WallMap(4, 4);
  apart.run({ col: 0, row: 1 }, 'east', 1, 'brick');
  apart.run({ col: 2, row: 1 }, 'east', 1, 'glass');
  assert.doesNotThrow(() => resolveWallGeometry(apart));
});

function coverage(rects: readonly Rect[], width: number, height: number): Uint8Array {
  const count = new Uint8Array(width * height);
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) count[y * width + x] = (count[y * width + x] ?? 0) + 1;
    }
  }
  return count;
}

test('joints and bodies cover every wall exactly once: no gaps and no overlaps', () => {
  const cols = 15;
  const rows = 8;
  const map = demoWallMap(cols, rows, { col: 8, row: 4 });
  const geometry = resolveWallGeometry(map);
  const width = (cols + 1) * SEGMENT_LENGTH;
  const height = (rows + 1) * SEGMENT_LENGTH;
  const count = coverage(wallFootprint(geometry), width, height);
  assert.ok(count.every((value) => value <= 1), 'no pixel belongs to two pieces');

  // The ideal wall: a 16px band centered on the grid line, reaching 8px past both vertices.
  const bands = map.walls().map((wall) => {
    const [a, b] = edgeVertices(wall.edge);
    const x = Math.min(a.col, b.col) * SEGMENT_LENGTH - 8;
    const y = Math.min(a.row, b.row) * SEGMENT_LENGTH - 8;
    return wall.edge.axis === 'horizontal'
      ? { x, y, width: SEGMENT_LENGTH + WALL_THICKNESS, height: WALL_THICKNESS }
      : { x, y, width: WALL_THICKNESS, height: SEGMENT_LENGTH + WALL_THICKNESS };
  });
  const ideal = coverage(bands, width, height);
  for (let i = 0; i < count.length; i += 1) assert.equal(count[i], Math.min(1, ideal[i] ?? 0), `pixel ${i % width}, ${Math.floor(i / width)}`);
});

test('connected walls form groups of a single material that never touch each other', () => {
  const geometry = resolveWallGeometry(demoWallMap(15, 8, { col: 8, row: 4 }));
  const groups = groupWallGeometry(geometry);
  assert.equal(groups.length, 8);
  assert.equal(groups.reduce((sum, group) => sum + group.bodies.length, 0), geometry.bodies.length);
  for (const group of groups) {
    assert.ok([...group.joints, ...group.bodies].every((piece) => piece.material === group.material));
  }
  const expand = (rect: Rect): Rect => ({ x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 });
  const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  groups.forEach((group, i) => {
    const mine = [...group.joints, ...group.bodies].map((piece) => expand(piece.rect));
    groups.slice(i + 1).forEach((other) => {
      for (const piece of [...other.joints, ...other.bodies]) assert.ok(!mine.some((rect) => overlaps(rect, piece.rect)));
    });
  });
});
