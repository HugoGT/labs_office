import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ANCHOR_X, ANCHOR_Y, FRAME_HEIGHT, FRAME_WIDTH } from './camera.ts';
import { CHARACTERS } from './characters.ts';
import { facingYaw } from './directions.ts';
import { PixelBuffer } from './pixelBuffer.ts';
import { buildScene } from './rig.ts';
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
import { projectPoint } from './spriteRenderer.ts';
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
          for (let y = 0; y < image.height; y += 1) if (image.alphaAt(SIT_ANCHOR_X, y) > 0) lowest = y;
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
