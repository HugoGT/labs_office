/**
 * Chairs in four materials (wood, metal, leather, gamer) and the four facings of seating.ts, built
 * from boxes by furnitureModel.ts. Every chair shares one seat: 14x14 pixels, its surface
 * SEAT_HEIGHT above the floor, its backrest's inner face 5 pixels behind the seat center, so any
 * seated pose fits any chair.
 *
 * The sprite contract (see seating.ts):
 * - `back` and `front` have the same size and origin; `back` goes under the sitter, `front` over
 *   it. A backrest seen from behind (facing up) and the armrest on the near side of a side view
 *   are in front; everything else is in the back layer.
 * - `ground` is the floor pixel under the seat center: the chair's (and its sitter's) depth for
 *   sorting against characters, whose feet point plays the same role.
 * - `seat` is the pixel where the sitter's pelvis center lands: the middle of the seat surface,
 *   always `ground` moved SEAT_HEIGHT pixels up.
 */
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { renderFurniture, type Box, type FurnitureModel, type Layer, type Part, type Span } from './furnitureModel.ts';
import type { PixelBuffer, Rgba } from './pixelBuffer.ts';
import { SEAT_HEIGHT, type Facing, type SeatPoint } from './seating.ts';

export const CHAIR_MATERIALS = ['wood', 'metal', 'leather', 'gamer'] as const;
export type ChairMaterial = (typeof CHAIR_MATERIALS)[number];

export interface ChairSprite {
  readonly back: PixelBuffer;
  readonly front: PixelBuffer;
  readonly seat: SeatPoint;
  readonly ground: SeatPoint;
}

/** Half the seat size; the seat spans -SEAT_HALF..SEAT_HALF on both floor axes. */
const SEAT_HALF = 7;
/** Model u of the backrest's inner face: where a sitter's back rests. */
const BACK_FACE = -5;
const SEAT_UNDER = SEAT_HEIGHT - 2;

const SEAT_SPAN: Span = [-SEAT_HALF, SEAT_HALF];

/** Seen from behind, the backrest covers the sitter's back. */
const backrestLayer = (facing: Facing): Layer => (facing === 'up' ? 'front' : 'back');

/** An armrest on the sitter's right (+1) or left (-1) side covers the sitter when it is the near one. */
function armLayer(side: 1 | -1): (facing: Facing) => Layer {
  return (facing) => (facing === 'up' || facing === (side > 0 ? 'right' : 'left') ? 'front' : 'back');
}

function mirrorV(box: Box): Box {
  return { ...box, v: [-box.v[1], -box.v[0]] };
}

function pair(box: Box): Box[] {
  return [box, mirrorV(box)];
}

function darken(color: Rgba, ramp: Ramp, amount: number): Rgba {
  return mixRgba(color, ramp.deep, amount);
}

// --- Wood --------------------------------------------------------------------------------------

const WOOD = makeRamp('#a36a3e');
const WOOD_TOP = 9 + 13;

/** Cafe chair: four square legs, the back ones rising into posts, a top rail and a wide splat. */
function woodChair(): FurnitureModel {
  const grain = (point: { face: string; u: number; v: number; col: number; row: number }, color: Rgba): Rgba =>
    point.face === 'top' && Math.floor(point.v + SEAT_HALF) % 5 === 4 ? darken(color, WOOD, 0.35) : color;
  return {
    shadow: { u: SEAT_SPAN, v: SEAT_SPAN, shape: 'ellipse' },
    parts: [
      { boxes: pair({ u: [5, 7], v: [5, 7], y: [0, SEAT_UNDER], ramp: WOOD, side: 'base' }) },
      { boxes: [{ u: SEAT_SPAN, v: SEAT_SPAN, y: [SEAT_UNDER, SEAT_HEIGHT], ramp: WOOD, top: 'light', side: 'shadow', shade: grain }] },
      {
        layer: backrestLayer,
        boxes: [
          ...pair({ u: [-7, BACK_FACE], v: [5, 7], y: [0, WOOD_TOP], ramp: WOOD, top: 'light', side: 'base' }),
          { u: [-7, BACK_FACE], v: [-5, 5], y: [WOOD_TOP - 4, WOOD_TOP], ramp: WOOD, top: 'light', side: 'base' },
          { u: [-7, BACK_FACE], v: [-2, 2], y: [SEAT_HEIGHT, WOOD_TOP - 4], ramp: WOOD, top: 'light', side: 'base' },
        ],
      },
    ],
  };
}

// --- Metal -------------------------------------------------------------------------------------

const STEEL = makeRamp('#9aa4b0');
const FRAME = makeRamp('#5f6977');
const METAL_TOP = 9 + 12;

/** Perforations: a hole every other pixel on alternate rows. */
function perforated(point: { face: string; col: number; row: number; width: number; height: number }, color: Rgba): Rgba {
  const inner = point.col > 0 && point.row > 0 && point.col < point.width - 1 && point.row < point.height - 1;
  return inner && point.row % 2 === 1 && point.col % 2 === 1 ? darken(color, STEEL, 0.55) : color;
}

/** Industrial chair: thin tube legs and uprights, a perforated steel seat and back panel. */
function metalChair(): FurnitureModel {
  return {
    shadow: { u: SEAT_SPAN, v: SEAT_SPAN, shape: 'ellipse' },
    parts: [
      { boxes: pair({ u: [5, 6], v: [5, 6], y: [0, SEAT_UNDER], ramp: FRAME, side: 'base' }) },
      { boxes: [{ u: SEAT_SPAN, v: SEAT_SPAN, y: [SEAT_UNDER, SEAT_HEIGHT], ramp: STEEL, top: 'base', side: 'shadow', shade: perforated }] },
      {
        layer: backrestLayer,
        boxes: [
          ...pair({ u: [-7, -6], v: [5, 6], y: [0, METAL_TOP], ramp: FRAME, top: 'light', side: 'base' }),
          { u: [-7, -6], v: [-6, 6], y: [METAL_TOP - 1, METAL_TOP], ramp: FRAME, top: 'light', side: 'base' },
          { u: [-7, BACK_FACE], v: [-5, 5], y: [METAL_TOP - 8, METAL_TOP - 1], ramp: STEEL, top: 'light', side: 'base', shade: perforated },
        ],
      },
    ],
  };
}

// --- Leather -----------------------------------------------------------------------------------

const LEATHER = makeRamp('#8c4a31');
const FEET = makeRamp('#4a2e22');
const LEATHER_TOP = 9 + 12;
const ARM_TOP = SEAT_HEIGHT + 4;

/** Buttoned upholstery: a dimple on a diamond grid, lit just above it. */
function tufted(point: { face: string; col: number; row: number; width: number; height: number }, color: Rgba): Rgba {
  // Only the side the sitter leans on is buttoned.
  if (point.face !== 'forward' || point.width < 8) return color;
  const { col, row } = point;
  if (row < 2 || row > point.height - 3 || col < 2 || col > point.width - 3) return color;
  if ((row % 6 === 2 && col % 6 === 3) || (row % 6 === 5 && col % 6 === 0)) return LEATHER.deep;
  return color;
}

/** Club armchair: a padded body on short dark feet, a cushion, rolled arms and a buttoned back. */
function leatherChair(): FurnitureModel {
  const cushion = (point: { face: string; col: number; row: number; width: number; height: number }, color: Rgba): Rgba =>
    point.face === 'top' && point.row === point.height - 1 ? mixRgba(color, LEATHER.light, 0.3) : color;
  return {
    shadow: { u: [-8, 7], v: [-10, 10], shape: 'ellipse' },
    parts: [
      { boxes: [...pair({ u: [5, 7], v: [7, 9], y: [0, 3], ramp: FEET, side: 'base' }), ...pair({ u: [-7, -5], v: [7, 9], y: [0, 3], ramp: FEET, side: 'base' })] },
      { boxes: [{ u: [-7, 7], v: [-9, 9], y: [3, SEAT_UNDER], ramp: LEATHER, side: 'shadow', rounded: true }] },
      { boxes: [{ u: [-6, 7], v: SEAT_SPAN, y: [SEAT_UNDER, SEAT_HEIGHT], ramp: LEATHER, top: 'base', side: 'base', rounded: true, shade: cushion }] },
      { layer: backrestLayer, boxes: [{ u: [-8, BACK_FACE], v: [-10, 10], y: [SEAT_UNDER, LEATHER_TOP], ramp: LEATHER, top: 'light', side: 'base', rounded: true, shade: tufted }] },
      { layer: armLayer(1), boxes: [{ u: [-7, 6], v: [7, 10], y: [3, ARM_TOP], ramp: LEATHER, top: 'light', side: 'base', rounded: true }] },
      { layer: armLayer(-1), boxes: [{ u: [-7, 6], v: [-10, -7], y: [3, ARM_TOP], ramp: LEATHER, top: 'light', side: 'base', rounded: true }] },
    ],
  };
}

// --- Gamer -------------------------------------------------------------------------------------

const SHELL = makeRamp('#363944');
const ACCENT = makeRamp('#d8433b');
const BASE = makeRamp('#2b2d34');
const CHROME = makeRamp('#aab3bd');
const GAMER_TOP = 9 + 16;
const STAR_RADIUS = 7;

/** Racing stripes down the seat and the backrest, and harness slots near the top. */
function racing(point: { face: string; u: number; v: number; y: number }, color: Rgba): Rgba {
  const stripe = Math.abs(Math.abs(point.v) - 3.5) < 0.9;
  if (point.face === 'top' || point.face === 'forward' || point.face === 'backward') {
    if (point.face !== 'top' && point.y > GAMER_TOP - 4 && point.y < GAMER_TOP - 2 && stripe) return SHELL.outline;
    if (stripe && point.y < GAMER_TOP - 4) return point.face === 'top' ? ACCENT.base : ACCENT.shadow;
  }
  return color;
}

/** Five spokes from the gas lift, one pointing back, each ending on a caster. */
function starBase(): Box[] {
  const boxes: Box[] = [{ u: [-1, 1], v: [-1, 1], y: [1, 3], ramp: BASE, top: 'light', side: 'base' }];
  for (let k = 0; k < 5; k += 1) {
    const angle = Math.PI + (2 * Math.PI * k) / 5;
    for (let t = 1.5; t <= STAR_RADIUS; t += 0.5) {
      const u = Math.floor(t * Math.cos(angle));
      const v = Math.floor(t * Math.sin(angle));
      const tip = t === STAR_RADIUS;
      boxes.push({ u: [u, u + 1], v: [v, v + 1], y: tip ? [0, 2] : [1, 2], ramp: BASE, top: tip ? 'base' : 'light', side: 'base' });
    }
  }
  return boxes;
}

/** Racing-style gaming chair: star base, bucket seat and tall winged backrest with red accents. */
function gamerChair(): FurnitureModel {
  const pad = { ramp: SHELL, top: 'light', side: 'base' } as const;
  return {
    shadow: { u: [-STAR_RADIUS, STAR_RADIUS], v: [-STAR_RADIUS, STAR_RADIUS], shape: 'ellipse' },
    parts: [
      { boxes: starBase() },
      { boxes: [{ u: [-1, 1], v: [-1, 1], y: [2, 6], ramp: CHROME, top: 'light', side: 'base' }, { u: [-4, 3], v: [-4, 4], y: [5, SEAT_UNDER], ramp: BASE, side: 'base' }] },
      {
        boxes: [
          { u: SEAT_SPAN, v: SEAT_SPAN, y: [SEAT_UNDER, SEAT_HEIGHT], ramp: SHELL, top: 'base', side: 'base', shade: racing },
          ...pair({ u: [-6, 7], v: [6, 8], y: [SEAT_UNDER, SEAT_HEIGHT + 1], ramp: ACCENT, top: 'base', side: 'shadow', rounded: true }),
        ],
      },
      {
        layer: backrestLayer,
        boxes: [
          { u: [-8, BACK_FACE], v: [-7, 7], y: [SEAT_UNDER + 1, GAMER_TOP - 4], ...pad, shade: racing },
          { u: [-8, BACK_FACE], v: [-5, 5], y: [GAMER_TOP - 4, GAMER_TOP], ...pad, rounded: true, shade: racing },
          ...pair({ u: [-7, -4], v: [6, 9], y: [SEAT_HEIGHT + 2, GAMER_TOP - 5], ramp: ACCENT, top: 'base', side: 'shadow', rounded: true }),
        ],
      },
      ...([1, -1] as const).map(
        (side): Part => ({
          layer: armLayer(side),
          boxes: [
            { u: [-2, 0], v: side > 0 ? [8, 10] : [-10, -8], y: [SEAT_UNDER, ARM_TOP], ramp: BASE, side: 'base' },
            { u: [-4, 3], v: side > 0 ? [8, 10] : [-10, -8], y: [ARM_TOP, ARM_TOP + 1], ramp: SHELL, top: 'light', side: 'base' },
          ],
        }),
      ),
    ],
  };
}

const MODELS: Readonly<Record<ChairMaterial, () => FurnitureModel>> = {
  wood: woodChair,
  metal: metalChair,
  leather: leatherChair,
  gamer: gamerChair,
};

const cache = new Map<string, ChairSprite>();

export function chairSprite(material: ChairMaterial, facing: Facing): ChairSprite {
  const id = `${material}:${facing}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const { back, front, origin } = renderFurniture(MODELS[material](), facing);
  const sprite: ChairSprite = { back, front, ground: origin, seat: { x: origin.x, y: origin.y - SEAT_HEIGHT } };
  cache.set(id, sprite);
  return sprite;
}
