import { describe, expect, it } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import {
  DECOR_ROTATIONS,
  MAX_DECOR_EDITS,
  ON_TOP_KINDS,
  decorEditKey,
  decorItemKey,
  decorKey,
  decorKeyIndex,
  decorKeyLayer,
  decorLayerOf,
  diffDecor,
  fallenTopItems,
  isOnTopKind,
  topItemSupported,
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
  decorRotationFor,
  decorRotationsOf,
  decorSeats,
  isDecorSofaPiece,
  isDecorColor,
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
const TREE: DecorPieceInfo = { kind: 'tree', footprint: { w: 1, h: 1 } };
const MEETING: DecorPieceInfo = { kind: 'table', footprint: { w: 7, h: 5 } };
const at = (tx: number, ty: number): number => ty * WIDTH + tx;

const INFO: Record<string, DecorPieceInfo> = {
  'chair-wood': CHAIR,
  'desk-wood': DESK,
  'plant-bonsai': PLANT,
  'table-meeting': MEETING,
};
const infoOf = (piece: string): DecorPieceInfo | null => INFO[piece] ?? null;

describe('officeDecor: pieces', () => {
  it('reads the placeable kinds from a manifest entry, with the fixed chair and desk footprints', () => {
    const manifest = JSON.parse(exportedManifest) as { pieces: { id: string; kind: string; footprint?: { w: number; h: number } }[] };
    const byId = new Map(manifest.pieces.map((piece) => [piece.id, piece]));
    expect(decorPieceInfo(byId.get('chair-wood')!)).toEqual(CHAIR);
    expect(decorPieceInfo(byId.get('desk-wood')!)).toEqual(DESK);
    expect(decorPieceInfo(byId.get('plant-bonsai')!)).toEqual(PLANT);
    expect(decorPieceInfo(byId.get('table-meeting')!)).toEqual(MEETING);
    expect(decorPieceInfo(byId.get('table-cafeteria')!)).toEqual({ kind: 'table', footprint: { w: 5, h: 3 } });
    // A tree stands on its 1x1 base, whatever its crown covers.
    expect(decorPieceInfo(byId.get('tree-large')!)).toEqual(TREE);
    // The tree takes a color, its leaves.
    expect(decorPieceInfo(byId.get('tree-oak')!)).toEqual({ ...TREE, colorable: true });
    for (const id of ['floor-wood', 'wall-brick', 'character-01']) {
      const piece = byId.get(id);
      if (piece !== undefined) expect(decorPieceInfo(piece), id).toBeNull();
    }
    expect(decorPieceInfo({ kind: 'plant' })).toBeNull();
  });

  it('falls back on the id for chairs, desk tables, plants and trees when no catalog says, never for room tables', () => {
    expect(decorInfoFromPieceId('chair-gamer')).toEqual(CHAIR);
    expect(decorInfoFromPieceId('desk-upload-0123456789abcdef')).toEqual(DESK);
    expect(decorInfoFromPieceId('plant-upload-0123456789abcdef')).toEqual(PLANT);
    expect(decorInfoFromPieceId('table-meeting')).toBeNull();
    expect(decorInfoFromPieceId('tree-oak')).toEqual(TREE);
  });

  it('turns chairs, desk tables, room tables and plants (#121), never trees', () => {
    expect(isRotatable('chair')).toBe(true);
    expect(isRotatable('desk')).toBe(true);
    expect(isRotatable('table')).toBe(true);
    expect(isRotatable('plant')).toBe(true);
    expect(isRotatable('tree')).toBe(false);
  });

  it('turns a room table only between horizontal (0) and vertical (90): it is symmetric', () => {
    expect(decorRotationsOf('chair')).toEqual([0, 90, 180, 270]);
    expect(decorRotationsOf('desk')).toEqual([0, 90, 180, 270]);
    expect(decorRotationsOf('table')).toEqual([0, 90]);
    // A plant turns between its drawing (0) and its mirror (180) (#121).
    expect(decorRotationsOf('plant')).toEqual([0, 180]);
    expect(decorRotationFor('plant', 180)).toBe(180);
    expect(decorRotationFor('table', 180)).toBe(0);
    expect(decorRotationFor('table', 270)).toBe(90);
    expect(decorRotationFor('plant', 90)).toBe(0);
    expect(decorRotationFor('chair', 270)).toBe(270);
  });

  it('marks a colorable desk table and a colorable chair colorable, and nothing else', () => {
    expect(decorPieceInfo({ kind: 'desk', colorable: true })).toEqual({ kind: 'desk', footprint: { w: 3, h: 1 }, colorable: true });
    expect(decorPieceInfo({ kind: 'desk', colorable: false })?.colorable).toBeUndefined();
    expect(decorPieceInfo({ kind: 'chair', colorable: true })).toEqual({ kind: 'chair', footprint: { w: 1, h: 1 }, colorable: true });
    expect(decorPieceInfo({ kind: 'chair', colorable: false })?.colorable).toBeUndefined();
    expect(decorPieceInfo({ kind: 'chair' })?.colorable).toBeUndefined();
    // A plant or a room table has no color of its own, whatever a row says.
    expect(decorPieceInfo({ kind: 'plant', footprint: { w: 1, h: 1 }, colorable: true })?.colorable).toBeUndefined();
    const manifest = JSON.parse(exportedManifest) as { pieces: { id: string; kind: string; colorable?: boolean }[] };
    expect(decorPieceInfo(manifest.pieces.find((piece) => piece.id === 'desk-painted')!)?.colorable).toBe(true);
    expect(decorPieceInfo(manifest.pieces.find((piece) => piece.id === 'chair-gamer')!)?.colorable).toBe(true);
    expect(decorPieceInfo(manifest.pieces.find((piece) => piece.id === 'chair-wood')!)?.colorable).toBeUndefined();
  });

  it('takes a color only as a strict lower-case #rrggbb', () => {
    expect(isDecorColor('#4f9a8a')).toBe(true);
    for (const raw of ['#4F9A8A', '4f9a8a', '#4f9a8', '#4f9a8a0', 'red', '', null, 7]) expect(isDecorColor(raw), String(raw)).toBe(false);
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
    expect(decorFootprint({ index: at(4, 6), piece: 'plant-bonsai', rotation: 0 }, PLANT, WIDTH)).toEqual({ x: 4, y: 6, w: 1, h: 1 });
    expect(decorFootprint({ index: at(10, 10), piece: 'table-meeting', rotation: 0 }, MEETING, WIDTH)).toEqual({ x: 7, y: 8, w: 7, h: 5 });
    expect(decorFootprint({ index: at(10, 10), piece: 'table-cafeteria', rotation: 0 }, { kind: 'table', footprint: { w: 5, h: 3 } }, WIDTH)).toEqual({ x: 8, y: 9, w: 5, h: 3 });
  });

  it('stands a vertical room table (90) on the swapped footprint, centered on the same anchor', () => {
    expect(decorFootprint({ index: at(10, 10), piece: 'table-meeting', rotation: 90 }, MEETING, WIDTH)).toEqual({ x: 8, y: 7, w: 5, h: 7 });
    // A stored 180 or 270 reads as its symmetric 0 or 90.
    expect(decorFootprint({ index: at(10, 10), piece: 'table-meeting', rotation: 270 }, MEETING, WIDTH)).toEqual({ x: 8, y: 7, w: 5, h: 7 });
    expect(decorFootprint({ index: at(10, 10), piece: 'table-meeting', rotation: 180 }, MEETING, WIDTH)).toEqual({ x: 7, y: 8, w: 7, h: 5 });
    const oval: DecorPieceInfo = { kind: 'table', footprint: { w: 2, h: 1 } };
    expect(decorFootprint({ index: at(10, 10), piece: 'table-oval', rotation: 0 }, oval, WIDTH)).toEqual({ x: 9, y: 10, w: 2, h: 1 });
    expect(decorFootprint({ index: at(10, 10), piece: 'table-oval', rotation: 90 }, oval, WIDTH)).toEqual({ x: 10, y: 9, w: 1, h: 2 });
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

describe('officeDecor: seats', () => {
  it('every chair of the layer is a seat, an uploaded one too, facing its rotation', () => {
    const items: DecorItem[] = [
      { index: at(4, 5), piece: 'chair-wood', rotation: 0 },
      { index: at(6, 5), piece: 'chair-upload-0123456789abcdef', rotation: 90 },
      { index: at(8, 5), piece: 'plant-bonsai', rotation: 0 },
    ];

    expect(decorChairs(items)).toEqual([
      { index: at(4, 5), piece: 'chair-wood', facing: 'down' },
      { index: at(6, 5), piece: 'chair-upload-0123456789abcdef', facing: 'right' },
    ]);
  });
});

describe('officeDecor: painted seats', () => {
  it('a painted chair keeps its color on its seat, and an unpainted one carries none', () => {
    const items: DecorItem[] = [
      { index: at(4, 5), piece: 'chair-gamer', rotation: 0, color: '#2a9d8f' },
      { index: at(6, 5), piece: 'chair-gamer', rotation: 90 },
    ];

    const seats = decorChairs(items);
    expect(seats).toEqual([
      { index: at(4, 5), piece: 'chair-gamer', facing: 'down', color: '#2a9d8f' },
      { index: at(6, 5), piece: 'chair-gamer', facing: 'right' },
    ]);
    expect('color' in seats[1]!).toBe(false);
  });
});

describe('officeDecor: overlap and covering', () => {
  it('finds the first item whose footprint overlaps an earlier one', () => {
    const items: DecorItem[] = [
      { index: at(4, 6), piece: 'desk-wood', rotation: 0 },
      { index: at(4, 5), piece: 'chair-wood', rotation: 0 },
      { index: at(5, 6), piece: 'plant-bonsai', rotation: 0 },
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

  it('toggles a room table between 0 and 90 and a plant between 0 and 180, either way', () => {
    expect(nextDecorRotation(0, 1, 'table')).toBe(90);
    expect(nextDecorRotation(90, 1, 'table')).toBe(0);
    expect(nextDecorRotation(0, -1, 'table')).toBe(90);
    expect(nextDecorRotation(90, -1, 'table')).toBe(0);
    expect(nextDecorRotation(180, 1, 'table')).toBe(90);
    expect(nextDecorRotation(0, 1, 'plant')).toBe(180);
    expect(nextDecorRotation(180, 1, 'plant')).toBe(0);
    expect(nextDecorRotation(0, -1, 'plant')).toBe(180);
    expect(nextDecorRotation(0, 1, 'tree')).toBe(0);
    expect(nextDecorRotation(0, 1, 'desk')).toBe(270);
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
      { index: 2, item: { piece: 'plant-bonsai', rotation: 0 } },
    ]);
    expect(placed.map(({ index }) => index)).toEqual([2, 9]);
    const replaced = withDecor(placed, [{ index: 9, item: { piece: 'desk-wood', rotation: 90 } }, { index: 2, item: null, layer: 'top' }, { index: 50, item: null }]);
    expect(replaced).toEqual([{ index: 9, piece: 'desk-wood', rotation: 90 }]);
  });

  it('keeps an item color through edits, and a later edit without one drops it', () => {
    const painted = withDecor([], [{ index: 4, item: { piece: 'desk-painted', rotation: 0, color: '#c83c3c' } }]);
    expect(painted).toEqual([{ index: 4, piece: 'desk-painted', rotation: 0, color: '#c83c3c' }]);
    expect(withDecor(painted, [{ index: 4, item: { piece: 'desk-painted', rotation: 90 } }])).toEqual([{ index: 4, piece: 'desk-painted', rotation: 90 }]);
  });

  it('carries a color as a fourth field on the wire, and still reads entries without one', () => {
    const tiles = WIDTH * WIDTH;
    const items: DecorItem[] = [
      { index: 3, piece: 'chair-wood', rotation: 270 },
      { index: 8, piece: 'desk-painted', rotation: 90, color: '#c83c3c' },
    ];
    const encoded = encodeOfficeDecor(items);
    expect(encoded).toBe('3:chair-wood:270,8:desk-painted:90:#c83c3c');
    expect(decodeOfficeDecor(encoded, tiles)).toEqual(items);
    expect(decodeOfficeDecor('8:desk-painted:0', tiles)).toEqual([{ index: 8, piece: 'desk-painted', rotation: 0 }]);
    for (const garbage of ['8:desk-painted:0:', '8:desk-painted:0:#C83C3C', '8:desk-painted:0:red', '8:desk-painted:0:#c83c3c:1']) {
      expect(decodeOfficeDecor(garbage, tiles), garbage).toBeNull();
    }
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
    for (const garbage of ['3', '3:chair-wood', '3:chair-wood:45', `${tiles}:chair-wood:0`, '3:chair-wood:0,3:desk-wood:0', '3:plant-bonsai:0,3:plant-ficus:0', '3:Chair:0', '-1:chair-wood:0']) {
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

describe('officeDecor: doors (#223, #233)', () => {
  const DOOR: DecorPieceInfo = { kind: 'door', footprint: { w: 2, h: 1 } };
  const DOUBLE: DecorPieceInfo = { kind: 'door', footprint: { w: 3, h: 1 } };

  it('knows a door by its id alone: two tiles wide, a double door three, both turned four ways', () => {
    expect(decorInfoFromPieceId('door-wood')).toEqual(DOOR);
    expect(decorInfoFromPieceId('door-wood-double')).toEqual(DOUBLE);
    expect(isRotatable('door')).toBe(true);
    expect(decorRotationsOf('door')).toEqual([0, 90, 180, 270]);
    expect(nextDecorRotation(0, 1, 'door')).toBe(270);
  });

  it('takes the footprint of a door from the catalog, and knows no door that states none', () => {
    expect(decorPieceInfo({ kind: 'door', footprint: { w: 2, h: 1 } })).toEqual(DOOR);
    expect(decorPieceInfo({ kind: 'door', footprint: { w: 3, h: 1 } })).toEqual(DOUBLE);
    // A door states its span; unlike a chair there is no fixed footprint to fall back on.
    expect(decorPieceInfo({ kind: 'door' })).toBeNull();
    expect(decorPieceInfo({ kind: 'door', footprint: { w: 0, h: 1 } })).toBeNull();
  });

  it('covers its span along the line and a tile on each side: the top line for 0 and 180, the left line for 90 and 270', () => {
    expect(decorFootprint({ index: at(4, 6), rotation: 0 }, DOOR, WIDTH)).toEqual({ x: 4, y: 5, w: 2, h: 2 });
    expect(decorFootprint({ index: at(4, 6), rotation: 180 }, DOOR, WIDTH)).toEqual({ x: 4, y: 5, w: 2, h: 2 });
    expect(decorFootprint({ index: at(4, 6), rotation: 90 }, DOOR, WIDTH)).toEqual({ x: 3, y: 6, w: 2, h: 2 });
    expect(decorFootprint({ index: at(4, 6), rotation: 270 }, DOOR, WIDTH)).toEqual({ x: 3, y: 6, w: 2, h: 2 });
    expect(decorTiles({ index: at(4, 6), rotation: 0 }, DOOR, WIDTH)).toEqual([at(4, 5), at(5, 5), at(4, 6), at(5, 6)]);
  });

  it('covers the three tiles of a double door along the line, and one item holds them all', () => {
    expect(decorFootprint({ index: at(4, 6), rotation: 0 }, DOUBLE, WIDTH)).toEqual({ x: 4, y: 5, w: 3, h: 2 });
    expect(decorFootprint({ index: at(4, 6), rotation: 90 }, DOUBLE, WIDTH)).toEqual({ x: 3, y: 6, w: 2, h: 3 });
    expect(decorFootprint({ index: at(4, 6), rotation: 270 }, DOUBLE, WIDTH)).toEqual({ x: 3, y: 6, w: 2, h: 3 });
    expect(decorTiles({ index: at(4, 6), rotation: 0 }, DOUBLE, WIDTH)).toEqual([
      at(4, 5), at(5, 5), at(6, 5),
      at(4, 6), at(5, 6), at(6, 6),
    ]);
  });

  it('keeps the footprints of chairs, desk tables, plants and room tables as they were', () => {
    expect(decorFootprint({ index: at(4, 6), rotation: 0 }, CHAIR, WIDTH)).toEqual({ x: 4, y: 6, w: 1, h: 1 });
    expect(decorFootprint({ index: at(4, 6), rotation: 90 }, DESK, WIDTH)).toEqual({ x: 4, y: 5, w: 1, h: 3 });
    expect(decorFootprint({ index: at(4, 6), rotation: 0 }, PLANT, WIDTH)).toEqual({ x: 4, y: 6, w: 1, h: 1 });
    expect(decorFootprint({ index: at(10, 10), rotation: 0 }, MEETING, WIDTH)).toEqual({ x: 7, y: 8, w: 7, h: 5 });
  });
});

describe('officeDecor: sofas', () => {
  const SOFA_2: DecorPieceInfo = { kind: 'sofa', footprint: { w: 2, h: 1 } };
  const SOFA_3: DecorPieceInfo = { kind: 'sofa', footprint: { w: 3, h: 1 } };

  it('knows a sofa by its manifest entry or by its id alone: one tile per seat, the fabric ones colorable', () => {
    const manifest = JSON.parse(exportedManifest) as { pieces: { id: string; kind: string; footprint?: { w: number; h: number }; colorable?: boolean }[] };
    const byId = new Map(manifest.pieces.map((piece) => [piece.id, piece]));
    expect(decorPieceInfo(byId.get('sofa-leather-2')!)).toEqual(SOFA_2);
    expect(decorPieceInfo(byId.get('sofa-leather-3')!)).toEqual(SOFA_3);
    expect(decorPieceInfo(byId.get('sofa-fabric-2')!)).toEqual({ ...SOFA_2, colorable: true });
    expect(decorPieceInfo(byId.get('sofa-fabric-3')!)).toEqual({ ...SOFA_3, colorable: true });
    expect(decorInfoFromPieceId('sofa-leather-2')).toEqual(SOFA_2);
    expect(decorInfoFromPieceId('sofa-fabric-3')).toEqual(SOFA_3);
    expect(decorInfoFromPieceId('sofa-upload-0123456789abcdef')).toBeNull();
    expect(isDecorSofaPiece('sofa-fabric-2')).toBe(true);
    expect(isDecorSofaPiece('chair-fabric')).toBe(false);
  });

  it('turns four ways like a chair', () => {
    expect(isRotatable('sofa')).toBe(true);
    expect(decorRotationsOf('sofa')).toEqual([0, 90, 180, 270]);
    expect(decorRotationFor('sofa', 270)).toBe(270);
    expect(nextDecorRotation(0, 1, 'sofa')).toBe(270);
  });

  it('lies along a row facing up or down and along a column facing left or right, centered on its anchor like a room table', () => {
    for (const rotation of [0, 180] as const) {
      expect(decorFootprint({ index: at(10, 10), rotation }, SOFA_2, WIDTH)).toEqual({ x: 9, y: 10, w: 2, h: 1 });
      expect(decorFootprint({ index: at(10, 10), rotation }, SOFA_3, WIDTH)).toEqual({ x: 9, y: 10, w: 3, h: 1 });
    }
    for (const rotation of [90, 270] as const) {
      expect(decorFootprint({ index: at(10, 10), rotation }, SOFA_2, WIDTH)).toEqual({ x: 10, y: 9, w: 1, h: 2 });
      expect(decorFootprint({ index: at(10, 10), rotation }, SOFA_3, WIDTH)).toEqual({ x: 10, y: 9, w: 1, h: 3 });
    }
    // The same anchor tile the 2x1 oval room table takes.
    expect(decorFootprint({ index: at(10, 10), rotation: 0 }, { kind: 'table', footprint: { w: 2, h: 1 } }, WIDTH)).toEqual({ x: 9, y: 10, w: 2, h: 1 });
  });

  it('is a seat on every tile, each facing the way the sofa faces; a chair stays one seat on its tile', () => {
    const items: DecorItem[] = [
      { index: at(4, 5), piece: 'chair-wood', rotation: 90 },
      { index: at(10, 10), piece: 'sofa-fabric-3', rotation: 0, color: '#2a9d8f' },
      { index: at(15, 10), piece: 'sofa-leather-2', rotation: 270 },
      { index: at(8, 5), piece: 'plant-bonsai', rotation: 0 },
      { index: at(2, 2), piece: 'desk-wood', rotation: 0 },
    ];

    expect(decorSeats(items, WIDTH)).toEqual([
      { index: at(4, 5), piece: 'chair-wood', facing: 'right' },
      { index: at(9, 10), piece: 'sofa-fabric-3', facing: 'down', color: '#2a9d8f' },
      { index: at(10, 10), piece: 'sofa-fabric-3', facing: 'down', color: '#2a9d8f' },
      { index: at(11, 10), piece: 'sofa-fabric-3', facing: 'down', color: '#2a9d8f' },
      { index: at(15, 9), piece: 'sofa-leather-2', facing: 'left' },
      { index: at(15, 10), piece: 'sofa-leather-2', facing: 'left' },
    ]);
    // The chairs alone, as `decorChairs` draws them, are what they were.
    expect(decorChairs(items)).toEqual([{ index: at(4, 5), piece: 'chair-wood', facing: 'right' }]);
  });
});

describe('officeDecor: the top layer (#121)', () => {
  const DESK_AT = at(5, 5);
  // A desk table turned 0 covers (4..6, 5); the room table 7x5 centered on (14, 10) covers (11..17, 8..12).
  const desk: DecorItem = { index: DESK_AT, piece: 'desk-wood', rotation: 0 };
  const meeting: DecorItem = { index: at(14, 10), piece: 'table-meeting', rotation: 0 };
  const LAPTOP: DecorPieceInfo = { kind: 'plant', footprint: { w: 2, h: 1 } };
  const topInfo = (piece: string): DecorPieceInfo | null => (piece === 'plant-wide' ? LAPTOP : infoOf(piece));

  it('puts plants on top and every other kind on the floor, by the kind its id starts with', () => {
    expect([...ON_TOP_KINDS]).toEqual(['plant']);
    expect(isOnTopKind('plant')).toBe(true);
    for (const kind of ['chair', 'desk', 'table', 'door', 'sofa', 'tree', 'nope']) expect(isOnTopKind(kind), kind).toBe(false);
    expect(decorLayerOf('plant-bonsai')).toBe('top');
    expect(decorLayerOf('plant-upload-0123456789abcdef')).toBe('top');
    for (const piece of ['desk-wood', 'chair-wood', 'table-meeting', 'tree-ficus', 'door-wood', 'sofa-fabric-2']) expect(decorLayerOf(piece), piece).toBe('floor');
  });

  it('keys an item by its anchor and layer: a floor key is its anchor, a top key never collides with any floor key', () => {
    expect(decorKey(7, 'floor')).toBe(7);
    expect(decorItemKey({ index: 7, piece: 'desk-wood' })).toBe(7);
    const top = decorItemKey({ index: 7, piece: 'plant-bonsai' });
    expect(top).toBe(decorKey(7, 'top'));
    expect(top).toBeLessThan(0);
    expect(decorKey(0, 'top')).toBeLessThan(0);
    for (const key of [decorKey(0, 'floor'), decorKey(0, 'top'), decorKey(41, 'top'), decorKey(41, 'floor')]) {
      expect(decorKey(decorKeyIndex(key), decorKeyLayer(key))).toBe(key);
    }
    expect(decorKeyIndex(top)).toBe(7);
    expect(decorKeyLayer(top)).toBe('top');
    // A placement keys by its piece; a removal by its layer, absent the floor.
    expect(decorEditKey({ index: 7, item: { piece: 'plant-bonsai', rotation: 0 } })).toBe(top);
    expect(decorEditKey({ index: 7, item: null, layer: 'top' })).toBe(top);
    expect(decorEditKey({ index: 7, item: null })).toBe(7);
  });

  it('holds a floor item and a top item on one tile: each edit replaces or removes its own layer only', () => {
    const both = withDecor([], [
      { index: DESK_AT, item: { piece: 'plant-bonsai', rotation: 0 } },
      { index: DESK_AT, item: { piece: 'desk-wood', rotation: 0 } },
    ]);
    // Sorted by anchor, the floor item before the top one.
    expect(both).toEqual([desk, { index: DESK_AT, piece: 'plant-bonsai', rotation: 0 }]);
    expect(withDecor(both, [{ index: DESK_AT, item: { piece: 'plant-ficus', rotation: 0 } }])).toEqual([desk, { index: DESK_AT, piece: 'plant-ficus', rotation: 0 }]);
    expect(withDecor(both, [{ index: DESK_AT, item: null, layer: 'top' }])).toEqual([desk]);
    expect(withDecor(both, [{ index: DESK_AT, item: null }])).toEqual([{ index: DESK_AT, piece: 'plant-bonsai', rotation: 0 }]);
    // Replace-on-anchor still holds on the floor.
    expect(withDecor([desk], [{ index: DESK_AT, item: { piece: 'chair-wood', rotation: 90 } }])).toEqual([{ index: DESK_AT, piece: 'chair-wood', rotation: 90 }]);
  });

  it('carries both layers of a tile on the wire, floor first, in the entries it always had', () => {
    const tiles = WIDTH * WIDTH;
    const items: DecorItem[] = [desk, { index: DESK_AT, piece: 'plant-bonsai', rotation: 0 }];
    const encoded = encodeOfficeDecor([...items].reverse());
    expect(encoded).toBe(`${DESK_AT}:desk-wood:0,${DESK_AT}:plant-bonsai:0`);
    expect(decodeOfficeDecor(encoded, tiles)).toEqual(items);
    expect(decodeOfficeDecor(`${DESK_AT}:plant-bonsai:0,${DESK_AT}:desk-wood:0`, tiles)).toEqual(items);
    // Two items of one layer on one anchor are still malformed.
    expect(decodeOfficeDecor(`${DESK_AT}:desk-wood:0,${DESK_AT}:chair-wood:0`, tiles)).toBeNull();
  });

  it('stands a top item only where floor desk tables or room tables cover its whole footprint', () => {
    const plantAt = (index: number, piece = 'plant-bonsai'): DecorItem => ({ index, piece, rotation: 0 });
    expect(topItemSupported(plantAt(at(4, 5)), [desk], topInfo, WIDTH)).toBe(true);
    expect(topItemSupported(plantAt(at(6, 5)), [desk], topInfo, WIDTH)).toBe(true);
    expect(topItemSupported(plantAt(at(7, 5)), [desk], topInfo, WIDTH)).toBe(false);
    expect(topItemSupported(plantAt(at(11, 8)), [meeting], topInfo, WIDTH)).toBe(true);
    expect(topItemSupported(plantAt(at(4, 5)), [], topInfo, WIDTH)).toBe(false);
    // A chair is no surface, nor is another top item.
    expect(topItemSupported(plantAt(at(2, 2)), [{ index: at(2, 2), piece: 'chair-wood', rotation: 0 }], topInfo, WIDTH)).toBe(false);
    expect(topItemSupported(plantAt(at(2, 2)), [plantAt(at(2, 2), 'plant-wide')], topInfo, WIDTH)).toBe(false);
    // A 2x1 piece centered on (6, 5) covers (5..6, 5): on the desk; on (7, 5) it hangs off its end.
    expect(topItemSupported(plantAt(at(6, 5), 'plant-wide'), [desk], topInfo, WIDTH)).toBe(true);
    expect(topItemSupported(plantAt(at(7, 5), 'plant-wide'), [desk], topInfo, WIDTH)).toBe(false);
    // Two desk tables side by side hold it across their seam.
    const next: DecorItem = { index: at(8, 5), piece: 'desk-wood', rotation: 0 };
    expect(topItemSupported(plantAt(at(7, 5), 'plant-wide'), [desk, next], topInfo, WIDTH)).toBe(true);
  });

  it('lets fall the top items a change leaves off their surface, never one that already stood on nothing or one the batch placed', () => {
    const onDesk: DecorItem = { index: at(4, 5), piece: 'plant-bonsai', rotation: 0 };
    const onTable: DecorItem = { index: at(12, 9), piece: 'plant-bonsai', rotation: 0 };
    const stray: DecorItem = { index: at(1, 1), piece: 'plant-bonsai', rotation: 0 };
    const before = [desk, meeting, onDesk, onTable, stray];
    expect(fallenTopItems(before, [meeting, onDesk, onTable, stray], infoOf, WIDTH)).toEqual([onDesk]);
    expect(fallenTopItems(before, before, infoOf, WIDTH)).toEqual([]);
    // Turned vertical, the desk table covers (5, 4..6): the plant on (4, 5) falls.
    expect(fallenTopItems(before, [{ ...desk, rotation: 90 }, meeting, onDesk, onTable, stray], infoOf, WIDTH)).toEqual([onDesk]);
    const placed = { index: at(9, 9), piece: 'plant-bonsai', rotation: 0 } as const;
    // Placed off any surface: the batch's own placement is the rules' to refuse, not the cascade's to drop.
    expect(fallenTopItems(before, [...before, placed], infoOf, WIDTH, new Set([decorItemKey(placed)]))).toEqual([]);
    expect(fallenTopItems(before, [...before, placed], infoOf, WIDTH)).toEqual([placed]);
  });

  it('diffs two layers into the edits between them, naming the layer of a top removal', () => {
    const top: DecorItem = { index: DESK_AT, piece: 'plant-bonsai', rotation: 0 };
    expect(diffDecor([desk, top], [desk, top])).toEqual([]);
    expect(diffDecor([desk, top], [desk])).toEqual([{ index: DESK_AT, item: null, layer: 'top' }]);
    expect(diffDecor([desk, top], [top])).toEqual([{ index: DESK_AT, item: null }]);
    expect(diffDecor([desk], [{ ...desk, rotation: 180 }, top])).toEqual([
      { index: DESK_AT, item: { piece: 'desk-wood', rotation: 180 } },
      { index: DESK_AT, item: { piece: 'plant-bonsai', rotation: 0 } },
    ]);
  });

  it('picks the top item over the floor item it stands on', () => {
    const top: DecorItem = { index: DESK_AT, piece: 'plant-wide', rotation: 0 };
    const wideDesk: DecorPieceInfo = { kind: 'desk', footprint: { w: 3, h: 1 } };
    const sameSize = (piece: string): DecorPieceInfo | null => (piece === 'plant-wide' ? { kind: 'plant', footprint: { w: 3, h: 1 } } : piece === 'desk-wood' ? wideDesk : null);
    // Same footprint as the desk: the top one still wins, it is drawn over it.
    expect(decorItemCovering([desk, top], sameSize, WIDTH, at(4, 5))).toEqual(top);
    expect(decorItemCovering([desk], sameSize, WIDTH, at(4, 5))).toEqual(desk);
  });
});
