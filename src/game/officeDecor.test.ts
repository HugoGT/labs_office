import { describe, expect, it } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import {
  DECOR_ROTATIONS,
  MAX_DECOR_EDITS,
  decodeOfficeDecor,
  decorChairFacing,
  decorChairs,
  decorFootprint,
  decorItemCovering,
  decorInfoFromPieceId,
  decorPieceInfo,
  decorTiles,
  encodeOfficeDecor,
  findDecorOverlap,
  fitsInsideDesk,
  isDecorPieceId,
  isDecorRotation,
  isRotatable,
  nextDecorRotation,
  withDecor,
  type DecorItem,
  type DecorPieceInfo,
} from './officeDecor';

const WIDTH = 20;
const CHAIR: DecorPieceInfo = { kind: 'chair', footprint: { w: 1, h: 1 } };
const DESK: DecorPieceInfo = { kind: 'desk', footprint: { w: 3, h: 1 } };
const PLANT: DecorPieceInfo = { kind: 'plant', footprint: { w: 1, h: 1 } };
const MEETING: DecorPieceInfo = { kind: 'table', footprint: { w: 7, h: 5 } };
const at = (tx: number, ty: number): number => ty * WIDTH + tx;

const INFO: Record<string, DecorPieceInfo> = {
  'chair-wood': CHAIR,
  'desk-wood': DESK,
  'plant-ficus': PLANT,
  'table-meeting': MEETING,
};
const infoOf = (piece: string): DecorPieceInfo | null => INFO[piece] ?? null;

describe('officeDecor: pieces', () => {
  it('reads the placeable kinds from a manifest entry, with the fixed chair and desk footprints', () => {
    const manifest = JSON.parse(exportedManifest) as { pieces: { id: string; kind: string; footprint?: { w: number; h: number } }[] };
    const byId = new Map(manifest.pieces.map((piece) => [piece.id, piece]));
    expect(decorPieceInfo(byId.get('chair-wood')!)).toEqual(CHAIR);
    expect(decorPieceInfo(byId.get('desk-wood')!)).toEqual(DESK);
    expect(decorPieceInfo(byId.get('plant-ficus')!)).toEqual(PLANT);
    expect(decorPieceInfo(byId.get('table-meeting')!)).toEqual(MEETING);
    expect(decorPieceInfo(byId.get('table-cafeteria')!)).toEqual({ kind: 'table', footprint: { w: 5, h: 3 } });
    for (const id of ['floor-wood', 'wall-brick', 'tree-oak', 'character-01']) {
      const piece = byId.get(id);
      if (piece !== undefined) expect(decorPieceInfo(piece), id).toBeNull();
    }
    expect(decorPieceInfo({ kind: 'plant' })).toBeNull();
  });

  it('falls back on the id for chairs, desk tables and plants when no catalog says, never for room tables', () => {
    expect(decorInfoFromPieceId('chair-gamer')).toEqual(CHAIR);
    expect(decorInfoFromPieceId('desk-upload-0123456789abcdef')).toEqual(DESK);
    expect(decorInfoFromPieceId('plant-upload-0123456789abcdef')).toEqual(PLANT);
    expect(decorInfoFromPieceId('table-meeting')).toBeNull();
    expect(decorInfoFromPieceId('tree-oak')).toBeNull();
  });

  it('turns only chairs and desk tables', () => {
    expect(isRotatable('chair')).toBe(true);
    expect(isRotatable('desk')).toBe(true);
    expect(isRotatable('plant')).toBe(false);
    expect(isRotatable('table')).toBe(false);
  });

  it('accepts piece ids of the art vocabulary only', () => {
    expect(isDecorPieceId('chair-wood')).toBe(true);
    expect(isDecorPieceId('plant-upload-0123456789abcdef')).toBe(true);
    for (const raw of ['', 'chair', 'Chair-wood', 'chair:wood', 'chair,wood', 'chair--wood', `plant-${'x'.repeat(100)}`, 7, null]) {
      expect(isDecorPieceId(raw), String(raw)).toBe(false);
    }
  });

  it('knows the four rotations', () => {
    expect(DECOR_ROTATIONS).toEqual([0, 90, 180, 270]);
    expect(isDecorRotation(90)).toBe(true);
    expect(isDecorRotation(45)).toBe(false);
    expect(isDecorRotation('90')).toBe(false);
  });

  it('caps one request like the chairs did', () => {
    expect(MAX_DECOR_EDITS).toBe(500);
  });
});

describe('officeDecor: footprints', () => {
  it('puts a chair on its own tile', () => {
    expect(decorFootprint({ index: at(4, 6), piece: 'chair-wood', rotation: 90 }, CHAIR, WIDTH)).toEqual({ x: 4, y: 6, w: 1, h: 1 });
  });

  it('lays a desk table along a row or a column around its middle tile', () => {
    expect(decorFootprint({ index: at(4, 6), piece: 'desk-wood', rotation: 0 }, DESK, WIDTH)).toEqual({ x: 3, y: 6, w: 3, h: 1 });
    expect(decorFootprint({ index: at(4, 6), piece: 'desk-wood', rotation: 180 }, DESK, WIDTH)).toEqual({ x: 3, y: 6, w: 3, h: 1 });
    expect(decorFootprint({ index: at(4, 6), piece: 'desk-wood', rotation: 90 }, DESK, WIDTH)).toEqual({ x: 4, y: 5, w: 1, h: 3 });
    expect(decorFootprint({ index: at(4, 6), piece: 'desk-wood', rotation: 270 }, DESK, WIDTH)).toEqual({ x: 4, y: 5, w: 1, h: 3 });
  });

  it('centers a plant or a room table on its anchor tile', () => {
    expect(decorFootprint({ index: at(4, 6), piece: 'plant-ficus', rotation: 0 }, PLANT, WIDTH)).toEqual({ x: 4, y: 6, w: 1, h: 1 });
    expect(decorFootprint({ index: at(10, 10), piece: 'table-meeting', rotation: 0 }, MEETING, WIDTH)).toEqual({ x: 7, y: 8, w: 7, h: 5 });
    expect(decorFootprint({ index: at(10, 10), piece: 'table-cafeteria', rotation: 0 }, { kind: 'table', footprint: { w: 5, h: 3 } }, WIDTH)).toEqual({ x: 8, y: 9, w: 5, h: 3 });
  });

  it('keeps an unknown piece on its anchor tile alone', () => {
    expect(decorFootprint({ index: at(2, 3), piece: 'table-gone', rotation: 0 }, null, WIDTH)).toEqual({ x: 2, y: 3, w: 1, h: 1 });
  });

  it('lists the tiles of a footprint row major', () => {
    expect(decorTiles({ index: at(4, 6), piece: 'desk-wood', rotation: 90 }, DESK, WIDTH)).toEqual([at(4, 5), at(4, 6), at(4, 7)]);
  });

  it('fits a footprint inside a desk only when every tile is in it', () => {
    const desk = { x: 3, y: 5, w: 3, h: 3 };
    expect(fitsInsideDesk({ x: 3, y: 7, w: 3, h: 1 }, desk)).toBe(true);
    expect(fitsInsideDesk({ x: 5, y: 5, w: 1, h: 3 }, desk)).toBe(true);
    expect(fitsInsideDesk({ x: 4, y: 7, w: 3, h: 1 }, desk)).toBe(false);
    expect(fitsInsideDesk({ x: 2, y: 5, w: 1, h: 1 }, desk)).toBe(false);
  });
});

describe('officeDecor: overlap and covering', () => {
  it('finds the first item whose footprint overlaps an earlier one', () => {
    const items: DecorItem[] = [
      { index: at(4, 6), piece: 'desk-wood', rotation: 0 },
      { index: at(4, 5), piece: 'chair-wood', rotation: 0 },
      { index: at(5, 6), piece: 'plant-ficus', rotation: 0 },
    ];
    expect(findDecorOverlap(items, infoOf, WIDTH)).toBe(at(5, 6));
    expect(findDecorOverlap(items.slice(0, 2), infoOf, WIDTH)).toBeNull();
  });

  it('finds the item covering a tile, a footprint tile included', () => {
    const items: DecorItem[] = [
      { index: at(10, 10), piece: 'table-meeting', rotation: 0 },
      { index: at(2, 2), piece: 'chair-wood', rotation: 0 },
    ];
    expect(decorItemCovering(items, infoOf, WIDTH, at(7, 8))).toEqual(items[0]);
    expect(decorItemCovering(items, infoOf, WIDTH, at(2, 2))).toEqual(items[1]);
    expect(decorItemCovering(items, infoOf, WIDTH, at(6, 8))).toBeNull();
  });
});

describe('officeDecor: rotation', () => {
  it('turns down, left, up, right one way and back the other', () => {
    expect(nextDecorRotation(0, 1)).toBe(270);
    expect(nextDecorRotation(270, 1)).toBe(180);
    expect(nextDecorRotation(180, 1)).toBe(90);
    expect(nextDecorRotation(90, 1)).toBe(0);
    expect(nextDecorRotation(0, -1)).toBe(90);
    expect(nextDecorRotation(90, -1)).toBe(180);
  });

  it('reads a chair rotation as its facing: 0 down, 90 right, 180 up, 270 left', () => {
    expect(decorChairFacing(0)).toBe('down');
    expect(decorChairFacing(90)).toBe('right');
    expect(decorChairFacing(180)).toBe('up');
    expect(decorChairFacing(270)).toBe('left');
  });
});

describe('officeDecor: edits and wire form', () => {
  it('applies edits in order, sorted by tile', () => {
    const placed = withDecor([], [
      { index: 9, item: { piece: 'chair-wood', rotation: 0 } },
      { index: 2, item: { piece: 'plant-ficus', rotation: 0 } },
    ]);
    expect(placed.map(({ index }) => index)).toEqual([2, 9]);
    const replaced = withDecor(placed, [{ index: 9, item: { piece: 'desk-wood', rotation: 90 } }, { index: 2, item: null }, { index: 50, item: null }]);
    expect(replaced).toEqual([{ index: 9, piece: 'desk-wood', rotation: 90 }]);
  });

  it('round-trips the wire string and refuses anything malformed', () => {
    const tiles = WIDTH * WIDTH;
    const items: DecorItem[] = [
      { index: 3, piece: 'chair-wood', rotation: 270 },
      { index: 40, piece: 'plant-upload-0123456789abcdef', rotation: 0 },
    ];
    const encoded = encodeOfficeDecor(items);
    expect(encoded).toBe('3:chair-wood:270,40:plant-upload-0123456789abcdef:0');
    expect(decodeOfficeDecor(encoded, tiles)).toEqual(items);
    expect(encodeOfficeDecor([])).toBe('');
    expect(decodeOfficeDecor('', tiles)).toEqual([]);
    for (const garbage of ['3', '3:chair-wood', '3:chair-wood:45', `${tiles}:chair-wood:0`, '3:chair-wood:0,3:plant-ficus:0', '3:Chair:0', '-1:chair-wood:0']) {
      expect(decodeOfficeDecor(garbage, tiles), garbage).toBeNull();
    }
    expect(decodeOfficeDecor(42, tiles)).toBeNull();
  });

  it('derives the seats of the decor: every chair piece, facing its rotation', () => {
    const items: DecorItem[] = [
      { index: 3, piece: 'chair-wood', rotation: 90 },
      { index: 4, piece: 'desk-wood', rotation: 0 },
      { index: 7, piece: 'chair-gamer', rotation: 180 },
    ];
    expect(decorChairs(items)).toEqual([
      { index: 3, piece: 'chair-wood', facing: 'right' },
      { index: 7, piece: 'chair-gamer', facing: 'up' },
    ]);
  });
});
