/**
 * The frame the creator's live preview shows: the character standing still,
 * facing the viewer, drawn with the same rig, pose and frame geometry as the
 * full walk sheet, so the preview is pixel for pixel what the server will
 * draw. One render instead of the ~110 of both sheets, which keeps every
 * change of the creator well under a frame budget in the browser.
 */
import type { CharacterSpec } from './characters.ts';
import { facingYaw } from './directions.ts';
import type { PixelBuffer } from './pixelBuffer.ts';
import { buildScene, rampsFor } from './rig.ts';
import { renderScene } from './spriteRenderer.ts';
import { STANDING_POSE } from './walkCycle.ts';

export function renderCharacterIdle(spec: CharacterSpec): PixelBuffer {
  return renderScene(buildScene(spec, STANDING_POSE), rampsFor(spec), facingYaw('S'));
}
