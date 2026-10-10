import { describe, expect, it } from 'vitest';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE } from '../../../src/game/mapData.ts';
import {
  blockIndexAt,
  newlyUnwalkableTiles,
  terrainSnapshot,
  withBlock,
  type LayoutMaterial,
} from '../../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_TERRAIN as BASE_TERRAIN, LEGACY_SEATS as BASE_MAP_SEATS } from '../../../src/test/legacyOffice.ts';
import {
  InvalidTerrainEditError,
  TerrainProtectedError,
  findUnwalkableConflict,
  findChairConflict,
  findWallConflict,
  parseChairBatch,
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

describe('parseChairBatch', () => {
  const TILES = BASE_LAYOUT.width * BASE_LAYOUT.height;

  it('reads chairs and erasures on distinct tiles of the map', () => {
    expect(
      parseChairBatch({ edits: [{ index: 0, chair: { piece: 'chair-wood', facing: 'down' } }, { index: TILES - 1, chair: null }] }, TILES),
    ).toEqual([
      { index: 0, chair: { piece: 'chair-wood', facing: 'down' } },
      { index: TILES - 1, chair: null },
    ]);
  });

  it.each([
    ['no body', null],
    ['an array body', []],
    ['no edits', {}],
    ['an empty batch', { edits: [] }],
    ['a tile off the map', { edits: [{ index: 189 * 135 * 10, chair: null }] }],
    ['a negative tile', { edits: [{ index: -1, chair: null }] }],
    ['a fractional tile', { edits: [{ index: 1.5, chair: null }] }],
    ['an unknown piece', { edits: [{ index: 3, chair: { piece: 'chair-throne', facing: 'down' } }] }],
    ['a wall piece', { edits: [{ index: 3, chair: { piece: 'wall-brick', facing: 'down' } }] }],
    ['an unknown facing', { edits: [{ index: 3, chair: { piece: 'chair-wood', facing: 'north' } }] }],
    ['a chair that is not an object', { edits: [{ index: 3, chair: 'chair-wood' }] }],
    ['a missing chair', { edits: [{ index: 3 }] }],
    ['a repeated tile', { edits: [{ index: 3, chair: null }, { index: 3, chair: { piece: 'chair-wood', facing: 'up' } }] }],
    ['an edit that is not an object', { edits: [3] }],
  ])('refuses %s', (_name, body) => {
    expect(() => parseChairBatch(body, TILES)).toThrow(InvalidTerrainEditError);
  });

  it('caps a batch at MAX_CHAIR_EDITS tiles', () => {
    const edits = (count: number) => Array.from({ length: count }, (_, index) => ({ index, chair: null }));
    expect(parseChairBatch({ edits: edits(500) }, TILES)).toHaveLength(500);
    expect(() => parseChairBatch({ edits: edits(501) }, TILES)).toThrow(InvalidTerrainEditError);
  });
});

describe('findChairConflict', () => {
  const free = 22 * W + 67;
  const desk = { x: 66, y: 21, w: 3, h: 3 };

  it('lets a chair stand on any free walkable tile, rooms and players included', () => {
    const protections: TerrainProtections = { placements: [{ x: 60, y: 18, w: 12, h: 9 }], players: [standingOn(67, 22)] };
    expect(findChairConflict([free], BASE_TERRAIN, STATIC, protections)).toBeNull();
    expect(findChairConflict([], BASE_TERRAIN, STATIC, protections)).toBeNull();
  });

  it('refuses a chair on water or void, on a seat, static furniture or the spawn area, or on a desk', () => {
    const seat = BASE_MAP_SEATS[0]!;
    const lake = 58 * W + 94;
    expect(BASE_TERRAIN.walkable[lake]).toBe(false);
    expect(findChairConflict([free, lake], BASE_TERRAIN, STATIC, NONE)).toBe('placement');
    expect(findChairConflict([seat.ty * W + seat.tx], BASE_TERRAIN, STATIC, NONE)).toBe('placement');
    expect(findChairConflict([PLAYER_SPAWN_TY * W + PLAYER_SPAWN_TX + 1], BASE_TERRAIN, STATIC, NONE)).toBe('placement');
    expect(findChairConflict([free], BASE_TERRAIN, STATIC, { ...NONE, desks: [desk] })).toBe('placement');
    expect(findChairConflict([22 * W + 69], BASE_TERRAIN, STATIC, { ...NONE, desks: [desk] })).toBeNull();
  });

  it('refuses a chair on a tile a wall rectangle covers', () => {
    const walls = new Array<string | null>(W * BASE_LAYOUT.height).fill(null);
    walls[free] = 'wall-brick';
    const walled = terrainSnapshot(BASE_LAYOUT, BASE_LAYOUT.blocks, walls);
    // The post on the top-left corner of the tile reaches into it and its three neighbors.
    expect(findChairConflict([free], walled, STATIC, NONE)).toBe('placement');
    expect(findChairConflict([free - W - 1], walled, STATIC, NONE)).toBe('placement');
    expect(findChairConflict([free + 1], walled, STATIC, NONE)).toBeNull();
  });
});
