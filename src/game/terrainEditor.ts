/**
 * Shapes of the terrain editor (#123 phase 2) shared by React and the scene,
 * kept free of Phaser so the sidebar can import them.
 */

import type { LayoutMaterial } from './officeLayout';

/**
 * What the terrain editor asks the map to show while it is open. `null` (the
 * whole command) closes it. The preview is drawn for this admin only and
 * never changes collisions: the room decides once each paint is applied.
 */
export interface TerrainEditCommand {
  /**
   * The floor picked in the palette, or `null`. While one is picked the map
   * outlines the block a click would paint; every click reports its block.
   */
  brush: LayoutMaterial | null;
  /** Paints on their way to the room, drawn over the live blocks. Drawing only, never walkability. */
  previewBlocks?: readonly LayoutMaterial[];
}

/** A grid of square cells over the world, row major from the top-left one. */
export interface StrokeGrid {
  readonly columns: number;
  readonly rows: number;
  /** Side of a cell, in world pixels. */
  readonly cellSize: number;
}

/** Samples per cell along a stroke: dense enough that a stroke never steps over a cell it crosses but by a corner. */
const STROKE_SAMPLES_PER_CELL = 8;

/**
 * The cells a pointer stroke paints, in order and each once: the cell under a
 * press (`from` null), or every cell the segment from the previous pointer
 * position to `to` crosses. A pointer reports far apart positions on a fast
 * drag, so walking the segment keeps a quick stroke from skipping cells.
 * Points off the grid paint nothing.
 */
export function cellsAlongStroke(grid: StrokeGrid, from: { x: number; y: number } | null, to: { x: number; y: number }): number[] {
  const start = from ?? to;
  const dx = to.x - start.x;
  const dy = to.y - start.y;
  if (![start.x, start.y, dx, dy].every(Number.isFinite)) return [];
  const steps = Math.max(1, Math.ceil((Math.hypot(dx, dy) * STROKE_SAMPLES_PER_CELL) / grid.cellSize));
  const cells: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const col = Math.floor((start.x + (dx * step) / steps) / grid.cellSize);
    const row = Math.floor((start.y + (dy * step) / steps) / grid.cellSize);
    if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) continue;
    const cell = row * grid.columns + col;
    if (!cells.includes(cell)) cells.push(cell);
  }
  return cells;
}
