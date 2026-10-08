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
 *   - `walls`   tile layer, a `wall-*` pack piece on each solid wall tile.
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
import { AVATAR_BODY_CENTER_OFFSET } from './avatarGeometry.ts';
export { AVATAR_BODY_CENTER_OFFSET } from './avatarGeometry.ts';

/** Same as `TILE` in mapData.ts and `ART_TILE` in artContract.ts (pinned by tests). */
export const LAYOUT_TILE = 32;
/** Side of a terrain block, in tiles (#123). */
export const BLOCK_TILES = 9;

/** `TERRAIN_MATERIALS` of artContract.ts, in the same drawing priority (pinned by a test). */
export const LAYOUT_MATERIALS = ['water', 'grass', 'dirt', 'sand', 'cobblestone', 'wood', 'tile', 'carpet'] as const;
export type LayoutMaterial = (typeof LAYOUT_MATERIALS)[number];

/** `TERRAIN_WALKABLE` of artContract.ts: water is the only terrain nobody walks on. */
export const MATERIAL_WALKABLE: Readonly<Record<LayoutMaterial, boolean>> = {
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
  readonly materials: readonly LayoutMaterial[];
  readonly walkable: readonly boolean[];
}

/**
 * The effective walkability of each tile, in this precedence (each step
 * overrides the previous one):
 *
 *   1. Terrain: walkable unless water. A `ground` tile wins over its block.
 *   2. Deck props (bridges): their footprint is walkable, water included.
 *   3. Layout solids: walls and hedges block, a deck under them too.
 *
 * Solid props (trees, plants, tables, desks) are not stamped here: they
 * collide through their pieces' rectangles (`pieceCollisions.ts`), whose
 * default is their whole footprint, so an untouched piece blocks the same
 * tiles it always did. Outside the map nothing is walkable (`isTileWalkable`).
 */
export function terrainSnapshot(layout: OfficeLayout, blocks: readonly LayoutMaterial[] = layout.blocks): TerrainSnapshot {
  const { width, height } = layout;
  const expected = (width / BLOCK_TILES) * (height / BLOCK_TILES);
  if (blocks.length !== expected) throw new InvalidOfficeLayoutError(`the map has ${expected} blocks, got ${blocks.length}`);
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
  layout.walls.forEach((wall, index) => {
    if (wall !== null) walkable[index] = false;
  });
  layout.hedges.forEach((hedge, index) => {
    if (hedge !== null) walkable[index] = false;
  });
  return { width, height, blocks: [...blocks], materials, walkable };
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

/** The terrain half of a move check; the room also checks the pieces' rectangles (`isPositionBlocked`). */
export function isPositionWalkable(snapshot: TerrainSnapshot, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return isTileWalkable(
    snapshot,
    Math.floor((x + AVATAR_BODY_CENTER_OFFSET.x) / LAYOUT_TILE),
    Math.floor((y + AVATAR_BODY_CENTER_OFFSET.y) / LAYOUT_TILE),
  );
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
 * Tiles (row-major indexes) that are water in `after` and were not in
 * `before`. Compare snapshots so explicit ground overlays, where present,
 * are respected without ever flooding neighboring blocks through jitter.
 */
export function newlyWateredTiles(before: TerrainSnapshot, after: TerrainSnapshot): number[] {
  const tiles: number[] = [];
  after.materials.forEach((material, index) => {
    if (material === 'water' && before.materials[index] !== 'water') tiles.push(index);
  });
  return tiles;
}

// --- The office --------------------------------------------------------------------------------

/** The committed layout. A broken file fails here, at load, on both sides alike. */
export const BASE_LAYOUT: OfficeLayout = parseOfficeLayout(officeMap);
/** The terrain of the committed blocks; persisted blocks replace it in #123 phase 2. */
export const BASE_TERRAIN: TerrainSnapshot = terrainSnapshot(BASE_LAYOUT);
