import { describe, expect, it } from 'vitest';
import { floorFrameAt } from './artContract';
import { BLOCK_TILES, terrainSnapshot, type LayoutMaterial, type OfficeLayout } from './officeLayout';
import { terrainFloorTileData } from './terrainFloorTiles';

const PIECE = 'floor-upload-0123456789abcdef';
const OTHER = 'floor-upload-fedcba9876543210';

/** Two blocks side by side: block 0 on tiles 0-8, block 1 on tiles 9-17. */
function twoBlocks(blocks: readonly LayoutMaterial[]): OfficeLayout {
  const empty = new Array<null>(2 * BLOCK_TILES * BLOCK_TILES).fill(null);
  return { width: 2 * BLOCK_TILES, height: BLOCK_TILES, blocks: [...blocks], ground: empty, walls: empty, hedges: empty, decals: empty, props: [] };
}

describe('terrainFloorTileData (S13)', () => {
  it('lays the piece over every tile of its wood block by the repeating motif frame, and nowhere else', () => {
    const data = terrainFloorTileData(terrainSnapshot(twoBlocks(['wood', 'wood'])), new Map([[1, PIECE]]));

    expect([...data.keys()]).toEqual([PIECE]);
    const rows = data.get(PIECE)!;
    expect(rows).toHaveLength(BLOCK_TILES);
    rows.forEach((row, ty) =>
      row.forEach((frame, tx) => expect(frame).toBe(tx >= BLOCK_TILES ? floorFrameAt(tx, ty) : -1)),
    );
  });

  it('keeps one set of rows per piece', () => {
    const data = terrainFloorTileData(terrainSnapshot(twoBlocks(['wood', 'wood'])), new Map([[0, PIECE], [1, OTHER]]));

    expect([...data.keys()].sort()).toEqual([PIECE, OTHER].sort());
    expect(data.get(PIECE)![0]![0]).toBe(floorFrameAt(0, 0));
    expect(data.get(PIECE)![0]![BLOCK_TILES]).toBe(-1);
    expect(data.get(OTHER)![0]![BLOCK_TILES]).toBe(floorFrameAt(BLOCK_TILES, 0));
  });

  it('draws nothing where the block is no longer wood (a pending paint of another material hides it)', () => {
    const data = terrainFloorTileData(terrainSnapshot(twoBlocks(['grass', 'wood'])), new Map([[0, PIECE]]));

    expect(data.size).toBe(0);
  });

  it('draws nothing without floors', () => {
    expect(terrainFloorTileData(terrainSnapshot(twoBlocks(['wood', 'wood'])), new Map()).size).toBe(0);
  });

  it('ignores a block index outside the map', () => {
    expect(terrainFloorTileData(terrainSnapshot(twoBlocks(['wood', 'wood'])), new Map([[7, PIECE]])).size).toBe(0);
  });
});
