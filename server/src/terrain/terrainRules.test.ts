import { describe, expect, it } from 'vitest';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE } from '../../../src/game/mapData.ts';
import {
  blockIndexAt,
  newlyUnwalkableTiles,
  terrainSnapshot,
  withBlock,
  withWalls,
  type LayoutMaterial,
} from '../../../src/game/officeLayout.ts';
import { MAX_DECOR_EDITS, type DecorItem, type DecorPieceInfo } from '../../../src/game/officeDecor.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_TERRAIN as BASE_TERRAIN, LEGACY_SEATS as BASE_MAP_SEATS } from '../../../src/test/legacyOffice.ts';
import {
  InvalidTerrainEditError,
  TerrainProtectedError,
  findUnwalkableConflict,
  findDecorConflict,
  findWallConflict,
  parseDecorBatch,
  parseTerrainBatch,
  parseWallBatch,
  parseTerrainEdit,
  staticProtectedTiles,
  type TerrainProtections,
} from './terrainRules.ts';

const W = BASE_LAYOUT.width;
const COUNT = BASE_LAYOUT.blocks.length;
/** A free lawn block: nothing static stands where its water would reach. */
const LAWN = 35;
const STATIC = staticProtectedTiles(BASE_LAYOUT, BASE_MAP_SEATS);
const NONE: TerrainProtections = { placements: [], players: [] };

function watered(index: number, material: LayoutMaterial = 'water'): number[] {
  return newlyUnwalkableTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, index, material)));
}

/** A network position whose avatar body sits in the middle of tile (tx, ty). */
function standingOn(tx: number, ty: number) {
  return { x: tx * TILE + 16, y: ty * TILE + 5 };
}

describe('parseTerrainBatch', () => {
  it('accepts the expected wire string of a whole 21x15 map of the longest material name, and nothing longer', () => {
    const count = 21 * 15;
    const expected = new Array(count).fill('cobblestone').join(',');
    const edits = [{ index: 0, material: 'grass' }];

    expect(parseTerrainBatch({ edits, expected }, count).expected).toBe(expected);
    expect(() => parseTerrainBatch({ edits, expected: `${expected},xx` }, count)).toThrow(InvalidTerrainEditError);
  });
});

describe('parseTerrainEdit', () => {
  it('reads a block index from the route and a material from the body', () => {
    expect(parseTerrainEdit('35', { material: 'water' }, COUNT)).toEqual({ index: 35, material: 'water' });
    expect(parseTerrainEdit('0', { material: 'carpet' }, COUNT)).toEqual({ index: 0, material: 'carpet' });
  });

  it('refuses an index off the map or that is not a plain number, and an unknown material', () => {
    for (const index of ['140', '-1', '1.5', '1e2', ' 3', 'abc', '', 7, undefined]) {
      expect(() => parseTerrainEdit(index, { material: 'grass' }, COUNT), String(index)).toThrow(InvalidTerrainEditError);
    }
    for (const body of [{ material: 'lava' }, { material: 3 }, {}, null, 'water', ['water']]) {
      expect(() => parseTerrainEdit('3', body, COUNT), JSON.stringify(body)).toThrow(InvalidTerrainEditError);
    }
  });
});

describe('terrain block colors (#222)', () => {
  it('reads a color on a colorable material, normalized to lower case, and no color as none', () => {
    expect(parseTerrainEdit('3', { material: 'carpet', color: '#A0B1C2' }, COUNT)).toStrictEqual({ index: 3, material: 'carpet', color: '#a0b1c2' });
    expect(parseTerrainEdit('3', { material: 'carpet', color: null }, COUNT)).toStrictEqual({ index: 3, material: 'carpet' });
    expect(parseTerrainEdit('3', { material: 'carpet' }, COUNT)).toStrictEqual({ index: 3, material: 'carpet' });
    expect(parseTerrainEdit('3', { material: 'grass' }, COUNT)).toStrictEqual({ index: 3, material: 'grass' });
  });

  it('refuses a malformed color', () => {
    for (const color of ['rojo', '#abc', 'a0b1c2', '#a0b1c2 ', 3, true, {}]) {
      expect(() => parseTerrainEdit('3', { material: 'carpet', color }, COUNT), JSON.stringify(color)).toThrow(new InvalidTerrainEditError('invalid color'));
    }
  });

  it('refuses a color on a material that takes none', () => {
    for (const material of ['grass', 'wood', 'tile', 'water', 'void']) {
      expect(() => parseTerrainEdit('3', { material, color: '#a0b1c2' }, COUNT), material).toThrow(new InvalidTerrainEditError('this material takes no color'));
    }
  });

  it('carries each edit color through a batch, and refuses the whole batch for one bad color', () => {
    const expected = 'grass';
    expect(parseTerrainBatch({ edits: [{ index: 1, material: 'carpet', color: '#A0B1C2' }, { index: 2, material: 'sand' }], expected }, COUNT).edits).toStrictEqual([
      { index: 1, material: 'carpet', color: '#a0b1c2' },
      { index: 2, material: 'sand' },
    ]);
    expect(() => parseTerrainBatch({ edits: [{ index: 1, material: 'carpet' }, { index: 2, material: 'sand', color: '#a0b1c2' }], expected }, COUNT)).toThrow(InvalidTerrainEditError);
  });
});

describe('terrain block floors (uploaded floor pieces)', () => {
  const FLOOR = 'floor-upload-0123456789abcdef';

  it('reads an uploaded floor on wood, and an edit without one as before', () => {
    expect(parseTerrainEdit('3', { material: 'wood', floor: FLOOR }, COUNT)).toStrictEqual({ index: 3, material: 'wood', floor: FLOOR });
    expect(parseTerrainEdit('3', { material: 'wood', floor: null }, COUNT)).toStrictEqual({ index: 3, material: 'wood' });
    expect(parseTerrainEdit('3', { material: 'wood' }, COUNT)).toStrictEqual({ index: 3, material: 'wood' });
    expect(parseTerrainEdit('3', { material: 'carpet', color: '#A0B1C2' }, COUNT)).toStrictEqual({ index: 3, material: 'carpet', color: '#a0b1c2' });
  });

  it('refuses anything that is not an uploaded floor id', () => {
    for (const floor of ['floor-wood', 'floor-upload-0123456789ABCDEF', 'floor-upload-0123', 'plant-upload-0123456789abcdef', `${FLOOR} `, 3, true, {}]) {
      expect(() => parseTerrainEdit('3', { material: 'wood', floor }, COUNT), JSON.stringify(floor)).toThrow(new InvalidTerrainEditError('invalid floor'));
    }
  });

  it('refuses a floor on any material but wood, and a floor together with a color', () => {
    for (const material of ['grass', 'carpet', 'tile', 'water', 'void', 'sand']) {
      expect(() => parseTerrainEdit('3', { material, floor: FLOOR }, COUNT), material).toThrow(new InvalidTerrainEditError('a floor lies on wood'));
    }
    expect(() => parseTerrainEdit('3', { material: 'wood', floor: FLOOR, color: '#a0b1c2' }, COUNT)).toThrow(InvalidTerrainEditError);
  });

  it('still refuses an unknown material, with or without a floor', () => {
    expect(() => parseTerrainEdit('3', { material: 'lava' }, COUNT)).toThrow(new InvalidTerrainEditError('unknown material'));
    expect(() => parseTerrainEdit('3', { material: 'lava', floor: FLOOR }, COUNT)).toThrow(new InvalidTerrainEditError('unknown material'));
  });

  it('carries each edit floor through a batch, and refuses the whole batch for one bad floor', () => {
    const expected = 'grass';
    expect(parseTerrainBatch({ edits: [{ index: 1, material: 'wood', floor: FLOOR }, { index: 2, material: 'sand' }], expected }, COUNT).edits).toStrictEqual([
      { index: 1, material: 'wood', floor: FLOOR },
      { index: 2, material: 'sand' },
    ]);
    expect(() => parseTerrainBatch({ edits: [{ index: 1, material: 'wood', floor: FLOOR }, { index: 2, material: 'sand', floor: FLOOR }], expected }, COUNT)).toThrow(InvalidTerrainEditError);
  });
});

describe('staticProtectedTiles', () => {
  it('holds every map chair, the furniture people use and the spawn area, but not the scenery', () => {
    for (const seat of BASE_MAP_SEATS) expect(STATIC.has(seat.ty * W + seat.tx)).toBe(true);
    const table = BASE_LAYOUT.props.find((prop) => prop.piece === 'table-meeting')!;
    expect(STATIC.has(table.ty * W + table.tx)).toBe(true);
    const desk = BASE_LAYOUT.props.find((prop) => prop.kind === 'desk')!;
    expect(STATIC.has(desk.ty * W + desk.tx)).toBe(true);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) expect(STATIC.has((PLAYER_SPAWN_TY + dy) * W + PLAYER_SPAWN_TX + dx)).toBe(true);
    }
    // Trees, hedges and walls stay solid over any terrain, so water under
    // them changes nothing anyone can stand on.
    const tree = BASE_LAYOUT.props.find((prop) => prop.kind === 'tree')!;
    expect(STATIC.has(tree.ty * W + tree.tx)).toBe(false);
    const bridge = BASE_LAYOUT.props.find((prop) => prop.kind === 'bridge')!;
    expect(STATIC.has(bridge.ty * W + bridge.tx)).toBe(false);
  });
});

describe('findUnwalkableConflict', () => {
  it('does not veto player ground contact: relocation is decided after persistence', () => {
    const protections = { placements: [], players: [{ x: 100, y: 207 }] };
    // Footprint (91, 211)..(109, 225) crosses both x=96 and y=224.
    expect(findUnwalkableConflict([7 * W + 3], W, new Set(), protections)).toBeNull();
    expect(findUnwalkableConflict([5 * W + 2], W, new Set(), protections)).toBeNull();
  });

  it('lets water onto a free lawn and anything that is not water anywhere', () => {
    expect(findUnwalkableConflict(watered(LAWN), W, STATIC, NONE)).toBeNull();
    expect(watered(blockIndexAt(W, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY), 'sand')).toEqual([]);
  });

  it('refuses water over the spawn area, where everyone enters', () => {
    expect(findUnwalkableConflict(watered(blockIndexAt(W, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY)), W, STATIC, NONE)).toBe('placement');
  });

  it('refuses water under a space or a desk on a block edge, but never floods neighboring blocks', () => {
    const flooded = watered(LAWN);
    expect(flooded.every((tile) => tile % W >= 63 && tile % W < 72 && tile >= 18 * W && tile < 27 * W)).toBe(true);
    const tx = 63;
    const ty = 18;

    expect(findUnwalkableConflict(flooded, W, STATIC, { placements: [{ x: tx, y: ty, w: 1, h: 1 }], players: [] })).toBe('placement');
    expect(findUnwalkableConflict(flooded, W, STATIC, { placements: [{ x: 0, y: 0, w: 9, h: 9 }], players: [] })).toBeNull();
  });

  it('allows water under players, including partial footprint overlaps', () => {
    expect(findUnwalkableConflict(watered(LAWN), W, STATIC, { placements: [], players: [standingOn(67, 22)] })).toBeNull();
    // Body center just right of the block's last column: a third of the body still overlaps it.
    const flooded = new Set(watered(LAWN));
    expect(flooded.has(22 * W + 71)).toBe(true);
    const halfIn = { x: 72 * TILE + 5, y: 22 * TILE + 5 };
    const players = { placements: [], players: [halfIn] };
    expect(findUnwalkableConflict([22 * W + 71], W, new Set(), players)).toBeNull();
    expect(findUnwalkableConflict(watered(LAWN), W, STATIC, { placements: [], players: [standingOn(10, 10)] })).toBeNull();
  });

  it('names the placement before the player: one of them moves away, the other does not', () => {
    const flooded = watered(LAWN);
    const protections: TerrainProtections = { placements: [{ x: 63, y: 18, w: 9, h: 9 }], players: [standingOn(67, 22)] };
    expect(findUnwalkableConflict(flooded, W, STATIC, protections)).toBe('placement');
  });

  it('treats void like water: refused under a placement or the spawn, free over a lawn', () => {
    const erased = watered(LAWN, 'void');
    expect(erased).toEqual(watered(LAWN));
    expect(findUnwalkableConflict(erased, W, STATIC, NONE)).toBeNull();
    expect(findUnwalkableConflict(erased, W, STATIC, { placements: [{ x: 63, y: 18, w: 1, h: 1 }], players: [] })).toBe('placement');
    expect(findUnwalkableConflict(watered(blockIndexAt(W, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY), 'void'), W, STATIC, NONE)).toBe('placement');
  });

  it('reads void as a material of an edit', () => {
    expect(parseTerrainEdit('35', { material: 'void' }, COUNT)).toEqual({ index: 35, material: 'void' });
  });

  it('carries the reason on a typed error', () => {
    const error = new TerrainProtectedError('placement');
    expect(error).toBeInstanceOf(Error);
    expect(error.reason).toBe('placement');
  });
});

describe('parseWallBatch', () => {
  const TILES = BASE_LAYOUT.width * BASE_LAYOUT.height;

  it('reads wall pieces and erasures on distinct tiles of the map', () => {
    expect(parseWallBatch({ edits: [{ index: 0, piece: 'wall-brick' }, { index: TILES - 1, piece: null }, { index: 7, piece: 'wall-glass' }] }, TILES)).toEqual([
      { index: 0, piece: 'wall-brick' },
      { index: TILES - 1, piece: null },
      { index: 7, piece: 'wall-glass' },
    ]);
  });

  it.each([
    ['no body', null],
    ['an array body', []],
    ['no edits', {}],
    ['an empty batch', { edits: [] }],
    ['a tile off the map', { edits: [{ index: 189 * 135 * 10, piece: 'wall-brick' }] }],
    ['a negative tile', { edits: [{ index: -1, piece: 'wall-brick' }] }],
    ['a fractional tile', { edits: [{ index: 1.5, piece: 'wall-brick' }] }],
    ['a tile as text', { edits: [{ index: '3', piece: 'wall-brick' }] }],
    ['an unknown piece', { edits: [{ index: 3, piece: 'wall-lava' }] }],
    ['a hedge', { edits: [{ index: 3, piece: 'hedge-boxwood' }] }],
    ['a missing piece', { edits: [{ index: 3 }] }],
    ['a repeated tile', { edits: [{ index: 3, piece: 'wall-brick' }, { index: 3, piece: null }] }],
    ['an edit that is not an object', { edits: [3] }],
  ])('refuses %s', (_name, body) => {
    expect(() => parseWallBatch(body, TILES)).toThrow(InvalidTerrainEditError);
  });

  it('caps a batch at MAX_WALL_EDITS tiles', () => {
    const edits = (count: number) => Array.from({ length: count }, (_, index) => ({ index, piece: 'wall-stone' }));
    expect(parseWallBatch({ edits: edits(2000) }, TILES)).toHaveLength(2000);
    expect(() => parseWallBatch({ edits: edits(2001) }, TILES)).toThrow(InvalidTerrainEditError);
  });
});

describe('findWallConflict', () => {
  const spawn = PLAYER_SPAWN_TY * W + PLAYER_SPAWN_TX;
  const free = 22 * W + 67;
  const desk = { x: 66, y: 21, w: 3, h: 3 };
  const MAP = { width: W, height: BASE_LAYOUT.height };

  it('lets a wall go anywhere nothing static and no desk stands, rooms and players included', () => {
    const protections: TerrainProtections = { placements: [{ x: 60, y: 18, w: 12, h: 9 }], players: [standingOn(67, 22)] };
    expect(findWallConflict([free], MAP, STATIC, protections)).toBeNull();
    expect(findWallConflict([], MAP, STATIC, protections)).toBeNull();
  });

  it('refuses a post whose footprint touches a seat, static furniture or the spawn area', () => {
    const seat = BASE_MAP_SEATS[0]!;
    expect(findWallConflict([seat.ty * W + seat.tx], MAP, STATIC, NONE)).toBe('placement');
    // The vertex at the seat tile's bottom-right corner: its joint reaches into the seat.
    expect(findWallConflict([(seat.ty + 1) * W + seat.tx + 1], MAP, STATIC, NONE)).toBe('placement');
    expect(findWallConflict([spawn], MAP, STATIC, NONE)).toBe('placement');
    expect(findWallConflict([spawn + 2 * W + 2], MAP, STATIC, NONE)).toBe('placement');
    expect(findWallConflict([spawn + 3 * W + 3], MAP, STATIC, NONE)).toBeNull();
  });

  it('refuses to remove a post that ends a door (#223), never to repaint it or to change another post', () => {
    const doorPosts = new Set([free, free + 1]);
    expect(findWallConflict([], MAP, STATIC, NONE, [free + 1], doorPosts)).toBe('placement');
    expect(findWallConflict([free], MAP, STATIC, NONE, [], doorPosts)).toBeNull();
    expect(findWallConflict([free, free + 1], MAP, STATIC, NONE, [], doorPosts)).toBeNull();
    expect(findWallConflict([], MAP, STATIC, NONE, [free + 2], doorPosts)).toBeNull();
    expect(findWallConflict([free + 2], MAP, STATIC, NONE, [], doorPosts)).toBeNull();
    // A batch that repaints a door's posts and erases an unrelated one is not refused for the door.
    expect(findWallConflict([free], MAP, STATIC, NONE, [free + 2], doorPosts)).toBeNull();
  });

  it('refuses a post on a desk, its edge lines included', () => {
    expect(findWallConflict([free], MAP, STATIC, { ...NONE, desks: [desk] })).toBe('placement');
    // The desk's top-left and bottom-right corners: the post straddles the edge.
    expect(findWallConflict([21 * W + 66], MAP, STATIC, { ...NONE, desks: [desk] })).toBe('placement');
    expect(findWallConflict([24 * W + 69], MAP, STATIC, { ...NONE, desks: [desk] })).toBe('placement');
    // A whole tile away.
    expect(findWallConflict([25 * W + 68], MAP, STATIC, { ...NONE, desks: [desk] })).toBeNull();
    expect(findWallConflict([22 * W + 70], MAP, STATIC, { ...NONE, desks: [desk] })).toBeNull();
    expect(findWallConflict([20 * W + 67], MAP, STATIC, { ...NONE, desks: [desk] })).toBeNull();
  });
});

describe('parseDecorBatch', () => {
  const TILES = BASE_LAYOUT.width * BASE_LAYOUT.height;

  it('reads items and erasures on distinct tiles of the map', () => {
    expect(
      parseDecorBatch({ edits: [{ index: 0, item: { piece: 'chair-wood', rotation: 270 } }, { index: TILES - 1, item: null }, { index: 5, item: { piece: 'plant-upload-0123456789abcdef', rotation: 0 } }] }, TILES),
    ).toEqual([
      { index: 0, item: { piece: 'chair-wood', rotation: 270 } },
      { index: TILES - 1, item: null },
      { index: 5, item: { piece: 'plant-upload-0123456789abcdef', rotation: 0 } },
    ]);
  });

  it.each([
    ['no body', null],
    ['an array body', []],
    ['no edits', {}],
    ['an empty batch', { edits: [] }],
    ['a tile off the map', { edits: [{ index: TILES, item: null }] }],
    ['a negative tile', { edits: [{ index: -1, item: null }] }],
    ['a fractional tile', { edits: [{ index: 1.5, item: null }] }],
    ['a malformed piece id', { edits: [{ index: 3, item: { piece: 'chair:wood', rotation: 0 } }] }],
    ['a piece that is not a string', { edits: [{ index: 3, item: { piece: 7, rotation: 0 } }] }],
    ['an unknown rotation', { edits: [{ index: 3, item: { piece: 'chair-wood', rotation: 45 } }] }],
    ['a missing rotation', { edits: [{ index: 3, item: { piece: 'chair-wood' } }] }],
    ['an item that is not an object', { edits: [{ index: 3, item: 'chair-wood' }] }],
    ['a missing item', { edits: [{ index: 3 }] }],
    ['a repeated tile', { edits: [{ index: 3, item: null }, { index: 3, item: { piece: 'chair-wood', rotation: 0 } }] }],
    ['an edit that is not an object', { edits: [3] }],
    ['a color that is not #rrggbb', { edits: [{ index: 3, item: { piece: 'desk-painted', rotation: 0, color: 'red' } }] }],
    ['a short color', { edits: [{ index: 3, item: { piece: 'desk-painted', rotation: 0, color: '#c83c3' } }] }],
    ['a color that is not a string', { edits: [{ index: 3, item: { piece: 'desk-painted', rotation: 0, color: 0xc83c3c } }] }],
  ])('refuses %s', (_name, body) => {
    expect(() => parseDecorBatch(body, TILES)).toThrow(InvalidTerrainEditError);
  });

  it('reads an item color, normalized to lower case, and no color as none', () => {
    expect(
      parseDecorBatch(
        {
          edits: [
            { index: 3, item: { piece: 'desk-painted', rotation: 90, color: '#C83C3C' } },
            { index: 9, item: { piece: 'desk-painted', rotation: 0, color: null } },
            { index: 12, item: { piece: 'desk-painted', rotation: 0 } },
          ],
        },
        TILES,
      ),
    ).toEqual([
      { index: 3, item: { piece: 'desk-painted', rotation: 90, color: '#c83c3c' } },
      { index: 9, item: { piece: 'desk-painted', rotation: 0 } },
      { index: 12, item: { piece: 'desk-painted', rotation: 0 } },
    ]);
  });

  it('caps a batch at MAX_DECOR_EDITS tiles', () => {
    const edits = (count: number) => Array.from({ length: count }, (_, index) => ({ index, item: null }));
    expect(parseDecorBatch({ edits: edits(MAX_DECOR_EDITS) }, TILES)).toHaveLength(MAX_DECOR_EDITS);
    expect(() => parseDecorBatch({ edits: edits(MAX_DECOR_EDITS + 1) }, TILES)).toThrow(InvalidTerrainEditError);
  });
});

describe('findDecorConflict', () => {
  const at = (tx: number, ty: number) => ty * W + tx;
  const free = at(67, 22);
  const INFO: Record<string, DecorPieceInfo> = {
    'chair-wood': { kind: 'chair', footprint: { w: 1, h: 1 } },
    'desk-wood': { kind: 'desk', footprint: { w: 3, h: 1 } },
    'table-meeting': { kind: 'table', footprint: { w: 7, h: 5 } },
  };
  const infoOf = (piece: string) => INFO[piece] ?? null;
  const conflict = (after: DecorItem[], placed: number[], snapshot = BASE_TERRAIN) => findDecorConflict(after, new Set(placed), infoOf, snapshot, STATIC);

  it('lets an item stand on free walkable ground, desks, rooms and players included', () => {
    expect(conflict([{ index: free, piece: 'chair-wood', rotation: 0 }], [free])).toBeNull();
    expect(conflict([{ index: free, piece: 'desk-wood', rotation: 90 }], [free])).toBeNull();
    expect(conflict([], [])).toBeNull();
  });

  describe('doors (#223, #233, S3)', () => {
    const door = (index: number, rotation: 0 | 90 | 180 | 270 = 0, piece = 'door-wood'): DecorItem => ({ index, piece, rotation });
    const doorInfo = (piece: string): DecorPieceInfo | null => {
      if (!piece.startsWith('door-')) return infoOf(piece);
      return { kind: 'door', footprint: { w: piece === 'door-wood-double' ? 3 : 2, h: 1 } };
    };
    const posts = (...at2: [number, number][]) => at2.map(([x, y]) => ({ index: at(x, y), piece: 'wall-brick' as 'wall-brick' | 'wall-plaster' | 'wall-glass' }));
    const snapshotOf = (edits: ReturnType<typeof posts>) => terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, withWalls(BASE_LAYOUT.walls, edits));
    const check = (after: DecorItem[], placed: number[], snapshot: ReturnType<typeof snapshotOf>) => findDecorConflict(after, new Set(placed), doorInfo, snapshot, STATIC);
    /** A post at each end of a 2 tile span (67, 22)..(69, 22) and of a 4 tile one (67, 22)..(71, 22): no wall between them. */
    const single = snapshotOf(posts([67, 22], [69, 22]));
    const double = snapshotOf(posts([67, 22], [70, 22]));

    it('takes a door between two posts with no wall between them, whatever the side it opens to', () => {
      expect(check([door(free)], [free], single)).toBeNull();
      expect(check([door(free, 180)], [free], single)).toBeNull();
      // A vertical span (67, 22)..(67, 24) takes the same two posts at its ends.
      const vertical = snapshotOf(posts([67, 22], [67, 24]));
      expect(check([door(free, 90)], [free], vertical)).toBeNull();
      expect(check([door(free, 270)], [free], vertical)).toBeNull();
    });

    it('takes a double door between two posts three tiles apart, and a single one does not fit there', () => {
      expect(check([door(free, 0, 'door-wood-double')], [free], double)).toBeNull();
      expect(check([door(free, 90, 'door-wood-double')], [free], snapshotOf(posts([67, 22], [67, 25])))).toBeNull();
      expect(check([door(free)], [free], double)).toBe('placement');
      expect(check([door(free, 0, 'door-wood-double')], [free], single)).toBe('placement');
    });

    it('takes a door between posts of two materials and posts at a corner or an L', () => {
      const mixed = snapshotOf([{ index: at(67, 22), piece: 'wall-plaster' }, { index: at(69, 22), piece: 'wall-glass' }]);
      expect(check([door(free)], [free], mixed)).toBeNull();
      // Each end post is the corner of a wall that turns away from the door: an L either side.
      const corners = snapshotOf(posts([67, 22], [67, 23], [67, 24], [69, 22], [69, 23], [69, 24], [70, 24]));
      expect(check([door(free)], [free], corners)).toBeNull();
    });

    it('refuses a door with a post missing at either end, with no wall at all, or leaving the map', () => {
      expect(check([door(free)], [free], snapshotOf(posts([67, 22])))).toBe('placement');
      expect(check([door(free)], [free], snapshotOf(posts([69, 22])))).toBe('placement');
      expect(check([door(free)], [free], BASE_TERRAIN)).toBe('placement');
      // Posts around it but not at its ends: one tile off.
      expect(check([door(free)], [free], snapshotOf(posts([66, 22], [70, 22])))).toBe('placement');
      expect(check([door(at(0, 0), 90)], [at(0, 0)], snapshotOf(posts([0, 0])))).toBe('placement');
    });

    it('keeps other items off the tiles of a door, and refuses a door over another item', () => {
      // Any other piece still keeps off the tiles the wall touches.
      expect(check([{ index: free, piece: 'chair-wood', rotation: 0 }], [free], single)).toBe('placement');
      // Another item on one of the door footprint tiles refuses it, on either side or along its span.
      expect(check([door(free), { index: at(67, 21), piece: 'chair-wood', rotation: 0 }], [free], single)).toBe('placement');
      expect(check([door(free), { index: at(68, 22), piece: 'chair-wood', rotation: 0 }], [free], single)).toBe('placement');
      // Beyond its span it is free.
      expect(check([door(free), { index: at(70, 21), piece: 'chair-wood', rotation: 0 }], [free], single)).toBeNull();
    });
  });

  it('refuses any tile of a footprint on water or void, a static tile or the spawn area, or off the map', () => {
    const seat = BASE_MAP_SEATS[0]!;
    const lake = at(94, 58);
    expect(BASE_TERRAIN.walkable[lake]).toBe(false);
    expect(conflict([{ index: lake, piece: 'chair-wood', rotation: 0 }], [lake])).toBe('placement');
    // A desk table next to the seat reaches it with an end tile.
    expect(conflict([{ index: at(seat.tx + 1, seat.ty), piece: 'desk-wood', rotation: 0 }], [at(seat.tx + 1, seat.ty)])).toBe('placement');
    expect(conflict([{ index: at(PLAYER_SPAWN_TX + 1, PLAYER_SPAWN_TY), piece: 'chair-wood', rotation: 0 }], [at(PLAYER_SPAWN_TX + 1, PLAYER_SPAWN_TY)])).toBe('placement');
    expect(conflict([{ index: at(0, 5), piece: 'desk-wood', rotation: 0 }], [at(0, 5)])).toBe('placement');
  });

  it('refuses a footprint on a tile a wall rectangle covers', () => {
    const walls = new Array<string | null>(W * BASE_LAYOUT.height).fill(null);
    walls[free] = 'wall-brick';
    const walled = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, walls);
    // The post on the top-left corner of the tile reaches into it and its three neighbors.
    expect(conflict([{ index: free, piece: 'chair-wood', rotation: 0 }], [free], walled)).toBe('placement');
    expect(conflict([{ index: free + 2, piece: 'desk-wood', rotation: 0 }], [free + 2], walled)).toBeNull();
    expect(conflict([{ index: free + 1, piece: 'desk-wood', rotation: 0 }], [free + 1], walled)).toBe('placement');
  });

  it('refuses a placed item overlapping another one, but never blames stored items for overlapping each other', () => {
    const table = { index: free, piece: 'desk-wood', rotation: 0 } as const;
    expect(conflict([table, { index: free + 1, piece: 'chair-wood', rotation: 0 }], [free + 1])).toBe('placement');
    expect(conflict([table, { index: free + W, piece: 'chair-wood', rotation: 0 }], [free + W])).toBeNull();
    // Two stored items that overlap already (kept at load) never veto an edit elsewhere.
    expect(conflict([table, { index: free + 1, piece: 'chair-wood', rotation: 0 }, { index: free + 5 * W, piece: 'chair-wood', rotation: 0 }], [free + 5 * W])).toBeNull();
  });
});
