import { describe, expect, it } from 'vitest';
import { cellsAlongStroke, sameBrush } from './terrainEditor';

const GRID = { columns: 4, rows: 3, cellSize: 100 };

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
});
