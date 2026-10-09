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
 * reader, whose catalog would reject the pack.
 */
export const ART_CONTRACT_VERSION = 2;

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
  /** Distance between two grid vertices: one wall segment. */
  readonly segmentLength: number;
  readonly thickness: number;
  /** Square piece centered on each vertex that holds a wall. */
  readonly jointSize: number;
  /** What is left of a segment between two joints. */
  readonly bodyLength: number;
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

/** Room tables differ in size: each piece states its footprint, up to `maxFootprint`. */
export interface TableSpec extends PropSpecBase {
  readonly kind: 'table';
  readonly maxFootprint: Footprint;
}

export interface TerrainTilesetSpec extends ImageSpecBase {
  readonly kind: 'terrain-tileset';
  readonly masks: number;
  readonly phases: number;
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
  | TableSpec;

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

/** 64px cells (2x2 tiles) fit a desk in any facing; its footprint follows the long side. */
export const DESK: DeskSpec = {
  kind: 'desk',
  frame: { width: 64, height: 64 },
  columns: PACK_FACINGS.length,
  rows: 1,
  columnOrder: PACK_FACINGS,
  anchor: { x: 32, y: 40 },
  footprintByFacing: {
    up: { w: 2, h: 1 },
    down: { w: 2, h: 1 },
    left: { w: 1, h: 2 },
    right: { w: 1, h: 2 },
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

const WALL_THICKNESS = 16;

/**
 * Walls live on the edges of the 32px grid (the art was drawn for a 96px one).
 * Every piece is 16x16: frame 0 the horizontal body, 1 the vertical body, then
 * `1 + mask` the joint whose walls leave toward the sides in `mask`.
 */
export const WALL: WallSpec = {
  kind: 'wall',
  frame: { width: WALL_THICKNESS, height: WALL_THICKNESS },
  columns: 2 + 15,
  rows: 1,
  segmentLength: ART_TILE,
  thickness: WALL_THICKNESS,
  jointSize: WALL_THICKNESS,
  bodyLength: ART_TILE - WALL_THICKNESS,
  // Glass is translucent; a wall piece covers its whole frame, so no corner rule.
  alpha: 'partial',
  transparentCorners: false,
  maxColors: MAX_COLORS_PER_IMAGE,
};

// --- Terrain (#123) ------------------------------------------------------------------------------

/**
 * The block types of the terrain, in drawing priority: where two meet, the
 * later one is drawn over the earlier one's edge. Water is the lowest, so every
 * shore is the land's edge over the water, and carpet the highest.
 */
export const TERRAIN_MATERIALS = ['water', 'sand', 'dirt', 'cobblestone', 'grass', 'wood', 'tile', 'carpet'] as const;
export type TerrainMaterial = (typeof TERRAIN_MATERIALS)[number];

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
export const TERRAIN_MASKS = 16;
/** One tileset row per motif tile: the terrain keeps the floor motif's 96px repeat. */
export const TERRAIN_PHASES = MOTIF_TILES * MOTIF_TILES;

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
 * material (TERRAIN_MATERIALS order), each row the 16 corner masks of one motif
 * phase, then one row of decals. Mask 0 is an empty tile so the index stays
 * arithmetic. Colors are capped per material band.
 */
export const TERRAIN_TILESET: TerrainTilesetSpec = {
  kind: 'terrain-tileset',
  frame: { width: ART_TILE, height: ART_TILE },
  columns: TERRAIN_MASKS,
  rows: TERRAIN_MATERIALS.length * TERRAIN_PHASES + 1,
  masks: TERRAIN_MASKS,
  phases: TERRAIN_PHASES,
  // Edge tiles are partly transparent and carry a translucent contact shadow.
  alpha: 'partial',
  transparentCorners: false,
  maxColors: MAX_COLORS_PER_IMAGE,
  colorBandRows: TERRAIN_PHASES,
};

/** Terrain layers a map needs: a cell has four corners, so at most four materials. */
export const TERRAIN_LAYER_COUNT = 4;
/**
 * World position of display cell (0, 0). The display grid sits half a tile up
 * and left of the map grid, so the corners of display cell (cx, cy) are the
 * centers of map tiles (cx - 1, cy - 1) to (cx, cy): a (w + 1) x (h + 1) layer
 * covers a w x h map.
 */
export const TERRAIN_LAYER_ORIGIN = -ART_TILE / 2;

/**
 * The material at each corner of a display cell. `null` is a corner without
 * terrain (the office layout's void): nothing is drawn for it, so the
 * materials around it edge straight over the background.
 */
export interface TerrainCorners {
  readonly nw: TerrainMaterial | null;
  readonly ne: TerrainMaterial | null;
  readonly sw: TerrainMaterial | null;
  readonly se: TerrainMaterial | null;
}

export interface TerrainLayerTile {
  readonly material: TerrainMaterial;
  readonly mask: number;
}

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

export function terrainTileIndex(material: TerrainMaterial, mask: number, phase: number): number {
  if (!Number.isInteger(mask) || mask < 1 || mask >= TERRAIN_MASKS) throw new Error(`Invalid terrain mask ${mask}`);
  if (!Number.isInteger(phase) || phase < 0 || phase >= TERRAIN_PHASES) throw new Error(`Invalid terrain phase ${phase}`);
  return (TERRAIN_MATERIALS.indexOf(material) * TERRAIN_PHASES + phase) * TERRAIN_MASKS + mask;
}

export function terrainDecalIndex(decal: TerrainDecal): number {
  return TERRAIN_MATERIALS.length * TERRAIN_PHASES * TERRAIN_MASKS + TERRAIN_DECALS.indexOf(decal);
}

/**
 * The tiles of one display cell, bottom layer first: its lowest material
 * full, then each higher material over the corners at or above it. Nesting
 * the masks means every edge blends over the material just below it.
 */
export function terrainCellLayers(corners: TerrainCorners): TerrainLayerTile[] {
  // Void ranks below every material: no layer for it, and no corner bit for it in any mask.
  const rank = (material: TerrainMaterial | null): number => (material === null ? -1 : TERRAIN_MATERIALS.indexOf(material));
  const present = [...new Set([corners.nw, corners.ne, corners.sw, corners.se])]
    .filter((material): material is TerrainMaterial => material !== null)
    .sort((a, b) => rank(a) - rank(b));
  return present.map((material) => ({
    material,
    mask: terrainCornerMask({
      nw: rank(corners.nw) >= rank(material),
      ne: rank(corners.ne) >= rank(material),
      sw: rank(corners.sw) >= rank(material),
      se: rank(corners.se) >= rank(material),
    }),
  }));
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
  const at = (tx: number, ty: number): TerrainMaterial | null => terrainAt(clamp(tx, 0, width - 1), clamp(ty, 0, height - 1));
  return { nw: at(cx - 1, cy - 1), ne: at(cx, cy - 1), sw: at(cx - 1, cy), se: at(cx, cy) };
}

/**
 * Tile data of the TERRAIN_LAYER_COUNT layers of a map, `[layer][cy][cx]`,
 * `-1` where a layer draws nothing (Phaser's empty tile), void corners
 * (`null`) included. Each layer is
 * (width + 1) x (height + 1) cells placed at TERRAIN_LAYER_ORIGIN.
 */
export function terrainLayerData(width: number, height: number, terrainAt: (tx: number, ty: number) => TerrainMaterial | null): number[][][] {
  const layers = Array.from({ length: TERRAIN_LAYER_COUNT }, () =>
    Array.from({ length: height + 1 }, () => new Array<number>(width + 1).fill(-1)),
  );
  for (let cy = 0; cy <= height; cy += 1) {
    for (let cx = 0; cx <= width; cx += 1) {
      const phase = terrainPhaseAt(cx, cy);
      terrainCellLayers(terrainCellCorners(terrainAt, width, height, cx, cy)).forEach((tile, layer) => {
        layers[layer]![cy]![cx] = terrainTileIndex(tile.material, tile.mask, phase);
      });
    }
  }
  return layers;
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

/** Meeting and cafeteria tables: one frame fits the largest, the 7x5 meeting table. */
export const TABLE: TableSpec = {
  ...PROP_BASE,
  kind: 'table',
  frame: { width: 256, height: 192 },
  anchor: { x: 128, y: 180 },
  maxFootprint: { w: 7, h: 5 },
  layer: 'sorted',
  collision: 'solid',
};

export function bridgeFrameIndex(orientation: BridgeOrientation): number {
  return BRIDGE_ORIENTATIONS.indexOf(orientation);
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

export interface GridVertex {
  readonly col: number;
  readonly row: number;
}

/** A horizontal edge runs east from its vertex, a vertical one south. */
export interface GridEdge extends GridVertex {
  readonly axis: 'horizontal' | 'vertical';
}

export interface Rect extends Point, Size {}

const HALF_THICKNESS = WALL_THICKNESS / 2;

/** World pixels of the joint centered on a vertex. */
export function wallJointRect(vertex: GridVertex): Rect {
  return {
    x: vertex.col * WALL.segmentLength - HALF_THICKNESS,
    y: vertex.row * WALL.segmentLength - HALF_THICKNESS,
    width: WALL.jointSize,
    height: WALL.jointSize,
  };
}

/** World pixels of the body between the two joints of an edge. */
export function wallBodyRect(edge: GridEdge): Rect {
  const x = edge.col * WALL.segmentLength;
  const y = edge.row * WALL.segmentLength;
  return edge.axis === 'horizontal'
    ? { x: x + HALF_THICKNESS, y: y - HALF_THICKNESS, width: WALL.bodyLength, height: WALL.thickness }
    : { x: x - HALF_THICKNESS, y: y + HALF_THICKNESS, width: WALL.thickness, height: WALL.bodyLength };
}

/** Connection mask bits: north 1, east 2, south 4, west 8. */
export type WallPiece = { readonly piece: 'body'; readonly axis: GridEdge['axis'] } | { readonly piece: 'joint'; readonly mask: number };

export function wallFrameIndex(piece: WallPiece): number {
  if (piece.piece === 'body') return piece.axis === 'horizontal' ? 0 : 1;
  if (!Number.isInteger(piece.mask) || piece.mask < 1 || piece.mask > 15) throw new Error(`Invalid wall joint mask ${piece.mask}`);
  return 1 + piece.mask;
}

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

export const ART_PIECE_KINDS = ['character', 'chair', 'desk', 'floor', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table'] as const;
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
  readonly segmentLength: number;
  readonly thickness: number;
  readonly translucent: boolean;
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
}

export interface ArtPlantPiece extends ArtPropPieceBase {
  readonly kind: 'plant';
}

export interface ArtTablePiece extends ArtPropPieceBase {
  readonly kind: 'table';
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

export type ArtPiece = ArtCharacterPiece | ArtChairPiece | ArtDeskPiece | ArtFloorPiece | ArtWallPiece | ArtTilesetPiece | ArtPropPiece;

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
