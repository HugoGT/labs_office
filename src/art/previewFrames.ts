/**
 * The few frames the creator's live preview shows (idle, the walk steps and
 * the seated idle, all facing the viewer), drawn with the same rig, poses and
 * frame geometry as the full sheets, so the preview is pixel for pixel what
 * the server will draw. A dozen renders instead of the ~110 of both sheets,
 * which keeps every change of the creator under a frame budget in the browser.
 */
import { CHARACTER_SEATED } from '../game/artContract.ts';
import type { CharacterSpec } from './characters.ts';
import { facingYaw, type Direction } from './directions.ts';
import type { PixelBuffer } from './pixelBuffer.ts';
import { buildScene, rampsFor } from './rig.ts';
import { FACING_DIRECTION, type Facing } from './seating.ts';
import { seatBack, sitFrameGeometry, sitPose } from './sitCycle.ts';
import { renderScene } from './spriteRenderer.ts';
import { STANDING_POSE, WALK_FRAME_COUNT, walkPose } from './walkCycle.ts';

export interface CharacterPreviewFrames {
  readonly idle: PixelBuffer;
  readonly walk: readonly PixelBuffer[];
  readonly seated: PixelBuffer;
}

const PREVIEW_DIRECTION: Direction = 'S';
const PREVIEW_CHAIR: Facing = 'down';

export function renderCharacterPreview(spec: CharacterSpec): CharacterPreviewFrames {
  const ramps = rampsFor(spec);
  const yaw = facingYaw(PREVIEW_DIRECTION);
  const walk = Array.from({ length: WALK_FRAME_COUNT }, (_, frame) => renderScene(buildScene(spec, walkPose(frame)), ramps, yaw));
  const seatedPose = sitPose(CHARACTER_SEATED.idleColumns[0]!);
  const seated = renderScene(
    buildScene(spec, seatedPose, seatBack(PREVIEW_CHAIR)),
    ramps,
    facingYaw(FACING_DIRECTION[PREVIEW_CHAIR]),
    sitFrameGeometry(PREVIEW_CHAIR),
  );
  return { idle: renderScene(buildScene(spec, STANDING_POSE), ramps, yaw), walk, seated };
}
