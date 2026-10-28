import { describe, expect, it } from 'vitest';
import { cellOutlineCenter, cellsAlongStroke, postsAlongStroke, sameBrush, terrainOutlines } from './terrainEditor';

const GRID = { columns: 4, rows: 3, cellSize: 100 };

describe('postsAlongStroke', () => {
  const VERTICES = { ...GRID, snap: 'vertex' as const };

  it('is the vertex nearest a press with the tile under it, what the eraser takes decor by', () => {
    // Past the middle of tile (1, 0): its bottom-right corner, vertex (2, 1).
    expect(postsAlongStroke(VERTICES, null, { x: 170, y: 60 })).toEqual([{ index: 6, tile: 1 }]);
  });

  it('lists every distinct vertex and tile pair a drag crosses, in order, and nothing off the grid', () => {
    expect(postsAlongStroke(VERTICES, { x: 10, y: 10 }, { x: 190, y: 10 })).toEqual([
      { index: 0, tile: 0 },
      { index: 1, tile: 0 },
      { index: 1, tile: 1 },
      { index: 2, tile: 1 },
    ]);
    expect(postsAlongStroke(VERTICES, null, { x: -5, y: 10 })).toEqual([]);
  });
});

describe('cellsAlongStroke', () => {
  it('is the cell under a press', () => {
    expect(cellsAlongStroke(GRID, null, { x: 150, y: 50 })).toEqual([1]);
  });

  it('lists every cell a fast drag crosses, in order, even when the pointer jumps several cells', () => {
    expect(cellsAlongStroke(GRID, { x: 50, y: 50 }, { x: 350, y: 50 })).toEqual([0, 1, 2, 3]);
    expect(cellsAlongStroke(GRID, { x: 50, y: 250 }, { x: 50, y: 50 })).toEqual([8, 4, 0]);
  });

  it('walks a diagonal through the cells it touches, with no repeats', () => {
    const cells = cellsAlongStroke(GRID, { x: 10, y: 10 }, { x: 290, y: 290 });
    expect(cells[0]).toBe(0);
    expect(cells.at(-1)).toBe(10);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('leaves out the part of a stroke off the grid', () => {
    expect(cellsAlongStroke(GRID, { x: -150, y: 50 }, { x: 150, y: 50 })).toEqual([0, 1]);
    expect(cellsAlongStroke(GRID, null, { x: 50, y: 400 })).toEqual([]);
    expect(cellsAlongStroke(GRID, null, { x: Number.NaN, y: 0 })).toEqual([]);
  });
});

describe('cellsAlongStroke on grid vertices (wall posts)', () => {
  const VERTICES = { ...GRID, snap: 'vertex' } as const;

  it('picks the nearest vertex, the top-left corner of the cell of the same index', () => {
    expect(cellsAlongStroke(VERTICES, null, { x: 140, y: 60 })).toEqual([5]);
    expect(cellsAlongStroke(VERTICES, null, { x: 49, y: 49 })).toEqual([0]);
    expect(cellsAlongStroke(VERTICES, null, { x: 151, y: 49 })).toEqual([2]);
  });

  it('clamps the far edge onto the last vertex and leaves points off the world out', () => {
    expect(cellsAlongStroke(VERTICES, null, { x: 380, y: 260 })).toEqual([11]);
    expect(cellsAlongStroke(VERTICES, null, { x: -1, y: 50 })).toEqual([]);
    expect(cellsAlongStroke(VERTICES, null, { x: 50, y: 300 })).toEqual([]);
    expect(cellsAlongStroke(VERTICES, null, { x: Number.NaN, y: 0 })).toEqual([]);
  });

  it('walks every vertex a fast drag passes, in order and each once', () => {
    expect(cellsAlongStroke(VERTICES, { x: 10, y: 10 }, { x: 310, y: 10 })).toEqual([0, 1, 2, 3]);
    expect(cellsAlongStroke(VERTICES, { x: 10, y: 210 }, { x: 10, y: 10 })).toEqual([8, 4, 0]);
  });
});

describe('cellOutlineCenter', () => {
  it('centers the outline on a cell, or on the vertex for a vertex grid', () => {
    expect(cellOutlineCenter(GRID, 5)).toEqual({ x: 150, y: 150 });
    expect(cellOutlineCenter({ ...GRID, snap: 'vertex' }, 5)).toEqual({ x: 100, y: 100 });
    expect(cellOutlineCenter({ ...GRID, snap: 'vertex' }, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('sameBrush', () => {
  it('compares brushes by what they paint', () => {
    expect(sameBrush({ kind: 'floor', material: 'grass' }, { kind: 'floor', material: 'grass' })).toBe(true);
    expect(sameBrush({ kind: 'floor', material: 'grass' }, { kind: 'floor', material: 'sand' })).toBe(false);
    expect(sameBrush({ kind: 'wall', piece: 'wall-brick' }, { kind: 'wall', piece: 'wall-brick' })).toBe(true);
    expect(sameBrush({ kind: 'wall', piece: null }, { kind: 'wall', piece: null })).toBe(true);
    expect(sameBrush({ kind: 'wall', piece: null }, { kind: 'wall', piece: 'wall-glass' })).toBe(false);
    expect(sameBrush({ kind: 'floor', material: 'void' }, { kind: 'wall', piece: null })).toBe(false);
    expect(sameBrush(null, undefined)).toBe(true);
    expect(sameBrush(null, { kind: 'wall', piece: null })).toBe(false);
  });

  it('tells carpet brushes of different colors apart (#222)', () => {
    expect(sameBrush({ kind: 'floor', material: 'carpet', color: '#c0392b' }, { kind: 'floor', material: 'carpet', color: '#c0392b' })).toBe(true);
    expect(sameBrush({ kind: 'floor', material: 'carpet', color: '#c0392b' }, { kind: 'floor', material: 'carpet', color: '#3c6ac8' })).toBe(false);
    expect(sameBrush({ kind: 'floor', material: 'carpet' }, { kind: 'floor', material: 'carpet', color: '#3c6ac8' })).toBe(false);
  });
});

describe('terrainOutlines (#216)', () => {
  it('is every desk and every room, as inclusive tile corners', () => {
    expect(terrainOutlines([{ x: 2, y: 3, w: 4, h: 4 }], [{ x: 20, y: 5, w: 9, h: 9 }])).toEqual([
      { x0: 2, y0: 3, x1: 5, y1: 6 },
      { x0: 20, y0: 5, x1: 28, y1: 13 },
    ]);
  });

  it('is nothing without desks or rooms', () => {
    expect(terrainOutlines([], [])).toEqual([]);
  });
});
