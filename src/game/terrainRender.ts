/**
 * What the map draws, as plain numbers (art migration, step 8): tilemap layer
 * data for the terrain and its decals, and the sprites of walls and hedges.
 * No Phaser, so it is tested under jsdom; `mapBuilder.ts` copies these into
 * tilemap layers and images.
 */

import {
  ART_TILE,
  TERRAIN_VOID_COLOR,
  bridgeFrameIndex,
  hedgeFrameIndex,
  terrainDecalIndex,
  terrainLayerData,
  type TerrainMaterial,
  wallFrameIndex,
} from './artContract';
import { LAYOUT_MATERIALS, terrainMaterialAt, wallOpeningHiddenTiles, wallTileFrames, type LayoutMaterial, type LayoutProp, type OfficeLayout, type TerrainSnapshot, type WallGrid, type WallTileCrop } from './officeLayout';

/**
 * The color of the void: the camera background around and under the world,
 * the minimap's too, and the void tile of the flat fallback. Next to terrain,
 * the tileset's void caps paint the same color (`TERRAIN_VOID_COLOR`), so an
 * unbuilt map reads as one black screen around its terrain.
 */
export const VOID_COLOR = TERRAIN_VOID_COLOR;

/** One flat color per material, for the tileset drawn when the pack is missing (`LAYOUT_MATERIALS` order). */
export const TERRAIN_FLAT_COLORS: Readonly<Record<LayoutMaterial, number>> = {
  void: VOID_COLOR,
  water: 0x3f78c4,
  sand: 0xd9c48c,
  dirt: 0x8d6a47,
  cobblestone: 0x8c9096,
  grass: 0x5d9b4c,
  wood: 0xa4723f,
  tile: 0xc5c9cf,
  carpet: 0x7b4f8c,
};

/** The pack material drawn on a tile, or `null` for void: nothing is drawn there. */
export function drawnTerrainAt(terrain: TerrainSnapshot, tx: number, ty: number): TerrainMaterial | null {
  const material = terrainMaterialAt(terrain, tx, ty);
  return material === 'void' ? null : material;
}

/**
 * Data of the `TERRAIN_LAYER_COUNT` dual-grid layers (`[layer][cy][cx]`,
 * `-1` empty), drawn at `TERRAIN_LAYER_ORIGIN` (artContract.ts). Transitions between any two
 * neighbors come from the corner masks of `terrainLayerData`; against the
 * void a material runs on under an opaque void cap, so its edge is the tile line.
 */
export function terrainTileData(terrain: TerrainSnapshot): number[][][] {
  return terrainLayerData(terrain.width, terrain.height, (tx, ty) => drawnTerrainAt(terrain, tx, ty));
}

/**
 * The decal layer, on the map grid (`[ty][tx]`, `-1` empty). A decal only
 * shows on the terrain it belongs to, so a block edit that floods a lawn
 * leaves no flowers floating, a drained pond no lily pads on the grass, and
 * an erased block nothing at all.
 */
export function decalTileData(layout: OfficeLayout, terrain: TerrainSnapshot): number[][] {
  const rows: number[][] = [];
  for (let ty = 0; ty < layout.height; ty += 1) {
    const row: number[] = [];
    for (let tx = 0; tx < layout.width; tx += 1) {
      const decal = layout.decals[ty * layout.width + tx];
      const material = terrainMaterialAt(terrain, tx, ty);
      const onWater = material === 'water';
      row.push(decal === null || decal === undefined || material === 'void' || (decal === 'lily-pad') !== onWater ? -1 : terrainDecalIndex(decal));
    }
    rows.push(row);
  }
  return rows;
}

/** Material index per tile (`[ty][tx]`), for the flat tileset drawn when the pack is missing. */
export function fallbackTerrainData(terrain: TerrainSnapshot): number[][] {
  const rows: number[][] = [];
  for (let ty = 0; ty < terrain.height; ty += 1) {
    const row: number[] = [];
    for (let tx = 0; tx < terrain.width; tx += 1) row.push(LAYOUT_MATERIALS.indexOf(terrainMaterialAt(terrain, tx, ty)));
    rows.push(row);
  }
  return rows;
}

export interface WallSprite {
  readonly piece: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  /**
   * What the piece y-sorts by: the bottom of its whole stretch, so a wall
   * is one block an avatar is either behind (north of it) or in front of.
   */
  readonly depthY: number;
  /** The only part of the frame drawn: the wall beside a narrower door, the base over a vertical door (`WallTileFrame.crop`). */
  readonly crop?: WallTileCrop;
  /** The color the wall is drawn in (`WallTileFrame.color`); absent, its default art. */
  readonly color?: string;
}

/** The sprite of every wall tile (`wallTileFrames`), its frame picked by tile column (`wallFrameIndex`). */
export function wallSprites(grid: WallGrid): WallSprite[] {
  return wallTileFrames(grid).map(({ tx, ty, piece, frame, depthY, crop, color }) => ({
    piece,
    frame: wallFrameIndex(frame, tx),
    x: tx * ART_TILE,
    y: ty * ART_TILE,
    depthY,
    ...(crop === undefined ? {} : { crop }),
    ...(color === undefined ? {} : { color }),
  }));
}

/**
 * The shadow a wall casts on the floor beside the ends of its run and under
 * its base, never above it: 20% opaque against the wall, fading out at
 * 0.3 tiles away.
 */
export const WALL_SHADOW = { reach: 0.3 * ART_TILE, from: 0.2, to: 0 } as const;

/** The shadow's opacity `distance` pixels from the wall, 0 past its reach. */
export function wallShadowAlpha(distance: number): number {
  if (distance < 0 || distance > WALL_SHADOW.reach) return 0;
  return WALL_SHADOW.from - (WALL_SHADOW.from - WALL_SHADOW.to) * (distance / WALL_SHADOW.reach);
}

/** A part of a wall drawn next to a shadow tile, in pixels from that tile's top-left corner. */
export interface WallShadowCaster {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A floor tile a wall shades: the drawn wall parts around it that cast onto
 * it, those to its left and right and those above it (straight or on a
 * diagonal, which round its corners). `key` names the shadow it takes, the
 * same for every tile with the same casters.
 */
export interface WallShadowTile {
  readonly tx: number;
  readonly ty: number;
  readonly casters: readonly WallShadowCaster[];
  readonly key: string;
}

/** The neighbors that cast onto a tile, as tile offsets: never the ones below it, which would shade above a wall. */
const SHADOW_CASTERS: readonly (readonly [number, number])[] = [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1]];

/**
 * Every floor tile a wall grid shades (`WALL_SHADOW`). A tile a wall covers
 * whole draws no shadow (the wall is over it), and neither does one a door
 * stands in: the door brings its own.
 */
export function wallShadowTiles(grid: WallGrid): WallShadowTile[] {
  const { width, height } = grid;
  const drawn = new Map<number, WallShadowCaster>();
  for (const { tx, ty, crop } of wallTileFrames(grid)) {
    const { x, w, h = ART_TILE } = crop ?? { x: 0, w: ART_TILE };
    drawn.set(ty * width + tx, { x, y: 0, w, h });
  }
  const doors = new Set((grid.openings ?? []).flatMap((opening) => wallOpeningHiddenTiles(opening, grid)));
  const candidates = new Set<number>();
  for (const index of drawn.keys()) {
    const tx = index % width;
    const ty = Math.floor(index / width);
    for (const [dx, dy] of SHADOW_CASTERS) {
      const x = tx - dx;
      const y = ty - dy;
      if (x >= 0 && y >= 0 && x < width && y < height) candidates.add(y * width + x);
    }
  }
  const shadows: WallShadowTile[] = [];
  for (const index of [...candidates].sort((a, b) => a - b)) {
    const own = drawn.get(index);
    if (doors.has(index) || (own !== undefined && own.w === ART_TILE && own.h === ART_TILE)) continue;
    const tx = index % width;
    const ty = Math.floor(index / width);
    const casters: WallShadowCaster[] = [];
    for (const [dx, dy] of SHADOW_CASTERS) {
      const x = tx + dx;
      const y = ty + dy;
      const part = x >= 0 && y >= 0 && x < width ? drawn.get(y * width + x) : undefined;
      if (part !== undefined) casters.push({ x: part.x + dx * ART_TILE, y: part.y + dy * ART_TILE, w: part.w, h: part.h });
    }
    if (casters.length > 0) shadows.push({ tx, ty, casters, key: casters.map(({ x, y, w, h }) => `${x},${y},${w},${h}`).join(';') });
  }
  return shadows;
}

/**
 * The opacity of every pixel of a shadow tile, row major: the shadow of the
 * nearest caster at that pixel's center, so where two walls shade one spot
 * (a room's inner corner) it is no darker than either.
 */
export function wallShadowPixels(casters: readonly WallShadowCaster[]): number[] {
  const alpha = new Array<number>(ART_TILE * ART_TILE).fill(0);
  for (let y = 0; y < ART_TILE; y += 1) {
    for (let x = 0; x < ART_TILE; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let nearest = Infinity;
      for (const caster of casters) {
        const dx = Math.max(caster.x - px, 0, px - (caster.x + caster.w));
        const dy = Math.max(caster.y - py, 0, py - (caster.y + caster.h));
        nearest = Math.min(nearest, Math.hypot(dx, dy));
      }
      alpha[y * ART_TILE + x] = wallShadowAlpha(nearest);
    }
  }
  return alpha;
}

/** Connection bits of hedges, like the pack's hedge frames. */
const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

function neighborMask(cells: readonly (string | null)[], width: number, height: number, tx: number, ty: number): number {
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && cells[y * width + x] !== null;
  return (at(tx, ty - 1) ? NORTH : 0) | (at(tx + 1, ty) ? EAST : 0) | (at(tx, ty + 1) ? SOUTH : 0) | (at(tx - 1, ty) ? WEST : 0);
}

export interface HedgeSprite {
  readonly piece: string;
  readonly frame: number;
  readonly tx: number;
  readonly ty: number;
}

/** One hedge tile each, framed by the hedges it connects to. */
export function hedgeSprites(layout: OfficeLayout): HedgeSprite[] {
  const { width, height, hedges } = layout;
  const sprites: HedgeSprite[] = [];
  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) {
      const piece = hedges[ty * width + tx];
      if (piece === null || piece === undefined) continue;
      sprites.push({ piece, frame: hedgeFrameIndex(neighborMask(hedges, width, height, tx, ty)), tx, ty });
    }
  }
  return sprites;
}

/** Frame of a prop's sheet: a bridge's orientation, the only frame of anything else. */
export function propFrame(prop: LayoutProp): number {
  return prop.kind === 'bridge' && prop.orientation !== null ? bridgeFrameIndex(prop.orientation) : 0;
}
