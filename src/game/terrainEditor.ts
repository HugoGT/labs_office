/**
 * Shapes of the terrain editor (#123 phase 2) shared by React and the scene,
 * kept free of Phaser so the sidebar can import them.
 */

import type { LayoutMaterial, WallEdit, WallPieceId } from './officeLayout';
import type { ChairEdit, ChairPieceId, SeatFacing } from './seating';

/**
 * What a map click paints: a floor on a whole 9x9 block, a wall post on one
 * grid vertex (`null`: the wall eraser), or a chair facing `facing` on one
 * tile (`null`: the chair eraser).
 */
export type TerrainBrush =
  | { readonly kind: 'floor'; readonly material: LayoutMaterial }
  | { readonly kind: 'wall'; readonly piece: WallPieceId | null }
  | { readonly kind: 'chair'; readonly piece: ChairPieceId | null; readonly facing: SeatFacing };

/** Whether two brushes paint the same thing (brushes are compared by value, not identity). */
export function sameBrush(a: TerrainBrush | null | undefined, b: TerrainBrush | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (a.kind === 'floor') return b.kind === 'floor' && a.material === b.material;
  if (a.kind === 'chair') return b.kind === 'chair' && a.piece === b.piece && a.facing === b.facing;
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
   * centered on the nearest grid vertex and reports `wallpick`; while a
   * chair (or the chair eraser) is picked it outlines the tile under the
   * pointer and reports `chairpick`.
   */
  brush: TerrainBrush | null;
  /** Paints on their way to the room, drawn over the live blocks. Drawing only, never walkability. */
  previewBlocks?: readonly LayoutMaterial[];
  /** Wall paints on their way to the room, applied in order over the live walls. Drawing only. */
  previewWalls?: readonly WallEdit[];
  /** Chair paints on their way to the room, applied in order over the live chairs. Drawing only. */
  previewChairs?: readonly ChairEdit[];
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
  const start = from ?? to;
  const dx = to.x - start.x;
  const dy = to.y - start.y;
  if (![start.x, start.y, dx, dy].every(Number.isFinite)) return [];
  const steps = Math.max(1, Math.ceil((Math.hypot(dx, dy) * STROKE_SAMPLES_PER_CELL) / grid.cellSize));
  const cells: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const cell = cellAt(grid, start.x + (dx * step) / steps, start.y + (dy * step) / steps);
    if (cell !== null && !cells.includes(cell)) cells.push(cell);
  }
  return cells;
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
