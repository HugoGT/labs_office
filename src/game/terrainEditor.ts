/**
 * Shapes of the terrain editor (#123 phase 2) shared by React and the scene,
 * kept free of Phaser so the sidebar can import them.
 */

import type { LayoutMaterial, TerrainColors, WallEdit, WallPieceId } from './officeLayout';
import type { DecorTileRect } from './officeDecor';
import { tileAreaRect, type TileRect } from './terrainGrid';

/**
 * What a map click paints: a floor on a whole 9x9 block, or a wall post on
 * one grid vertex (`null`: the wall eraser). A colorable floor (carpet, #222)
 * may carry the color it paints in; without one it paints the default art.
 * Chairs are decor since #208 (`decorEditor.ts`).
 */
export type TerrainBrush =
  | { readonly kind: 'floor'; readonly material: LayoutMaterial; readonly color?: string }
  | { readonly kind: 'wall'; readonly piece: WallPieceId | null };

/** Whether two brushes paint the same thing (brushes are compared by value, not identity). */
export function sameBrush(a: TerrainBrush | null | undefined, b: TerrainBrush | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (a.kind === 'floor') return b.kind === 'floor' && a.material === b.material && a.color === b.color;
  return b.kind === 'wall' && a.piece === b.piece;
}

/**
 * What the terrain editor asks the map to show while it is open. `null` (the
 * whole command) closes it. The preview is drawn for this admin only and
 * never changes collisions: the room decides once each paint is applied.
 */
export interface TerrainEditCommand {
  /**
   * The palette entry picked, or `null`. While a floor is picked the map
   * outlines the block a click would paint and reports `terrainpick`; while
   * a wall (or the wall eraser) is picked it outlines a tile-sized box
   * centered on the nearest grid vertex and reports `wallpick`.
   */
  brush: TerrainBrush | null;
  /** Paints on their way to the room, drawn over the live blocks. Drawing only, never walkability. */
  previewBlocks?: readonly LayoutMaterial[];
  /** The block colors (#222) that go with `previewBlocks`, a whole map. Absent with it: the live colors. */
  previewColors?: TerrainColors;
  /** Wall paints on their way to the room, applied in order over the live walls. Drawing only. */
  previewWalls?: readonly WallEdit[];
  /** The outlines of every room and desk, drawn over the map like "Editar espacios" does (#216). A guide only. */
  outlines?: readonly TileRect[];
  /** With the wall eraser: the posts a click would take a wall or a door from, which the box outlines in red (#241). */
  erasable?: readonly number[];
  /** With the wall eraser: the footprint of every decor piece it takes by a tile under it, outlined whole in red over the post box. */
  erasableDecor?: readonly TileRect[];
}

/** The outlines "Editar terreno" draws (#216): every desk and room, so a block or a wall is not painted blind. */
export function terrainOutlines(desks: readonly DecorTileRect[], rooms: readonly DecorTileRect[]): TileRect[] {
  return [...desks, ...rooms].map(tileAreaRect);
}

/** A grid of square cells over the world, row major from the top-left one. */
export interface StrokeGrid {
  readonly columns: number;
  readonly rows: number;
  /** Side of a cell, in world pixels. */
  readonly cellSize: number;
  /**
   * What a point picks: the cell under it (`cell`, the default), or the
   * nearest grid vertex (`vertex`), named by the cell whose top-left corner
   * it is. Wall posts stand on vertices, so a wall lands on the line between
   * two tiles.
   */
  readonly snap?: 'cell' | 'vertex';
}

/** Samples per cell along a stroke: dense enough that a stroke never steps over a cell it crosses but by a corner. */
const STROKE_SAMPLES_PER_CELL = 8;

/** The cell (or, for a vertex grid, the vertex) a world point picks, or `null` off the grid. */
function cellAt(grid: StrokeGrid, x: number, y: number): number | null {
  if (grid.snap === 'vertex') {
    // Off the world nothing; inside, the last half cell clamps onto the last vertex.
    if (x < 0 || y < 0 || x >= grid.columns * grid.cellSize || y >= grid.rows * grid.cellSize) return null;
    const col = Math.min(grid.columns - 1, Math.round(x / grid.cellSize));
    const row = Math.min(grid.rows - 1, Math.round(y / grid.cellSize));
    return row * grid.columns + col;
  }
  const col = Math.floor(x / grid.cellSize);
  const row = Math.floor(y / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) return null;
  return row * grid.columns + col;
}

/**
 * The cells a pointer stroke paints, in order and each once: the cell under a
 * press (`from` null), or every cell the segment from the previous pointer
 * position to `to` crosses (vertices it passes, for a vertex grid). A pointer
 * reports far apart positions on a fast drag, so walking the segment keeps a
 * quick stroke from skipping cells. Points off the grid paint nothing.
 */
export function cellsAlongStroke(grid: StrokeGrid, from: { x: number; y: number } | null, to: { x: number; y: number }): number[] {
  const cells: number[] = [];
  for (const point of strokeSamples(grid, from, to)) {
    const cell = cellAt(grid, point.x, point.y);
    if (cell !== null && !cells.includes(cell)) cells.push(cell);
  }
  return cells;
}

/**
 * The picks of a wall stroke: like `cellsAlongStroke` on the vertex grid,
 * with the tile under each sample, every distinct pair once. The eraser takes
 * the decor piece on that tile before the post (it covers tiles, not posts).
 */
export function postsAlongStroke(grid: StrokeGrid, from: { x: number; y: number } | null, to: { x: number; y: number }): { index: number; tile: number }[] {
  const tiles: StrokeGrid = { ...grid, snap: 'cell' };
  const picks: { index: number; tile: number }[] = [];
  for (const point of strokeSamples(grid, from, to)) {
    const index = cellAt(grid, point.x, point.y);
    const tile = cellAt(tiles, point.x, point.y);
    if (index === null || tile === null || picks.some((pick) => pick.index === index && pick.tile === tile)) continue;
    picks.push({ index, tile });
  }
  return picks;
}

/** The points a stroke samples from `from` (the press when `null`) to `to`, close enough never to step over a cell. */
function strokeSamples(grid: StrokeGrid, from: { x: number; y: number } | null, to: { x: number; y: number }): { x: number; y: number }[] {
  const start = from ?? to;
  const dx = to.x - start.x;
  const dy = to.y - start.y;
  if (![start.x, start.y, dx, dy].every(Number.isFinite)) return [];
  const steps = Math.max(1, Math.ceil((Math.hypot(dx, dy) * STROKE_SAMPLES_PER_CELL) / grid.cellSize));
  const points: { x: number; y: number }[] = [];
  for (let step = 0; step <= steps; step += 1) points.push({ x: start.x + (dx * step) / steps, y: start.y + (dy * step) / steps });
  return points;
}

/**
 * World center of the editor's outline for a picked cell: the cell's middle,
 * or the vertex itself for a vertex grid, so a cell-sized box around it sits
 * half on each side of both grid lines.
 */
export function cellOutlineCenter(grid: StrokeGrid, index: number): { x: number; y: number } {
  const offset = grid.snap === 'vertex' ? 0 : 0.5;
  return { x: ((index % grid.columns) + offset) * grid.cellSize, y: (Math.floor(index / grid.columns) + offset) * grid.cellSize };
}
