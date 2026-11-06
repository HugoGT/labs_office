/**
 * Hazard mat: a charcoal rubber mat ringed by a yellow-and-black diagonal
 * stripe band, the marking of a loading or danger zone. The stripes follow one
 * global diagonal so they run the same way on every side and turn the corners
 * without a seam; the phase puts a yellow stripe through each corner. The dark
 * stripes are the field's own tone, so the band reads as yellow painted on the mat.
 */
import { PixelBuffer, type Rgba } from '../../../../src/art/pixelBuffer.ts';
import { createRng } from '../random.ts';
import { makeRamp, mixRgba } from '../color.ts';
import { rugCanvas, rugFootprint, type RugFacing } from './shared.ts';

const RUBBER = makeRamp('#41444c');
const YELLOW = makeRamp('#f2c230');

export const HAZARD_PALETTE = {
  outline: RUBBER.outline,
  field: RUBBER.base,
  yellow: YELLOW.base,
} as const;

/**
 * Where the stripe band sits, in pixels from the outer edge, and how wide it is:
 * right inside the outline, so the yellow touches it with no rim between, and
 * straight into the field with no separator line. 9px keeps the field 10px in.
 */
export const HAZARD_BAND = { inset: 1, width: 9 } as const;

/** Stripe period along the diagonal: half yellow, half black. */
const PERIOD = 8;
const SEED = 0x4a2a7d;

function stripeColor(x: number, y: number): Rgba {
  // Centering x - y = 0 in a yellow stripe makes the corners on that diagonal symmetric.
  const t = (((x - y + 2) % PERIOD) + PERIOD) % PERIOD;
  return t < PERIOD / 2 ? HAZARD_PALETTE.yellow : HAZARD_PALETTE.field;
}

export function hazardRug(facing: RugFacing): PixelBuffer {
  const out = rugCanvas(facing);
  const { width, height } = rugFootprint(facing);
  const rng = createRng(SEED + (facing === 'horizontal' ? 0 : 1));
  const bandEnd = HAZARD_BAND.inset + HAZARD_BAND.width;
  const speckLight = mixRgba(HAZARD_PALETTE.field, RUBBER.light, 0.14);
  const speckDark = mixRgba(HAZARD_PALETTE.field, RUBBER.shadow, 0.35);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Distance to the nearest edge decides the ring the pixel belongs to.
      const d = Math.min(x, y, width - 1 - x, height - 1 - y);
      let color: Rgba;
      if (d === 0) color = HAZARD_PALETTE.outline;
      else if (d < bandEnd) color = stripeColor(x, y);
      else {
        const roll = rng();
        color = roll < 0.025 ? speckLight : roll < 0.05 ? speckDark : HAZARD_PALETTE.field;
      }
      out.setPixel(x, y, color);
    }
  }
  return out;
}
