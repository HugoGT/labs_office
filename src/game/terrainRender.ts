/**
 * What the map draws, as plain numbers (art migration, step 8): tilemap layer
 * data for the terrain and its decals, and the sprites of walls and hedges.
 * No Phaser, so it is tested under jsdom; `mapBuilder.ts` copies these into
 * tilemap layers and images.
 */

import {
  bridgeFrameIndex,
  hedgeFrameIndex,
  terrainDecalIndex,
  terrainLayerData,
  wallBodyRect,
  wallFrameIndex,
  wallJointRect,
  type Rect,
  type TerrainMaterial,
} from './artContract';
import { LAYOUT_MATERIALS, terrainMaterialAt, type LayoutMaterial, type LayoutProp, type OfficeLayout, type TerrainSnapshot } from './officeLayout';

/**
 * The color of the void: the camera background around and under the world,
 * the minimap's too, and the void tile of the flat fallback. Void is drawn as
 * nothing, so an unbuilt map reads as one black screen around its terrain.
 */
export const VOID_COLOR = 0x000000;

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
 * void a material simply ends on its own edge, over the black background.
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
  readonly part: 'joint' | 'body';
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  /** Bottom edge of the piece: what it y-sorts by. */
  readonly depthY: number;
}

/** Connection bits of walls and hedges, like the pack's joint masks. */
const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

function neighborMask(cells: readonly (string | null)[], width: number, height: number, tx: number, ty: number): number {
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && cells[y * width + x] !== null;
  return (at(tx, ty - 1) ? NORTH : 0) | (at(tx + 1, ty) ? EAST : 0) | (at(tx, ty + 1) ? SOUTH : 0) | (at(tx - 1, ty) ? WEST : 0);
}

/**
 * The sprites of a wall grid: the layout's, or the live walls of a snapshot
 * (painted walls). Each entry is a post on the top-left vertex of its tile,
 * drawn on the pack's own geometry: the joint centered on the vertex, the
 * bodies along the grid lines to its neighbors, so a wall sits on the edge
 * between two terrains, half on each. They draw exactly the rectangles the
 * wall blocks (`wallFootprintRects`).
 */
export function wallSprites({ width, height, walls }: Pick<OfficeLayout, 'width' | 'height' | 'walls'>): WallSprite[] {
  const joints: WallSprite[] = [];
  const bodies: WallSprite[] = [];
  const sprite = (piece: string, part: WallSprite['part'], frame: number, rect: Rect): WallSprite => ({
    piece,
    part,
    frame,
    x: rect.x,
    y: rect.y,
    depthY: rect.y + rect.height,
  });
  for (let ty = 0; ty < height; ty += 1) {
    for (let tx = 0; tx < width; tx += 1) {
      const piece = walls[ty * width + tx];
      if (piece === null || piece === undefined) continue;
      const mask = neighborMask(walls, width, height, tx, ty);
      // A lone post has no joint frame (masks start at 1): it stands as a vertical body.
      const frame = mask === 0 ? wallFrameIndex({ piece: 'body', axis: 'vertical' }) : wallFrameIndex({ piece: 'joint', mask });
      joints.push(sprite(piece, 'joint', frame, wallJointRect({ col: tx, row: ty })));
      if (mask & EAST) {
        bodies.push(sprite(piece, 'body', wallFrameIndex({ piece: 'body', axis: 'horizontal' }), wallBodyRect({ col: tx, row: ty, axis: 'horizontal' })));
      }
      if (mask & SOUTH) {
        bodies.push(sprite(piece, 'body', wallFrameIndex({ piece: 'body', axis: 'vertical' }), wallBodyRect({ col: tx, row: ty, axis: 'vertical' })));
      }
    }
  }
  return [...joints, ...bodies];
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
