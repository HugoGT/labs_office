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
} from './artContract';
import { LAYOUT_MATERIALS, terrainMaterialAt, type LayoutProp, type OfficeLayout, type TerrainSnapshot } from './officeLayout';

/**
 * Data of the `TERRAIN_LAYER_COUNT` dual-grid layers (`[layer][cy][cx]`,
 * `-1` empty), drawn at `TERRAIN_LAYER_ORIGIN` (artContract.ts). Transitions between any two
 * neighbors come from the corner masks of `terrainLayerData`.
 */
export function terrainTileData(terrain: TerrainSnapshot): number[][][] {
  return terrainLayerData(terrain.width, terrain.height, (tx, ty) => terrainMaterialAt(terrain, tx, ty));
}

/**
 * The decal layer, on the map grid (`[ty][tx]`, `-1` empty). A decal only
 * shows on the terrain it belongs to, so a block edit that floods a lawn
 * leaves no flowers floating and a drained pond no lily pads on the grass.
 */
export function decalTileData(layout: OfficeLayout, terrain: TerrainSnapshot): number[][] {
  const rows: number[][] = [];
  for (let ty = 0; ty < layout.height; ty += 1) {
    const row: number[] = [];
    for (let tx = 0; tx < layout.width; tx += 1) {
      const decal = layout.decals[ty * layout.width + tx];
      const onWater = terrainMaterialAt(terrain, tx, ty) === 'water';
      row.push(decal === null || decal === undefined || (decal === 'lily-pad') !== onWater ? -1 : terrainDecalIndex(decal));
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
 * A layout wall is a solid tile; the pack draws walls on grid lines. Running
 * the line through the tile centers keeps the 16px wall over the tile that
 * blocks, with the joints, bodies and masks of the contract shifted half a
 * tile.
 */
const HALF_TILE = 16;

function shifted(rect: Rect): Rect {
  return { ...rect, x: rect.x + HALF_TILE, y: rect.y + HALF_TILE };
}

export function wallSprites(layout: OfficeLayout): WallSprite[] {
  const { width, height, walls } = layout;
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
      // A lone wall tile has no joint frame (masks start at 1): it stands as a post.
      const frame = mask === 0 ? wallFrameIndex({ piece: 'body', axis: 'vertical' }) : wallFrameIndex({ piece: 'joint', mask });
      joints.push(sprite(piece, 'joint', frame, shifted(wallJointRect({ col: tx, row: ty }))));
      if (mask & EAST) {
        bodies.push(sprite(piece, 'body', wallFrameIndex({ piece: 'body', axis: 'horizontal' }), shifted(wallBodyRect({ col: tx, row: ty, axis: 'horizontal' }))));
      }
      if (mask & SOUTH) {
        bodies.push(sprite(piece, 'body', wallFrameIndex({ piece: 'body', axis: 'vertical' }), shifted(wallBodyRect({ col: tx, row: ty, axis: 'vertical' }))));
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
