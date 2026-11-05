/**
 * The static office layout (#4, #123 phase 1): a Tiled map, read by a pure
 * parser that the client and the server share, plus the walkability rule both
 * of them enforce.
 *
 * The map is `maps/office.json` (Tiled JSON, "Tiled map files" with CSV layer
 * data). It holds only static geometry and placements: the default terrain
 * blocks (persisted blocks replace them in #123 phase 2), tile precise
 * terrain, walls, hedges, static props and the base chairs (read by
 * `seating.ts`). Spaces, desks and decor are managed config and keep the
 * database as their source of truth.
 *
 * Layers, by name (anything else is ignored):
 *
 *   - `blocks`  tile layer, a terrain material on every tile, one material per
 *               9x9 block. Changing a block changes the render and the
 *               collisions with no other code (#123).
 *   - `ground`  tile layer, optional terrain per tile that wins over its block:
 *               kept empty in the shipped block-editor map; explicit fixtures
 *               can still test legacy tile-precise geometry.
 *   - `walls`   tile layer, a `wall-*` pack piece per wall post: the entry of
 *               tile (tx, ty) stands on the grid vertex at its top-left
 *               corner, and 4-adjacent posts join along the grid line.
 *   - `hedges`  tile layer, a `hedge-*` pack piece on each solid hedge tile.
 *   - `decals`  tile layer, optional small details over the terrain (flowers,
 *               pebbles, lily pads). Drawing only; they never block.
 *   - `props`   object layer: rectangles on the tile grid whose type (class) is
 *               a pack piece id (`tree-*`, `plant-*`, `bridge-*`, `table-*`,
 *               `desk-*`). Bridges need an `orientation` property, desks may
 *               set `facing` (down by default).
 *
 * Every tile layer uses the embedded `layout-palette` tileset, whose tiles are
 * named by their type: a terrain material, a wall or hedge piece, or a decal.
 *
 * Shared with the server's Node type stripping: imports use explicit `.ts`
 * extensions and remain pure. The JSON layout is read on both sides.
 */

import officeMap from './maps/office.json' with { type: 'json' };
import { VERTICAL_DOOR, WALL, type DoorAxis, type WallFrame } from './artContract.ts';
import { AVATAR_BODY_CENTER_OFFSET, physicalBodyRect } from './avatarGeometry.ts';
import { MAP_BLOCK_TILES } from './mapData.ts';
import { boxOverlapsRects, coveredTiles, isPositionBlocked, type CollisionRect } from './pieceCollisions.ts';
export { AVATAR_BODY_CENTER_OFFSET } from './avatarGeometry.ts';

/** Same as `TILE` in mapData.ts and `ART_TILE` in artContract.ts (pinned by tests). */
export const LAYOUT_TILE = 32;
/** Side of a terrain block, in tiles (#123). */
export const BLOCK_TILES = MAP_BLOCK_TILES;

/**
 * `void`, then the `TERRAIN_MATERIALS` of artContract.ts in the same drawing
 * priority (pinned by a test). Void is "no terrain": unbuilt map, drawn as
 * nothing over a black background, and never walkable. It has no art of its
 * own, so it is not a material of the art contract.
 */
export const LAYOUT_MATERIALS = ['void', 'water', 'sand', 'dirt', 'cobblestone', 'grass', 'wood', 'tile', 'carpet'] as const;
export type LayoutMaterial = (typeof LAYOUT_MATERIALS)[number];

/** `TERRAIN_WALKABLE` of artContract.ts plus void: void and water are the terrain nobody walks on. */
export const MATERIAL_WALKABLE: Readonly<Record<LayoutMaterial, boolean>> = {
  void: false,
  water: false,
  grass: true,
  dirt: true,
  sand: true,
  cobblestone: true,
  wood: true,
  tile: true,
  carpet: true,
};

/** `TERRAIN_DECALS` of artContract.ts (pinned by a test). */
export const LAYOUT_DECALS = ['flowers-white', 'flowers-yellow', 'flowers-blue', 'clover', 'pebbles', 'mushrooms', 'leaves', 'lily-pad'] as const;
export type LayoutDecal = (typeof LAYOUT_DECALS)[number];

export const LAYOUT_PROP_KINDS = ['tree', 'plant', 'bridge', 'table', 'desk'] as const;
export type LayoutPropKind = (typeof LAYOUT_PROP_KINDS)[number];
export type LayoutFacing = 'up' | 'down' | 'left' | 'right';
export type LayoutBridgeOrientation = 'north-south' | 'east-west';

/** A static prop on its footprint, in tiles from the top-left tile. */
export interface LayoutProp {
  readonly piece: string;
  readonly kind: LayoutPropKind;
  readonly tx: number;
  readonly ty: number;
  readonly w: number;
  readonly h: number;
  /**
   * `deck`: the whole footprint is walkable over any terrain (bridges).
   * `solid`: it blocks, through its piece's collision rectangles (`pieceCollisions.ts`).
   */
  readonly collision: 'solid' | 'deck';
  readonly orientation: LayoutBridgeOrientation | null;
  readonly facing: LayoutFacing | null;
}

/** Per-tile arrays are row major, `ty * width + tx`. */
export interface OfficeLayout {
  readonly width: number;
  readonly height: number;
  /** One material per block, row major over `width / 9` x `height / 9` blocks. */
  readonly blocks: readonly LayoutMaterial[];
  readonly ground: readonly (LayoutMaterial | null)[];
  readonly walls: readonly (string | null)[];
  readonly hedges: readonly (string | null)[];
  readonly decals: readonly (LayoutDecal | null)[];
  readonly props: readonly LayoutProp[];
}

export class InvalidOfficeLayoutError extends Error {
  constructor(message: string) {
    super(`Invalid office layout: ${message}`);
    this.name = 'InvalidOfficeLayoutError';
  }
}

// --- Parsing -----------------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new InvalidOfficeLayoutError(message);
}

/** Tiled stores flips and rotations in the top bits of a gid; the layout ignores them. */
const GID_MASK = 0x0fffffff;

/** Tile names by gid, from the embedded tilesets. */
function paletteOf(map: JsonRecord): Map<number, string> {
  const palette = new Map<number, string>();
  const tilesets = Array.isArray(map.tilesets) ? map.tilesets : fail('the map has no tilesets');
  for (const tileset of tilesets) {
    if (!isRecord(tileset) || !Number.isInteger(tileset.firstgid)) fail('a tileset has no firstgid');
    if (typeof tileset.source === 'string') fail(`tileset ${tileset.source} is external; embed it in the map`);
    const tiles = Array.isArray(tileset.tiles) ? tileset.tiles : [];
    for (const tile of tiles) {
      if (!isRecord(tile) || !Number.isInteger(tile.id)) continue;
      // Tiled 1.9 saved the tile type as `class`; later versions went back to `type`.
      const name = typeof tile.type === 'string' && tile.type !== '' ? tile.type : tile.class;
      if (typeof name === 'string' && name !== '') palette.set((tileset.firstgid as number) + (tile.id as number), name);
    }
  }
  return palette;
}

function layerNamed(map: JsonRecord, name: string, type: 'tilelayer' | 'objectgroup'): JsonRecord | null {
  const layers = Array.isArray(map.layers) ? map.layers : fail('the map has no layers');
  const layer = layers.find((candidate) => isRecord(candidate) && candidate.name === name);
  if (layer === undefined) return null;
  if (!isRecord(layer) || layer.type !== type) fail(`layer ${name} must be a ${type}`);
  return layer;
}

/** The tile names of a tile layer, `null` where it is empty. */
function tileLayer(map: JsonRecord, name: string, palette: Map<number, string>, width: number, height: number): (string | null)[] | null {
  const layer = layerNamed(map, name, 'tilelayer');
  if (layer === null) return null;
  if (!Array.isArray(layer.data)) fail(`layer ${name} must be saved as CSV (Map Properties > Tile Layer Format), not compressed`);
  if (layer.data.length !== width * height) fail(`layer ${name} has ${layer.data.length} tiles, the map ${width * height}`);
  return layer.data.map((raw, index) => {
    if (!Number.isInteger(raw)) fail(`layer ${name} has a tile that is not a gid`);
    const gid = (raw as number) & GID_MASK;
    if (gid === 0) return null;
    const tile = palette.get(gid);
    if (tile === undefined) fail(`layer ${name} uses gid ${gid} at tile (${index % width}, ${Math.floor(index / width)}), which has no type`);
    return tile;
  });
}

function isMaterial(name: string): name is LayoutMaterial {
  return (LAYOUT_MATERIALS as readonly string[]).includes(name);
}

function onlyKind<T extends string>(
  tiles: readonly (string | null)[],
  layer: string,
  width: number,
  accept: (name: string) => name is T,
): (T | null)[] {
  return tiles.map((tile, index) => {
    if (tile === null || accept(tile)) return tile;
    return fail(`layer ${layer} cannot hold ${tile} (tile (${index % width}, ${Math.floor(index / width)}))`);
  });
}

const isDecal = (name: string): name is LayoutDecal => (LAYOUT_DECALS as readonly string[]).includes(name);
const isWallPiece = (name: string): name is string => name.startsWith('wall-');
const isHedgePiece = (name: string): name is string => name.startsWith('hedge-');

function blocksOf(tiles: readonly (LayoutMaterial | null)[], width: number, height: number): LayoutMaterial[] {
  const blocks: LayoutMaterial[] = [];
  for (let by = 0; by < height / BLOCK_TILES; by += 1) {
    for (let bx = 0; bx < width / BLOCK_TILES; bx += 1) {
      const first = tiles[by * BLOCK_TILES * width + bx * BLOCK_TILES];
      for (let ty = by * BLOCK_TILES; ty < (by + 1) * BLOCK_TILES; ty += 1) {
        for (let tx = bx * BLOCK_TILES; tx < (bx + 1) * BLOCK_TILES; tx += 1) {
          const tile = tiles[ty * width + tx];
          if (tile === null || tile === undefined) fail(`block (${bx}, ${by}) has an empty tile at (${tx}, ${ty}) in layer blocks`);
          if (tile !== first) fail(`block (${bx}, ${by}) mixes ${first} and ${tile} in layer blocks; a block is one material`);
        }
      }
      blocks.push(first as LayoutMaterial);
    }
  }
  return blocks;
}

function propertyOf(object: JsonRecord, name: string): unknown {
  if (!Array.isArray(object.properties)) return undefined;
  const property = object.properties.find((candidate) => isRecord(candidate) && candidate.name === name);
  return isRecord(property) ? property.value : undefined;
}

const FACINGS: readonly LayoutFacing[] = ['up', 'down', 'left', 'right'];
const ORIENTATIONS: readonly LayoutBridgeOrientation[] = ['north-south', 'east-west'];

function propOf(object: unknown, width: number, height: number): LayoutProp {
  if (!isRecord(object)) fail('an object of layer props is not an object');
  const piece = typeof object.type === 'string' && object.type !== '' ? object.type : object.class;
  if (typeof piece !== 'string' || piece === '') fail(`prop ${String(object.id)} has no piece id as its type`);
  const kind = LAYOUT_PROP_KINDS.find((candidate) => piece.startsWith(`${candidate}-`));
  if (kind === undefined) fail(`prop ${piece} is not a ${LAYOUT_PROP_KINDS.join(', ')} piece`);
  const [x, y, w, h] = [object.x, object.y, object.width, object.height].map((value) => (typeof value === 'number' ? value / LAYOUT_TILE : Number.NaN));
  if (![x, y, w, h].every((value) => Number.isInteger(value)) || w! < 1 || h! < 1) {
    fail(`prop ${piece} at (${String(object.x)}, ${String(object.y)}) is not on the 32px grid`);
  }
  if (x! < 0 || y! < 0 || x! + w! > width || y! + h! > height) fail(`prop ${piece} at tile (${x}, ${y}) is outside the map`);

  let orientation: LayoutBridgeOrientation | null = null;
  if (kind === 'bridge') {
    const raw = propertyOf(object, 'orientation');
    if (!ORIENTATIONS.includes(raw as LayoutBridgeOrientation)) fail(`bridge ${piece} at tile (${x}, ${y}) needs an orientation property (${ORIENTATIONS.join(' or ')})`);
    orientation = raw as LayoutBridgeOrientation;
  }
  let facing: LayoutFacing | null = null;
  if (kind === 'desk') {
    const raw = propertyOf(object, 'facing') ?? 'down';
    if (!FACINGS.includes(raw as LayoutFacing)) fail(`desk ${piece} at tile (${x}, ${y}) has facing ${String(raw)}`);
    facing = raw as LayoutFacing;
  }
  return { piece, kind, tx: x!, ty: y!, w: w!, h: h!, collision: kind === 'bridge' ? 'deck' : 'solid', orientation, facing };
}

/** Reads a Tiled JSON map into the layout. Throws `InvalidOfficeLayoutError` naming what is wrong. */
export function parseOfficeLayout(raw: unknown): OfficeLayout {
  if (!isRecord(raw)) fail('the map is not a JSON object');
  if (raw.orientation !== 'orthogonal' || raw.infinite === true) fail('the map must be orthogonal and finite');
  if (raw.tilewidth !== LAYOUT_TILE || raw.tileheight !== LAYOUT_TILE) fail(`tiles must be ${LAYOUT_TILE}px`);
  const { width, height } = raw;
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1) fail('the map has no size');
  const w = width as number;
  const h = height as number;
  if (w % BLOCK_TILES !== 0 || h % BLOCK_TILES !== 0) fail(`the map is ${w}x${h}; it must be whole ${BLOCK_TILES}x${BLOCK_TILES} blocks`);

  const palette = paletteOf(raw);
  const blockTiles = tileLayer(raw, 'blocks', palette, w, h) ?? fail('the map has no blocks layer');
  const blocks = blocksOf(onlyKind(blockTiles, 'blocks', w, isMaterial), w, h);
  const empty = (): null[] => new Array<null>(w * h).fill(null);
  const ground = onlyKind(tileLayer(raw, 'ground', palette, w, h) ?? empty(), 'ground', w, isMaterial);
  const walls = onlyKind(tileLayer(raw, 'walls', palette, w, h) ?? empty(), 'walls', w, isWallPiece);
  const hedges = onlyKind(tileLayer(raw, 'hedges', palette, w, h) ?? empty(), 'hedges', w, isHedgePiece);
  const decals = onlyKind(tileLayer(raw, 'decals', palette, w, h) ?? empty(), 'decals', w, isDecal);
  const propLayer = layerNamed(raw, 'props', 'objectgroup');
  const objects = propLayer !== null && Array.isArray(propLayer.objects) ? propLayer.objects : [];
  const props = objects.map((object) => propOf(object, w, h));

  return { width: w, height: h, blocks, ground, walls, hedges, decals, props };
}

// --- Terrain -----------------------------------------------------------------------------------

export function blockIndexAt(width: number, tx: number, ty: number): number {
  return Math.floor(ty / BLOCK_TILES) * (width / BLOCK_TILES) + Math.floor(tx / BLOCK_TILES);
}

/**
 * How far, in tiles, a block border may wander. A block keeps its material
 * this far from its edges, so the organic shores never reach its middle.
 */
export const BORDER_JITTER_TILES = 3;
/** Distance between the noise lattice points: the wavelength of a border's wobble is about twice this. */
const JITTER_LATTICE = 5;
/** Noise units per tile of displacement. */
const JITTER_SCALE = 15;
const JITTER_SEED_X = 0x5f3759df;
const JITTER_SEED_Y = 0x2545f491;

/** Integer hash of a lattice point, in [0, 255]. Integer math only, so every engine agrees. */
function latticeValue(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 0xff;
}

/** Smooth value noise in whole tiles, within +-BORDER_JITTER_TILES, bilinear over the lattice. */
function jitter(tx: number, ty: number, seed: number): number {
  const ix = Math.floor(tx / JITTER_LATTICE);
  const iy = Math.floor(ty / JITTER_LATTICE);
  const fx = tx - ix * JITTER_LATTICE;
  const fy = ty - iy * JITTER_LATTICE;
  const gx = JITTER_LATTICE - fx;
  const gy = JITTER_LATTICE - fy;
  const sum =
    gx * gy * latticeValue(ix, iy, seed) +
    fx * gy * latticeValue(ix + 1, iy, seed) +
    gx * fy * latticeValue(ix, iy + 1, seed) +
    fx * fy * latticeValue(ix + 1, iy + 1, seed);
  const value = sum / (JITTER_LATTICE * JITTER_LATTICE);
  // Interpolation pulls values toward the middle, so the scale is narrower
  // than 256 / 5: most tiles still move, and the far ends saturate.
  const offset = Math.round((value - 128) / JITTER_SCALE);
  return Math.min(BORDER_JITTER_TILES, Math.max(-BORDER_JITTER_TILES, offset));
}

function clampTile(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}

/**
 * Legacy lookup helper, retained for explicit historical fixtures only;
 * `terrainSnapshot` deliberately never calls it. The block of a point displaced by a smooth
 * deterministic noise, so borders between blocks wobble instead of running
 * straight along the 9x9 grid (#123: rectangles read as boxes). The data
 * stays one material per block; only the lookup bends.
 */
export function jitteredBlockMaterial(
  blocks: readonly LayoutMaterial[],
  width: number,
  height: number,
  tx: number,
  ty: number,
): LayoutMaterial {
  const sx = clampTile(tx + jitter(tx, ty, JITTER_SEED_X), width);
  const sy = clampTile(ty + jitter(tx, ty, JITTER_SEED_Y), height);
  return blocks[blockIndexAt(width, sx, sy)]!;
}

/**
 * Everything a move needs, computed once per set of blocks: the effective
 * material and walkability of every tile. Persisted blocks (#123 phase 2)
 * build a new snapshot from the same layout instead of querying anything per
 * `move`.
 */
export interface TerrainSnapshot {
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly LayoutMaterial[];
  /** The live wall post of each grid vertex (row major, the top-left corner of the tile), `null` where there is none. */
  readonly walls: readonly (string | null)[];
  /**
   * The doors standing in the walls (#223, tile walls, `doorOpenings` of
   * officeDoors.ts): the wall blocks nothing where they let people through
   * (`wallOpeningPassTiles`). Empty without doors.
   */
  readonly openings: readonly WallOpening[];
  /**
   * The placement order of the posts (#223): tiles, oldest first, only for
   * the posts painted since the layout; every other post comes before them
   * (`orderedWallPosts`). It only decides which wall is drawn over which.
   */
  readonly wallOrder: readonly number[];
  /** World rectangles the walls block (`wallFootprintRects`): what the room and Arcade collide with. */
  readonly wallRects: readonly CollisionRect[];
  /** Tiles (row major) a wall rectangle touches at all: blocked for the tile helpers. */
  readonly wallTiles: readonly boolean[];
  readonly materials: readonly LayoutMaterial[];
  /** Terrain walkability per tile: void, water and hedges block; walls do not (they block by rectangle). */
  readonly walkable: readonly boolean[];
}

/**
 * The effective walkability of each tile, in this precedence (each step
 * overrides the previous one):
 *
 *   1. Terrain: walkable unless void or water. A `ground` tile wins over its block.
 *   2. Deck props (bridges): their footprint is walkable, water included.
 *   3. Solids: hedges block, a deck under them too.
 *
 * Walls (the layout's, or the live ones an admin painted) block by their
 * footprint rectangles (`wallRects`), checked on top of the tiles. The
 * `openings` the doors make (#223) leave a passage in them; the room, the
 * client grid, Arcade and the double-click path all read this same snapshot.
 *
 * Solid props (trees, plants, tables, desks) are not stamped here: they
 * collide through their pieces' rectangles (`pieceCollisions.ts`), whose
 * default is their whole footprint, so an untouched piece blocks the same
 * tiles it always did. Outside the map nothing is walkable (`isTileWalkable`).
 */
export function terrainSnapshot(
  layout: OfficeLayout,
  blocks: readonly LayoutMaterial[] = layout.blocks,
  walls: readonly (string | null)[] = layout.walls,
  openings: readonly WallOpening[] = [],
  wallOrder: readonly number[] = [],
): TerrainSnapshot {
  const { width, height } = layout;
  const expected = (width / BLOCK_TILES) * (height / BLOCK_TILES);
  if (blocks.length !== expected) throw new InvalidOfficeLayoutError(`the map has ${expected} blocks, got ${blocks.length}`);
  if (walls.length !== width * height) throw new InvalidOfficeLayoutError(`the map has ${width * height} tiles, got ${walls.length} walls`);
  const materials: LayoutMaterial[] = [];
  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) {
      materials.push(layout.ground[ty * width + tx] ?? blocks[blockIndexAt(width, tx, ty)]!);
    }
  }
  const walkable = materials.map((material) => MATERIAL_WALKABLE[material]);
  const cover = (prop: LayoutProp, value: boolean): void => {
    for (let ty = prop.ty; ty < prop.ty + prop.h; ty += 1) {
      for (let tx = prop.tx; tx < prop.tx + prop.w; tx += 1) walkable[ty * width + tx] = value;
    }
  };
  for (const prop of layout.props) if (prop.collision === 'deck') cover(prop, true);
  layout.hedges.forEach((hedge, index) => {
    if (hedge !== null) walkable[index] = false;
  });
  const wallRects = wallFootprintRects({ width, height, walls, openings });
  return {
    width,
    height,
    blocks: [...blocks],
    walls: [...walls],
    openings: [...openings],
    wallOrder: [...wallOrder],
    wallRects,
    wallTiles: coveredTiles(wallRects, width, height),
    materials,
    walkable,
  };
}

/** Effective material of a tile; outside the map, the nearest tile's. */
export function terrainMaterialAt(snapshot: TerrainSnapshot, tx: number, ty: number): LayoutMaterial {
  return snapshot.materials[clampTile(ty, snapshot.height) * snapshot.width + clampTile(tx, snapshot.width)]!;
}

export function isTileWalkable(snapshot: TerrainSnapshot, tx: number, ty: number): boolean {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false;
  if (tx < 0 || ty < 0 || tx >= snapshot.width || ty >= snapshot.height) return false;
  return snapshot.walkable[ty * snapshot.width + tx]!;
}

/**
 * The terrain half of a move check: the body center on a walkable tile and
 * outside every wall rectangle (half open, like a tile). The room also checks
 * the pieces' rectangles (`isPositionBlocked`).
 */
export function isPositionWalkable(snapshot: TerrainSnapshot, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const tx = Math.floor((x + AVATAR_BODY_CENTER_OFFSET.x) / LAYOUT_TILE);
  const ty = Math.floor((y + AVATAR_BODY_CENTER_OFFSET.y) / LAYOUT_TILE);
  if (!isTileWalkable(snapshot, tx, ty)) return false;
  // Every move runs this: only a tile a wall touches pays for the rectangles.
  return !snapshot.wallTiles[ty * snapshot.width + tx] || !isPositionBlocked(snapshot.wallRects, x, y);
}

/** Full half-open footprint, for authoritative restoration and terrain relocation: walkable tiles, clear of every wall. */
export function isFootprintWalkable(snapshot: TerrainSnapshot, position: { x: number; y: number }): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  const body = physicalBodyRect(position);
  for (let ty = Math.floor(body.y / LAYOUT_TILE); ty < Math.ceil((body.y + body.height) / LAYOUT_TILE); ty++) {
    for (let tx = Math.floor(body.x / LAYOUT_TILE); tx < Math.ceil((body.x + body.width) / LAYOUT_TILE); tx++) {
      if (!isTileWalkable(snapshot, tx, ty)) return false;
    }
  }
  return !boxOverlapsRects(snapshot.wallRects, body);
}

// --- Block edits (#123 phase 2) ----------------------------------------------------------------

export function isLayoutMaterial(value: unknown): value is LayoutMaterial {
  return typeof value === 'string' && isMaterial(value);
}

export function blockCount(layout: Pick<OfficeLayout, 'width' | 'height'>): number {
  return (layout.width / BLOCK_TILES) * (layout.height / BLOCK_TILES);
}

/** A copy of `blocks` with block `index` set to `material`; an index off the map throws. */
export function withBlock(blocks: readonly LayoutMaterial[], index: number, material: LayoutMaterial): LayoutMaterial[] {
  if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
    throw new InvalidOfficeLayoutError(`block ${index} is not on the map`);
  }
  const next = [...blocks];
  next[index] = material;
  return next;
}

/**
 * The wire form of the blocks, a replicated string of the room state: the
 * whole list is a few hundred bytes, so an edit resends it instead of a delta.
 */
export function encodeTerrainBlocks(blocks: readonly LayoutMaterial[]): string {
  return blocks.join(',');
}

/** The blocks of a wire string, or `null` unless it holds exactly `count` known materials. */
export function decodeTerrainBlocks(raw: unknown, count: number): LayoutMaterial[] | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const parts = raw.split(',');
  if (parts.length !== count || !parts.every(isMaterial)) return null;
  return parts as LayoutMaterial[];
}

// --- Block colors (#222) -----------------------------------------------------------------------

/**
 * The terrain materials that take a color of their own, like the painted
 * desk: the colorable floors of the art pack (pinned by a test against the
 * manifest). A block of one of them without a color draws its default art.
 */
export const COLORABLE_TERRAIN_MATERIALS = ['carpet'] as const satisfies readonly LayoutMaterial[];

/** A block color: strict lower-case `#rrggbb`, the art pack's own form (like `isDecorColor`). */
const TERRAIN_COLOR = /^#[0-9a-f]{6}$/;

/**
 * The colored blocks, by block index; a block without an entry draws its
 * material's default art. Sparse and kept apart from the block list, so the
 * blocks keep their wire form and every terrain stored before #222 reads
 * the same.
 */
export type TerrainColors = ReadonlyMap<number, string>;

export function isColorableTerrainMaterial(material: LayoutMaterial): boolean {
  return (COLORABLE_TERRAIN_MATERIALS as readonly LayoutMaterial[]).includes(material);
}

export function isTerrainColor(value: unknown): value is string {
  return typeof value === 'string' && TERRAIN_COLOR.test(value);
}

/**
 * The colors after `edits`: an edit sets its block's whole look, so a color
 * it carries on a colorable material stays, and any other edit of that block
 * (another material, or no color) leaves it the default art. `colors` is
 * left alone.
 */
export function withTerrainColors(
  colors: TerrainColors,
  edits: readonly { readonly index: number; readonly material: LayoutMaterial; readonly color?: string }[],
): Map<number, string> {
  const next = new Map(colors);
  for (const { index, material, color } of edits) {
    if (color !== undefined && isColorableTerrainMaterial(material)) next.set(index, color);
    else next.delete(index);
  }
  return next;
}

/**
 * The wire form of the colors, a replicated string of the room state apart
 * from `terrainBlocks`: `<block>:<#rrggbb>` pairs sorted by block, joined by
 * `,`, empty for none.
 */
export function encodeTerrainColors(colors: TerrainColors): string {
  return [...colors].sort(([a], [b]) => a - b).map(([index, color]) => `${index}:${color}`).join(',');
}

/** The colors of a wire string, or `null` unless every entry is a valid color on a distinct block below `count`. */
export function decodeTerrainColors(raw: unknown, count: number): Map<number, string> | null {
  if (typeof raw !== 'string') return null;
  const colors = new Map<number, string>();
  if (raw === '') return colors;
  for (const part of raw.split(',')) {
    const match = /^(\d+):(#[0-9a-f]{6})$/.exec(part);
    if (match === null) return null;
    const index = Number(match[1]);
    if (index >= count || colors.has(index)) return null;
    colors.set(index, match[2] as string);
  }
  return colors;
}

/** The tiles of block `index`, top-left first. */
export function blockTileRect(width: number, index: number): { tx: number; ty: number; w: number; h: number } {
  const columns = width / BLOCK_TILES;
  return { tx: (index % columns) * BLOCK_TILES, ty: Math.floor(index / columns) * BLOCK_TILES, w: BLOCK_TILES, h: BLOCK_TILES };
}

/** The block under a world pixel, or `null` off the map. */
export function blockAtWorldPoint(layout: Pick<OfficeLayout, 'width' | 'height'>, x: number, y: number): number | null {
  const tx = Math.floor(x / LAYOUT_TILE);
  const ty = Math.floor(y / LAYOUT_TILE);
  if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height) return null;
  return blockIndexAt(layout.width, tx, ty);
}

/**
 * Tiles (row-major indexes) whose terrain is walkable in `before` and not in
 * `after`: what an edit turns into water or void. Compare snapshots so
 * explicit ground overlays, where present, are respected without ever
 * reaching neighboring blocks through jitter.
 */
export function newlyUnwalkableTiles(before: TerrainSnapshot, after: TerrainSnapshot): number[] {
  const tiles: number[] = [];
  after.materials.forEach((material, index) => {
    const previous = before.materials[index];
    if (!MATERIAL_WALKABLE[material] && previous !== undefined && MATERIAL_WALKABLE[previous]) tiles.push(index);
  });
  return tiles;
}

// --- Wall edits ---------------------------------------------------------------------------------

/**
 * The wall pieces of the art pack (pinned by a test against the manifest):
 * the only pieces the terrain editor paints, one per grid vertex.
 */
export const WALL_PIECES = ['wall-brick', 'wall-stone', 'wall-plaster'] as const;
export type WallPieceId = (typeof WALL_PIECES)[number];

/** The most wall posts one request may set: a long dragged wall is one request, never an unbounded one. */
export const MAX_WALL_EDITS = 2000;

/**
 * One post of a wall edit: a wall piece, or `null` to remove the post there.
 * `index` is row major (`ty * width + tx`) and names the grid vertex at the
 * top-left corner of tile (tx, ty). A colorable wall (plaster) may carry the
 * color it is painted in; without one it draws its default art.
 */
export interface WallEdit {
  readonly index: number;
  readonly piece: WallPieceId | null;
  readonly color?: string;
}

export function isWallPieceId(value: unknown): value is WallPieceId {
  return typeof value === 'string' && (WALL_PIECES as readonly string[]).includes(value);
}

/**
 * The wall pieces that take a color of their own, like the colorable floors:
 * the colorable walls of the art pack (pinned by a test against the manifest).
 */
export const COLORABLE_WALL_PIECES = ['wall-plaster'] as const satisfies readonly WallPieceId[];

export function isColorableWallPiece(piece: string | null): boolean {
  return piece !== null && (COLORABLE_WALL_PIECES as readonly string[]).includes(piece);
}

/**
 * The colored walls, by post (the tile a wall is placed on); a wall without
 * an entry draws its default art. Sparse and kept apart from the walls, like
 * `TerrainColors`, so the walls keep their wire form and every wall stored
 * before wall colors reads the same. Its wire form is `encodeTerrainColors`'.
 */
export type WallColors = ReadonlyMap<number, string>;

/**
 * The colors after `edits`: an edit sets its post's whole look, so a color it
 * carries on a colorable wall stays, and any other edit of that post (another
 * piece, no color, the eraser) leaves it the default art. `colors` is left alone.
 */
export function withWallColors(colors: WallColors, edits: readonly WallEdit[]): Map<number, string> {
  const next = new Map(colors);
  for (const { index, piece, color } of edits) {
    if (color !== undefined && isColorableWallPiece(piece)) next.set(index, color);
    else next.delete(index);
  }
  return next;
}

/** A copy of `walls` with every edit applied in order; a tile off the map throws. */
export function withWalls(walls: readonly (string | null)[], edits: readonly WallEdit[]): (string | null)[] {
  const next = [...walls];
  for (const { index, piece } of edits) {
    if (!Number.isInteger(index) || index < 0 || index >= next.length) throw new InvalidOfficeLayoutError(`tile ${index} is not on the map`);
    next[index] = piece;
  }
  return next;
}

/**
 * A door standing in a tile wall (#223, tile walls): `axis` is the run it
 * stands in, (tx, ty) the wall tile of its first column (horizontal) or row
 * (vertical), and it spans `span` wall tiles from there. officeDoors.ts
 * makes them from the decor layer (`doorOpenings`); this module only cuts
 * the walls by them.
 */
export interface WallOpening {
  readonly axis: DoorAxis;
  readonly tx: number;
  readonly ty: number;
  readonly span: number;
  /**
   * Pixels of wall a horizontal door leaves drawn at each end of its span
   * (`doorFrontInset`): its first and last tiles are drawn cropped to them.
   * Collisions stay by tile; the client blocks them with `doorHingeStops`.
   */
  readonly inset?: number;
}

/** The tiles (row major) of each column (horizontal) or row (vertical) of an opening's span, by `rows(tx, ty)`. */
function openingTiles({ axis, tx, ty, span }: WallOpening, width: number, height: number, rows: (y: number) => readonly number[]): number[] {
  const tiles: number[] = [];
  for (let step = 0; step < span; step += 1) {
    const [x, y] = axis === 'horizontal' ? [tx + step, ty] : [tx, ty + step];
    if (x < 0 || x >= width) continue;
    for (const row of rows(y)) if (row >= 0 && row < height) tiles.push(row * width + x);
  }
  return tiles;
}

/**
 * The tiles a door lets people through (tile walls): in a horizontal run,
 * every tile of its columns, from the wall's base up to its top (S10); in a
 * vertical run, its own tiles of the column (S9).
 */
export function wallOpeningPassTiles(opening: WallOpening, { width, height }: Pick<OfficeLayout, 'width' | 'height'>): number[] {
  const reach = Math.floor(WALL.heightTiles / 2);
  return openingTiles(opening, width, height, (y) => (opening.axis === 'horizontal' ? Array.from({ length: WALL.heightTiles }, (_, i) => y - reach + i) : [y]));
}

/**
 * The wall tiles a door takes the place of, which are not drawn (tile walls):
 * in a horizontal run the bottom two tiles of its columns, the top one
 * staying as the dark band over the wall's material (S10); in a vertical
 * run its own tiles of the column, the dark top of the run included (S9).
 */
export function wallOpeningHiddenTiles(opening: WallOpening, { width, height }: Pick<OfficeLayout, 'width' | 'height'>): number[] {
  return openingTiles(opening, width, height, (y) => (opening.axis === 'horizontal' ? [y, y + 1] : [y]));
}

/**
 * A wall grid: one wall piece or `null` per tile (the tile a wall is placed
 * on), row major, the doors standing in the walls (#223), none when absent,
 * and the placement order of the walls (`wallOrder`, tiles oldest first)
 * that decides which wall is laid over which where two materials meet.
 * Collisions never read the order.
 */
export type WallGrid = Pick<OfficeLayout, 'width' | 'height' | 'walls'> & {
  readonly openings?: readonly WallOpening[];
  readonly wallOrder?: readonly number[];
  /** The color of each colored wall, by post (`WallColors`); absent, every wall draws its default art. */
  readonly colors?: WallColors;
};

/**
 * The standing posts in placement order, oldest first. Posts `order` does not
 * list (the layout's own, or a wire string from before the order existed)
 * come first by tile; then the listed ones, a tile that has no post any more
 * or repeats being skipped.
 */
export function orderedWallPosts(walls: readonly (string | null)[], order: readonly number[] = []): number[] {
  const listed = new Set<number>();
  const placed: number[] = [];
  for (const index of order) {
    if (walls[index] == null || listed.has(index)) continue;
    listed.add(index);
    placed.push(index);
  }
  const unlisted: number[] = [];
  walls.forEach((wall, index) => {
    if (wall != null && !listed.has(index)) unlisted.push(index);
  });
  return [...unlisted, ...placed];
}

/**
 * `order` after `edits` are applied to `walls`: a post that is placed or
 * repainted goes to the end (it is the latest), a removed one leaves, and an
 * edit that sets the piece a post already holds changes nothing.
 */
export function withWallOrder(order: readonly number[], walls: readonly (string | null)[], edits: readonly WallEdit[]): number[] {
  const touched = new Map<number, WallPieceId | null>();
  for (const { index, piece } of edits) {
    if (walls[index] === piece) continue;
    touched.delete(index);
    touched.set(index, piece);
  }
  if (touched.size === 0) return [...order];
  const placed = [...touched].flatMap(([index, piece]) => (piece === null ? [] : [index]));
  return [...order.filter((index) => !touched.has(index)), ...placed];
}

/**
 * Whether the posts on vertices (tx, ty) and (nx, ny) are one wall: both on
 * the map and both standing, whatever their material (#223). Walls of two
 * materials meet as one, the later laid over the earlier when drawn
 * (`wallSprites`), and block as one.
 */
export function wallsJoin({ width, height, walls }: WallGrid, tx: number, ty: number, nx: number, ny: number): boolean {
  const standing = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && walls[y * width + x] != null;
  return standing(tx, ty) && standing(nx, ny);
}

/**
 * One vertical stretch of wall tiles in column `tx`, rows `top` to `bottom`:
 * tiles some wall covers (`wallTiles`), with none right above or below. Its
 * face belongs to the lowest wall of the stretch, `piece` at `base`.
 */
export interface WallStretch {
  readonly tx: number;
  readonly top: number;
  readonly bottom: number;
  readonly base: number;
  readonly piece: string;
  /** The color of the wall at `base`, when it has one (`WallGrid.colors`). */
  readonly color?: string;
}

/**
 * The tiles (row major) the wall placed on `index` covers: that tile and the
 * ones above and below it, clipped to the map. A wall is a column one tile
 * wide and `WALL.heightTiles` tall, centered on the tile it is placed on.
 */
export function wallPostTiles({ width, height }: Pick<OfficeLayout, 'width' | 'height'>, index: number): number[] {
  const tx = index % width;
  const ty = Math.floor(index / width);
  const reach = Math.floor(WALL.heightTiles / 2);
  const tiles: number[] = [];
  for (let y = ty - reach; y <= ty + reach; y += 1) if (y >= 0 && y < height) tiles.push(y * width + tx);
  return tiles;
}

/**
 * The wall the eraser takes from `tile`, or `null`: a wall covers the tile it
 * stands on and the ones above and below it, and the one standing on `tile`
 * itself comes first. What a click takes and what the box outlines.
 */
export function wallPostUnder({ width, height }: Pick<OfficeLayout, 'width' | 'height'>, tile: number, standing: (index: number) => boolean): number | null {
  return [tile, tile - width, tile + width].find((index) => index >= 0 && index < width * height && standing(index)) ?? null;
}

/** Every vertical stretch of wall tiles, column by column, top to bottom. */
export function wallStretches({ width, height, walls, colors }: WallGrid): WallStretch[] {
  const covered = new Array<boolean>(width * height).fill(false);
  walls.forEach((wall, index) => {
    if (wall != null) for (const tile of wallPostTiles({ width, height }, index)) covered[tile] = true;
  });
  const stretches: WallStretch[] = [];
  for (let tx = 0; tx < width; tx += 1) {
    for (let ty = 0; ty < height; ty += 1) {
      if (!covered[ty * width + tx]) continue;
      const top = ty;
      while (ty + 1 < height && covered[(ty + 1) * width + tx]) ty += 1;
      let base = ty;
      while (walls[base * width + tx] == null) base -= 1;
      const color = colors?.get(base * width + tx);
      stretches.push({ tx, top, bottom: ty, base, piece: walls[base * width + tx]!, ...(color === undefined ? {} : { color }) });
    }
  }
  return stretches;
}

/**
 * The pixels of a tile drawn, left to right, when only part of it is
 * (`WallTileFrame.crop`), and its rows from the top (all when `h` is absent).
 */
export interface WallTileCrop {
  readonly x: number;
  readonly w: number;
  readonly h?: number;
}

/**
 * One tile of a wall stretch with the frame it shows; `depthY` is the bottom
 * edge of its stretch. `crop`, when set, is the only part of it drawn: the
 * wall left beside a door narrower than its span (`WallOpening.inset`).
 */
export interface WallTileFrame {
  readonly tx: number;
  readonly ty: number;
  readonly piece: string;
  readonly frame: WallFrame;
  readonly depthY: number;
  readonly crop?: WallTileCrop;
  /** The color its wall is drawn in (`WallStretch.color`); absent, its default art. */
  readonly color?: string;
}

/**
 * The tiles every opening of a grid hides (`wallOpeningHiddenTiles`), those it
 * lets people through (`wallOpeningPassTiles`), and among the hidden ones the
 * part still drawn of those beside a narrower door (`WallOpening.inset`).
 */
function openingTileSets(grid: WallGrid): {
  readonly hidden: ReadonlySet<number>;
  readonly verticalHidden: ReadonlySet<number>;
  readonly pass: ReadonlySet<number>;
  readonly kept: ReadonlyMap<number, WallTileCrop>;
} {
  const openings = grid.openings ?? [];
  const kept = new Map<number, WallTileCrop>();
  for (const opening of openings) {
    const inset = Math.min(opening.inset ?? 0, LAYOUT_TILE);
    if (opening.axis !== 'horizontal' || inset <= 0) continue;
    const last = opening.tx + opening.span - 1;
    for (const tile of wallOpeningHiddenTiles(opening, grid)) {
      const tx = tile % grid.width;
      if (tx === opening.tx) kept.set(tile, { x: 0, w: inset });
      else if (tx === last) kept.set(tile, { x: LAYOUT_TILE - inset, w: inset });
    }
  }
  return {
    hidden: new Set(openings.flatMap((opening) => wallOpeningHiddenTiles(opening, grid))),
    verticalHidden: new Set(openings.filter((opening) => opening.axis === 'vertical').flatMap((opening) => wallOpeningHiddenTiles(opening, grid))),
    pass: new Set(openings.flatMap((opening) => wallOpeningPassTiles(opening, grid))),
    kept,
  };
}

/**
 * The frame of every tile of every wall stretch (`wallStretches`): the
 * bottom `WALL.heightTiles` tiles show the face of the lowest wall (its
 * crown, face and base), and any tile above them, where walls stack into a
 * vertical run, is the dark top band (`cap`). A face tile with no tile of
 * the same piece (in the same color) drawn to its right ends a horizontal
 * run and takes the `End` frame, which closes the right edge; one with none
 * to its left starts it (`Start`, the left edge), and one with neither
 * stands alone (`Both`).
 *
 * A door (`grid.openings`) takes the place of the tiles it hides
 * (`wallOpeningHiddenTiles`): they are not drawn, the wall beside a door in
 * a horizontal run ends against it, and the tiles of a vertical run above a
 * door sort by the door's top instead of the run's bottom, so whoever walks
 * through it is drawn over them. The run above a door in a vertical run ends
 * there too (S14a): the `WALL.heightTiles` tiles right over the door show
 * the run's end face (`crownEnd`, `faceEnd`, `baseEnd`, the base nearest the
 * door; `Both` when nothing joins it on the left), which the door's frame
 * stands against.
 */
export function wallTileFrames(grid: WallGrid): WallTileFrame[] {
  const stretches = wallStretches(grid);
  const { hidden, verticalHidden, kept } = openingTileSets(grid);
  // A run joins walls of the same piece in the same color: plaster in two colors ends where they meet.
  const lookOf = (piece: string, color: string | undefined): string => (color === undefined ? piece : `${piece}@${color}`);
  const lookAt = new Map<number, string>();
  for (const { tx, top, bottom, piece, color } of stretches) {
    for (let ty = top; ty <= bottom; ty += 1) {
      const index = ty * grid.width + tx;
      if (!hidden.has(index) || kept.has(index)) lookAt.set(index, lookOf(piece, color));
    }
  }
  const column: readonly WallFrame[] = ['crown', 'face', 'base'];
  const tiles: WallTileFrame[] = [];
  for (const { tx, top, bottom, piece, color } of stretches) {
    const look = lookOf(piece, color);
    // Every tile of the stretch carries its piece and, when it has one, its color.
    const tinted = color === undefined ? {} : { color };
    const joinsRight = (index: number, x: number): boolean => x + 1 < grid.width && lookAt.get(index + 1) === look;
    const joinsLeft = (index: number, x: number): boolean => x > 0 && lookAt.get(index - 1) === look;
    // A face tile closes each edge no wall of its look continues: Start (left), End (right), Both.
    const edged = (frame: WallFrame, index: number, x: number, right: boolean): WallFrame => {
      const left = joinsLeft(index, x);
      if (left && right) return frame;
      return `${frame}${left ? 'End' : right ? 'Start' : 'Both'}` as WallFrame;
    };
    let depthY = (bottom + 1) * WALL.frame.height;
    // Bottom up, so a tile above a door knows it: the door's top is its depth, unless nothing is drawn below the door.
    let drawnBelow = false;
    // How many drawn tiles up from a vertical door this one is, null when there is none right under them.
    let overDoor: number | null = null;
    const drawn: WallTileFrame[] = [];
    for (let ty = bottom; ty >= top; ty -= 1) {
      const index = ty * grid.width + tx;
      const crop = kept.get(index);
      if (hidden.has(index)) {
        overDoor = verticalHidden.has(index) ? 0 : null;
        // The wall beside a narrower door is drawn, but sorts like the door's own tiles.
        if (crop !== undefined && bottom - ty < column.length) {
          drawn.push({ tx, ty, piece, frame: edged(column[column.length - 1 - (bottom - ty)]!, index, tx, joinsRight(index, tx)), depthY, crop, ...tinted });
        }
        if (drawnBelow) depthY = ty * WALL.frame.height;
        continue;
      }
      drawnBelow = true;
      if (overDoor !== null && overDoor < column.length) {
        // The base right over the door leaves its floor line out, under the door's frame and shadow (L43).
        const base = overDoor === 0 ? { crop: { x: 0, w: WALL.frame.width, h: WALL.frame.height - VERTICAL_DOOR.hidesWallBase } } : {};
        drawn.push({ tx, ty, piece, frame: edged(column[column.length - 1 - overDoor]!, index, tx, false), depthY, ...base, ...tinted });
        overDoor += 1;
        continue;
      }
      overDoor = null;
      const fromBottom = bottom - ty;
      if (fromBottom >= column.length) {
        drawn.push({ tx, ty, piece, frame: 'cap', depthY, ...tinted });
        continue;
      }
      drawn.push({ tx, ty, piece, frame: edged(column[column.length - 1 - fromBottom]!, index, tx, joinsRight(index, tx)), depthY, ...tinted });
    }
    tiles.push(...drawn.reverse());
  }
  return tiles;
}

/**
 * The world rectangles a wall grid blocks: every tile a wall covers, as one
 * rectangle per vertical stretch of them, less the tiles a door lets people
 * through (`wallOpeningPassTiles`), which split a stretch.
 */
export function wallFootprintRects(grid: WallGrid): CollisionRect[] {
  const { pass } = openingTileSets(grid);
  const rects: CollisionRect[] = [];
  for (const { tx, top, bottom } of wallStretches(grid)) {
    let start: number | null = null;
    for (let ty = top; ty <= bottom + 1; ty += 1) {
      const blocks = ty <= bottom && !pass.has(ty * grid.width + tx);
      if (blocks && start === null) start = ty;
      if (!blocks && start !== null) {
        rects.push({ x: tx * LAYOUT_TILE, y: start * LAYOUT_TILE, w: LAYOUT_TILE, h: (ty - start) * LAYOUT_TILE });
        start = null;
      }
    }
  }
  return rects;
}

/**
 * The same ground as `wallFootprintRects`, for the Arcade colliders: side by
 * side stretches with the same top and bottom merge into one rectangle, so a
 * wall is one smooth body to slide along, not a row of tile boxes whose
 * seams could snag the avatar.
 */
export function wallColliderRects(grid: WallGrid): CollisionRect[] {
  const merged: CollisionRect[] = [];
  const open = new Map<string, number>();
  for (const rect of wallFootprintRects(grid)) {
    const key = `${rect.y}:${rect.h}:${rect.x}`;
    const index = open.get(key);
    open.delete(key);
    if (index !== undefined) merged[index] = { ...merged[index]!, w: merged[index]!.w + rect.w };
    const at = index ?? merged.push(rect) - 1;
    open.set(`${rect.y}:${rect.h}:${rect.x + rect.w}`, at);
  }
  return merged;
}

const WALL_PREFIX = 'wall-';

/**
 * The wire form of the walls, a replicated string of the room state: sparse,
 * `<tile>:<material>` per wall joined by commas (`3:brick,4:brick`), empty
 * for none. A whole map of tiles would be tens of kilobytes; walls are few.
 * The entries come in placement order, oldest first (`orderedWallPosts`), so
 * the client draws the later wall over the earlier one; without an `order`
 * that is the tile order, which is also how older strings read.
 */
export function encodeTerrainWalls(walls: readonly (string | null)[], order: readonly number[] = []): string {
  const parts: string[] = [];
  for (const index of orderedWallPosts(walls, order)) {
    const wall = walls[index]!;
    if (wall.startsWith(WALL_PREFIX)) parts.push(`${index}:${wall.slice(WALL_PREFIX.length)}`);
  }
  return parts.join(',');
}

/** The walls of a wire string, one entry per tile, or `null` unless every entry is a known wall on a distinct tile of the map. */
export function decodeTerrainWalls(raw: unknown, count: number): (WallPieceId | null)[] | null {
  if (typeof raw !== 'string') return null;
  const walls = new Array<WallPieceId | null>(count).fill(null);
  if (raw === '') return walls;
  for (const part of raw.split(',')) {
    const match = /^(\d+):([a-z]+)$/.exec(part);
    if (match === null) return null;
    const index = Number(match[1]);
    const piece = `${WALL_PREFIX}${match[2]}`;
    if (index >= count || !isWallPieceId(piece) || walls[index] !== null) return null;
    walls[index] = piece;
  }
  return walls;
}

/** The tiles of a wire string in the order it lists them (placement order, oldest first), or `null` when `decodeTerrainWalls` refuses it. */
export function decodeTerrainWallOrder(raw: unknown, count: number): number[] | null {
  if (decodeTerrainWalls(raw, count) === null) return null;
  return raw === '' ? [] : (raw as string).split(',').map((part) => Number(part.slice(0, part.indexOf(':'))));
}

/** The tile under a world pixel, row major, or `null` off the map. */
export function tileAtWorldPoint(layout: Pick<OfficeLayout, 'width' | 'height'>, x: number, y: number): number | null {
  const tx = Math.floor(x / LAYOUT_TILE);
  const ty = Math.floor(y / LAYOUT_TILE);
  if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height) return null;
  return ty * layout.width + tx;
}

// --- The office --------------------------------------------------------------------------------

/** The committed layout. A broken file fails here, at load, on both sides alike. */
export const BASE_LAYOUT: OfficeLayout = parseOfficeLayout(officeMap);
/** The terrain of the committed blocks; persisted blocks replace it in #123 phase 2. */
export const BASE_TERRAIN: TerrainSnapshot = terrainSnapshot(BASE_LAYOUT);
