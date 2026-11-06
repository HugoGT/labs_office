/**
 * Shared geometry of the desk rugs: a flat piece of floor 3 tiles wide and 2
 * deep, laid under a desk. A rug turns like a room table: `horizontal` is the
 * footprint as stated (96x64), `vertical` the footprint swapped (64x96). Each
 * rug draws both facings itself instead of rotating pixels, so its light, its
 * thickness and anything standing under it (the raised floor's legs) keep
 * pointing down the screen.
 *
 * A rug image is the footprint plus RUG_BELOW transparent rows under it, room
 * for what hangs below the floor line (legs, a contact shadow).
 */
import { PixelBuffer } from '../../../../src/art/pixelBuffer.ts';
import { RUG_BELOW, type RugFacing } from '../../../../src/game/artContract.ts';

export { RUG_BELOW, RUG_FACINGS, type RugFacing } from '../../../../src/game/artContract.ts';

/** Tiles of the horizontal footprint. */
export const RUG_TILES = { w: 3, h: 2 } as const;
export const RUG_TILE_PX = 32;

/** Footprint pixels of a facing. */
export function rugFootprint(facing: RugFacing): { readonly width: number; readonly height: number } {
  const w = RUG_TILES.w * RUG_TILE_PX;
  const h = RUG_TILES.h * RUG_TILE_PX;
  return facing === 'horizontal' ? { width: w, height: h } : { width: h, height: w };
}

/** A transparent canvas of the footprint plus RUG_BELOW rows. */
export function rugCanvas(facing: RugFacing): PixelBuffer {
  const { width, height } = rugFootprint(facing);
  return new PixelBuffer(width, height + RUG_BELOW);
}
