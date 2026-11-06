/**
 * Tables in four materials (glass, metal, wood and a painted one colored like the plain floor),
 * a black gamer desk with colorable side lights and a curved wooden desk, in the four facings of seating.ts, built from boxes by furnitureModel.ts. A table's facing is
 * the way a person seated at it looks, so a chair with the same facing goes on that side: facing
 * up, the chair is south of the table.
 *
 * Every table is a desk: a top TABLE_HEIGHT above the floor on four legs, an apron under the top,
 * a drawer on the sitter's side and a modesty panel on the far side, so each facing shows a
 * different face: the drawer and the open knee space (up), the closed panel (down), the short
 * end with the panel's edge on one side and the drawer pull on the other (left and right).
 */
import { makeRamp, mixRgba, type Ramp } from './color.ts';
import { ART_TILE, TABLE, type Footprint, type TableFacing } from '../../../src/game/artContract.ts';
import { TABLE_DEPTH_PX, TABLE_LONG_SIDE_PX } from '../../../src/game/deskTable.ts';
import { DEPTH_SCALE, floorPoint, floorSpans, renderFurniture, type Box, type FurnitureModel, type Span, type SurfacePoint } from './furnitureModel.ts';
import { PixelBuffer, rgba, type Rgba } from '../../../src/art/pixelBuffer.ts';
import type { Facing, SeatPoint } from '../../../src/art/seating.ts';

export const TABLE_MATERIALS = ['glass', 'metal', 'wood', 'painted', 'gamer', 'curved'] as const;
export type TableMaterial = (typeof TABLE_MATERIALS)[number];

export const DEFAULT_TABLE_COLOR = '#4f9a8a';
/** The purple of the gamer desk's side lights, and the color the pack exports it in. */
export const DEFAULT_GAMER_LIGHT = '#a066e8';

/** The color a colorable desk is exported in: the painted one all over, the gamer one only in its lights. */
export const DESK_DEFAULT_COLORS: Readonly<Partial<Record<TableMaterial, string>>> = {
  painted: DEFAULT_TABLE_COLOR,
  gamer: DEFAULT_GAMER_LIGHT,
};

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
  /** Screen pixels of floor the top runs along its long side, the outline aside. */
  readonly floorLength: number;
  /** Screen pixels of floor across a regular desk's top (front to back edge), the outline aside: rows facing up or down, columns facing left or right. */
  readonly floorDepth: number;
}

/** Model extents: `u` runs from the sitter's side (negative) to the far side, `v` along the top. */
const HALF_DEPTH = TABLE_DEPTH_PX / 2;
/**
 * Half the long side on screen: 84px, a little over 2.5 tiles, so a table
 * sits centered on a 3-tile edge of a desk (a decor table, Editar espacios)
 * close to its neighbours (S19). Facing left or right the long side runs
 * along the floor depth, which DEPTH_SCALE shortens, so the model is longer
 * there to draw the same 84px.
 */
const HALF_LENGTH_PX = TABLE_LONG_SIDE_PX / 2;
/** How much the desks grew from their first 80px; the curved desk's arcs grow with it. */
const GROWTH = TABLE_LONG_SIDE_PX / 80;
const TOP_UNDER = TABLE_HEIGHT - 2;
const LEG_U: Span = [HALF_DEPTH - 3, HALF_DEPTH - 1];
/**
 * A chair's seat is 14 deep. In front of or behind the table its ground point sits 3 floor rows
 * past the top's sitter edge, so the seat slides under the top; counted in rows, not model
 * pixels, so the gap stays the 80px desk's however DEPTH_SCALE rounds a deeper top. Beside it
 * (left/right) the sitter sorts before the table, so the seat stops 2 pixels short of the top
 * and the table never covers the sitter's head and chest.
 */
const CHAIR_ROWS_PAST_EDGE = 3;
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

/** Half the model length `v` that draws HALF_LENGTH_PX on screen for a facing. */
function halfWidthFor(facing: Facing): number {
  return facing === 'up' || facing === 'down' ? HALF_LENGTH_PX : Math.round(HALF_LENGTH_PX / DEPTH_SCALE);
}

function tableModel(look: TableLook, HALF_WIDTH: number): FurnitureModel {
  const LEG_V: Span = [HALF_WIDTH - 3, HALF_WIDTH - 1];
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

const WALNUT = makeRamp('#8c5a36');
const BRASS = makeRamp('#d9b25a');

function look(material: 'glass' | 'metal' | 'wood' | 'painted', color: string): TableLook {
  switch (material) {
    case 'glass':
      return { top: GLASS, frame: CHROME, pull: CHROME, glass: true, topShade: glare };
    case 'metal':
      return { top: STEEL, frame: STEEL_FRAME, pull: STEEL, glass: false };
    case 'wood':
      return { top: WALNUT, frame: WALNUT, pull: BRASS, glass: false };
    case 'painted':
      return { top: makeRamp(color), frame: makeRamp(color), pull: CHROME, glass: false };
  }
}

// --- Gamer desk --------------------------------------------------------------------------------

/** Near black, a little blue, so no part of the body sits on the lights' ramp. */
const CARBON = makeRamp('#2a2c33');
const CARBON_FRAME = makeRamp('#1e1f25');

/**
 * A black gaming desk: a carbon top on two solid end panels, a modesty panel at the back and no
 * drawer. Light strips run along both short sides of the top and down the front of each end panel,
 * painted only in the tones of `light`'s ramp so the office can recolor them alone.
 */
function gamerDeskModel(lightHex: string, halfWidth: number): FurnitureModel {
  const LIGHT = makeRamp(lightHex);
  const strip: Span = [halfWidth - 4, halfWidth - 2];
  const carbon = (point: SurfacePoint, color: Rgba): Rgba => {
    const side = Math.abs(point.v);
    if (point.face === 'top') {
      if (side >= strip[0] && side < strip[1] && Math.abs(point.u) < HALF_DEPTH - 1) return Math.abs(point.u) < HALF_DEPTH - 3 ? LIGHT.light : LIGHT.base;
      // Carbon weave: a faint diagonal hatch, kept off the rim.
      return point.col > 1 && point.row > 0 && (point.col + point.row * 2) % 6 === 0 ? CARBON.shadow : color;
    }
    return color;
  };
  const top: Box = { u: [-HALF_DEPTH, HALF_DEPTH], v: [-halfWidth, halfWidth], y: [TOP_UNDER, TABLE_HEIGHT], ramp: CARBON, top: 'base', side: 'shadow', shade: carbon };
  // An end panel carries its light as an upright bar near the sitter's edge: seen from the front it is the panel's narrow face.
  const endLight = (point: SurfacePoint, color: Rgba): Rgba => {
    if (point.face === 'top' || point.row < 2 || point.row >= point.height - 1) return color;
    const near = point.face === 'forward' || point.face === 'backward' ? Math.abs(point.col + 0.5 - point.width / 2) < 1 : point.u > -HALF_DEPTH + 3 && point.u < -HALF_DEPTH + 5;
    return near ? LIGHT.base : color;
  };
  const end: Box = { u: [-HALF_DEPTH + 2, HALF_DEPTH - 2], v: [halfWidth - 6, halfWidth - 2], y: [0, TOP_UNDER], ramp: CARBON_FRAME, top: 'base', side: 'base', shade: endLight };
  const panel: Box = { u: [HALF_DEPTH - 5, HALF_DEPTH - 3], v: [-halfWidth + 6, halfWidth - 6], y: [4, TOP_UNDER], ramp: CARBON_FRAME, top: 'shadow', side: 'shadow' };
  // A beam under the sitter's edge of the top, like the other desks' apron, stiffens the long span.
  const beam: Box = { u: [-HALF_DEPTH + 1, -HALF_DEPTH + 3], v: [-halfWidth + 6, halfWidth - 6], y: [TOP_UNDER - 3, TOP_UNDER], ramp: CARBON_FRAME, top: 'base', side: 'base' };
  return {
    shadow: { u: [-HALF_DEPTH + 1, HALF_DEPTH - 1], v: [-halfWidth + 1, halfWidth - 1], shape: 'rect' },
    parts: [{ boxes: [end, mirrorV(end)] }, { boxes: [panel] }, { boxes: [beam, top] }],
  };
}

// --- Curved desk -------------------------------------------------------------------------------

const TERRACOTTA = makeRamp('#b9683c');
/** The curved desk's top runs this much deeper than the others, so the front half-ring has room. */
const CURVED_HALF_DEPTH = HALF_DEPTH + Math.round(6 * GROWTH);

/**
 * A curved wooden desk, as seen from above: its far corners rounded off in a wide arc and, at the
 * middle of the sitter's side, a half circle cut into the top where the chair rolls in. Built as
 * one slab per model row (boxes are axis aligned), each slab as wide as the shape there, so it
 * reads the same from every facing.
 */
function curvedDeskModel(halfWidth: number): FurnitureModel {
  // Turned sideways the long side is drawn longer (DEPTH_SCALE), so the arcs along it stretch too.
  const stretch = halfWidth / HALF_LENGTH_PX;
  const corner = Math.round(14 * GROWTH);
  const notch = Math.round(11 * GROWTH);
  const front = -HALF_DEPTH;
  const back = CURVED_HALF_DEPTH;
  const top: Box[] = [];
  for (let u = front; u < back; u += 1) {
    const middle = u + 0.5;
    // Far corners: a quarter circle of radius `corner` (stretched along v).
    const intoCorner = middle - (back - corner);
    const half = intoCorner > 0 ? halfWidth - corner * stretch + Math.round(corner * stretch * Math.sqrt(Math.max(0, 1 - (intoCorner / corner) ** 2))) : halfWidth;
    // Front notch: a half circle of radius `notch` around the middle of the sitter's edge.
    const fromFront = middle - front;
    const open = fromFront < notch ? Math.round(notch * stretch * Math.sqrt(1 - (fromFront / notch) ** 2)) : 0;
    const slab = { u: [u, u + 1] as Span, y: [TOP_UNDER, TABLE_HEIGHT] as Span, ramp: TERRACOTTA, top: 'base', side: 'shadow' } as const;
    if (open === 0) top.push({ ...slab, v: [-half, half] });
    else top.push({ ...slab, v: [-half, -open] }, { ...slab, v: [open, half] });
  }
  const leg = (u: Span, v: Span): Box => ({ u, v, y: [0, TOP_UNDER], ramp: TERRACOTTA, top: 'base', side: 'shadow' });
  const legs = [leg([front + 2, front + 5], [halfWidth - 6, halfWidth - 3]), leg([back - 9, back - 6], [halfWidth - 10, halfWidth - 7])];
  const panel: Box = { u: [back - 8, back - 6], v: [-halfWidth + 12, halfWidth - 12], y: [3, TOP_UNDER], ramp: TERRACOTTA, top: 'shadow', side: 'shadow' };
  return {
    // Up to the back edge, not past it: a row further rounds into one more floor row facing down than up.
    shadow: { u: [front + 1, back], v: [-halfWidth, halfWidth], shape: 'ellipse' },
    parts: [{ boxes: [...legs, ...legs.map(mirrorV)] }, { boxes: [panel] }, { boxes: top }],
  };
}

const cache = new Map<string, TableSprite>();

/** `color` paints a colorable desk (DESK_DEFAULT_COLORS); the others keep their material. */
export function tableSprite(material: TableMaterial, facing: Facing, color?: string): TableSprite {
  const fallback = DESK_DEFAULT_COLORS[material];
  const painted = fallback === undefined ? '' : (color ?? fallback);
  const id = `${material}:${facing}:${painted}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const halfWidth = halfWidthFor(facing);
  const model =
    material === 'gamer' ? gamerDeskModel(painted, halfWidth) : material === 'curved' ? curvedDeskModel(halfWidth) : tableModel(look(material, painted), halfWidth);
  const { back, origin } = renderFurniture(model, facing, 192);
  // The curved desk's top runs deeper on the far side; its front edge, where people sit, is the others'.
  const spans = floorSpans(facing, [-HALF_DEPTH, material === 'curved' ? CURVED_HALF_DEPTH : HALF_DEPTH], [-halfWidth, halfWidth]);
  const front = spans.z[1] - 1;
  const across = facing === 'up' || facing === 'down';
  const floorLength = across ? spans.x[1] - spans.x[0] : spans.z[1] - spans.z[0];
  const regular = floorSpans(facing, [-HALF_DEPTH, HALF_DEPTH], [-halfWidth, halfWidth]);
  const floorDepth = across ? regular.z[1] - regular.z[0] : regular.x[1] - regular.x[0];
  const chair = across
    ? { x: 0, y: facing === 'up' ? regular.z[1] + CHAIR_ROWS_PAST_EDGE : regular.z[0] - CHAIR_ROWS_PAST_EDGE }
    : floorPoint(facing, SIDE_CHAIR_U, 0);
  const sprite: TableSprite = {
    image: back,
    center: origin,
    ground: { x: origin.x, y: origin.y + front },
    chairGround: { x: origin.x + chair.x, y: origin.y + chair.y },
    floorLength,
    floorDepth,
  };
  if (painted !== '' && cache.size > 64) cache.clear();
  cache.set(id, sprite);
  return sprite;
}

// --- Room tables -------------------------------------------------------------------------------

/** The shared tables of the map: the meeting room's, the cafeteria's, a small oval one (#208) and a 1x1 round one. */
export const ROOM_TABLES = ['meeting', 'cafeteria', 'oval', 'round'] as const;
export type RoomTable = (typeof ROOM_TABLES)[number];

/**
 * The tiles each table covers standing horizontal (the meeting and cafeteria ones are the
 * `props` objects in src/game/maps/office.json); standing vertical it covers them swapped.
 */
export const ROOM_TABLE_FOOTPRINTS: Readonly<Record<RoomTable, Footprint>> = {
  meeting: { w: 7, h: 5 },
  cafeteria: { w: 5, h: 3 },
  oval: { w: 2, h: 1 },
  round: { w: 1, h: 1 },
};

const BEECH = makeRamp('#c8a06a');
const OAK = makeRamp('#b07d52');

/** Wood grain along the length of a long top, in broken lines: across the screen, or down it when `vertical`. */
function longGrain(shadow: Rgba, vertical: boolean): (point: SurfacePoint, color: Rgba) => Rgba {
  return (point, color) => {
    if (point.face !== 'top') return color;
    const [across, along] = vertical ? [point.col, point.row] : [point.row, point.col];
    const line = across % 5 === 2;
    const broken = Math.floor((along + across * 7) / 9) % 4 === 0;
    return line && !broken ? mixRgba(color, shadow, 0.35) : color;
  };
}

/** The footprint a table covers in a facing: as stated horizontal, swapped vertical. */
function facingFootprint(kind: RoomTable, facing: TableFacing): Footprint {
  const { w, h } = ROOM_TABLE_FOOTPRINTS[kind];
  return facing === 'vertical' ? { w: h, h: w } : { w, h };
}

/**
 * A table seated on every side: a thick top over an apron ring and legs at the corners (and in
 * the middle of a long side), built from the same boxes as the desks. Seen from the front in
 * either facing, so its floor rows are the footprint's height in tiles: standing vertical it is
 * modeled long in depth, never a turned copy of the horizontal drawing.
 */
function roomTableModel(kind: 'meeting' | 'cafeteria', facing: TableFacing): FurnitureModel {
  const { w, h } = facingFootprint(kind, facing);
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
    shade: longGrain(wood.shadow, facing === 'vertical'),
  };
  const apronU: Span = [halfDepth - 6, halfDepth - 4];
  const apron: Box[] = [
    { u: apronU, v: [-halfWidth + 4, halfWidth - 4], y: [TOP_UNDER - 3, TOP_UNDER], ramp: wood, top: 'shadow', side: 'shadow' },
    { u: [-apronU[1], -apronU[0]], v: [-halfWidth + 4, halfWidth - 4], y: [TOP_UNDER - 3, TOP_UNDER], ramp: wood, top: 'shadow', side: 'shadow' },
  ];
  const legUs: Span[] = [[halfDepth - 7, halfDepth - 3], [-(halfDepth - 3), -(halfDepth - 7)]];
  const legVs: Span[] = [[halfWidth - 6, halfWidth - 2], [-(halfWidth - 2), -(halfWidth - 6)]];
  // A long side gets a leg in its middle too, whichever way it runs.
  if (w >= 6) legVs.push([-2, 2]);
  if (h >= 6) legUs.push([-2, 2]);
  const legs = legVs.flatMap((v) => legUs.map((u): Box => ({ u, v, y: [0, TOP_UNDER], ramp: wood, top: 'base', side: 'shadow' })));
  return {
    shadow: { u: [-halfDepth + 2, halfDepth - 2], v: [-halfWidth + 2, halfWidth - 2], shape: 'rect' },
    parts: [{ boxes: legs }, { boxes: apron }, { boxes: [top] }],
  };
}

/**
 * The oval table, and the round one on a single tile: its top an ellipse inscribed in the footprint, built as one slab per floor row
 * (the boxes are axis aligned), each as wide as the ellipse at that row, so the rim curves and
 * the front half shows its thin edge. One pedestal on a foot along the long side holds it up.
 * The rim catches the light from the upper left and the grain runs along the long side.
 */
function ovalTableModel(kind: 'oval' | 'round', facing: TableFacing): FurnitureModel {
  const { w, h } = facingFootprint(kind, facing);
  // A round table is the same standing either way: its square footprint never turns its foot.
  const vertical = facing === 'vertical' && kind !== 'round';
  // One pixel inside the footprint, so the outline stays on it.
  const radiusRows = (h * ART_TILE) / 2 - 1;
  // The edge under a round top shows on screen too, so it is that much wider to read as a circle, not an egg.
  const radiusX = kind === 'round' ? radiusRows + (TABLE_HEIGHT - TOP_UNDER) / 2 : (w * ART_TILE) / 2 - 1;
  const halfDepth = radiusRows / DEPTH_SCALE;
  const grain = longGrain(OAK.shadow, vertical);
  const shade = (point: SurfacePoint, color: Rgba): Rgba => {
    if (point.face !== 'top') return color;
    // Screen left is +v facing down, screen up is -u.
    const across = point.v / radiusX;
    const deep = point.u / halfDepth;
    if (across * across + deep * deep > 0.72 && (across > 0.35 || deep < -0.35)) return mixRgba(color, OAK.light, 0.45);
    return grain(point, color);
  };
  const slabs: Box[] = [];
  for (let row = -radiusRows; row < radiusRows; row += 1) {
    const middle = (row + 0.5) / radiusRows;
    const half = Math.max(1, Math.round(radiusX * Math.sqrt(Math.max(0, 1 - middle * middle))));
    slabs.push({ u: [row / DEPTH_SCALE, (row + 1) / DEPTH_SCALE], v: [-half, half], y: [TOP_UNDER, TABLE_HEIGHT], ramp: OAK, top: 'base', side: 'shadow', shade });
  }
  const pedestal: Box = { u: [-4, 4], v: [-3, 3], y: [2, TOP_UNDER], ramp: OAK, top: 'shadow', side: 'shadow' };
  const foot: Box = vertical
    ? { u: [-halfDepth + 10, halfDepth - 10], v: [-5, 5], y: [0, 2], ramp: OAK, top: 'base', side: 'shadow' }
    : { u: [-6, 6], v: [-radiusX + 12, radiusX - 12], y: [0, 2], ramp: OAK, top: 'base', side: 'shadow' };
  return {
    shadow: { u: [-halfDepth + 2, halfDepth - 2], v: [-radiusX + 2, radiusX - 2], shape: 'ellipse' },
    parts: [{ boxes: [foot, pedestal] }, { boxes: slabs }],
  };
}

/**
 * A room table in one frame of the TABLE sheet, the floor under the middle of its footprint's
 * south edge (the footprint swapped when vertical) on TABLE.anchor.
 */
export function roomTableSprite(kind: RoomTable, facing: TableFacing = 'horizontal'): PixelBuffer {
  const model = kind === 'oval' || kind === 'round' ? ovalTableModel(kind, facing) : roomTableModel(kind, facing);
  const { back, origin } = renderFurniture(model, 'down', 400);
  const frame = new PixelBuffer(TABLE.frame.width, TABLE.frame.height);
  const halfRows = (facingFootprint(kind, facing).h * ART_TILE) / 2;
  frame.blit(back, TABLE.anchor.x - origin.x, TABLE.anchor.y - halfRows - origin.y);
  return frame;
}
