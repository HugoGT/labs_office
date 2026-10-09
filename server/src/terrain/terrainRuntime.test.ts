import { describe, expect, it, vi } from 'vitest';
import { TILE, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import { BASE_LAYOUT as OFFICE_LAYOUT, BLOCK_TILES, blockIndexAt, blockTileRect, isPositionWalkable, isTileWalkable, withWalls, type LayoutMaterial } from '../../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS, LEGACY_TERRAIN as BASE_TERRAIN } from '../../../src/test/legacyOffice.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import type { TerrainStore } from './terrainPort.ts';
import { TerrainProtectedError, type TerrainProtections } from './terrainRules.ts';
import { createTerrainRuntime } from './terrainRuntime.ts';

const LAWN = 35;
const LAKE = 94;
const NONE = async (): Promise<TerrainProtections> => ({ placements: [], players: [] });

describe('createTerrainRuntime', () => {
  it.each([126, 135].flatMap((width) => (['water', 'grass', 'sand'] as const).map((material) => ({ width, material }))))(
    'ignores saved $material at the spawn block of a $width-tile layout without changing stored rows',
    async ({ width, material }) => {
      const spawn = blockIndexAt(width, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
      const blocks: LayoutMaterial[] = new Array((width / BLOCK_TILES) * (OFFICE_LAYOUT.height / BLOCK_TILES)).fill('water');
      blocks[spawn] = 'wood';
      const empty = () => new Array<null>(width * OFFICE_LAYOUT.height).fill(null);
      const layout = { ...OFFICE_LAYOUT, width, blocks, ground: empty(), walls: empty(), hedges: empty(), decals: empty() };
      const stored: readonly (readonly [number, LayoutMaterial])[] = [[spawn, material], [spawn - 1, 'grass']];
      const store = createMemoryTerrain(stored);
      const saveBlock = vi.spyOn(store, 'saveBlock');
      const saveBlocks = vi.spyOn(store, 'saveBlocks');
      const runtime = createTerrainRuntime({ layout, store, seats: [] });

      await runtime.load();

      expect(runtime.blocks()[spawn]).toBe('wood');
      expect(runtime.blocks()[spawn - 1]).toBe('grass');
      const { tx, ty, w, h } = blockTileRect(width, spawn);
      for (let y = ty; y < ty + h; y += 1) for (let x = tx; x < tx + w; x += 1) {
        expect(runtime.snapshot().materials[y * width + x]).toBe('wood');
        expect(isTileWalkable(runtime.snapshot(), x, y)).toBe(true);
      }
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        expect(isPositionWalkable(runtime.snapshot(), (PLAYER_SPAWN_TX + dx) * TILE + TILE / 2, (PLAYER_SPAWN_TY + dy) * TILE + TILE / 2)).toBe(true);
      }
      expect(new Map(await store.loadBlocks())).toEqual(new Map(stored));
      expect(saveBlock).not.toHaveBeenCalled();
      expect(saveBlocks).not.toHaveBeenCalled();
    },
  );

  it('serves the committed layout until it loads, and without a store for good', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT });

    await runtime.load();

    expect(runtime.blocks()).toEqual(BASE_LAYOUT.blocks);
    expect(runtime.snapshot().walkable).toEqual(BASE_TERRAIN.walkable);
    expect(runtime.editable).toBe(false);
  });

  it('builds the snapshot from the persisted blocks once, at load, ignoring blocks the map no longer has', async () => {
    const store = createMemoryTerrain([
      [LAWN, 'water'],
      [LAKE, 'grass'],
      [BASE_LAYOUT.blocks.length, 'sand'],
    ]);
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    const loadBlocks = vi.spyOn(store, 'loadBlocks');

    await runtime.load();
    runtime.snapshot();
    runtime.snapshot();

    expect(runtime.editable).toBe(true);
    expect(runtime.blocks()[LAWN]).toBe('water');
    expect(runtime.blocks()[LAKE]).toBe('grass');
    expect(runtime.blocks()).toHaveLength(BASE_LAYOUT.blocks.length);
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(false);
    expect(isTileWalkable(runtime.snapshot(), 94, 58)).toBe(true);
    expect(loadBlocks).toHaveBeenCalledTimes(1);
  });

  it('persists an accepted edit, rebuilds the snapshot and tells every subscriber the new blocks', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();
    const seen: (readonly LayoutMaterial[])[] = [];
    const unsubscribe = runtime.subscribe((blocks) => seen.push(blocks));

    await runtime.setBlock({ index: LAWN, material: 'water', actorId: 'admin-1' }, NONE);

    expect(new Map(await store.loadBlocks())).toEqual(new Map([[LAWN, 'water']]));
    expect(store.actorOf(LAWN)).toBe('admin-1');
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(false);
    expect(seen).toEqual([runtime.blocks()]);

    unsubscribe();
    await runtime.setBlock({ index: LAWN, material: 'sand', actorId: 'admin-1' }, NONE);
    expect(seen).toHaveLength(1);
  });

  it('accepts water under a player and announces it only after saving', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const someone = async (): Promise<TerrainProtections> => ({
      placements: [],
      players: [{ x: 67 * TILE + 32, y: 22 * TILE + 25 }],
    });

    await runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, someone);
    expect([...(await store.loadBlocks())]).toEqual([[LAWN, 'water']]);
    expect(runtime.blocks()[LAWN]).toBe('water');
    expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());
  });

  it('only reads the protections when the edit floods something', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await runtime.load();
    const protections = vi.fn(NONE);

    await runtime.setBlock({ index: LAKE, material: 'grass', actorId: null }, protections);
    await runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, protections);

    expect(protections).not.toHaveBeenCalled();
  });

  it('keeps the old terrain when saving fails', async () => {
    const store: TerrainStore = {
      loadBlocks: async () => new Map(),
      saveBlock: async () => {
        throw new Error('connection lost');
      },
      saveBlocks: async () => { throw new Error('connection lost'); },
      loadWalls: async () => new Map(),
      saveWalls: async () => { throw new Error('connection lost'); },
    };
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();

    await expect(runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, NONE)).rejects.toThrow('connection lost');

    expect(runtime.blocks()).toEqual(BASE_LAYOUT.blocks);
  });

  it('applies edits one after another, each checked against the terrain the previous one left', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await runtime.load();

    const first = runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, NONE);
    const second = runtime.setBlock({ index: LAWN + 1, material: 'water', actorId: null }, NONE);
    const failed = runtime.setBlock({ index: LAWN + 2, material: 'water', actorId: null }, async () => {
      throw new Error('spaces unavailable');
    });
    const third = runtime.setBlock({ index: 0, material: 'carpet', actorId: null }, NONE);

    await Promise.all([first, second, third]);
    await expect(failed).rejects.toThrow('spaces unavailable');
    expect(runtime.blocks()[LAWN]).toBe('water');
    expect(runtime.blocks()[LAWN + 1]).toBe('water');
    expect(runtime.blocks()[LAWN + 2]).toBe(BASE_LAYOUT.blocks[LAWN + 2]);
    expect(runtime.blocks()[0]).toBe('carpet');
  });

  it('refuses edits without a store', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT });

    await expect(runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, NONE)).rejects.toThrow(/no terrain store/);
  });
});

describe('createTerrainRuntime walls', () => {
  const W = BASE_LAYOUT.width;
  const at = (tx: number, ty: number) => ty * W + tx;
  /** A free lawn tile: no seat, furniture or spawn on it. */
  const FREE = at(67, 22);
  const DESK = { x: 66, y: 21, w: 3, h: 3 };

  it('serves the layout walls until it loads, and without a store for good', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT });
    await runtime.load();

    expect(runtime.walls()).toEqual(BASE_LAYOUT.walls);
    expect(runtime.snapshot().walls).toEqual(BASE_LAYOUT.walls);
    await expect(runtime.setWalls([{ index: FREE, piece: 'wall-brick' }], null, NONE)).rejects.toThrow(/no terrain store/);
  });

  it('loads stored walls over the layout ones, ignoring tiles off the map or under the spawn area', async () => {
    const spawn = at(PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
    const store = createMemoryTerrain([], [[FREE, 'wall-glass'], [W * BASE_LAYOUT.height, 'wall-brick'], [spawn, 'wall-stone']]);
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });

    await runtime.load();

    expect(runtime.walls()[FREE]).toBe('wall-glass');
    expect(runtime.walls()).toHaveLength(W * BASE_LAYOUT.height);
    expect(runtime.walls()[spawn]).toBe(BASE_LAYOUT.walls[spawn]);
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(false);
    expect(isTileWalkable(runtime.snapshot(), PLAYER_SPAWN_TX, PLAYER_SPAWN_TY)).toBe(true);
  });

  it('places and removes walls atomically, rebuilding the snapshot and telling every subscriber once', async () => {
    const store = createMemoryTerrain();
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    await runtime.setWalls([{ index: FREE, piece: 'wall-brick' }, { index: FREE + 1, piece: 'wall-brick' }], 'admin-1', NONE);

    expect(new Map(await store.loadWalls())).toEqual(new Map([[FREE, 'wall-brick'], [FREE + 1, 'wall-brick']]));
    expect(store.wallActorOf(FREE)).toBe('admin-1');
    expect(isTileWalkable(runtime.snapshot(), 68, 22)).toBe(false);
    expect(runtime.snapshot().walls).toEqual(runtime.walls());
    expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());

    await runtime.setWalls([{ index: FREE, piece: null }], 'admin-1', NONE);
    expect([...(await store.loadWalls())]).toEqual([[FREE + 1, 'wall-brick']]);
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the live walls when blocks change, and the live blocks when walls change', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await runtime.load();

    await runtime.setWalls([{ index: FREE, piece: 'wall-stone' }], null, NONE);
    await runtime.setBlock({ index: LAKE, material: 'grass', actorId: null }, NONE);
    await runtime.setWalls([{ index: FREE + 1, piece: 'wall-stone' }], null, NONE);

    expect(runtime.snapshot().walls).toEqual(withWalls(BASE_LAYOUT.walls, [{ index: FREE, piece: 'wall-stone' }, { index: FREE + 1, piece: 'wall-stone' }]));
    expect(runtime.blocks()[LAKE]).toBe('grass');
    expect(isTileWalkable(runtime.snapshot(), 94, 58)).toBe(true);
  });

  it('saves nothing and tells nobody when every tile already holds what the edit asks', async () => {
    const store = createMemoryTerrain([], [[FREE, 'wall-brick']]);
    const saveWalls = vi.spyOn(store, 'saveWalls');
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    await runtime.setWalls([{ index: FREE, piece: 'wall-brick' }, { index: FREE + 5, piece: null }], null, NONE);

    expect(saveWalls).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('refuses the whole batch when one wall lands on a desk or a static tile, reading protections only to place walls', async () => {
    const store = createMemoryTerrain([], [[FREE + 4, 'wall-brick']]);
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store, seats: BASE_MAP_SEATS });
    await runtime.load();
    const desks = vi.fn(async (): Promise<TerrainProtections> => ({ placements: [DESK], desks: [DESK], players: [] }));
    const seat = BASE_MAP_SEATS[0]!;

    await expect(runtime.setWalls([{ index: at(64, 19), piece: 'wall-brick' }, { index: FREE, piece: 'wall-brick' }], null, desks)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setWalls([{ index: at(seat.tx, seat.ty), piece: 'wall-brick' }], null, NONE)).rejects.toThrow(TerrainProtectedError);
    expect([...(await store.loadWalls())]).toEqual([[FREE + 4, 'wall-brick']]);
    expect(runtime.walls()[at(64, 19)]).toBeNull();

    desks.mockClear();
    await runtime.setWalls([{ index: FREE + 4, piece: null }], null, desks);
    expect(desks).not.toHaveBeenCalled();
    // A room is no desk: walls go inside and around rooms.
    await runtime.setWalls([{ index: FREE, piece: 'wall-plaster' }], null, async () => ({ placements: [DESK], desks: [], players: [] }));
    expect(runtime.walls()[FREE]).toBe('wall-plaster');
  });

  it('keeps the old walls when saving fails', async () => {
    const store = createMemoryTerrain();
    vi.spyOn(store, 'saveWalls').mockRejectedValue(new Error('connection lost'));
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    await expect(runtime.setWalls([{ index: FREE, piece: 'wall-brick' }], null, NONE)).rejects.toThrow('connection lost');

    expect(runtime.walls()).toEqual(BASE_LAYOUT.walls);
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('runs wall and block edits in one queue, each checked against what the previous one left', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await runtime.load();

    const wall = runtime.setWalls([{ index: FREE, piece: 'wall-brick' }], null, NONE);
    const failed = runtime.setWalls([{ index: FREE + 1, piece: 'wall-brick' }], null, async () => {
      throw new Error('desks unavailable');
    });
    const block = runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, NONE);
    const erase = runtime.setWalls([{ index: FREE, piece: null }, { index: FREE + 2, piece: 'wall-glass' }], null, NONE);

    await Promise.all([wall, block, erase]);
    await expect(failed).rejects.toThrow('desks unavailable');
    expect(runtime.walls()[FREE]).toBeNull();
    expect(runtime.walls()[FREE + 1]).toBeNull();
    expect(runtime.walls()[FREE + 2]).toBe('wall-glass');
    expect(runtime.snapshot().materials[FREE]).toBe('sand');
  });
});
