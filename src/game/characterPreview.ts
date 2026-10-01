/**
 * Frames the entrance selector cuts from a character's sheets (art migration,
 * step 5). Pure and Phaser-free on purpose: the selector runs before the
 * office, and loading Phaser there is exactly what the lazy office chunk
 * avoids. The numbers come from the contract, so a preview shows the same
 * cell the office will draw.
 */

import { CHARACTER_SEATED, CHARACTER_WALK, seatedRowForFacing, sheetSize, walkRowForFacing, type ArtFacing } from './artContract';

export type CharacterPose = 'idle' | 'walk' | 'seated';

/** Everything a CSS background sprite needs, already multiplied by the scale. */
export interface CharacterPreviewFrame {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  /** Background offset of the first frame shown. */
  readonly x: number;
  readonly y: number;
  /** Frames an animation steps through to the right of `x`; 0 for a still pose. */
  readonly steps: number;
}

/** Previews face the viewer, like the office's default facing, unless told otherwise. */
const PREVIEW_FACING: ArtFacing = 'down';

/**
 * `scale` must be an integer for crisp pixel art: the sheets are drawn 1:1 and
 * a fractional scale would make some pixels wider than others.
 */
export function characterPreviewFrame(
  sheets: { readonly walkUrl: string; readonly seatedUrl: string },
  pose: CharacterPose,
  scale: number,
  facing: ArtFacing = PREVIEW_FACING,
): CharacterPreviewFrame {
  const spec = pose === 'seated' ? CHARACTER_SEATED : CHARACTER_WALK;
  const sheet = sheetSize(spec);
  const column =
    pose === 'seated' ? CHARACTER_SEATED.idleColumns[0] : pose === 'idle' ? CHARACTER_WALK.idleColumn : 0;
  const row = pose === 'seated' ? seatedRowForFacing(facing) : walkRowForFacing(facing);
  return {
    url: pose === 'seated' ? sheets.seatedUrl : sheets.walkUrl,
    width: spec.frame.width * scale,
    height: spec.frame.height * scale,
    sheetWidth: sheet.width * scale,
    sheetHeight: sheet.height * scale,
    x: -column * spec.frame.width * scale,
    y: -row * spec.frame.height * scale,
    steps: pose === 'walk' ? CHARACTER_WALK.stepColumns : 0,
  };
}
