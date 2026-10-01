/**
 * Tables in four materials (glass, metal, wood and a painted one colored like the plain floor)
 * and the four facings of seating.ts, built from boxes by furnitureModel.ts. A table's facing is
 * the way a person seated at it looks, so a chair with the same facing goes on that side: facing
 * up, the chair is south of the table.
 *
 * Every table is a desk: a top TABLE_HEIGHT above the floor on four legs, an apron under the top,
 * a drawer on the sitter's side and a modesty panel on the far side, so each facing shows a
 * different face: the drawer and the open knee space (up), the closed panel (down), the short
 * end with the panel's edge on one side and the drawer pull on the other (left and right).
 */
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { ART_TILE, TABLE, type Footprint } from '../../../src/game/artContract.ts';
import { DEPTH_SCALE, floorPoint, floorSpans, renderFurniture, type Box, type FurnitureModel, type Span, type SurfacePoint } from './furnitureModel.ts';
import { PixelBuffer, rgba, type Rgba } from './pixelBuffer.ts';
import type { Facing, SeatPoint } from './seating.ts';

export const TABLE_MATERIALS = ['glass', 'metal', 'wood', 'painted'] as const;
export type TableMaterial = (typeof TABLE_MATERIALS)[number];

export const DEFAULT_TABLE_COLOR = '#4f9a8a';

/** Screen pixels from the floor to the table top. */
export const TABLE_HEIGHT = 15;

export interface TableSprite {
  readonly image: PixelBuffer;
  /** Floor pixel under the middle of the table. */
  readonly center: SeatPoint;
  /** Floor pixel under the middle of the front edge: the table's depth for sorting. */
  readonly ground: SeatPoint;
  /** Where the ground point of a chair with the same facing goes, tucked a little under the top. */
  readonly chairGround: SeatPoint;
}

/** Model extents: `u` runs from the sitter's side (negative) to the far side, `v` along the top. */
const HALF_DEPTH = 12;
const HALF_WIDTH = 26;
const TOP_UNDER = TABLE_HEIGHT - 2;
const LEG_U: Span = [HALF_DEPTH - 3, HALF_DEPTH - 1];
const LEG_V: Span = [HALF_WIDTH - 3, HALF_WIDTH - 1];
/**
 * A chair's seat is 14 deep. In front of or behind the table it slides 3 pixels under the top; beside
 * it (left/right) the sitter sorts before the table, so the seat stops 2 pixels short of the top
 * and the table never covers the sitter's head and chest.
 */
const CHAIR_U = -(HALF_DEPTH + 7 - 3);
const SIDE_CHAIR_U = -(HALF_DEPTH + 7 + 2);

interface TableLook {
  readonly top: Ramp;
  readonly frame: Ramp;
  readonly pull: Ramp;
  /** Glass lets the floor and the legs show through its top and panel. */
  readonly glass: boolean;
  readonly topShade?: (point: SurfacePoint, color: Rgba) => Rgba;
}

function mirrorU(box: Box): Box {
  return { ...box, u: [-box.u[1], -box.u[0]] };
}

function mirrorV(box: Box): Box {
  return { ...box, v: [-box.v[1], -box.v[0]] };
}

function tableModel(look: TableLook): FurnitureModel {
  const leg: Box = { u: LEG_U, v: LEG_V, y: [0, TOP_UNDER], ramp: look.frame, top: 'light', side: 'base' };
  const legs = [leg, mirrorU(leg), mirrorV(leg), mirrorU(mirrorV(leg))];
  const glassAlpha = look.glass ? GLASS_ALPHA : undefined;
  const topBox: Box = look.glass
    ? { u: [-HALF_DEPTH, HALF_DEPTH], v: [-HALF_WIDTH, HALF_WIDTH], y: [TABLE_HEIGHT - 1, TABLE_HEIGHT], ramp: look.top, top: 'base', side: 'light', alpha: glassAlpha, shade: look.topShade }
    : { u: [-HALF_DEPTH, HALF_DEPTH], v: [-HALF_WIDTH, HALF_WIDTH], y: [TOP_UNDER, TABLE_HEIGHT], ramp: look.top, top: 'base', side: 'shadow', shade: look.topShade };
  // A ring of rails rather than a solid box, so a glass top shows the floor inside it.
  const apronY: Span = look.glass ? [TOP_UNDER, TABLE_HEIGHT - 1] : [TOP_UNDER - 3, TOP_UNDER];
  const rail = { y: apronY, ramp: look.frame, top: 'light', side: 'shadow' } as const;
  const [ui, uo, vi, vo] = [HALF_DEPTH - 3, HALF_DEPTH - 2, HALF_WIDTH - 3, HALF_WIDTH - 2];
  const alongV: Box = { ...rail, u: [ui, uo], v: [-vo, vo] };
  const alongU: Box = { ...rail, u: [-uo, uo], v: [vi, vo] };
  const apron = [alongV, mirrorU(alongV), alongU, mirrorV(alongU)];
  const drawer: Box = {
    u: [-HALF_DEPTH + 1, -HALF_DEPTH + 2],
    v: [-8, 8],
    y: [TOP_UNDER - 4, TOP_UNDER],
    ramp: look.frame,
    top: 'base',
    side: 'base',
    shade: (point, color) => (Math.abs(point.v) < 2 && point.row === 1 ? look.pull.light : point.row === 0 ? mixRgba(color, look.frame.light, 0.4) : color),
  };
  const pull: Box = { u: [-HALF_DEPTH - 1, -HALF_DEPTH + 1], v: [-1, 1], y: [TOP_UNDER - 3, TOP_UNDER - 2], ramp: look.pull, top: 'light', side: 'light' };
  const panel: Box = {
    u: [HALF_DEPTH - 5, HALF_DEPTH - 3],
    v: [-HALF_WIDTH + 3, HALF_WIDTH - 3],
    y: [3, TOP_UNDER],
    ramp: look.frame,
    top: 'shadow',
    side: 'shadow',
    alpha: glassAlpha === undefined ? undefined : 150,
    shade: (point, color) => (point.row === 0 || point.row === point.height - 1 ? mixRgba(color, look.frame.light, 0.25) : color),
  };
  return {
    shadow: { u: [-HALF_DEPTH + 1, HALF_DEPTH - 1], v: [-HALF_WIDTH + 1, HALF_WIDTH - 1], shape: 'rect' },
    parts: [{ boxes: legs }, { boxes: [panel] }, { boxes: [...apron, drawer, pull] }, { boxes: [topBox] }],
  };
}

// --- Materials ---------------------------------------------------------------------------------

const GLASS = makeRamp('#9fd3ec');
const GLASS_ALPHA = 110;
const GLARE = rgba(240, 250, 255, 170);
const CHROME = makeRamp('#aab4be');

/** Diagonal glare stripes like the glass walls. */
function glare(point: SurfacePoint, color: Rgba): Rgba {
  if (point.face !== 'top') return rgba(color.r, color.g, color.b, 200);
  const phase = (point.col + point.row) % 19;
  return phase < 2 || phase === 4 ? GLARE : color;
}

const STEEL = makeRamp('#a6b0ba');
const STEEL_FRAME = makeRamp('#6a7480');

/** Brushed steel: faint lines along the top, and a lit rim. */
function brushed(point: SurfacePoint, color: Rgba): Rgba {
  return point.face === 'top' && point.row % 3 === 1 && point.col > 0 ? mixRgba(color, STEEL.shadow, 0.25) : color;
}

const WALNUT = makeRamp('#8c5a36');
const BRASS = makeRamp('#d9b25a');

/** Wood grain along the length of the top, in broken lines. */
function grain(point: SurfacePoint, color: Rgba): Rgba {
  if (point.face !== 'top') return color;
  const line = Math.floor(point.u * 0.55 + 20) % 3 === 0;
  const broken = Math.floor(Math.abs(point.v) / 5 + Math.floor(point.u)) % 4 === 0;
  return line && !broken ? mixRgba(color, WALNUT.shadow, 0.45) : color;
}

function look(material: TableMaterial, color: string): TableLook {
  switch (material) {
    case 'glass':
      return { top: GLASS, frame: CHROME, pull: CHROME, glass: true, topShade: glare };
    case 'metal':
      return { top: STEEL, frame: STEEL_FRAME, pull: STEEL, glass: false, topShade: brushed };
    case 'wood':
      return { top: WALNUT, frame: WALNUT, pull: BRASS, glass: false, topShade: grain };
    case 'painted':
      return { top: makeRamp(color), frame: makeRamp(color), pull: CHROME, glass: false };
  }
}

const cache = new Map<string, TableSprite>();

/** `color` only paints the painted table; the others keep their material. */
export function tableSprite(material: TableMaterial, facing: Facing, color = DEFAULT_TABLE_COLOR): TableSprite {
  const id = `${material}:${facing}:${material === 'painted' ? color : ''}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const { back, origin } = renderFurniture(tableModel(look(material, color)), facing);
  const front = floorSpans(facing, [-HALF_DEPTH, HALF_DEPTH], [-HALF_WIDTH, HALF_WIDTH]).z[1] - 1;
  const chair = floorPoint(facing, facing === 'left' || facing === 'right' ? SIDE_CHAIR_U : CHAIR_U, 0);
  const sprite: TableSprite = {
    image: back,
    center: origin,
    ground: { x: origin.x, y: origin.y + front },
    chairGround: { x: origin.x + chair.x, y: origin.y + chair.y },
  };
  if (material === 'painted' && cache.size > 64) cache.clear();
  cache.set(id, sprite);
  return sprite;
}

// --- Room tables -------------------------------------------------------------------------------

/** The two shared tables of the map: the meeting room's and the cafeteria's. */
export const ROOM_TABLES = ['meeting', 'cafeteria'] as const;
export type RoomTable = (typeof ROOM_TABLES)[number];

/** The tiles each table covers on the map (`placeFurniture` in mapBuilder.ts). */
export const ROOM_TABLE_FOOTPRINTS: Readonly<Record<RoomTable, Footprint>> = {
  meeting: { w: 7, h: 5 },
  cafeteria: { w: 5, h: 3 },
};

const BEECH = makeRamp('#c8a06a');

/** Wood grain along the length of a long top, in broken lines. */
function longGrain(shadow: Rgba): (point: SurfacePoint, color: Rgba) => Rgba {
  return (point, color) => {
    if (point.face !== 'top') return color;
    const line = point.row % 5 === 2;
    const broken = Math.floor((point.col + point.row * 7) / 9) % 4 === 0;
    return line && !broken ? mixRgba(color, shadow, 0.35) : color;
  };
}

/**
 * A table seated on every side: a thick top over an apron ring and legs at the corners (and in
 * the middle of a long side), built from the same boxes as the desks. Seen from the front, so its
 * floor rows are the footprint's height in tiles.
 */
function roomTableModel(kind: RoomTable): FurnitureModel {
  const { w, h } = ROOM_TABLE_FOOTPRINTS[kind];
  const wood = kind === 'meeting' ? WALNUT : BEECH;
  const halfWidth = (w * ART_TILE) / 2;
  const halfDepth = (h * ART_TILE) / 2 / DEPTH_SCALE;
  const top: Box = {
    u: [-halfDepth, halfDepth],
    v: [-halfWidth, halfWidth],
    y: [TOP_UNDER, TABLE_HEIGHT],
    ramp: wood,
    top: 'base',
    side: 'shadow',
    shade: longGrain(wood.shadow),
  };
  const apronU: Span = [halfDepth - 6, halfDepth - 4];
  const apron: Box[] = [
    { u: apronU, v: [-halfWidth + 4, halfWidth - 4], y: [TOP_UNDER - 3, TOP_UNDER], ramp: wood, top: 'shadow', side: 'shadow' },
    { u: [-apronU[1], -apronU[0]], v: [-halfWidth + 4, halfWidth - 4], y: [TOP_UNDER - 3, TOP_UNDER], ramp: wood, top: 'shadow', side: 'shadow' },
  ];
  const legU: Span = [halfDepth - 7, halfDepth - 3];
  const legVs: Span[] = [[halfWidth - 6, halfWidth - 2], [-(halfWidth - 2), -(halfWidth - 6)]];
  if (w >= 6) legVs.push([-2, 2]);
  const legs = legVs.flatMap((v): Box[] => [
    { u: legU, v, y: [0, TOP_UNDER], ramp: wood, top: 'base', side: 'shadow' },
    { u: [-legU[1], -legU[0]], v, y: [0, TOP_UNDER], ramp: wood, top: 'base', side: 'shadow' },
  ]);
  return {
    shadow: { u: [-halfDepth + 2, halfDepth - 2], v: [-halfWidth + 2, halfWidth - 2], shape: 'rect' },
    parts: [{ boxes: legs }, { boxes: apron }, { boxes: [top] }],
  };
}

/** A room table in the TABLE frame, the floor under the middle of its footprint's south edge on TABLE.anchor. */
export function roomTableSprite(kind: RoomTable): PixelBuffer {
  const { back, origin } = renderFurniture(roomTableModel(kind), 'down', 320);
  const frame = new PixelBuffer(TABLE.frame.width, TABLE.frame.height);
  const halfRows = (ROOM_TABLE_FOOTPRINTS[kind].h * ART_TILE) / 2;
  frame.blit(back, TABLE.anchor.x - origin.x, TABLE.anchor.y - halfRows - origin.y);
  return frame;
}
