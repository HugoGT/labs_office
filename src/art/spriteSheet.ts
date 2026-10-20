/**
 * Sprite sheet layout, one sheet per character:
 * - walk: 10 columns (frames 0..9) by 8 rows in DIRECTIONS order: S, SE, E, NE, N, NW, W, SW.
 * - idle: 1 column by the same 8 rows, used while a character stands still.
 * - sit: SIT_FRAME_COUNT columns (the SIT_DOWN_FRAME_COUNT sit-down frames, then the
 *   SIT_IDLE_FRAME_COUNT seated idle frames) by 4 rows in SIT_ROWS order: up (N), down (S),
 *   left (W), right (E). Cells are SIT_FRAME_WIDTH x SIT_FRAME_HEIGHT; see sitCycle.ts for the
 *   seat anchor and where to stand before sitting down.
 * Every direction is rendered from the 3D rig (no mirroring), so held items stay in the
 * right hand and the light keeps coming from the upper left.
 */
import { FRAME_HEIGHT, FRAME_WIDTH } from './camera.ts';
import type { CharacterSpec } from './characters.ts';
import { DIRECTIONS, directionIndex, facingYaw, type Direction } from './directions.ts';
import { PixelBuffer } from './pixelBuffer.ts';
import { buildScene, rampsFor } from './rig.ts';
import { FACING_DIRECTION, type Facing } from './seating.ts';
import { seatBack, SIT_FRAME_COUNT, SIT_FRAME_HEIGHT, SIT_FRAME_WIDTH, SIT_ROWS, sitFrameGeometry, sitPose } from './sitCycle.ts';
import { renderScene } from './spriteRenderer.ts';
import { STANDING_POSE, WALK_FRAME_COUNT, walkPose, type WalkPose } from './walkCycle.ts';

export { FRAME_HEIGHT, FRAME_WIDTH } from './camera.ts';

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CharacterSprites {
  readonly walk: PixelBuffer;
  readonly idle: PixelBuffer;
  readonly sit: PixelBuffer;
}

export function frameRect(direction: Direction, frame: number): FrameRect {
  return { x: frame * FRAME_WIDTH, y: directionIndex(direction) * FRAME_HEIGHT, width: FRAME_WIDTH, height: FRAME_HEIGHT };
}

/** Cell of the sit sheet for a chair facing; columns are sit-down frames, then idle frames. */
export function sitFrameRect(facing: Facing, column: number): FrameRect {
  return {
    x: column * SIT_FRAME_WIDTH,
    y: SIT_ROWS.indexOf(facing) * SIT_FRAME_HEIGHT,
    width: SIT_FRAME_WIDTH,
    height: SIT_FRAME_HEIGHT,
  };
}

function renderColumn(spec: CharacterSpec, pose: WalkPose, target: PixelBuffer, column: number): void {
  const scene = buildScene(spec, pose);
  const ramps = rampsFor(spec);
  for (const direction of DIRECTIONS) {
    const rect = frameRect(direction, column);
    target.blit(renderScene(scene, ramps, facingYaw(direction)), rect.x, rect.y);
  }
}

export function buildCharacterSprites(spec: CharacterSpec): CharacterSprites {
  const walk = new PixelBuffer(FRAME_WIDTH * WALK_FRAME_COUNT, FRAME_HEIGHT * DIRECTIONS.length);
  for (let frame = 0; frame < WALK_FRAME_COUNT; frame += 1) renderColumn(spec, walkPose(frame), walk, frame);
  const idle = new PixelBuffer(FRAME_WIDTH, FRAME_HEIGHT * DIRECTIONS.length);
  renderColumn(spec, STANDING_POSE, idle, 0);
  return { walk, idle, sit: buildSitSheet(spec) };
}

function buildSitSheet(spec: CharacterSpec): PixelBuffer {
  const sheet = new PixelBuffer(SIT_FRAME_WIDTH * SIT_FRAME_COUNT, SIT_FRAME_HEIGHT * SIT_ROWS.length);
  const ramps = rampsFor(spec);
  // The last sit-down frame is also the first idle frame: render each distinct pose once.
  const cells = new Map<WalkPose, PixelBuffer[]>();
  for (let column = 0; column < SIT_FRAME_COUNT; column += 1) {
    const pose = sitPose(column);
    let rendered = cells.get(pose);
    if (!rendered) {
      rendered = SIT_ROWS.map((facing) =>
        renderScene(buildScene(spec, pose, seatBack(facing)), ramps, facingYaw(FACING_DIRECTION[facing]), sitFrameGeometry(facing)),
      );
      cells.set(pose, rendered);
    }
    rendered.forEach((image, row) => sheet.blit(image, column * SIT_FRAME_WIDTH, row * SIT_FRAME_HEIGHT));
  }
  return sheet;
}
