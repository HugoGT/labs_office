/**
 * The desk rugs of the pack: six 3x2 rugs laid under a desk, each drawn per
 * facing by its own module. Only the woven one takes a color, exported in
 * DEFAULT_RUG_COLOR and recolored by ramp like a painted desk.
 */
import type { PixelBuffer } from '../../../../src/art/pixelBuffer.ts';
import type { RugFacing } from './shared.ts';
import { grassRug } from './grass.ts';
import { hazardRug } from './hazard.ts';
import { mosaicRug } from './mosaic.ts';
import { stoneRug } from './stone.ts';
import { woodRug } from './wood.ts';
import { DEFAULT_RUG_COLOR, wovenRug } from './woven.ts';

export const RUG_KINDS = ['woven', 'wood', 'hazard', 'grass', 'stone', 'mosaic'] as const;
export type RugKind = (typeof RUG_KINDS)[number];

/** The color a colorable rug is exported in. */
export const RUG_DEFAULT_COLORS: Readonly<Partial<Record<RugKind, string>>> = { woven: DEFAULT_RUG_COLOR };

const DRAW: Readonly<Record<RugKind, (facing: RugFacing) => PixelBuffer>> = {
  woven: (facing) => wovenRug(facing),
  wood: woodRug,
  hazard: hazardRug,
  grass: grassRug,
  stone: stoneRug,
  mosaic: mosaicRug,
};

/** A rug in one facing: the footprint plus RUG_BELOW rows (`rugCanvas`). */
export function rugSprite(kind: RugKind, facing: RugFacing): PixelBuffer {
  return DRAW[kind](facing);
}
