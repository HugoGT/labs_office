/**
 * Where a pack piece lands in the world (art migration, step 4). Pure
 * geometry over `artContract.ts`: no Phaser, so it is tested under jsdom and
 * the scene only copies these numbers into game objects.
 *
 * Every piece is drawn at its native size (one PNG pixel, one world pixel) and
 * positioned by its anchor, never stretched to a logical area: a 3x3 tile desk
 * area holds a 64px desk, not a 96px one. Facings pick an exported column of
 * the sheet instead of rotating a perspective drawing.
 */

import {
  CHAIR,
  DESK,
  facingColumn,
  type ArtChairPiece,
  type ArtDeskPiece,
  type ArtFacing,
  type Point,
} from './artContract';
import { GROUND, MAP_H, MAP_W, TILE, type GroundCode } from './mapData';
import type { TerrainGrid } from './terrainGrid';

/**
 * Facing of every desk until desks store one: the sitter looks down, toward
 * the viewer, so their face shows and the desk sits in front of them. Desks
 * have no persisted facing (step 3 stores material and color only).
 */
export const DEFAULT_DESK_FACING: ArtFacing = 'down';

/** A frame of a spritesheet placed in the world: top-left corner, size, frame index and y-sort point. */
export interface SpritePlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly depthY: number;
}

export interface DeskPlacement extends SpritePlacement {
  /** Where the ground point of a matching chair goes (step 6 seats people there). */
  readonly chairGround: Point;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A piece stands in the middle of its footprint. */
export function footprintAnchor(rect: PixelRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** An assignable desk (a 3x3 tile area) holds its desk in the middle. */
export const deskAreaAnchor = footprintAnchor;

export function deskPlacement(piece: ArtDeskPiece, facing: ArtFacing, anchor: Point): DeskPlacement {
  const { ground, chairGround } = piece.facings[facing];
  return {
    x: anchor.x - piece.anchor.x,
    y: anchor.y - piece.anchor.y,
    width: DESK.frame.width,
    height: DESK.frame.height,
    frame: facingColumn(facing),
    depthY: anchor.y + ground.y,
    chairGround: { x: anchor.x + chairGround.x, y: anchor.y + chairGround.y },
  };
}

/** Both layers of a chair with no sitter; step 6 draws the sitter between them. */
export function chairPlacement(piece: ArtChairPiece, facing: ArtFacing, ground: Point): { back: SpritePlacement; front: SpritePlacement } {
  const column = facingColumn(facing);
  const back: SpritePlacement = {
    x: ground.x - piece.anchors.ground.x,
    y: ground.y - piece.anchors.ground.y,
    width: CHAIR.frame.width,
    height: CHAIR.frame.height,
    frame: column,
    depthY: ground.y,
  };
  return { back, front: { ...back, frame: CHAIR.columns + column } };
}

/**
 * Pack floor that paints each ground code of the base map, or `null` where the
 * pack has none yet (hedge, bridge, tile walls): those keep the legacy Kenney
 * frame until the map migration (step 8).
 */
const GROUND_FLOORS: Readonly<Record<GroundCode, string | null>> = {
  [GROUND.G]: 'floor-grass',
  [GROUND.GD]: null,
  [GROUND.WATER]: 'floor-water',
  [GROUND.BRIDGE]: null,
  [GROUND.FLOOR]: 'floor-plain',
  [GROUND.WOODF]: 'floor-wood',
  [GROUND.WALL]: null,
  [GROUND.CORR]: 'floor-plain',
};

export function groundFloorPiece(code: GroundCode): string | null {
  return GROUND_FLOORS[code];
}

/**
 * Tiles of a space that take its floor: its rectangle clipped to the map, less
 * walls and water. Water stays visible because it blocks the way; painting a
 * floor over it would show a walkable room where nobody can walk.
 */
export function spaceFloorTiles(space: PixelRect, grid: TerrainGrid): { tx: number; ty: number }[] {
  const x0 = Math.max(0, Math.floor(space.x / TILE));
  const y0 = Math.max(0, Math.floor(space.y / TILE));
  const x1 = Math.min(MAP_W, Math.ceil((space.x + space.w) / TILE));
  const y1 = Math.min(MAP_H, Math.ceil((space.y + space.h) / TILE));
  const tiles: { tx: number; ty: number }[] = [];
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      const code = grid.ground[ty][tx];
      if (code === GROUND.WALL || code === GROUND.WATER) continue;
      tiles.push({ tx, ty });
    }
  }
  return tiles;
}
