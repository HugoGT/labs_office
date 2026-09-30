import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PixelBuffer, Rgba } from './pixelBuffer.ts';
import { demoWallMap } from './wallDemo.ts';
import {
  BODY_LENGTH,
  groupWallGeometry,
  JOINT_SIZE,
  maskOf,
  resolveWallGeometry,
  SEGMENT_LENGTH,
  WALL_THICKNESS,
  wallFootprint,
  type WallGroup,
} from './wallGeometry.ts';
import { WALL_MATERIALS, WallMap, type WallMaterial } from './wallMap.ts';
import { composeWalls, renderWallGroup } from './wallRenderer.ts';
import { bodySprite, jointSprite, wallOutline } from './walls.ts';

const luma = (p: { r: number; g: number; b: number }): number => p.r * 0.3 + p.g * 0.59 + p.b * 0.11;
const same = (a: Rgba, b: Rgba): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
const AROUND = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

const DEMO_GROUPS = groupWallGeometry(resolveWallGeometry(demoWallMap(15, 8, { col: 8, row: 4 })));
/** The fractional scale of a 1920x970 viewport, plus a few others. */
const SCALES = [1, 1.263, 1.5, 0.8, 2];
const HALF_JOINT = JOINT_SIZE / 2;

test('bodies and joints are 16x16 for all 15 connection masks', () => {
  for (const material of WALL_MATERIALS) {
    const horizontal = bodySprite(material, 'horizontal').image;
    const vertical = bodySprite(material, 'vertical').image;
    assert.deepEqual([horizontal.width, horizontal.height], [BODY_LENGTH, WALL_THICKNESS]);
    assert.deepEqual([vertical.width, vertical.height], [WALL_THICKNESS, BODY_LENGTH]);
    for (let mask = 1; mask <= 15; mask += 1) {
      const joint = jointSprite(material, mask).image;
      assert.deepEqual([joint.width, joint.height], [JOINT_SIZE, JOINT_SIZE]);
    }
    assert.throws(() => jointSprite(material, 0));
  }
});

test('the four materials look different and are deterministic', () => {
  const bodies = WALL_MATERIALS.map((material) => bodySprite(material, 'horizontal').image.data.join());
  assert.equal(new Set(bodies).size, 4);
  for (const material of WALL_MATERIALS) assert.deepEqual(bodySprite(material, 'vertical', 99).image.data, bodySprite(material, 'vertical', 99).image.data);
});

test('solid walls are opaque and glass stays translucent in bodies and joints', () => {
  for (const material of WALL_MATERIALS) {
    for (const sprite of [bodySprite(material, 'horizontal'), jointSprite(material, 15), jointSprite(material, maskOf(['east', 'west']))]) {
      let translucent = 0;
      for (let i = 3; i < sprite.image.data.length; i += 4) if ((sprite.image.data[i] ?? 0) < 255) translucent += 1;
      const area = sprite.image.width * sprite.image.height;
      if (material === 'glass') assert.ok(translucent > area * 0.3, 'glass is mostly translucent');
      else assert.equal(translucent, 0, `${material} must be fully opaque`);
    }
  }
});

test('light comes from the upper left in both orientations', () => {
  for (const material of WALL_MATERIALS) {
    const horizontal = bodySprite(material, 'horizontal').image;
    const vertical = bodySprite(material, 'vertical').image;
    let lit = 0;
    let shaded = 0;
    for (let i = 0; i < BODY_LENGTH; i += 1) {
      lit += luma(horizontal.getPixel(i, 1)) + luma(vertical.getPixel(1, i));
      shaded += luma(horizontal.getPixel(i, WALL_THICKNESS - 2)) + luma(vertical.getPixel(WALL_THICKNESS - 2, i));
    }
    assert.ok(lit > shaded, `${material}: lit ${lit} vs shaded ${shaded}`);
  }
});

function isInside(image: PixelBuffer, x: number, y: number): boolean {
  return image.alphaAt(x, y) > 0;
}

function outlinePixels(image: PixelBuffer, outline: Rgba): Set<number> {
  const out = new Set<number>();
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) if (same(image.getPixel(x, y), outline)) out.add(y * image.width + x);
  return out;
}

/** Checks that the outline is exactly the ring of pixels touching the outside, and nothing else. */
function assertOneScreenPixelOutline(image: PixelBuffer, material: WallMaterial, label: string): void {
  const outline = outlinePixels(image, wallOutline(material));
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!isInside(image, x, y)) continue;
      const edge = AROUND.some(([ox, oy]) => !isInside(image, x + ox, y + oy));
      assert.equal(outline.has(y * image.width + x), edge, `${label}: (${x}, ${y}) ${edge ? 'is an edge but not outline' : 'is outline inside the wall'}`);
      if (edge) continue;
      // Nothing just inside the outline is dark either, which would make the line read 2px wide.
      if (AROUND.some(([ox, oy]) => outline.has((y + oy) * image.width + x + ox))) {
        assert.ok(luma(image.getPixel(x, y)) > luma(wallOutline(material)) + 55, `${label}: dark pixel next to the outline at (${x}, ${y})`);
      }
    }
  }
}

test('at 1x the outline runs only along the outside: none between bodies and joints', () => {
  for (const group of DEMO_GROUPS) assertOneScreenPixelOutline(composeWalls(group).image, group.material, `${group.material} 1x`);
});

test('at every scale the outline stays exactly one screen pixel wide', () => {
  for (const scale of SCALES) {
    for (const group of DEMO_GROUPS) assertOneScreenPixelOutline(renderWallGroup(group, scale).image, group.material, `${group.material} ${scale}x`);
  }
});

test('rendering at scale 1 is the composed wall layer, untouched', () => {
  for (const group of DEMO_GROUPS) {
    const flat = composeWalls(group);
    const rendered = renderWallGroup(group, 1);
    assert.deepEqual([rendered.left, rendered.top], [flat.left, flat.top]);
    assert.deepEqual(rendered.image.data, flat.image.data);
  }
});

function footprintOf(group: WallGroup): (x: number, y: number) => boolean {
  const rects = wallFootprint(group);
  return (x, y) => rects.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
}

test('on screen the walls have no holes and nothing outside their footprint', () => {
  for (const scale of SCALES) {
    for (const group of DEMO_GROUPS) {
      const { image, left, top } = renderWallGroup(group, scale);
      const inFootprint = footprintOf(group);
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const covered = inFootprint(Math.floor((left + x + 0.5) / scale), Math.floor((top + y + 0.5) / scale));
          assert.equal(image.alphaAt(x, y) > 0, covered, `${group.material} ${scale}x (${x}, ${y})`);
        }
      }
    }
  }
});

test('glass is composited once: its alpha never darkens where pieces meet', () => {
  const alphas = new Set<number>([jointSprite('glass', 15), bodySprite('glass', 'horizontal')].flatMap((sprite) => [...sprite.image.data.filter((_, i) => i % 4 === 3)]));
  for (const scale of SCALES) {
    for (const group of DEMO_GROUPS.filter((g) => g.material === 'glass')) {
      const { image } = renderWallGroup(group, scale);
      for (let i = 3; i < image.data.length; i += 4) {
        const alpha = image.data[i] ?? 0;
        if (alpha > 0) assert.ok(alphas.has(alpha), `alpha ${alpha} at ${scale}x`);
      }
    }
  }
});

test('consecutive walls repeat seamlessly: every tile of a straight run looks the same', () => {
  for (const material of WALL_MATERIALS) {
    for (const axis of ['horizontal', 'vertical'] as const) {
      const map = new WallMap(6, 6);
      map.run({ col: 1, row: 1 }, axis === 'horizontal' ? 'east' : 'south', 4, material);
      const [group] = groupWallGeometry(resolveWallGeometry(map));
      const { image } = composeWalls(group as WallGroup);
      // Past the end cap: the first two bodies and straight joints against the next two.
      for (let u = JOINT_SIZE; u < JOINT_SIZE + 2 * SEGMENT_LENGTH; u += 1) {
        for (let v = 0; v < WALL_THICKNESS; v += 1) {
          const [x, y, x2, y2] = axis === 'horizontal' ? [u, v, u + SEGMENT_LENGTH, v] : [v, u, v, u + SEGMENT_LENGTH];
          assert.deepEqual(image.getPixel(x, y), image.getPixel(x2, y2), `${material} ${axis} at ${u}, ${v}`);
        }
      }
    }
  }
});

test('corners read as one surface: no outline along the diagonal from the outer to the inner corner', () => {
  const main = (i: number): [number, number] => [i, i];
  const anti = (i: number): [number, number] => [i, JOINT_SIZE - 1 - i];
  for (const material of WALL_MATERIALS) {
    for (const [mask, diagonal] of [
      [maskOf(['north', 'east']), anti],
      [maskOf(['east', 'south']), main],
      [maskOf(['south', 'west']), anti],
      [maskOf(['west', 'north']), main],
    ] as const) {
      const joint = jointSprite(material, mask);
      // Both ends are skipped: the outer corner of the outline and the inner corner pixel.
      for (let i = 1; i < JOINT_SIZE - 1; i += 1) {
        const [x, y] = diagonal(i);
        assert.ok(!same(joint.image.getPixel(x, y), wallOutline(material)), `${material} mask ${mask} (${x}, ${y})`);
      }
    }
  }
});

test('brick and stone courses end evenly: a whole unit on the outer course, a half on the inner one', () => {
  for (const material of ['brick', 'stone'] as const) {
    const body = bodySprite(material, 'horizontal').image;
    const line = body.getPixel(0, 4);
    const isLine = (x: number, y: number): boolean => same(body.getPixel(x, y), line);
    // The outer course (rows 1-7) starts on a joint line and ends on a whole unit before the next one.
    assert.ok(isLine(0, 4) && !isLine(BODY_LENGTH - 1, 4), `${material} outer course`);
    // The inner course (rows 9-14) is cut in half at both ends: its first and last lines sit 8px in.
    const lines = Array.from({ length: BODY_LENGTH }, (_, x) => x).filter((x) => isLine(x, 11));
    assert.equal(lines[0], HALF_JOINT, `${material} inner course starts with a half`);
    assert.equal(BODY_LENGTH - (lines.at(-1) as number), HALF_JOINT, `${material} inner course ends with a half`);
  }
  const brick = bodySprite('brick', 'horizontal').image;
  const mortarAt = (y: number): number[] =>
    Array.from({ length: BODY_LENGTH }, (_, x) => x).filter((x) => same(brick.getPixel(x, y), brick.getPixel(0, 4)));
  assert.deepEqual(mortarAt(4), [0]);
  assert.deepEqual(mortarAt(11), [8]);
});

test('brick and stone joint lines stay 1px wide where bodies meet joints', () => {
  for (const group of DEMO_GROUPS.filter((g) => g.material === 'brick' || g.material === 'stone')) {
    const { image, left, top } = composeWalls(group);
    const line = bodySprite(group.material, 'horizontal').image.getPixel(0, 4);
    for (const body of group.bodies) {
      const horizontal = body.edge.axis === 'horizontal';
      const { x, y } = body.rect;
      // Along the wall from 8px into the joint before the body to 8px into the one after it.
      for (const across of [3, 4, 5, 6, 10, 11, 12, 13]) {
        let run = 0;
        for (let u = -HALF_JOINT; u < BODY_LENGTH + HALF_JOINT; u += 1) {
          const [px, py] = horizontal ? [x + u, y + across] : [x + across, y + u];
          run = same(image.getPixel(px - left, py - top), line) ? run + 1 : 0;
          assert.ok(run <= 1, `${group.material} ${body.edge.axis} body at (${x}, ${y}): 2px line at u=${u}, row ${across}`);
        }
      }
    }
  }
});
