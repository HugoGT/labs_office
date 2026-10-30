import { describe, expect, it } from 'vitest';
import {
  TERRAIN_FLOOR_BASE,
  decodeTerrainFloors,
  encodeTerrainFloors,
  isTerrainFloorPieceId,
  withTerrainFloors,
} from './terrainFloors';

const A = 'floor-upload-0123456789abcdef';
const B = 'floor-upload-fedcba9876543210';

describe('terrainFloors: an uploaded floor painted on a block of wood (#121)', () => {
  it('is laid over wood, the built floor with square edges that every block can be', () => {
    expect(TERRAIN_FLOOR_BASE).toBe('wood');
  });

  it('knows an uploaded floor by its id, and nothing the pack or another kind owns', () => {
    expect(isTerrainFloorPieceId(A)).toBe(true);
    for (const other of ['floor-wood', 'plant-upload-0123456789abcdef', 'floor-upload-0123', 'floor-upload-0123456789ABCDEF', '', 3, null, undefined]) {
      expect(isTerrainFloorPieceId(other)).toBe(false);
    }
  });

  it('writes the floors as <block>:<piece> pairs sorted by block, empty for none', () => {
    expect(encodeTerrainFloors(new Map())).toBe('');
    expect(encodeTerrainFloors(new Map([[7, B], [2, A]]))).toBe(`2:${A},7:${B}`);
  });

  it('reads them back, and refuses the whole string unless every entry is valid on its own block below the count', () => {
    expect(decodeTerrainFloors('', 10)).toEqual(new Map());
    expect(decodeTerrainFloors(`2:${A},7:${B}`, 10)).toEqual(new Map([[2, A], [7, B]]));
    expect(decodeTerrainFloors(`10:${A}`, 10)).toBeNull();
    expect(decodeTerrainFloors(`2:${A},2:${B}`, 10)).toBeNull();
    expect(decodeTerrainFloors('2:floor-wood', 10)).toBeNull();
    expect(decodeTerrainFloors('2', 10)).toBeNull();
    expect(decodeTerrainFloors(null, 10)).toBeNull();
  });

  it('lets an edit set the whole look of its block: the floor stays only on wood, any other edit clears it', () => {
    const before = new Map([[1, A], [2, A], [3, B]]);

    const after = withTerrainFloors(before, [
      { index: 1, material: 'wood', floor: B },
      { index: 2, material: 'wood' },
      { index: 3, material: 'grass' },
      { index: 4, material: 'water', floor: A },
      { index: 5, material: 'wood', floor: A },
    ]);

    expect(after).toEqual(new Map([[1, B], [5, A]]));
    expect(before).toEqual(new Map([[1, A], [2, A], [3, B]]));
  });
});
