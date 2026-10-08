import { describe, expect, it } from 'vitest';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY, TILE } from '../../../src/game/mapData.ts';
import {
  blockIndexAt,
  newlyWateredTiles,
  terrainSnapshot,
  withBlock,
  type LayoutMaterial,
} from '../../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_TERRAIN as BASE_TERRAIN, LEGACY_SEATS as BASE_MAP_SEATS } from '../../../src/test/legacyOffice.ts';
import {
  InvalidTerrainEditError,
  TerrainProtectedError,
  findWaterConflict,
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
  return newlyWateredTiles(BASE_TERRAIN, terrainSnapshot(BASE_LAYOUT, withBlock(BASE_LAYOUT.blocks, index, material)));
}

/** A network position whose avatar body sits in the middle of tile (tx, ty). */
function standingOn(tx: number, ty: number) {
  return { x: tx * TILE + 16, y: ty * TILE + 5 };
}

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

describe('findWaterConflict', () => {
  it('protects ground contact rather than the old offset tile, even when the center is outside', () => {
    const protections = { placements: [], players: [{ x: 100, y: 207 }] };
    // Footprint (91, 211)..(109, 225) crosses both x=96 and y=224.
    expect(findWaterConflict([7 * W + 3], W, new Set(), protections)).toBe('player');
    expect(findWaterConflict([5 * W + 2], W, new Set(), protections)).toBeNull();
  });

  it('lets water onto a free lawn and anything that is not water anywhere', () => {
    expect(findWaterConflict(watered(LAWN), W, STATIC, NONE)).toBeNull();
    expect(watered(blockIndexAt(W, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY), 'sand')).toEqual([]);
  });

  it('refuses water over the spawn area, where everyone enters', () => {
    expect(findWaterConflict(watered(blockIndexAt(W, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY)), W, STATIC, NONE)).toBe('placement');
  });

  it('refuses water under a space or a desk on a block edge, but never floods neighboring blocks', () => {
    const flooded = watered(LAWN);
    expect(flooded.every((tile) => tile % W >= 63 && tile % W < 72 && tile >= 18 * W && tile < 27 * W)).toBe(true);
    const tx = 63;
    const ty = 18;

    expect(findWaterConflict(flooded, W, STATIC, { placements: [{ x: tx, y: ty, w: 1, h: 1 }], players: [] })).toBe('placement');
    expect(findWaterConflict(flooded, W, STATIC, { placements: [{ x: 0, y: 0, w: 9, h: 9 }], players: [] })).toBeNull();
  });

  it('refuses water under a connected player, wherever their body touches it', () => {
    expect(findWaterConflict(watered(LAWN), W, STATIC, { placements: [], players: [standingOn(67, 22)] })).toBe('player');
    // Body center just right of the block's last column: a third of the body still overlaps it.
    const flooded = new Set(watered(LAWN));
    expect(flooded.has(22 * W + 71)).toBe(true);
    const halfIn = { x: 72 * TILE + 5, y: 22 * TILE + 5 };
    const players = { placements: [], players: [halfIn] };
    expect(findWaterConflict([22 * W + 71], W, new Set(), players)).toBe('player');
    expect(findWaterConflict(watered(LAWN), W, STATIC, { placements: [], players: [standingOn(10, 10)] })).toBeNull();
  });

  it('names the placement before the player: one of them moves away, the other does not', () => {
    const flooded = watered(LAWN);
    const protections: TerrainProtections = { placements: [{ x: 63, y: 18, w: 9, h: 9 }], players: [standingOn(67, 22)] };
    expect(findWaterConflict(flooded, W, STATIC, protections)).toBe('placement');
  });

  it('carries the reason on a typed error', () => {
    const error = new TerrainProtectedError('player');
    expect(error).toBeInstanceOf(Error);
    expect(error.reason).toBe('player');
  });
});
