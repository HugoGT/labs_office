/**
 * Sofas of two and three seats in leather and in a colorable fabric, the armchairs of
 * upholstery.ts widened one seat per tile, in the four facings of seating.ts.
 *
 * The sprite contract extends the chairs' (chairs.ts) to several seats:
 * - `back` and `front` have the same size and origin; `back` goes under every sitter, `front` over
 *   every sitter.
 * - `ground` is the floor pixel under the middle of the sofa (the middle of its footprint).
 * - `seats` are where the sitters' pelvises land, one per seat in footprint order (left to right
 *   facing up or down, top to bottom facing left or right): a whole tile (SEAT_PITCH) apart on
 *   screen, each SEAT_HEIGHT above the floor under it, so each seat sits on its own tile's middle.
 */
import { floorPoint, renderFurniture } from './furnitureModel.ts';
import { DEFAULT_FABRIC_COLOR, seatV, upholsteredModel, type UpholsteryStyle } from './upholstery.ts';
import type { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { SEAT_HEIGHT, type Facing, type SeatPoint } from '../../../src/art/seating.ts';

export const SOFA_MATERIALS = ['leather', 'fabric'] as const satisfies readonly UpholsteryStyle[];
export type SofaMaterial = (typeof SOFA_MATERIALS)[number];

export const SOFA_SEATS = [2, 3] as const;
export type SofaSeats = (typeof SOFA_SEATS)[number];

/** The color a colorable sofa is exported in; the leather keeps its own. */
export const SOFA_DEFAULT_COLORS: Readonly<Partial<Record<SofaMaterial, string>>> = { fabric: DEFAULT_FABRIC_COLOR };

export interface SofaSprite {
  readonly back: PixelBuffer;
  readonly front: PixelBuffer;
  readonly ground: SeatPoint;
  readonly seats: readonly SeatPoint[];
}

/** Room for a three-seat sofa turned sideways, which runs three tiles down the screen. */
const SOFA_CANVAS = 192;

const cache = new Map<string, SofaSprite>();

/** `color` paints the fabric sofa; the leather one ignores it. */
export function sofaSprite(material: SofaMaterial, seats: SofaSeats, facing: Facing, color?: string): SofaSprite {
  const fallback = SOFA_DEFAULT_COLORS[material];
  const painted = fallback === undefined ? '' : (color ?? fallback);
  const id = `${material}:${seats}:${facing}:${painted}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const model = upholsteredModel(material, seats, facing, painted === '' ? undefined : painted);
  const { back, front, origin } = renderFurniture(model, facing, SOFA_CANVAS);
  const points = Array.from({ length: seats }, (_, index) => {
    const floor = floorPoint(facing, 0, seatV(seats, index, facing));
    return { x: origin.x + floor.x, y: origin.y + floor.y - SEAT_HEIGHT };
  });
  // Footprint order: left to right on screen, or top to bottom for a sideways sofa.
  const sideways = facing === 'left' || facing === 'right';
  points.sort((a, b) => (sideways ? a.y - b.y : a.x - b.x));
  const sprite: SofaSprite = { back, front, ground: origin, seats: points };
  if (painted !== '' && cache.size > 64) cache.clear();
  cache.set(id, sprite);
  return sprite;
}
