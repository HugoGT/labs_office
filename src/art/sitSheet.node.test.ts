import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ANCHOR_X, ANCHOR_Y, FRAME_HEIGHT, FRAME_WIDTH } from './camera.ts';
import { CHARACTERS, type CharacterSpec } from './characters.ts';
import { facingYaw } from './directions.ts';
import { PixelBuffer } from './pixelBuffer.ts';
import { buildScene, rampsFor } from './rig.ts';
import { FACING_DIRECTION, FACINGS, type Facing } from './seating.ts';
import {
  SIT_ANCHOR_X,
  SIT_ANCHOR_Y,
  SIT_DOWN_FRAME_COUNT,
  SIT_FRAME_COUNT,
  SIT_FRAME_HEIGHT,
  SIT_FRAME_WIDTH,
  SIT_IDLE_FRAME_COUNT,
  STAND_OFFSET,
  seatBack,
  sitFrameGeometry,
  sitPose,
} from './sitCycle.ts';
import { projectPoint, renderScene } from './spriteRenderer.ts';
import { buildCharacterSprites, frameRect, sitFrameRect } from './spriteSheet.ts';

const sprites = CHARACTERS.map((character) => ({ character, ...buildCharacterSprites(character) }));
const sample = [0, 3, 5, 15, 16, 17].map((index) => sprites[index]).filter((entry) => entry !== undefined);
const SEATED_COLUMNS = Array.from({ length: SIT_IDLE_FRAME_COUNT + 1 }, (_, i) => SIT_DOWN_FRAME_COUNT - 1 + i);

function cell(sheet: PixelBuffer, facing: Facing, column: number): PixelBuffer {
  const rect = sitFrameRect(facing, column);
  const out = new PixelBuffer(rect.width, rect.height);
  out.blit(sheet, -rect.x, -rect.y);
  return out;
}

function opaqueColumns(image: PixelBuffer, fromRow: number): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let y = Math.max(0, fromRow); y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alphaAt(x, y) === 255) {
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
    }
  }
  return max < min ? 0 : max - min + 1;
}

test('the sit sheet is 4 facing rows by the transition plus idle columns', () => {
  assert.ok(SIT_FRAME_WIDTH >= FRAME_WIDTH && SIT_FRAME_HEIGHT >= FRAME_HEIGHT);
  for (const { sit } of sprites) {
    assert.equal(sit.width, SIT_FRAME_WIDTH * SIT_FRAME_COUNT);
    assert.equal(sit.height, SIT_FRAME_HEIGHT * FACINGS.length);
  }
  assert.deepEqual(sitFrameRect('left', 3), {
    x: 3 * SIT_FRAME_WIDTH,
    y: 2 * SIT_FRAME_HEIGHT,
    width: SIT_FRAME_WIDTH,
    height: SIT_FRAME_HEIGHT,
  });
});

test('every sit frame holds the whole character without touching the cell border', () => {
  for (const { character, sit } of sprites) {
    for (const facing of FACINGS) {
      for (let column = 0; column < SIT_FRAME_COUNT; column += 1) {
        const image = cell(sit, facing, column);
        const label = `${character.id} ${facing} ${column}`;
        assert.ok(image.countOpaque() > 200, `${label} is too empty`);
        for (let x = 0; x < image.width; x += 1) {
          assert.equal(image.alphaAt(x, 0), 0, `${label} touches the top`);
          assert.equal(image.alphaAt(x, image.height - 1), 0, `${label} touches the bottom`);
        }
        for (let y = 0; y < image.height; y += 1) {
          assert.equal(image.alphaAt(0, y), 0, `${label} touches the left edge`);
          assert.equal(image.alphaAt(image.width - 1, y), 0, `${label} touches the right edge`);
        }
      }
    }
  }
});

test('the pelvis lands exactly on SIT_ANCHOR in every seated frame and facing', () => {
  for (const { character } of sample) {
    for (const column of SEATED_COLUMNS) {
      for (const facing of FACINGS) {
        const scene = buildScene(character, sitPose(column), seatBack(facing));
        assert.ok(scene.seat, `${character.id} ${column} has no seat point`);
        const yaw = facingYaw(FACING_DIRECTION[facing]);
        const point = projectPoint(scene.seat, yaw, sitFrameGeometry(facing));
        assert.ok(Math.abs(point.x - SIT_ANCHOR_X) < 1e-6, `${character.id} ${facing} ${column} x ${point.x}`);
        assert.ok(Math.abs(point.y - SIT_ANCHOR_Y) < 1e-6, `${character.id} ${facing} ${column} y ${point.y}`);
      }
    }
  }
});

test('the rendered pelvis sits on the anchor pixel', () => {
  for (const { character, sit } of sample) {
    for (const column of SEATED_COLUMNS) {
      for (const facing of FACINGS) {
        const image = cell(sit, facing, column);
        const label = `${character.id} ${facing} ${column}`;
        assert.equal(image.alphaAt(SIT_ANCHOR_X, SIT_ANCHOR_Y - 2), 255, `${label}: no body above the seat point`);
        if (facing === 'left' || facing === 'right') {
          // Side view: the bottom of the pelvis, outline included, is on the seat line. The near
          // thigh sits a little closer to the camera, so it may reach half a pixel lower.
          let lowest = -1;
          // Opaque only: the translucent seat shadow below the thighs is not part of the pelvis.
          for (let y = 0; y < image.height; y += 1) if (image.alphaAt(SIT_ANCHOR_X, y) === 255) lowest = y;
          assert.ok(Math.abs(lowest - SIT_ANCHOR_Y) <= 1, `${label}: pelvis bottom at row ${lowest}`);
        }
      }
    }
  }
});

test('breathing only moves the upper body: the seat line and legs stay still', () => {
  for (const { character, sit } of sprites) {
    for (const facing of FACINGS) {
      const first = cell(sit, facing, SEATED_COLUMNS[0] ?? 0);
      for (const column of SEATED_COLUMNS.slice(1)) {
        const other = cell(sit, facing, column);
        for (let y = SIT_ANCHOR_Y; y < first.height; y += 1) {
          for (let x = 0; x < first.width; x += 1) {
            const at = `${character.id} ${facing} ${column} at ${x},${y}`;
            assert.equal(other.alphaAt(x, y), first.alphaAt(x, y), `${at}: silhouette moved`);
            // Right at the seat line the rising forearms may shift a cast shadow; below it, nothing changes.
            if (y >= SIT_ANCHOR_Y + 3) assert.deepEqual(other.getPixel(x, y), first.getPixel(x, y), at);
          }
        }
      }
    }
  }
});

test('the seated character fits a chair seat of about 16-20px', () => {
  for (const { character, sit } of sprites) {
    for (const facing of FACINGS) {
      const image = cell(sit, facing, SIT_DOWN_FRAME_COUNT - 1);
      const label = `${character.id} ${facing}`;
      assert.ok(opaqueColumns(image, SIT_ANCHOR_Y - 2) <= 20, `${label}: seat footprint ${opaqueColumns(image, SIT_ANCHOR_Y - 2)}px`);
      if (facing === 'up' || facing === 'down') {
        assert.ok(opaqueColumns(image, 0) <= 20, `${label}: body width ${opaqueColumns(image, 0)}px`);
      }
    }
  }
});

test('the sit-down transition starts from the standing idle frame at STAND_OFFSET, pixel for pixel', () => {
  for (const { character, idle, sit } of sprites) {
    for (const facing of FACINGS) {
      const start = cell(sit, facing, 0);
      const rect = frameRect(FACING_DIRECTION[facing], 0);
      const standing = new PixelBuffer(start.width, start.height);
      const dx = SIT_ANCHOR_X + STAND_OFFSET[facing].x - ANCHOR_X;
      const dy = SIT_ANCHOR_Y + STAND_OFFSET[facing].y - ANCHOR_Y;
      standing.blit(idle, dx - rect.x, dy - rect.y);
      // Only the idle cell itself, not its neighbors in the sheet.
      const clipped = new PixelBuffer(start.width, start.height);
      for (let y = dy; y < dy + FRAME_HEIGHT; y += 1) {
        for (let x = dx; x < dx + FRAME_WIDTH; x += 1) clipped.setPixel(x, y, standing.getPixel(x, y));
      }
      let differing = 0;
      for (let y = 0; y < start.height; y += 1) {
        for (let x = 0; x < start.width; x += 1) {
          const a = start.getPixel(x, y);
          const b = clipped.getPixel(x, y);
          if (a.r !== b.r || a.g !== b.g || a.b !== b.b || a.a !== b.a) differing += 1;
        }
      }
      assert.equal(differing, 0, `${character.id} ${facing}: ${differing} pixels differ`);
    }
  }
});

test('each transition frame is a distinct drawing', () => {
  for (const { character, sit } of sample) {
    for (const facing of FACINGS) {
      for (let column = 1; column < SIT_DOWN_FRAME_COUNT; column += 1) {
        const a = cell(sit, facing, column - 1);
        const b = cell(sit, facing, column);
        assert.ok(!a.data.every((value, index) => value === b.data[index]), `${character.id} ${facing} ${column}`);
      }
    }
  }
});

/** Pixels the soft contact shadow shows through: neither empty nor part of the opaque figure. */
function translucentPixels(image: PixelBuffer): { x: number; y: number }[] {
  const pixels: { x: number; y: number }[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.alphaAt(x, y);
      if (alpha > 0 && alpha < 255) pixels.push({ x, y });
    }
  }
  return pixels;
}

/** Same footprint the renderer stamps: an ellipse centered half a pixel above a contact point. */
function insideShadow(pixel: { x: number; y: number }, contact: { x: number; y: number }): boolean {
  const u = (pixel.x + 0.5 - contact.x) / 7.5;
  const w = (pixel.y + 0.5 - (contact.y - 0.5)) / 2.4;
  return u * u + w * w <= 1;
}

function assertShadowAt(image: PixelBuffer, contact: { x: number; y: number }, label: string): void {
  const shadow = translucentPixels(image);
  assert.ok(shadow.length > 0, `${label}: no shadow pixel shows`);
  const stray = shadow.filter((pixel) => !insideShadow(pixel, contact));
  assert.deepEqual(stray, [], `${label}: shadow pixels away from (${contact.x}, ${contact.y})`);
}

function isSeated(column: number): boolean {
  const pose = sitPose(column);
  return 'sit' in pose && pose.sit.lower === 1;
}

/** The whole shadow of a sit cell, rendered without the body that covers most of it. */
function shadowMask(character: CharacterSpec, facing: Facing, column: number): { x: number; y: number }[] {
  const scene = buildScene(character, sitPose(column), seatBack(facing));
  const yaw = facingYaw(FACING_DIRECTION[facing]);
  const image = renderScene({ ...scene, primitives: [], decals: [] }, rampsFor(character), yaw, sitFrameGeometry(facing));
  return translucentPixels(image);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Parts wrapped around the pelvis: its back is the sitter's back, whatever hangs behind it. */
const PELVIS_PARTS: ReadonlySet<string> = new Set(['hips', 'skirt', 'coat']);

/**
 * Side views: the screen column of the back of the pelvis, from a render of the pelvis parts
 * alone, so long hair or a handbag set down behind the sitter does not count as the back.
 */
function pelvisBack(character: CharacterSpec, facing: Facing, column: number, backToward: 1 | -1): number {
  const scene = buildScene(character, sitPose(column), seatBack(facing));
  const pelvis = { ...scene, primitives: scene.primitives.filter((primitive) => PELVIS_PARTS.has(primitive.part)), decals: [] };
  const image = renderScene(pelvis, rampsFor(character), facingYaw(FACING_DIRECTION[facing]), sitFrameGeometry(facing));
  let back = backToward > 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alphaAt(x, y) === 255) back = backToward > 0 ? Math.max(back, x) : Math.min(back, x);
    }
  }
  return back;
}

test('sit-down frames before the pelvis rests keep the one shadow under the planted feet', () => {
  for (const { character, sit } of sample) {
    for (const facing of FACINGS) {
      for (let column = 0; column < SIT_FRAME_COUNT; column += 1) {
        if (isSeated(column)) continue;
        const feet = sitFrameGeometry(facing);
        assertShadowAt(cell(sit, facing, column), { x: feet.anchorX, y: feet.anchorY }, `${character.id} ${facing} ${column}`);
      }
    }
  }
});

test('seated, the one shadow sits lower than the seat point and none is left under the feet', () => {
  for (const { character, sit } of sample) {
    for (const facing of FACINGS) {
      for (let column = 0; column < SIT_FRAME_COUNT; column += 1) {
        if (!isSeated(column)) continue;
        const label = `${character.id} ${facing} ${column}`;
        const mask = shadowMask(character, facing, column);
        assert.ok(mask.length > 0, `${label}: no shadow`);
        const centerY = mean(mask.map((pixel) => pixel.y + 0.5));
        assert.ok(centerY > SIT_ANCHOR_Y, `${label}: shadow centered at row ${centerY}, not below the seat`);
        // Every translucent pixel of the real cell belongs to that one shadow.
        const inMask = new Set(mask.map((pixel) => `${pixel.x},${pixel.y}`));
        const stray = translucentPixels(cell(sit, facing, column)).filter((pixel) => !inMask.has(`${pixel.x},${pixel.y}`));
        assert.deepEqual(stray, [], `${label}: a second shadow`);
      }
    }
  }
});

test('seen from the side, the seated shadow starts at the back of the pelvis and runs forward under the thighs', () => {
  for (const { character } of sample) {
    for (const facing of ['left', 'right'] as const) {
      // Facing left (W) the back is toward screen right, facing right (E) toward screen left.
      const backToward = facing === 'left' ? 1 : -1;
      for (let column = 0; column < SIT_FRAME_COUNT; column += 1) {
        if (!isSeated(column)) continue;
        const label = `${character.id} ${facing} ${column}`;
        const xs = shadowMask(character, facing, column).map((pixel) => pixel.x);
        const back = pelvisBack(character, facing, column, backToward);
        const rearmost = backToward > 0 ? Math.max(...xs) : Math.min(...xs);
        const frontmost = backToward > 0 ? Math.min(...xs) : Math.max(...xs);
        assert.ok((rearmost - back) * backToward <= 0, `${label}: shadow reaches column ${rearmost}, behind the back at ${back}`);
        // The silhouette's 1px outline lies outside the hips, and a pixel joins the shadow only when
        // its center is inside: the shadow's rear column may fall up to 2 columns inside the edge.
        assert.ok((back - rearmost) * backToward <= 2, `${label}: shadow starts at column ${rearmost}, short of the back at ${back}`);
        assert.ok((SIT_ANCHOR_X - frontmost) * backToward >= 6, `${label}: shadow front at column ${frontmost}, not under the thighs`);
      }
    }
  }
});

test('seen from the front or the back, the seated shadow lies ahead of the seat point in depth', () => {
  // The same footprint ahead of the seat shows lower on screen facing down (toward the viewer)
  // than facing up (away from the viewer); centered on the seat it would show at the same row.
  for (const { character } of sample) {
    for (let column = 0; column < SIT_FRAME_COUNT; column += 1) {
      if (!isSeated(column)) continue;
      const row = (facing: Facing): number => mean(shadowMask(character, facing, column).map((pixel) => pixel.y + 0.5));
      assert.ok(row('down') - row('up') >= 1.5, `${character.id} ${column}: down ${row('down')}, up ${row('up')}`);
    }
  }
});

test('standing idle frames keep the contact shadow under the feet', () => {
  for (const { character, idle } of sample) {
    for (const facing of FACINGS) {
      const rect = frameRect(FACING_DIRECTION[facing], 0);
      const image = new PixelBuffer(rect.width, rect.height);
      image.blit(idle, -rect.x, -rect.y);
      assertShadowAt(image, { x: ANCHOR_X, y: ANCHOR_Y }, `${character.id} ${facing} idle`);
    }
  }
});
