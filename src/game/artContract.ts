/**
 * Pixel and file format contract of the art pack (docs/art/contract.md). One
 * versioned source for the exporter (`tools/art`), the server catalog and the
 * client loader, so every integration reads the same sizes, orders and anchors
 * instead of carrying its own offsets.
 *
 * No imports on purpose, like `mapData.ts`: the server loads this file with
 * Node type stripping, which would need explicit `.ts` extensions that the
 * client build does not accept.
 *
 * Three concepts stay apart: the PNG frame size, the logical footprint in
 * tiles (placement and collision) and the visual anchor (feet, seat or floor
 * point). A 3x3 desk station does not imply a 96x96 PNG.
 */

/**
 * Bump when any number below changes meaning; the manifest records it.
 * Version 2 added the terrain tileset and the map props (trees, plants,
 * bridges, hedges, room tables): their kinds are unknown to a version 1
 * reader, whose catalog would reject the pack. Version 3 grew the door frame
 * from 128x128 to 160x256 (S14, the door of a vertical run drawn standing):
 * a version 2 reader would cut the new door sheets into the wrong frames.
 */
export const ART_CONTRACT_VERSION = 3;

/** Every file is a non-interlaced 8-bit RGBA PNG. */
export const ART_FILE_FORMAT = 'png-rgba8';

/** Logical unit of coordinates, placement and bounds. Same as `TILE` in mapData.ts. */
export const ART_TILE = 32;

/**
 * Distinct non-transparent RGBA values allowed in one file. The pack's busiest
 * character sheet has about 75 (shaded ramps plus the partial-alpha contact
 * shadow); 128 leaves room for new characters while still rejecting what the
 * cap exists for: photos, gradients and smoothed upscales, which run into the
 * hundreds or thousands.
 */
export const MAX_COLORS_PER_IMAGE = 128;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Logical size in tiles, independent of the PNG size. */
export interface Footprint {
  readonly w: number;
  readonly h: number;
}

/** Office facing vocabulary (`Facing` in officeProtocol.ts), restated for the same reason as ART_TILE. */
export type ArtFacing = 'up' | 'down' | 'left' | 'right';

/**
 * Order of the four facings in every pack sheet (seated rows, chair and desk
 * columns). It is not the office order `FACINGS` (`down, up, left, right`), so
 * code must go through `seatedRowForFacing` / `facingColumn`, never an index.
 * A facing is the way a seated character looks.
 */
export const PACK_FACINGS: readonly ArtFacing[] = ['up', 'down', 'left', 'right'];

/** The eight walk directions in screen space, in walk-sheet row order. */
export const WALK_DIRECTIONS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type WalkDirection = (typeof WALK_DIRECTIONS)[number];

/** Walk direction a character uses for each facing (standing or seated). */
export const FACING_WALK_DIRECTION: Readonly<Record<ArtFacing, WalkDirection>> = {
  up: 'N',
  down: 'S',
  left: 'W',
  right: 'E',
};

export const CHAIR_LAYERS = ['back', 'front'] as const;
export type ChairLayer = (typeof CHAIR_LAYERS)[number];

export const ART_IMAGE_KINDS = [
  'character-walk',
  'character-seated',
  'chair',
  'desk',
  'floor',
  'wall',
  'terrain-tileset',
  'tree',
  'plant',
  'bridge',
  'hedge',
  'table',
  'door',
  'sofa',
] as const;
export type ArtImageKind = (typeof ART_IMAGE_KINDS)[number];

interface ImageSpecBase {
  readonly kind: ArtImageKind;
  readonly frame: Size;
  readonly columns: number;
  readonly rows: number;
  /** `partial`: any alpha (shadows, glass). `opaque`: every pixel has alpha 255. */
  readonly alpha: 'partial' | 'opaque';
  /**
   * Sprites float over the floor, so each frame's four corner pixels must be
   * transparent. It is what catches a backdrop baked into an export.
   */
  readonly transparentCorners: boolean;
  readonly maxColors: number;
  /**
   * When set, `maxColors` applies to each band of this many frame rows instead
   * of the whole file: a sheet that gathers several materials (the terrain
   * tileset) is held to the per-material budget of a single sheet.
   */
  readonly colorBandRows?: number;
}

export interface CharacterWalkSpec extends ImageSpecBase {
  readonly kind: 'character-walk';
  readonly rowOrder: readonly WalkDirection[];
  readonly stepColumns: number;
  readonly idleColumn: number;
  /** Ground point under the feet, inside a frame. */
  readonly anchor: Point;
  /** The feet tile; the rest of the body is drawn and depth sorted by the feet only. */
  readonly footprint: Footprint;
}

export interface CharacterSeatedSpec extends ImageSpecBase {
  readonly kind: 'character-seated';
  readonly rowOrder: readonly ArtFacing[];
  readonly transitionColumns: number;
  readonly idleColumns: readonly number[];
  /** Where the pelvis rests on the seat in every seated frame: drawn at `chair seat - anchor`. */
  readonly anchor: Point;
}

export interface ChairSpec extends ImageSpecBase {
  readonly kind: 'chair';
  readonly columnOrder: readonly ArtFacing[];
  readonly rowOrder: readonly ChairLayer[];
  /** Seat point (the sitter's pelvis), the same in every cell, so any character sits on any chair. */
  readonly anchor: Point;
  /** Floor pixel under the seat: the depth used to sort the chair against characters. */
  readonly ground: Point;
  readonly footprint: Footprint;
}

/**
 * A sofa: an armchair widened one seat per tile, laid out like a chair sheet
 * (facings by layers). Every cell holds the floor pixel under the middle of
 * the sofa (the middle of its footprint) on `anchor`; its seats lie a whole
 * tile apart on screen, each SEAT_HEIGHT above the middle of its own tile.
 */
export interface SofaSpec extends ImageSpecBase {
  readonly kind: 'sofa';
  readonly columnOrder: readonly ArtFacing[];
  readonly rowOrder: readonly ChairLayer[];
  readonly anchor: Point;
  /** The most seats a sofa of this frame holds. */
  readonly maxSeats: number;
}

export interface DeskSpec extends ImageSpecBase {
  readonly kind: 'desk';
  readonly columnOrder: readonly ArtFacing[];
  /** Floor pixel under the middle of the desk, the same in every cell. */
  readonly anchor: Point;
  readonly footprintByFacing: Readonly<Record<ArtFacing, Footprint>>;
}

export interface FloorSpec extends ImageSpecBase {
  readonly kind: 'floor';
  /** Tiles per side of the motif: the sheet is the motif, cut into one frame per tile. */
  readonly motifTiles: number;
}

export interface WallSpec extends ImageSpecBase {
  readonly kind: 'wall';
  /** Tiles a wall covers from top to bottom: the one it is placed on is the middle one. */
  readonly heightTiles: number;
  /** Pixels of the dark top band of a wall column, seen from above. */
  readonly topHeight: number;
}

/** `ground`: drawn over the terrain and under everything else. `sorted`: depth sorted by its anchor. */
export type PropLayer = 'ground' | 'sorted';
/** `solid`: the footprint blocks movement. `deck`: the footprint is walkable whatever the terrain under it. */
export type PropCollision = 'solid' | 'deck';

/**
 * Map props: one fixed frame per image kind. The anchor is the floor pixel at
 * the bottom middle of the footprint, and its y is the depth the prop sorts
 * by, like the feet of a character.
 */
interface PropSpecBase extends ImageSpecBase {
  readonly anchor: Point;
  readonly layer: PropLayer;
  readonly collision: PropCollision;
}

export interface TreeSpec extends PropSpecBase {
  readonly kind: 'tree';
  readonly footprint: Footprint;
}

export interface PlantSpec extends PropSpecBase {
  readonly kind: 'plant';
  readonly footprint: Footprint;
}

export const BRIDGE_ORIENTATIONS = ['north-south', 'east-west'] as const;
export type BridgeOrientation = (typeof BRIDGE_ORIENTATIONS)[number];

export interface BridgeSpec extends PropSpecBase {
  readonly kind: 'bridge';
  readonly columnOrder: readonly BridgeOrientation[];
  readonly footprint: Footprint;
}

export interface HedgeSpec extends PropSpecBase {
  readonly kind: 'hedge';
  readonly footprint: Footprint;
  /** Screen pixels the top of the hedge rises over its footprint. */
  readonly height: number;
}

/**
 * The two ways a room table stands (#208): its long side across the screen
 * (`horizontal`, the footprint as stated) or along the floor depth
 * (`vertical`, the footprint swapped). A room table is symmetric, so these
 * are all its turns: the decor layer's rotation 0 and 90.
 */
export const TABLE_FACINGS = ['horizontal', 'vertical'] as const;
export type TableFacing = (typeof TABLE_FACINGS)[number];

/** Room tables differ in size: each piece states its (horizontal) footprint, up to `maxFootprint`. */
export interface TableSpec extends PropSpecBase {
  readonly kind: 'table';
  readonly columnOrder: readonly TableFacing[];
  readonly maxFootprint: Footprint;
}

/**
 * The two ends of a door's span its hinge may sit on (#223): `start` is the
 * west (horizontal edge) or north (vertical edge) one. A single door hinges at
 * its start. A double door is drawn whole (both leaves, hinged at the outer
 * ends), so it only uses the `start` rows.
 */
export const DOOR_HINGES = ['start', 'end'] as const;
export type DoorHinge = (typeof DOOR_HINGES)[number];

/**
 * The frames a door swings through, from 0 (closed) to the last (open): the
 * leaf turns a third of a quarter turn per step, so it never jumps (#233).
 */
export const DOOR_STEPS = 4;

/**
 * The pieces of the door kind: a single door and a double door are two items
 * (#233), and a window is a third one (tile walls): it stands in a wall like a
 * door, but never opens it.
 */
export const DOOR_VARIANTS = ['single', 'double', 'window'] as const;
export type DoorVariant = (typeof DOOR_VARIANTS)[number];

/**
 * How a door variant fills the grid line it stands on, in tiles and pixels:
 * `span` tiles between the two walls it stands between, of which the leaf (or
 * both leaves) takes `leafLength` pixels and a jamb of `jamb` pixels on each
 * side merges with the wall at that end (single: 1.4 + 2 x 0.3 tiles, double:
 * 3.2 + 2 x 0.4).
 */
export interface DoorVariantSpec {
  readonly span: number;
  readonly leafLength: number;
  readonly jamb: number;
  /**
   * How wide it is seen from the front in a horizontal run, frame included,
   * centered on its span; the wall's material shows on each side of it.
   */
  readonly frontWidth: number;
}

/**
 * A door (#223, #233): one column per decor rotation (`DECOR_ROTATIONS`
 * order: 0 opens down, 90 right, 180 up, 270 left), `DOOR_STEPS` rows per
 * hinge from closed to open (`doorFrameIndex`). The anchor is the middle of
 * the door's span (`doorPlacement`). In a vertical wall run (90, 270) it is
 * seen from above: a closed leaf lies along the run and an open one swings a
 * quarter into the side it opens to. In a horizontal run (0, 180) it is seen
 * from the front (`DOOR_FRONT`), a window too (`WINDOW_FRONT`). One frame
 * fits the widest variant, the double door; the others are drawn in the
 * middle of it.
 */
export interface DoorSpec extends ImageSpecBase {
  readonly kind: 'door';
  readonly anchor: Point;
  /** Across the edge: the plank's thickness. */
  readonly leafThickness: number;
  readonly variants: Readonly<Record<DoorVariant, DoorVariantSpec>>;
}

export interface TerrainTilesetSpec extends ImageSpecBase {
  readonly kind: 'terrain-tileset';
  readonly masks: number;
  readonly phases: number;
  readonly variants: number;
}

export type ArtImageSpec =
  | CharacterWalkSpec
  | CharacterSeatedSpec
  | ChairSpec
  | DeskSpec
  | FloorSpec
  | WallSpec
  | TerrainTilesetSpec
  | TreeSpec
  | PlantSpec
  | BridgeSpec
  | HedgeSpec
  | TableSpec
  | DoorSpec
  | SofaSpec;

export const CHARACTER_WALK: CharacterWalkSpec = {
  kind: 'character-walk',
  frame: { width: 32, height: 52 },
  columns: 11,
  rows: WALK_DIRECTIONS.length,
  rowOrder: WALK_DIRECTIONS,
  stepColumns: 10,
  idleColumn: 10,
  anchor: { x: 16, y: 47 },
  footprint: { w: 1, h: 1 },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

export const CHARACTER_SEATED: CharacterSeatedSpec = {
  kind: 'character-seated',
  frame: { width: 44, height: 58 },
  columns: 8,
  rows: PACK_FACINGS.length,
  rowOrder: PACK_FACINGS,
  transitionColumns: 6,
  idleColumns: [6, 7],
  anchor: { x: 22, y: 42 },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/**
 * The seat sits at the same pixel of every cell, and the ground point
 * SEAT_HEIGHT (9) below. Each chair fits the art's 36px SEAT_BLOCK, but once
 * they share that seat pixel they span 37 rows (up to 22 above the seat, 15
 * from it down), so the cell is 38 tall rather than 36.
 */
export const CHAIR: ChairSpec = {
  kind: 'chair',
  frame: { width: 36, height: 38 },
  columns: PACK_FACINGS.length,
  rows: CHAIR_LAYERS.length,
  columnOrder: PACK_FACINGS,
  rowOrder: CHAIR_LAYERS,
  anchor: { x: 18, y: 22 },
  ground: { x: 18, y: 31 },
  footprint: { w: 1, h: 1 },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/**
 * Sofas of up to three seats in every facing: a three-seat one spans 90
 * pixels across, or 109 rows turned sideways (45 below the middle of the
 * sofa, 64 above it with the backrest). The anchor leaves a free row and
 * column around the largest, so every frame corner stays transparent.
 */
export const SOFA: SofaSpec = {
  kind: 'sofa',
  frame: { width: 96, height: 112 },
  columns: PACK_FACINGS.length,
  rows: CHAIR_LAYERS.length,
  columnOrder: PACK_FACINGS,
  rowOrder: CHAIR_LAYERS,
  anchor: { x: 48, y: 66 },
  maxSeats: 3,
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

const SOFA_ID = /^sofa-[a-z0-9]+-([0-9])$/;

/**
 * How many seats (tiles) a sofa piece holds, read from its id
 * (`sofa-<material>-<seats>`), like a door's span: the decor rules size a sofa
 * without its catalog entry. `null` for an id that states none from 2 up to
 * `SOFA.maxSeats`.
 */
export function sofaSeatsOf(piece: string): number | null {
  const match = SOFA_ID.exec(piece);
  if (match === null) return null;
  const seats = Number(match[1]);
  return seats >= 2 && seats <= SOFA.maxSeats ? seats : null;
}

/**
 * A desk piece is the table a person places on one 3-tile edge of their desk
 * (desk decor, Editar espacios): about 2.6 tiles (84px) long in any facing,
 * so it looks centered on the edge, close to the next desk like in a real
 * office. A 96x104 cell fits it horizontal or vertical (the vertical one
 * stands its top over 84 floor rows, 100 rows with its height); the footprint
 * is the whole edge, along the long side.
 */
export const DESK: DeskSpec = {
  kind: 'desk',
  frame: { width: 96, height: 104 },
  columns: PACK_FACINGS.length,
  rows: 1,
  columnOrder: PACK_FACINGS,
  anchor: { x: 48, y: 60 },
  footprintByFacing: {
    up: { w: 3, h: 1 },
    down: { w: 3, h: 1 },
    left: { w: 1, h: 3 },
    right: { w: 1, h: 3 },
  },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/** Floor patterns are drawn as 96x96 seamless motifs. */
export const FLOOR_MOTIF_SIZE = 96;
const MOTIF_TILES = FLOOR_MOTIF_SIZE / ART_TILE;

export const FLOOR: FloorSpec = {
  kind: 'floor',
  frame: { width: ART_TILE, height: ART_TILE },
  columns: MOTIF_TILES,
  rows: MOTIF_TILES,
  motifTiles: MOTIF_TILES,
  alpha: 'opaque',
  transparentCorners: false,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/**
 * Walls stand on whole tiles (the edge walls they replace sat on grid lines).
 * A wall is placed on one tile and covers it plus the tile above and below:
 * a column one tile wide and `heightTiles` tall, drawn as a dark top band
 * `topHeight` pixels tall over the material's face. Where walls stack into a
 * vertical run only the bottom of the run shows the face; above it the run
 * is all top band. Frames are 32x32: a row per variant (`WALL_VARIANTS`),
 * in the order of `WALL_FRAMES` across.
 */
export const WALL: WallSpec = {
  kind: 'wall',
  frame: { width: ART_TILE, height: ART_TILE },
  columns: 13,
  rows: 3,
  heightTiles: 3,
  topHeight: 19,
  // No pack wall is translucent since the glass material was removed; partial alpha
  // stays so the contract walls are drawn against does not tighten. A wall piece
  // covers its whole frame, so no corner rule.
  alpha: 'partial',
  transparentCorners: false,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/** Near black with a blue cast: the top of every wall, whatever its material. */
export const WALL_TOP_COLOR = '#1b1a2b';

/**
 * Frames of a wall sheet: `cap` is all top band (the upper tiles of a
 * vertical run), `crown` the tile where the top band meets the face, then
 * the `face` and the `base` (bottom tile, with the outline on the floor).
 * The `End` frames are the same tiles for the last wall of a horizontal run,
 * whose right edge they close with a column in the top band's color; the
 * `Start` frames close the left edge of the first wall, and the `Both` frames
 * both edges of a wall alone. Walls in the middle of a run leave them open.
 */
export const WALL_FRAMES = {
  cap: 0,
  crown: 1,
  face: 2,
  base: 3,
  crownEnd: 4,
  faceEnd: 5,
  baseEnd: 6,
  crownStart: 7,
  faceStart: 8,
  baseStart: 9,
  crownBoth: 10,
  faceBoth: 11,
  baseBoth: 12,
} as const;
export type WallFrame = keyof typeof WALL_FRAMES;

/**
 * A wall face repeats every `WALL_VARIANTS` tiles across instead of every
 * tile, so a pattern can hold pieces longer than a tile allows (stone blocks
 * of 12 to 24px). The variant of a wall is its tile column modulo this.
 */
export const WALL_VARIANTS = WALL.rows;

/** Sheet index of a wall frame for the wall standing in tile column `tx`. */
export function wallFrameIndex(frame: WallFrame, tx: number): number {
  return (((tx % WALL_VARIANTS) + WALL_VARIANTS) % WALL_VARIANTS) * WALL.columns + WALL_FRAMES[frame];
}

// --- Terrain (#123) ------------------------------------------------------------------------------

/**
 * The block types of the terrain, in drawing priority: where two meet, the
 * later one is drawn over the earlier one's edge. Water is the lowest, so every
 * shore is the land's edge over the water, and carpet the highest.
 */
export const TERRAIN_MATERIALS = ['water', 'sand', 'dirt', 'cobblestone', 'grass', 'wood', 'tile', 'carpet'] as const;
export type TerrainMaterial = (typeof TERRAIN_MATERIALS)[number];

/**
 * The built floors: square edges on the map tile lines and no contact shadow,
 * so their drawn edge is exactly their walkable tiles. Where one meets water,
 * the water gets a bank tile instead (`terrainCellLayers`), so it still reads
 * as sunk below the floor.
 */
export const TERRAIN_BUILT_FLOORS = ['wood', 'tile', 'carpet'] as const satisfies readonly TerrainMaterial[];

export function isTerrainBuiltFloor(material: TerrainMaterial | null): boolean {
  return material !== null && (TERRAIN_BUILT_FLOORS as readonly TerrainMaterial[]).includes(material);
}

/** The natural materials, with organic edges: every terrain material but the built floors, in TERRAIN_MATERIALS order. */
export const TERRAIN_ORGANIC_MATERIALS: readonly TerrainMaterial[] = TERRAIN_MATERIALS.filter((material) => !isTerrainBuiltFloor(material));

/** Water is solid for the client and the server alike; every other material is walkable. */
export const TERRAIN_WALKABLE: Readonly<Record<TerrainMaterial, boolean>> = {
  water: false,
  grass: true,
  dirt: true,
  sand: true,
  cobblestone: true,
  wood: true,
  tile: true,
  carpet: true,
};

/** Each terrain material is the floor piece of the same name, cut on the dual grid. */
export function terrainFloorPieceId(material: TerrainMaterial): string {
  return `floor-${material}`;
}

/** Corner mask bits of a dual-grid cell, in reading order. */
export const TERRAIN_CORNER_BITS = { nw: 1, ne: 2, sw: 4, se: 8 } as const;
/** The corners in reading order: the order a split material lists its groups in. */
const TERRAIN_CORNER_ORDER = ['nw', 'ne', 'sw', 'se'] as const;
export const TERRAIN_MASKS = 16;
/** One tileset row per motif tile: the terrain keeps the floor motif's 96px repeat. */
export const TERRAIN_PHASES = MOTIF_TILES * MOTIF_TILES;
/**
 * Organic edges come in this many shapes per mask and phase, picked per display cell
 * (`terrainVariantAt`). With one shape, the edge noise repeated with the 96px motif, and since
 * terrain is painted in 9x9 blocks (a multiple of it), every block side drew the same curve.
 */
export const TERRAIN_VARIANTS = 3;
/**
 * The void's color, `0xRRGGBB`: the office draws it behind the terrain (`VOID_COLOR`) and the
 * tileset's void caps paint it, so a cap never shows as a different black.
 */
export const TERRAIN_VOID_COLOR = 0x000000;

/** A layer mask and the void corners of its cell (`voidMask`, always inside `mask`: void counts as covered). */
export interface TerrainVoidEdgeCombo {
  readonly mask: number;
  readonly voidMask: number;
}

/**
 * Every organic edge that can meet the void, in (mask, voidMask) order: a void corner, a corner of
 * the material itself, and at least one uncovered corner (mask 15 has no edge). Its noise fades out
 * next to the void quarters, so these get their own tiles (`terrainVoidEdgeIndex`), 36 of them.
 */
export const TERRAIN_VOID_EDGE_COMBOS: readonly TerrainVoidEdgeCombo[] = (() => {
  const combos: TerrainVoidEdgeCombo[] = [];
  for (let mask = 1; mask < 15; mask += 1) {
    for (let voidMask = 1; voidMask < 16; voidMask += 1) {
      if ((voidMask & ~mask) === 0 && voidMask !== mask) combos.push({ mask, voidMask });
    }
  }
  return combos;
})();

/** Small transparent details for a decal layer over the terrain (flowers, pebbles, lily pads). */
export const TERRAIN_DECALS = [
  'flowers-white',
  'flowers-yellow',
  'flowers-blue',
  'clover',
  'pebbles',
  'mushrooms',
  'leaves',
  'lily-pad',
] as const;
export type TerrainDecal = (typeof TERRAIN_DECALS)[number];

/**
 * One shared tileset for every terrain layer: a band of TERRAIN_PHASES rows per
 * material (TERRAIN_MATERIALS order), each row the TERRAIN_VARIANTS edge
 * variants of one motif phase side by side, 16 corner masks each (built floors
 * only fill variant 0), then one row of decals, then one row with the water
 * bank tiles by corner mask (`terrainBankIndex`) in its first 16 columns and
 * the void caps (`terrainVoidCapIndex`) in the next 16, then the void edge
 * tiles (`terrainVoidEdgeIndex`) one after the other over the full width,
 * the last row partly empty. Mask 0 is an empty tile so the index stays
 * arithmetic. Colors are capped per band of TERRAIN_PHASES rows: the material
 * bands, then bands that mix decals, banks, caps and the void edges of up to
 * two organic materials, which share their colors with the material bands.
 */
export const TERRAIN_TILESET: TerrainTilesetSpec = {
  kind: 'terrain-tileset',
  frame: { width: ART_TILE, height: ART_TILE },
  columns: TERRAIN_MASKS * TERRAIN_VARIANTS,
  rows:
    TERRAIN_MATERIALS.length * TERRAIN_PHASES +
    2 +
    Math.ceil((TERRAIN_ORGANIC_MATERIALS.length * TERRAIN_PHASES * TERRAIN_VOID_EDGE_COMBOS.length) / (TERRAIN_MASKS * TERRAIN_VARIANTS)),
  masks: TERRAIN_MASKS,
  phases: TERRAIN_PHASES,
  variants: TERRAIN_VARIANTS,
  // Edge tiles are partly transparent and carry a translucent contact shadow.
  alpha: 'partial',
  transparentCorners: false,
  maxColors: MAX_COLORS_PER_IMAGE,
  colorBandRows: TERRAIN_PHASES,
};

/**
 * Terrain layers a map needs: a cell has four corners, so at most four
 * material tiles (a split material counts once per group, still one per
 * corner at most), plus the water bank over the lowest one; with a void
 * corner, at most three material tiles, the bank and the void cap.
 */
export const TERRAIN_LAYER_COUNT = 5;
/**
 * World position of display cell (0, 0). The display grid sits half a tile up
 * and left of the map grid, so the corners of display cell (cx, cy) are the
 * centers of map tiles (cx - 1, cy - 1) to (cx, cy): a (w + 1) x (h + 1) layer
 * covers a w x h map.
 */
export const TERRAIN_LAYER_ORIGIN = -ART_TILE / 2;

/**
 * The material at each corner of a display cell. `null` is a corner without
 * terrain (the office layout's void): the materials run on under it and a void
 * cap covers its quarter, so every edge against the void is the tile line.
 */
export interface TerrainCorners {
  readonly nw: TerrainMaterial | null;
  readonly ne: TerrainMaterial | null;
  readonly sw: TerrainMaterial | null;
  readonly se: TerrainMaterial | null;
}

/** A group (a block color) per corner of a display cell, `null` for none. */
export type TerrainCornerGroups = Readonly<Record<keyof TerrainCorners, string | null>>;

/** A material over the corners in `mask`. */
export interface TerrainMaterialTile {
  readonly material: TerrainMaterial;
  readonly mask: number;
  /** The group of the corners it covers (a block color), set only where the caller grouped them. */
  readonly group?: string;
}

/** The contact shadow of the built floors over water, outside the corners in `mask`. */
export interface TerrainBankTile {
  readonly bank: true;
  readonly mask: number;
}

/** The void over the corners in `mask`: square opaque quarters in TERRAIN_VOID_COLOR with a 1px rim outside. */
export interface TerrainVoidTile {
  readonly void: true;
  readonly mask: number;
}

export type TerrainLayerTile = TerrainMaterialTile | TerrainBankTile | TerrainVoidTile;

export function terrainCornerMask(corners: Readonly<Record<keyof TerrainCorners, boolean>>): number {
  return (
    (corners.nw ? TERRAIN_CORNER_BITS.nw : 0) |
    (corners.ne ? TERRAIN_CORNER_BITS.ne : 0) |
    (corners.sw ? TERRAIN_CORNER_BITS.sw : 0) |
    (corners.se ? TERRAIN_CORNER_BITS.se : 0)
  );
}

/** Motif phase of display cell (cx, cy): it starts at world pixel (32 cx - 16, 32 cy - 16). */
export function terrainPhaseAt(cx: number, cy: number): number {
  return mod(cy - 1, MOTIF_TILES) * MOTIF_TILES + mod(cx - 1, MOTIF_TILES);
}

/** Motif pixel at the top-left of every tile of a phase (it wraps around the 96px motif). */
export function terrainPhaseOrigin(phase: number): Point {
  const half = ART_TILE / 2;
  return { x: half + (phase % MOTIF_TILES) * ART_TILE, y: half + Math.floor(phase / MOTIF_TILES) * ART_TILE };
}

/**
 * Edge variant of display cell (cx, cy): an integer hash of the cell, so neighbors pick
 * independently and neither the 3-cell motif nor the 9-cell terrain block repeats a shape.
 */
export function terrainVariantAt(cx: number, cy: number): number {
  let hash = Math.imul(cx, 0x9e3779b1) ^ Math.imul(cy, 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) % TERRAIN_VARIANTS;
}

export function terrainTileIndex(material: TerrainMaterial, mask: number, phase: number, variant = 0): number {
  if (!Number.isInteger(mask) || mask < 1 || mask >= TERRAIN_MASKS) throw new Error(`Invalid terrain mask ${mask}`);
  if (!Number.isInteger(phase) || phase < 0 || phase >= TERRAIN_PHASES) throw new Error(`Invalid terrain phase ${phase}`);
  if (!Number.isInteger(variant) || variant < 0 || variant >= TERRAIN_VARIANTS) throw new Error(`Invalid terrain variant ${variant}`);
  return (TERRAIN_MATERIALS.indexOf(material) * TERRAIN_PHASES + phase) * TERRAIN_TILESET.columns + variant * TERRAIN_MASKS + mask;
}

export function terrainDecalIndex(decal: TerrainDecal): number {
  return TERRAIN_MATERIALS.length * TERRAIN_PHASES * TERRAIN_TILESET.columns + TERRAIN_DECALS.indexOf(decal);
}

/** First index of the row after the decals: the water banks, then the void caps. */
const TERRAIN_BANK_ROW_START = (TERRAIN_MATERIALS.length * TERRAIN_PHASES + 1) * TERRAIN_TILESET.columns;

/** The water bank tile casting the built floors' shadow outside the corners in `mask` (1-15); one per mask, any phase. */
export function terrainBankIndex(mask: number): number {
  if (!Number.isInteger(mask) || mask < 1 || mask >= TERRAIN_MASKS) throw new Error(`Invalid terrain bank mask ${mask}`);
  return TERRAIN_BANK_ROW_START + mask;
}

/** The void cap over the corners in `mask` (1-15); one per mask, any phase or variant. */
export function terrainVoidCapIndex(mask: number): number {
  if (!Number.isInteger(mask) || mask < 1 || mask >= TERRAIN_MASKS) throw new Error(`Invalid terrain void cap mask ${mask}`);
  return TERRAIN_BANK_ROW_START + TERRAIN_MASKS + mask;
}

/** First index after the bank row: the void edge tiles. */
const TERRAIN_VOID_EDGE_START = TERRAIN_BANK_ROW_START + TERRAIN_TILESET.columns;

/**
 * The tile of an organic `material` over `mask` in a cell whose void corners are `voidMask` (a
 * TERRAIN_VOID_EDGE_COMBOS pair), for one motif phase. One shape per phase: next to the void the
 * edge has to meet the tile line, so there is nothing for a variant to vary.
 */
export function terrainVoidEdgeIndex(material: TerrainMaterial, mask: number, voidMask: number, phase: number): number {
  const organic = TERRAIN_ORGANIC_MATERIALS.indexOf(material);
  if (organic < 0) throw new Error(`Void edge tiles are organic only, not ${material}`);
  const combo = TERRAIN_VOID_EDGE_COMBOS.findIndex((entry) => entry.mask === mask && entry.voidMask === voidMask);
  if (combo < 0) throw new Error(`Invalid terrain void edge ${mask}/${voidMask}`);
  if (!Number.isInteger(phase) || phase < 0 || phase >= TERRAIN_PHASES) throw new Error(`Invalid terrain phase ${phase}`);
  return TERRAIN_VOID_EDGE_START + (organic * TERRAIN_PHASES + phase) * TERRAIN_VOID_EDGE_COMBOS.length + combo;
}

/** The void corners of a display cell. */
export function terrainVoidMask(corners: TerrainCorners): number {
  return terrainCornerMask({ nw: corners.nw === null, ne: corners.ne === null, sw: corners.sw === null, se: corners.se === null });
}

/**
 * The tiles of one display cell, bottom layer first: its lowest material
 * full, then each higher material over the corners at or above it. Nesting
 * the masks means every edge blends over the material just below it.
 *
 * Void ranks above every material, so the materials run on under the void
 * corners, and a void cap over those corners comes last: an organic edge
 * would wave over the black background, the cap's square quarters put every
 * edge against the void on the tile line instead.
 *
 * Built floors cast no shadow, which would paint past their walkable tiles
 * onto any neighbor. Over water, a bank tile right above it puts that shadow
 * back on the built-floor corners: the higher materials then cover all of it
 * but what falls on the water, which keeps reading as sunk below the floors.
 *
 * `groups` says which group each corner belongs to (a block color, #259). A
 * material whose own corners fall in several groups gets one tile per group,
 * each over only its group's corners (and the higher ones, which cover it
 * anyway), so a seam between two groups is the tile line, not a whole cell
 * drawn for the first group. A `null` group is a group of its own.
 */
export function terrainCellLayers(corners: TerrainCorners, groups?: TerrainCornerGroups): TerrainLayerTile[] {
  const rank = (material: TerrainMaterial | null): number => (material === null ? TERRAIN_MATERIALS.length : TERRAIN_MATERIALS.indexOf(material));
  const present = [...new Set([corners.nw, corners.ne, corners.sw, corners.se])]
    .filter((material): material is TerrainMaterial => material !== null)
    .sort((a, b) => rank(a) - rank(b));
  const layers: TerrainLayerTile[] = present.flatMap((material): TerrainMaterialTile[] => {
    const covers = (corner: keyof TerrainCorners): boolean => rank(corners[corner]) >= rank(material);
    const wholeMask = terrainCornerMask({ nw: covers('nw'), ne: covers('ne'), sw: covers('sw'), se: covers('se') });
    if (groups === undefined) return [{ material, mask: wholeMask }];
    const own = TERRAIN_CORNER_ORDER.filter((corner) => corners[corner] === material);
    const keys = [...new Set(own.map((corner) => groups[corner]))];
    if (keys.length === 1 && keys[0] === null) return [{ material, mask: wholeMask }];
    const higher = wholeMask & ~terrainCornerMask({ nw: own.includes('nw'), ne: own.includes('ne'), sw: own.includes('sw'), se: own.includes('se') });
    return keys.map((key) => {
      const mask = higher | terrainCornerMask({ nw: own.includes('nw') && groups.nw === key, ne: own.includes('ne') && groups.ne === key, sw: own.includes('sw') && groups.sw === key, se: own.includes('se') && groups.se === key });
      return key === null ? { material, mask } : { material, mask, group: key };
    });
  });
  const built = terrainCornerMask({
    nw: isTerrainBuiltFloor(corners.nw),
    ne: isTerrainBuiltFloor(corners.ne),
    sw: isTerrainBuiltFloor(corners.sw),
    se: isTerrainBuiltFloor(corners.se),
  });
  if (present[0] === 'water' && built !== 0) layers.splice(1, 0, { bank: true, mask: built });
  const voids = terrainVoidMask(corners);
  if (present.length > 0 && voids !== 0) layers.push({ void: true, mask: voids });
  return layers;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Corners of display cell (cx, cy) on a width x height map; outside the map, the nearest tile. */
export function terrainCellCorners(
  terrainAt: (tx: number, ty: number) => TerrainMaterial | null,
  width: number,
  height: number,
  cx: number,
  cy: number,
): TerrainCorners {
  return cornersOf(terrainAt, width, height, cx, cy);
}

function cornersOf<T>(valueAt: (tx: number, ty: number) => T, width: number, height: number, cx: number, cy: number): Record<keyof TerrainCorners, T> {
  const at = (tx: number, ty: number): T => valueAt(clamp(tx, 0, width - 1), clamp(ty, 0, height - 1));
  return { nw: at(cx - 1, cy - 1), ne: at(cx, cy - 1), sw: at(cx - 1, cy), se: at(cx, cy) };
}

/**
 * Tile data of the TERRAIN_LAYER_COUNT layers of a map, `[layer][cy][cx]`,
 * `-1` where a layer draws nothing (Phaser's empty tile), cells whose four
 * corners are void (`null`) included. Each layer is
 * (width + 1) x (height + 1) cells placed at TERRAIN_LAYER_ORIGIN. Natural
 * materials take the cell's edge variant, or their void edge tile when the
 * cell has void corners and the layer an edge; built floors, square, only have variant 0.
 */
export function terrainLayerData(width: number, height: number, terrainAt: (tx: number, ty: number) => TerrainMaterial | null): number[][][] {
  return terrainLayerCells(width, height, terrainAt).tiles;
}

/** The tile data of `terrainLayerData` and, in the same `[layer][cy][cx]` shape, the group of each material tile (`null` for the rest). */
export interface TerrainLayerCells {
  readonly tiles: number[][][];
  readonly groups: (string | null)[][][];
}

/**
 * `terrainLayerData` with the corners grouped by `groupAt` (`terrainCellLayers`):
 * a cell between two groups of one material draws one tile per group.
 */
export function terrainLayerCells(
  width: number,
  height: number,
  terrainAt: (tx: number, ty: number) => TerrainMaterial | null,
  groupAt?: (material: TerrainMaterial, tx: number, ty: number) => string | null,
): TerrainLayerCells {
  const grid = <T>(empty: T): T[][][] => Array.from({ length: TERRAIN_LAYER_COUNT }, () => Array.from({ length: height + 1 }, () => new Array<T>(width + 1).fill(empty)));
  const layers = grid(-1);
  const groupLayers = grid<string | null>(null);
  for (let cy = 0; cy <= height; cy += 1) {
    for (let cx = 0; cx <= width; cx += 1) {
      const phase = terrainPhaseAt(cx, cy);
      const variant = terrainVariantAt(cx, cy);
      const corners = terrainCellCorners(terrainAt, width, height, cx, cy);
      const groups =
        groupAt === undefined
          ? undefined
          : cornersOf((tx, ty) => {
              const material = terrainAt(tx, ty);
              return material === null ? null : groupAt(material, tx, ty);
            }, width, height, cx, cy);
      const voids = terrainVoidMask(corners);
      const materialIndex = (tile: TerrainMaterialTile): number => {
        if (isTerrainBuiltFloor(tile.material)) return terrainTileIndex(tile.material, tile.mask, phase);
        if (voids !== 0 && tile.mask !== 15) return terrainVoidEdgeIndex(tile.material, tile.mask, voids, phase);
        return terrainTileIndex(tile.material, tile.mask, phase, variant);
      };
      terrainCellLayers(corners, groups).forEach((tile, layer) => {
        layers[layer]![cy]![cx] = 'bank' in tile ? terrainBankIndex(tile.mask) : 'void' in tile ? terrainVoidCapIndex(tile.mask) : materialIndex(tile);
        if ('material' in tile) groupLayers[layer]![cy]![cx] = tile.group ?? null;
      });
    }
  }
  return { tiles: layers, groups: groupLayers };
}

// --- Map props ---------------------------------------------------------------------------------

const PROP_BASE = { columns: 1, rows: 1, alpha: 'partial', transparentCorners: true, maxColors: MAX_COLORS_PER_IMAGE } as const;

/** A tree stands on one tile; its crown spills over the tiles around and above it. */
export const TREE: TreeSpec = {
  ...PROP_BASE,
  kind: 'tree',
  frame: { width: 64, height: 96 },
  anchor: { x: 32, y: 90 },
  footprint: { w: 1, h: 1 },
  layer: 'sorted',
  collision: 'solid',
};

export const PLANT: PlantSpec = {
  ...PROP_BASE,
  kind: 'plant',
  frame: { width: 32, height: 48 },
  anchor: { x: 16, y: 46 },
  footprint: { w: 1, h: 1 },
  layer: 'sorted',
  collision: 'solid',
};

/** A 3x3 deck centered in a 128px cell, with abutments reaching 16px onto each bank. */
export const BRIDGE: BridgeSpec = {
  ...PROP_BASE,
  kind: 'bridge',
  frame: { width: 128, height: 128 },
  columns: BRIDGE_ORIENTATIONS.length,
  columnOrder: BRIDGE_ORIENTATIONS,
  anchor: { x: 64, y: 112 },
  footprint: { w: 3, h: 3 },
  layer: 'ground',
  collision: 'deck',
};

const HEDGE_HEIGHT = 16;

/**
 * One tile of hedge per frame, frame = connection mask to hedge neighbors
 * (north 1, east 2, south 4, west 8, like wall joints; 0 is a lone bush). A
 * connected hedge fills its frame to the edge, so no corner rule.
 */
export const HEDGE: HedgeSpec = {
  ...PROP_BASE,
  kind: 'hedge',
  frame: { width: ART_TILE, height: ART_TILE + HEDGE_HEIGHT },
  columns: 16,
  anchor: { x: ART_TILE / 2, y: ART_TILE + HEDGE_HEIGHT },
  footprint: { w: 1, h: 1 },
  height: HEDGE_HEIGHT,
  layer: 'sorted',
  collision: 'solid',
  transparentCorners: false,
};

/**
 * Room tables, one column per `TABLE_FACINGS`: a frame fits the largest, the
 * 7x5 meeting table, both horizontal and standing vertical (5x7, its lifted
 * top over 7 tiles of floor depth). The anchor is the floor under the bottom
 * middle of the footprint in either frame, the footprint swapped in the
 * vertical one, and 12 rows of frame stay below it like before.
 */
export const TABLE: TableSpec = {
  ...PROP_BASE,
  kind: 'table',
  frame: { width: 256, height: 256 },
  columns: TABLE_FACINGS.length,
  columnOrder: TABLE_FACINGS,
  anchor: { x: 128, y: 244 },
  maxFootprint: { w: 7, h: 5 },
  layer: 'sorted',
  collision: 'solid',
};

/**
 * The door frame (S14): 8 tiles tall, because a door in a vertical run stands
 * in the walls' projection, its frame rising 77px over the span's top (to
 * where the wall's material ends) and the lower leaf of a double door
 * reaching about 68px past the span's bottom; 5 tiles wide for a leaf swung
 * out about 80px to either side. The anchor stays the middle of the span.
 */
const DOOR_FRAME = { width: 5 * ART_TILE, height: 8 * ART_TILE } as const;

export const DOOR: DoorSpec = {
  ...PROP_BASE,
  kind: 'door',
  frame: DOOR_FRAME,
  columns: 4,
  rows: DOOR_HINGES.length * DOOR_STEPS,
  anchor: { x: DOOR_FRAME.width / 2, y: DOOR_FRAME.height / 2 },
  leafThickness: 6,
  variants: {
    // Seen from the front, 1.4 tiles of its two: 0.1 of frame on each side of a 1.2 doorway.
    single: { span: 2, leafLength: 44, jamb: 10, frontWidth: 44 },
    double: { span: 3, leafLength: 70, jamb: 13, frontWidth: 96 },
    // A window takes two wall tiles but is drawn 1.4 wide in their middle, the wall showing on each side (L24).
    window: { span: 2, leafLength: 44, jamb: 10, frontWidth: 44 },
  },
};

/** The door piece of a variant: the single door is `door-<material>`, the double one `door-<material>-double`, a window `door-<material>-window`. */
export function doorVariantOf(piece: string): DoorVariant {
  if (piece.endsWith('-double')) return 'double';
  return piece.endsWith('-window') ? 'window' : 'single';
}

/** How many tiles of a horizontal wall's line a door piece spans (2 or 3); a vertical run takes one fewer (`doorSpanAlong`). */
export function doorSpanOf(piece: string): number {
  return DOOR.variants[doorVariantOf(piece)].span;
}

/**
 * The tiles a door of `span` (its horizontal span, `doorSpanOf`) takes in a
 * run along `axis` (L41): a tile fewer in a vertical run, where a door rising
 * from the floor would otherwise look far bigger than the same door seen from
 * the front. A single door spans 1 tile there, a double door 2.
 */
export function doorSpanAlong(axis: DoorAxis, span: number): number {
  return axis === 'vertical' ? span - 1 : span;
}

/**
 * The end of its span a door hinges at (#233). A double door always hinges
 * its leaves at the outer ends, so it reports `start`. A single door turns as
 * a whole with its rotation, going round clockwise from hinged at the west end
 * and opening down (0): left (270) hinges it at the north end, up (180) at the
 * east end and right (90) at the south end. Which side it swings to when
 * opened is up to whoever opens it (`openDoorLeaves`).
 */
export function doorHingeOf(piece: string, rotation: 0 | 90 | 180 | 270): DoorHinge {
  return doorVariantOf(piece) === 'single' && (rotation === 90 || rotation === 180) ? 'end' : 'start';
}

/**
 * The frame of a door leaf: its rotation's column, and the row of its hinge
 * (`DOOR_HINGES`) at `step` of the swing, 0 closed up to `DOOR_STEPS - 1` open.
 */
export function doorFrameIndex(rotation: 0 | 90 | 180 | 270, hinge: DoorHinge, step: number): number {
  const row = DOOR_HINGES.indexOf(hinge) * DOOR_STEPS + step;
  return row * DOOR.columns + rotation / 90;
}

/** The wall run a door or window stands in (tile walls): rotations 0 and 180 are horizontal, 90 and 270 vertical. */
export type DoorAxis = 'horizontal' | 'vertical';

export function doorAxisOf(rotation: 0 | 90 | 180 | 270): DoorAxis {
  return rotation === 0 || rotation === 180 ? 'horizontal' : 'vertical';
}

/**
 * Where the top of the wall a door or window stands in falls in its frame,
 * in a horizontal run: two tiles over the anchor (`doorPlacement`). Front
 * drawings are laid from it, so growing the frame (S14) leaves them on the
 * same world pixels.
 */
export const DOOR_WALL_TOP = DOOR.anchor.y - 2 * ART_TILE;

/**
 * A door in a horizontal wall run, seen from the front (tile walls): it takes
 * the bottom two tiles of the wall, under the top one, which keeps the dark
 * band and the wall's material. In frame pixels, from the top of the wall
 * (`DOOR_WALL_TOP`).
 */
export const DOOR_FRONT = { top: DOOR_WALL_TOP + ART_TILE, bottom: DOOR_WALL_TOP + 3 * ART_TILE, frame: 3 } as const;

/**
 * How many pixels of wall a door piece leaves at each end of its span seen
 * from the front (`frontWidth`): the wall's material is drawn there and
 * nobody walks through it.
 */
export function doorFrontInset(piece: string): number {
  const { span, frontWidth } = DOOR.variants[doorVariantOf(piece)];
  return (span * ART_TILE - frontWidth) / 2;
}

/**
 * A window, seen from the front like a horizontal door (tile walls): it
 * stands over the wall's bottom tile, which stays the wall's, and starts 0.4
 * tiles under the dark band (L22, L23), the wall's material showing between
 * them. It is `DOOR.variants.window.frontWidth` wide, centered on its two
 * tiles, the wall's material on each side. Frame pixels, like `DOOR_FRONT`.
 */
export const WINDOW_FRONT = { top: DOOR_WALL_TOP + WALL.topHeight + 2 * Math.round(0.2 * ART_TILE), bottom: DOOR_WALL_TOP + 2 * ART_TILE } as const;

/**
 * Where to draw a door or window of `span` tiles whose first wall tile is
 * (tx, ty) (tile walls): the frame's top-left in world pixels, the anchor on
 * the middle of the span. In a horizontal run the anchor is level with the
 * top of the wall's bottom tile, so the top of the wall is `DOOR_WALL_TOP`
 * in the frame (`DOOR_FRONT`); in a vertical one it is the middle of the
 * column.
 */
export function doorPlacement(axis: DoorAxis, tx: number, ty: number, span: number): { readonly x: number; readonly y: number } {
  const middle = axis === 'horizontal' ? { x: (tx + span / 2) * ART_TILE, y: (ty + 1) * ART_TILE } : { x: (tx + 0.5) * ART_TILE, y: (ty + span / 2) * ART_TILE };
  return { x: middle.x - DOOR.anchor.x, y: middle.y - DOOR.anchor.y };
}

/**
 * A door in a vertical wall run (S9, S14), drawn like the walls: what stands
 * on the floor rises straight up the screen. Its leaves are `leafThickness`
 * pixels thick on the floor and `height` tall (a horizontal door's height,
 * `DOOR_FRONT`, less the box on its frame's top); the lower post's foot is
 * under the wall below the span, only `stubShows` pixels of its top showing
 * over that wall. The wall right over it is drawn without its last
 * `hidesWallBase` rows, its floor line (L43): the frame and the ceiling's
 * shadow meet the doorway with nothing across them.
 */
export const VERTICAL_DOOR = { leafThickness: 10, height: DOOR_FRONT.bottom - DOOR_FRONT.top, stubShows: 2, hidesWallBase: 2 } as const;

/**
 * Where the two posts of a door in a vertical run stand on the floor, `top`
 * being the y of its span's top (world or frame pixels): the upper one at
 * the span's top, the lower one a door's height under the span's bottom, so
 * its top shows `stubShows` pixels over the wall below (S14b, S14d).
 */
export function verticalDoorFeet(variant: DoorVariant, top: number): { readonly upper: number; readonly lower: number } {
  return { upper: top, lower: top + doorSpanAlong('vertical', DOOR.variants[variant].span) * ART_TILE - VERTICAL_DOOR.stubShows + VERTICAL_DOOR.height };
}

/**
 * A leaf of a door in a vertical run: hinged on the floor at `hingeY` in the
 * column's middle, running `down` (+1) or up (-1) the run when shut,
 * `length` pixels long.
 */
export interface VerticalDoorLeaf {
  readonly hingeY: number;
  readonly down: 1 | -1;
  readonly length: number;
}

/**
 * The leaves of a door in a vertical run whose span's top is at `top`
 * (S14d): a single door's one leaf hangs from the upper post, half the
 * post-to-post length; a double door's two share that length, the upper one
 * from the upper post, the lower one from the lower post. Every hinge of a
 * vertical door is the same: its lower post stands under the wall.
 */
export function verticalDoorLeaves(variant: DoorVariant, top: number): VerticalDoorLeaf[] {
  const { upper, lower } = verticalDoorFeet(variant, top);
  const length = lower - upper;
  const first = Math.floor(length / 2);
  if (variant !== 'double') return [{ hingeY: upper, down: 1, length: first }];
  return [
    { hingeY: upper, down: 1, length: first },
    { hingeY: lower, down: -1, length: length - first },
  ];
}

/** The lowest floor y a vertical door's leaf reaches at `step` of its swing (`doorFrameIndex`), its thickness included. */
function leafLowestY({ hingeY, down, length }: VerticalDoorLeaf, step: number): number {
  const angle = (step / (DOOR_STEPS - 1)) * (Math.PI / 2);
  return hingeY + (down === 1 ? length * Math.cos(angle) : 0) + (VERTICAL_DOOR.leafThickness / 2) * Math.sin(angle);
}

/**
 * The frame of a door in a vertical wall run cut into images sorted apart
 * (S14), crops in frame pixels, the same at every `step` of its swing; only
 * the depths move. The door's first tile is on row `ty`.
 *
 * - The column over the span (frame top, post, shadow): just over the
 *   run-end face above it (`wallTileFrames` sorts that by the span's top),
 *   under whoever crosses the doorway.
 * - The column along the span (the shut door's line, the stub, the shadow):
 *   by the span's bottom, over whoever crosses it.
 * - Beside the column, where only leaves draw, left and right: by the lowest
 *   floor pixel of the leaf there, so an avatar below it walks in front of
 *   it. A double door's two leaves are cut apart at the floor midpoint
 *   between their hinges. The upper part beside the column belongs to the
 *   leaves too, so an avatar's head beside a swung leaf never shows over it.
 */
export function doorSlices(ty: number, piece: string, step: number): { readonly crop: Rect; readonly depthY: number }[] {
  const variant = doorVariantOf(piece);
  const span = doorSpanAlong('vertical', DOOR.variants[variant].span);
  const top = DOOR.anchor.y - (span * ART_TILE) / 2;
  const columnX = DOOR.anchor.x - ART_TILE / 2;
  const rightX = columnX + ART_TILE;
  const { height, width } = DOOR.frame;
  const leaves = verticalDoorLeaves(variant, ty * ART_TILE);
  const { upper, lower } = verticalDoorFeet(variant, top);
  const bands = leaves.length === 1 ? [{ y: 0, h: height }] : [{ y: 0, h: Math.floor((upper + lower) / 2) }, { y: Math.floor((upper + lower) / 2), h: height - Math.floor((upper + lower) / 2) }];
  return [
    { crop: { x: columnX, y: 0, width: ART_TILE, height: top }, depthY: ty * ART_TILE + 1 },
    { crop: { x: columnX, y: top, width: ART_TILE, height: span * ART_TILE }, depthY: (ty + span) * ART_TILE },
    ...bands.flatMap(({ y, h }, i) => {
      const depthY = leafLowestY(leaves[i]!, step);
      return [
        { crop: { x: 0, y, width: columnX, height: h }, depthY },
        { crop: { x: rightX, y, width: width - rightX, height: h }, depthY },
      ];
    }),
  ];
}

export function bridgeFrameIndex(orientation: BridgeOrientation): number {
  return BRIDGE_ORIENTATIONS.indexOf(orientation);
}

/** The frame of a room table for a decor rotation: 0 and 180 horizontal, 90 and 270 vertical (it is symmetric). */
export function tableFrameIndex(rotation: 0 | 90 | 180 | 270): number {
  return TABLE_FACINGS.indexOf(rotation === 90 || rotation === 270 ? 'vertical' : 'horizontal');
}

export function hedgeFrameIndex(mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 15) throw new Error(`Invalid hedge mask ${mask}`);
  return mask;
}

/**
 * Where to draw a prop whose footprint's top-left tile is (tx, ty): the frame's
 * top-left in world pixels and the depth it sorts by.
 */
export function propPlacement(
  piece: { readonly anchor: Point; readonly footprint: Footprint },
  tx: number,
  ty: number,
): { readonly x: number; readonly y: number; readonly depthY: number } {
  const groundX = tx * ART_TILE + (piece.footprint.w * ART_TILE) / 2;
  const groundY = (ty + piece.footprint.h) * ART_TILE;
  return { x: groundX - piece.anchor.x, y: groundY - piece.anchor.y, depthY: groundY };
}

export const ART_IMAGE_SPECS: Readonly<{
  'character-walk': CharacterWalkSpec;
  'character-seated': CharacterSeatedSpec;
  chair: ChairSpec;
  desk: DeskSpec;
  floor: FloorSpec;
  wall: WallSpec;
  'terrain-tileset': TerrainTilesetSpec;
  tree: TreeSpec;
  plant: PlantSpec;
  bridge: BridgeSpec;
  hedge: HedgeSpec;
  table: TableSpec;
  door: DoorSpec;
  sofa: SofaSpec;
}> = {
  'character-walk': CHARACTER_WALK,
  'character-seated': CHARACTER_SEATED,
  chair: CHAIR,
  desk: DESK,
  floor: FLOOR,
  wall: WALL,
  'terrain-tileset': TERRAIN_TILESET,
  tree: TREE,
  plant: PLANT,
  bridge: BRIDGE,
  hedge: HEDGE,
  table: TABLE,
  door: DOOR,
  sofa: SOFA,
};

export function sheetSize(spec: Pick<ImageSpecBase, 'frame' | 'columns' | 'rows'>): Size {
  return { width: spec.frame.width * spec.columns, height: spec.frame.height * spec.rows };
}

/** Row of the walk sheet for an office facing (the 4 cardinal of the 8 directions). */
export function walkRowForFacing(facing: ArtFacing): number {
  return WALK_DIRECTIONS.indexOf(FACING_WALK_DIRECTION[facing]);
}

/** Row of the seated sheet, or column of a chair or desk sheet, for an office facing. */
export function seatedRowForFacing(facing: ArtFacing): number {
  return PACK_FACINGS.indexOf(facing);
}

export const facingColumn = seatedRowForFacing;

// --- Images ------------------------------------------------------------------------------------

/** Decoded RGBA8 image, row by row (compatible with ImageData and the exporter's PixelBuffer). */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

function cropImage(image: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/**
 * Cuts a floor motif into its nine tiles, frame `row * 3 + col` being motif
 * sub-tile (col, row), so laying them out by `floorFrameAt` repeats the whole
 * pattern instead of one tile of it.
 */
export function splitFloorMotif(motif: RgbaImage): RgbaImage[] {
  if (motif.width !== FLOOR_MOTIF_SIZE || motif.height !== FLOOR_MOTIF_SIZE) {
    throw new Error(`A floor motif is ${FLOOR_MOTIF_SIZE}x${FLOOR_MOTIF_SIZE}, got ${motif.width}x${motif.height}`);
  }
  const tiles: RgbaImage[] = [];
  for (let row = 0; row < MOTIF_TILES; row += 1) {
    for (let col = 0; col < MOTIF_TILES; col += 1) tiles.push(cropImage(motif, col * ART_TILE, row * ART_TILE, ART_TILE, ART_TILE));
  }
  return tiles;
}

/** Inverse of `splitFloorMotif`. */
export function assembleFloorMotif(tiles: readonly RgbaImage[]): RgbaImage {
  if (tiles.length !== MOTIF_TILES * MOTIF_TILES) throw new Error(`A floor motif needs ${MOTIF_TILES * MOTIF_TILES} tiles, got ${tiles.length}`);
  const data = new Uint8ClampedArray(FLOOR_MOTIF_SIZE * FLOOR_MOTIF_SIZE * 4);
  tiles.forEach((tile, index) => {
    if (tile.width !== ART_TILE || tile.height !== ART_TILE) throw new Error(`Floor tile ${index} is not ${ART_TILE}x${ART_TILE}`);
    const x0 = (index % MOTIF_TILES) * ART_TILE;
    const y0 = Math.floor(index / MOTIF_TILES) * ART_TILE;
    for (let row = 0; row < ART_TILE; row += 1) {
      data.set(tile.data.subarray(row * ART_TILE * 4, (row + 1) * ART_TILE * 4), ((y0 + row) * FLOOR_MOTIF_SIZE + x0) * 4);
    }
  });
  return { width: FLOOR_MOTIF_SIZE, height: FLOOR_MOTIF_SIZE, data };
}

/** Frame of a floor sheet to draw at world tile (tx, ty): the motif repeats every 3 tiles. */
export function floorFrameAt(tx: number, ty: number): number {
  return mod(ty, MOTIF_TILES) * MOTIF_TILES + mod(tx, MOTIF_TILES);
}

// --- Walls -------------------------------------------------------------------------------------

export interface Rect extends Point, Size {}

// --- Pack manifest -----------------------------------------------------------------------------

/**
 * Texture key of one file of a piece, as the office loads it. Here and not in
 * `artPack.ts` because the server names it too: the desk decor asset of an
 * uploaded plant points at it as its `textureKey` (#121).
 */
export function artSheetKey(pieceId: string, role: string): string {
  return `art:${pieceId}:${role}`;
}

/** `format` of `public/assets/pack/manifest.json`. */
export const ART_PACK_FORMAT = 'oficina-art-pack';

export const ART_PIECE_KINDS = ['character', 'chair', 'desk', 'floor', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table', 'door', 'sofa'] as const;
export type ArtPieceKind = (typeof ART_PIECE_KINDS)[number];

/** One PNG of a piece. Paths are relative to the manifest; `sha256` is of the file bytes. */
export interface ArtPieceFile {
  readonly role: string;
  readonly path: string;
  readonly imageKind: ArtImageKind;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

interface ArtPieceBase {
  /** Stable identity, `<kind>-<name>`. Persisted choices point here, so it never changes meaning. */
  readonly id: string;
  readonly kind: ArtPieceKind;
  /** Shown in the UI (Spanish copy). */
  readonly name: string;
  readonly author: string;
  readonly license: string;
  readonly files: readonly ArtPieceFile[];
}

export interface ArtCharacterPiece extends ArtPieceBase {
  readonly kind: 'character';
  readonly anchors: { readonly walk: Point; readonly seated: Point };
  readonly footprint: Footprint;
}

export interface ArtChairPiece extends ArtPieceBase {
  readonly kind: 'chair';
  readonly material: string;
  readonly facings: readonly ArtFacing[];
  readonly layers: readonly ChairLayer[];
  readonly anchors: { readonly seat: Point; readonly ground: Point };
  readonly footprint: Footprint;
  /**
   * Only the gamer chair takes a color, its accent (the red stripes and bolsters); it is exported in
   * `defaultColor`, like a painted desk. Absent, as on a chair uploaded before chairs had colors, means
   * not colorable.
   */
  readonly colorable?: boolean;
  readonly defaultColor?: string | null;
}

/**
 * A sofa of `seats` places (`sofaSeatsOf` its id), one per tile: `footprint`
 * is `seats` x 1 facing down (0), swapped when it is turned sideways. Its
 * `anchor` is the floor under the middle of that footprint in every cell of
 * its `SOFA` sheet, the seats a tile apart around it. Like a chair it may take
 * a color (the fabric one), exported in `defaultColor`.
 */
export interface ArtSofaPiece extends ArtPieceBase {
  readonly kind: 'sofa';
  readonly material: string;
  readonly seats: number;
  readonly facings: readonly ArtFacing[];
  readonly layers: readonly ChairLayer[];
  readonly anchor: Point;
  readonly footprint: Footprint;
  readonly colorable?: boolean;
  readonly defaultColor?: string | null;
}

/** Per facing, as offsets from the desk anchor: its depth point and where a matching chair's ground goes. */
export interface ArtDeskFacing {
  readonly footprint: Footprint;
  readonly ground: Point;
  readonly chairGround: Point;
}

export interface ArtDeskPiece extends ArtPieceBase {
  readonly kind: 'desk';
  readonly material: string;
  /** A colorable piece is exported in `defaultColor`; other colors are generated from the same model. */
  readonly colorable: boolean;
  readonly defaultColor: string | null;
  readonly anchor: Point;
  readonly facings: Readonly<Record<ArtFacing, ArtDeskFacing>>;
}

export interface ArtFloorPiece extends ArtPieceBase {
  readonly kind: 'floor';
  readonly material: string;
  readonly colorable: boolean;
  readonly defaultColor: string | null;
  readonly motifTiles: number;
}

export interface ArtWallPiece extends ArtPieceBase {
  readonly kind: 'wall';
  readonly material: string;
  readonly heightTiles: number;
  readonly topHeight: number;
  readonly translucent: boolean;
  /** Plaster takes a color of its own; a pack exported before wall colors has neither field. */
  readonly colorable?: boolean;
  readonly defaultColor?: string | null;
}

/** One terrain material of the tileset: where its band starts and the floor piece it is cut from. */
export interface ArtTilesetMaterial {
  readonly material: TerrainMaterial;
  readonly floor: string;
  readonly walkable: boolean;
  /** Index of its (phase 0, mask 0) tile; `terrainTileIndex` gives the rest. */
  readonly firstTile: number;
}

export interface ArtTilesetPiece extends ArtPieceBase {
  readonly kind: 'tileset';
  readonly tileSize: number;
  readonly columns: number;
  readonly masks: number;
  readonly phases: number;
  /** Edge variants per mask and phase, side by side in each row (`terrainTileIndex`). */
  readonly variants: number;
  readonly materials: readonly ArtTilesetMaterial[];
  readonly decals: readonly { readonly decal: TerrainDecal; readonly tile: number }[];
}

/** Map props share placement: footprint, anchor (bottom middle of the footprint), layer and collision. */
interface ArtPropPieceBase extends ArtPieceBase {
  readonly material: string;
  readonly footprint: Footprint;
  readonly anchor: Point;
  readonly layer: PropLayer;
  readonly collision: PropCollision;
}

export interface ArtTreePiece extends ArtPropPieceBase {
  readonly kind: 'tree';
  /**
   * The broadleaf tree takes a color, its leaves, exported in `defaultColor` like a painted desk.
   * Absent, as on a tree exported before trees had colors, means not colorable.
   */
  readonly colorable?: boolean;
  readonly defaultColor?: string | null;
}

export interface ArtPlantPiece extends ArtPropPieceBase {
  readonly kind: 'plant';
}

export interface ArtTablePiece extends ArtPropPieceBase {
  readonly kind: 'table';
  /** The frames of its sheet, in `TABLE_FACINGS` order; `footprint` is the horizontal one. */
  readonly facings: readonly TableFacing[];
}

export interface ArtHedgePiece extends ArtPropPieceBase {
  readonly kind: 'hedge';
  readonly height: number;
}

/** Tile rectangle relative to the top-left tile of a footprint. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ArtBridgePiece extends ArtPropPieceBase {
  readonly kind: 'bridge';
  readonly orientations: readonly BridgeOrientation[];
  /** The walkable tiles per orientation, over water too. The rest of the footprint is solid. */
  readonly deck: Readonly<Record<BridgeOrientation, TileRect>>;
}

export type ArtPropPiece = ArtTreePiece | ArtPlantPiece | ArtTablePiece | ArtHedgePiece | ArtBridgePiece;

/**
 * A door or window of the decor layer (#223, tile walls): one sheet of `DOOR`
 * frames. It stands in a wall run, never on the floor, so it states its
 * anchor (the middle of its span in its frame) and the wall tiles it spans
 * along the run: 2 for a single door or a window, 3 for a double door (#233,
 * `doorSpanOf`).
 */
export interface ArtDoorPiece extends ArtPieceBase {
  readonly kind: 'door';
  readonly material: string;
  readonly anchor: Point;
  readonly footprint: Footprint;
  readonly variant: DoorVariant;
}

export type ArtPiece =
  | ArtCharacterPiece
  | ArtChairPiece
  | ArtDeskPiece
  | ArtFloorPiece
  | ArtWallPiece
  | ArtTilesetPiece
  | ArtPropPiece
  | ArtDoorPiece
  | ArtSofaPiece;

export interface ArtPackManifest {
  readonly format: typeof ART_PACK_FORMAT;
  readonly contractVersion: number;
  readonly fileFormat: typeof ART_FILE_FORMAT;
  readonly tile: number;
  readonly author: string;
  readonly license: string;
  /** Initial choices for rows that have none yet: a new user, a desk or a space. */
  readonly defaults: { readonly character: string; readonly desk: string; readonly floor: string };
  readonly pieces: readonly ArtPiece[];
}

// --- Validation --------------------------------------------------------------------------------

export type ArtViolationCode = 'invalid-dimensions' | 'too-many-colors' | 'not-opaque' | 'background-present';

export interface ArtViolation {
  readonly code: ArtViolationCode;
  readonly message: string;
}

/** Distinct RGBA values among pixels with alpha > 0. */
export function countColors(image: RgbaImage): number {
  const colors = new Set<number>();
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a === 0) continue;
    colors.add((((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | a) >>> 0);
  }
  return colors.size;
}

function alphaAt(image: RgbaImage, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

/**
 * Checks a decoded image against its kind. Returns every violation instead of
 * the first one, so a report names all that is wrong with a file at once. A
 * wrong size stops there: the other rules read frames that would not line up.
 */
export function validateArtImage(kind: ArtImageKind, image: RgbaImage): ArtViolation[] {
  const spec: ImageSpecBase = ART_IMAGE_SPECS[kind];
  const expected = sheetSize(spec);
  if (image.width !== expected.width || image.height !== expected.height || image.data.length !== image.width * image.height * 4) {
    return [
      {
        code: 'invalid-dimensions',
        message: `${kind} must be ${expected.width}x${expected.height} RGBA, got ${image.width}x${image.height} with ${image.data.length} bytes`,
      },
    ];
  }
  const violations: ArtViolation[] = [];
  const bandHeight = (spec.colorBandRows ?? spec.rows) * spec.frame.height;
  for (let top = 0; top < image.height; top += bandHeight) {
    const colors = countColors(cropImage(image, 0, top, image.width, Math.min(bandHeight, image.height - top)));
    if (colors > spec.maxColors) {
      const where = spec.colorBandRows === undefined ? '' : ` in the band at row ${top}`;
      violations.push({ code: 'too-many-colors', message: `${kind} allows ${spec.maxColors} colors, got ${colors}${where}` });
      break;
    }
  }
  if (spec.alpha === 'opaque') {
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i] !== 255) {
        const pixel = (i - 3) / 4;
        violations.push({ code: 'not-opaque', message: `${kind} must be fully opaque; pixel (${pixel % image.width}, ${Math.floor(pixel / image.width)}) is not` });
        break;
      }
    }
  }
  if (spec.transparentCorners) {
    const { width, height } = spec.frame;
    for (let frame = 0; frame < spec.columns * spec.rows; frame += 1) {
      const x0 = (frame % spec.columns) * width;
      const y0 = Math.floor(frame / spec.columns) * height;
      const corners = [
        [x0, y0],
        [x0 + width - 1, y0],
        [x0, y0 + height - 1],
        [x0 + width - 1, y0 + height - 1],
      ] as const;
      if (corners.some(([x, y]) => alphaAt(image, x, y) !== 0)) {
        violations.push({ code: 'background-present', message: `${kind} frame ${frame} has an opaque corner: frames must not carry a background` });
        break;
      }
    }
  }
  return violations;
}
