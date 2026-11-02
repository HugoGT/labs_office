/**
 * Chairs in eight materials (wood, metal, leather, gamer, office, task, fabric, executive) and the
 * four facings of seating.ts, built from boxes by furnitureModel.ts. Every chair shares one seat: 14x14 pixels, its surface
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
import { renderFurniture, type Box, type FurnitureModel, type Part } from './furnitureModel.ts';
import { ARM_TOP, BACK_FACE, DEFAULT_FABRIC_COLOR, LEATHER_FEET, SEAT_HALF, SEAT_SPAN, SEAT_UNDER, armLayer, backrestLayer, upholsteredModel } from './upholstery.ts';
import type { PixelBuffer, Rgba } from '../../../src/art/pixelBuffer.ts';
import { SEAT_HEIGHT, type Facing, type SeatPoint } from '../../../src/art/seating.ts';

export const CHAIR_MATERIALS = ['wood', 'metal', 'leather', 'gamer', 'office', 'task', 'fabric', 'executive'] as const;
export type ChairMaterial = (typeof CHAIR_MATERIALS)[number];

export interface ChairSprite {
  readonly back: PixelBuffer;
  readonly front: PixelBuffer;
  readonly seat: SeatPoint;
  readonly ground: SeatPoint;
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

// --- Gamer -------------------------------------------------------------------------------------

const SHELL = makeRamp('#363944');
const BASE = makeRamp('#2b2d34');
const CHROME = makeRamp('#aab3bd');
const GAMER_TOP = 9 + 16;
const STAR_RADIUS = 7;

/**
 * The red of the gamer chair's stripes and side bolsters, and the color the pack exports it in.
 * It is the only part of the chair that takes a color: the shell, base and chrome stay as drawn.
 */
export const DEFAULT_GAMER_ACCENT = '#d8433b';

/** Racing stripes down the seat and the backrest, and harness slots near the top. */
function racing(accent: Ramp): (point: { face: string; u: number; v: number; y: number }, color: Rgba) => Rgba {
  return (point, color) => {
    const stripe = Math.abs(Math.abs(point.v) - 3.5) < 0.9;
    if (point.face === 'top' || point.face === 'forward' || point.face === 'backward') {
      if (point.face !== 'top' && point.y > GAMER_TOP - 4 && point.y < GAMER_TOP - 2 && stripe) return SHELL.outline;
      if (stripe && point.y < GAMER_TOP - 4) return point.face === 'top' ? accent.base : accent.shadow;
    }
    return color;
  };
}

/** Spokes from the gas lift (five by default, one pointing back), each ending on a caster. */
function starBase(ramp: Ramp = BASE, spokes = 5, start = Math.PI): Box[] {
  const boxes: Box[] = [{ u: [-1, 1], v: [-1, 1], y: [1, 3], ramp, top: 'light', side: 'base' }];
  for (let k = 0; k < spokes; k += 1) {
    const angle = start + (2 * Math.PI * k) / spokes;
    for (let t = 1.5; t <= STAR_RADIUS; t += 0.5) {
      const u = Math.floor(t * Math.cos(angle));
      const v = Math.floor(t * Math.sin(angle));
      const tip = t === STAR_RADIUS;
      boxes.push({ u: [u, u + 1], v: [v, v + 1], y: tip ? [0, 2] : [1, 2], ramp, top: tip ? 'base' : 'light', side: 'base' });
    }
  }
  return boxes;
}

/** Racing-style gaming chair: star base, bucket seat and tall winged backrest with accents (red by default). */
function gamerChair(accentHex: string): FurnitureModel {
  const ACCENT = makeRamp(accentHex);
  const racingStripes = racing(ACCENT);
  const pad = { ramp: SHELL, top: 'light', side: 'base' } as const;
  return {
    shadow: { u: [-STAR_RADIUS, STAR_RADIUS], v: [-STAR_RADIUS, STAR_RADIUS], shape: 'ellipse' },
    parts: [
      { boxes: starBase() },
      { boxes: [{ u: [-1, 1], v: [-1, 1], y: [2, 6], ramp: CHROME, top: 'light', side: 'base' }, { u: [-4, 3], v: [-4, 4], y: [5, SEAT_UNDER], ramp: BASE, side: 'base' }] },
      {
        boxes: [
          { u: SEAT_SPAN, v: SEAT_SPAN, y: [SEAT_UNDER, SEAT_HEIGHT], ramp: SHELL, top: 'base', side: 'base', shade: racingStripes },
          ...pair({ u: [-6, 7], v: [6, 8], y: [SEAT_UNDER, SEAT_HEIGHT + 1], ramp: ACCENT, top: 'base', side: 'shadow', rounded: true }),
        ],
      },
      {
        layer: backrestLayer,
        boxes: [
          { u: [-8, BACK_FACE], v: [-7, 7], y: [SEAT_UNDER + 1, GAMER_TOP - 4], ...pad, shade: racingStripes },
          { u: [-8, BACK_FACE], v: [-5, 5], y: [GAMER_TOP - 4, GAMER_TOP], ...pad, rounded: true, shade: racingStripes },
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

// --- Office ------------------------------------------------------------------------------------

const SLATE = makeRamp('#4a5466');
const SLATE_DARK = makeRamp('#353b48');
const OFFICE_TOP = SEAT_HEIGHT + 14;

/** Mesh: a fine checker on the face the sitter leans on. */
function mesh(point: { face: string; col: number; row: number; width: number; height: number }, color: Rgba): Rgba {
  if (point.face !== 'forward' && point.face !== 'backward') return color;
  const inner = point.col > 0 && point.row > 0 && point.col < point.width - 1 && point.row < point.height - 1;
  return inner && (point.col + point.row) % 2 === 0 ? mixRgba(color, SLATE.shadow, 0.4) : color;
}

/** Ergonomic office chair: star base on casters, a padded seat, a mesh back on a spine and T armrests. */
function officeChair(): FurnitureModel {
  return {
    shadow: { u: [-STAR_RADIUS, STAR_RADIUS], v: [-STAR_RADIUS, STAR_RADIUS], shape: 'ellipse' },
    parts: [
      { boxes: starBase() },
      { boxes: [{ u: [-1, 1], v: [-1, 1], y: [2, 6], ramp: BASE, top: 'light', side: 'base' }, { u: [-3, 3], v: [-3, 3], y: [5, SEAT_UNDER - 1], ramp: BASE, side: 'base' }] },
      { boxes: [{ u: SEAT_SPAN, v: SEAT_SPAN, y: [SEAT_UNDER - 1, SEAT_HEIGHT], ramp: SLATE, top: 'base', side: 'base', rounded: true }] },
      {
        layer: backrestLayer,
        boxes: [
          { u: [-8, -6], v: [-1, 1], y: [SEAT_UNDER - 1, SEAT_HEIGHT + 3], ramp: BASE, top: 'light', side: 'base' },
          { u: [-8, BACK_FACE], v: [-6, 6], y: [SEAT_HEIGHT + 2, OFFICE_TOP], ramp: SLATE, top: 'light', side: 'base', rounded: true, shade: mesh },
        ],
      },
      ...([1, -1] as const).map(
        (side): Part => ({
          layer: armLayer(side),
          boxes: [
            { u: [-1, 1], v: side > 0 ? [8, 9] : [-9, -8], y: [SEAT_UNDER - 1, ARM_TOP], ramp: BASE, side: 'base' },
            { u: [-4, 3], v: side > 0 ? [8, 10] : [-10, -8], y: [ARM_TOP, ARM_TOP + 1], ramp: SLATE_DARK, top: 'light', side: 'base' },
          ],
        }),
      ),
    ],
  };
}

// --- Task --------------------------------------------------------------------------------------

const TASK_FRAME = makeRamp('#2a2c31');
const TASK_PANEL = makeRamp('#9a9ea4');
const TASK_SEAT = makeRamp('#3b3e45');
const TASK_TOP = SEAT_HEIGHT + 14;

/** A light panel set in the black back frame, on the faces front and back. */
function panel(point: { face: string; col: number; row: number; width: number; height: number }, color: Rgba): Rgba {
  if (point.face !== 'forward' && point.face !== 'backward') return color;
  const inner = point.col > 0 && point.row > 0 && point.col < point.width - 1 && point.row < point.height - 1;
  if (!inner) return color;
  return point.col === 1 || point.row === 1 ? TASK_PANEL.light : TASK_PANEL.base;
}

/** Armless swivel chair: a four-spoke base, one column, a dark seat and a framed light back panel. */
function taskChair(): FurnitureModel {
  return {
    shadow: { u: [-STAR_RADIUS, STAR_RADIUS], v: [-STAR_RADIUS, STAR_RADIUS], shape: 'ellipse' },
    parts: [
      { boxes: starBase(TASK_FRAME, 4, Math.PI / 4) },
      { boxes: [{ u: [-1, 1], v: [-1, 1], y: [2, SEAT_UNDER - 1], ramp: CHROME, top: 'light', side: 'base' }] },
      { boxes: [{ u: SEAT_SPAN, v: SEAT_SPAN, y: [SEAT_UNDER - 1, SEAT_HEIGHT], ramp: TASK_SEAT, top: 'base', side: 'shadow', rounded: true }] },
      {
        layer: backrestLayer,
        boxes: [
          { u: [-8, -6], v: [-1, 1], y: [SEAT_UNDER - 1, SEAT_HEIGHT + 3], ramp: TASK_FRAME, top: 'light', side: 'base' },
          { u: [-8, BACK_FACE], v: [-6, 6], y: [SEAT_HEIGHT + 3, TASK_TOP], ramp: TASK_FRAME, top: 'light', side: 'base', rounded: true, shade: panel },
        ],
      },
    ],
  };
}

// --- Executive ---------------------------------------------------------------------------------

const CREAM = makeRamp('#d8c6a8');
const EXECUTIVE_TOP = SEAT_HEIGHT + 13;
const EXECUTIVE_HALF = 10;

/** A button sunk in the padding: a dark center in a cross of shade. */
function button(col: number, row: number, atCol: number, atRow: number): 'center' | 'arm' | null {
  const dc = Math.abs(col - atCol);
  const dr = Math.abs(row - atRow);
  if (dc === 0 && dr === 0) return 'center';
  return dc + dr === 1 ? 'arm' : null;
}

/** The high back: two stacked cushions, each buttoned twice, parted by a seam. */
function executiveBack(point: { face: string; col: number; row: number; width: number; height: number }, color: Rgba): Rgba {
  if (point.face !== 'forward') return color;
  if (point.row === 6) return CREAM.shadow;
  for (const atRow of [3, 9]) {
    for (const atCol of [6, point.width - 7]) {
      const hit = button(point.col, point.row, atCol, atRow);
      if (hit !== null) return hit === 'center' ? CREAM.deep : CREAM.shadow;
    }
  }
  return color;
}

/** The seat cushion: two buttons across it, shaded where the back meets it. */
function executiveSeat(point: { face: string; u: number; v: number }, color: Rgba): Rgba {
  if (point.face !== 'top') return color;
  if (point.u < BACK_FACE + 2) return CREAM.shadow;
  return Math.abs(point.u - 2) < 0.9 && Math.abs(Math.abs(point.v) - 3.7) < 0.75 ? CREAM.deep : color;
}

/** Executive chair: a tall buttoned back in two cushions, rolled arms and a buttoned seat on short dark feet. */
function executiveChair(): FurnitureModel {
  const half = EXECUTIVE_HALF;
  const feet: Box[] = [];
  for (const u of [[5, 7], [-7, -5]] as const) for (const v of [[half - 3, half - 1], [1 - half, 3 - half]] as const) feet.push({ u, v, y: [0, 3], ramp: LEATHER_FEET, side: 'base' });
  return {
    shadow: { u: [-8, 8], v: [-(half + 1), half + 1], shape: 'ellipse' },
    parts: [
      { boxes: feet },
      { boxes: [{ u: [-7, 7], v: [1 - half, half - 1], y: [3, SEAT_UNDER], ramp: CREAM, side: 'shadow', rounded: true }] },
      { boxes: [{ u: [BACK_FACE + 1, 7], v: [3 - half, half - 3], y: [SEAT_UNDER, SEAT_HEIGHT], ramp: CREAM, top: 'base', side: 'base', rounded: true, shade: executiveSeat }] },
      { layer: backrestLayer, boxes: [{ u: [-8, BACK_FACE], v: [-half, half], y: [SEAT_UNDER, EXECUTIVE_TOP], ramp: CREAM, top: 'base', side: 'base', rounded: true, shade: executiveBack }] },
      ...([1, -1] as const).map(
        (side): Part => ({
          layer: armLayer(side),
          boxes: [{ u: [-7, 7], v: side > 0 ? [half - 3, half] : [-half, 3 - half], y: [3, ARM_TOP], ramp: CREAM, top: 'base', side: 'base', rounded: true }],
        }),
      ),
    ],
  };
}

/** The color a colorable chair is exported in; a chair without one keeps its materials. */
export const CHAIR_DEFAULT_COLORS: Readonly<Partial<Record<ChairMaterial, string>>> = {
  gamer: DEFAULT_GAMER_ACCENT,
  fabric: DEFAULT_FABRIC_COLOR,
};

/** Only the gamer chair (its accent) and the fabric armchair read the color; the rest keep their own. */
const MODELS: Readonly<Record<ChairMaterial, (facing: Facing, color: string) => FurnitureModel>> = {
  wood: woodChair,
  metal: metalChair,
  leather: (facing) => upholsteredModel('leather', 1, facing),
  gamer: (_facing, color) => gamerChair(color),
  office: officeChair,
  task: taskChair,
  fabric: (facing, color) => upholsteredModel('fabric', 1, facing, color),
  executive: executiveChair,
};

const cache = new Map<string, ChairSprite>();

/** `color` paints a colorable chair (CHAIR_DEFAULT_COLORS); the other chairs ignore it. */
export function chairSprite(material: ChairMaterial, facing: Facing, color?: string): ChairSprite {
  const fallback = CHAIR_DEFAULT_COLORS[material];
  const painted = fallback === undefined ? '' : (color ?? fallback);
  const id = `${material}:${facing}:${painted}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const { back, front, origin } = renderFurniture(MODELS[material](facing, painted), facing);
  const sprite: ChairSprite = { back, front, ground: origin, seat: { x: origin.x, y: origin.y - SEAT_HEIGHT } };
  if (painted !== '' && cache.size > 64) cache.clear();
  cache.set(id, sprite);
  return sprite;
}
