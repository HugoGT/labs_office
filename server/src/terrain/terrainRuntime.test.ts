import { describe, expect, it, vi } from 'vitest';
import { TILE, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import { BASE_LAYOUT as OFFICE_LAYOUT, BLOCK_TILES, blockIndexAt, blockTileRect, isPositionWalkable, isTileWalkable, withWalls, type LayoutMaterial } from '../../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS, LEGACY_TERRAIN as BASE_TERRAIN } from '../../../src/test/legacyOffice.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import type { TerrainStore } from './terrainPort.ts';
import { InvalidTerrainEditError, TerrainProtectedError, type TerrainProtections } from './terrainRules.ts';
import { DecorOutsideAreaError, DeskChairLimitError, createTerrainRuntime } from './terrainRuntime.ts';

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
      saveBlocksClearingWalls: async () => { throw new Error('connection lost'); },
      loadBlockColors: async () => new Map(),
      loadWalls: async () => new Map(),
      saveWalls: async () => { throw new Error('connection lost'); },
      loadDecor: async () => [],
      saveDecor: async () => { throw new Error('connection lost'); },
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

  it('loads stored walls over the layout ones, ignoring posts off the map or whose footprint touches the spawn area', async () => {
    const spawn = at(PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
    // Two vertices down and right of the spawn tile: the post's joint reaches its ring.
    const nearSpawn = at(PLAYER_SPAWN_TX + 2, PLAYER_SPAWN_TY + 2);
    const store = createMemoryTerrain([], [[FREE, 'wall-glass'], [W * BASE_LAYOUT.height, 'wall-brick'], [spawn, 'wall-stone'], [nearSpawn, 'wall-stone']]);
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });

    await runtime.load();

    expect(runtime.walls()[FREE]).toBe('wall-glass');
    expect(runtime.walls()).toHaveLength(W * BASE_LAYOUT.height);
    expect(runtime.walls()[spawn]).toBe(BASE_LAYOUT.walls[spawn]);
    expect(runtime.walls()[nearSpawn]).toBe(BASE_LAYOUT.walls[nearSpawn]);
    // The post stands on the top-left corner of tile (67, 22): it blocks there, not the tile's middle.
    expect(isPositionWalkable(runtime.snapshot(), 67 * TILE, 22 * TILE - 11)).toBe(false);
    expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(true);
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
    // The body between the two posts, on the grid line y = 22 * TILE.
    const onBody = { x: 67 * TILE + TILE / 2, y: 22 * TILE - 11 };
    expect(isPositionWalkable(runtime.snapshot(), onBody.x, onBody.y)).toBe(false);
    expect(runtime.snapshot().walls).toEqual(runtime.walls());
    expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());

    await runtime.setWalls([{ index: FREE, piece: null }], 'admin-1', NONE);
    expect([...(await store.loadWalls())]).toEqual([[FREE + 1, 'wall-brick']]);
    expect(isPositionWalkable(runtime.snapshot(), onBody.x, onBody.y)).toBe(true);
    expect(isPositionWalkable(runtime.snapshot(), 68 * TILE, 22 * TILE - 11)).toBe(false);
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

  describe('placement order (#223)', () => {
    it('loads the stored walls in the order the store lists them, the layout ones unlisted', async () => {
      const store = createMemoryTerrain([], [[FREE + 3, 'wall-glass'], [FREE, 'wall-brick'], [FREE + 1, 'wall-stone']]);
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });

      expect(runtime.snapshot().wallOrder).toEqual([]);
      await runtime.load();

      expect(runtime.snapshot().wallOrder).toEqual([FREE + 3, FREE, FREE + 1]);
    });

    it('puts a placed or repainted post last, drops a removed one, and ignores an edit that changes nothing', async () => {
      const store = createMemoryTerrain();
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();

      await runtime.setWalls([{ index: FREE + 2, piece: 'wall-brick' }, { index: FREE, piece: 'wall-brick' }], null, NONE);
      expect(runtime.snapshot().wallOrder).toEqual([FREE + 2, FREE]);
      await runtime.setWalls([{ index: FREE + 1, piece: 'wall-glass' }], null, NONE);
      expect(runtime.snapshot().wallOrder).toEqual([FREE + 2, FREE, FREE + 1]);
      // A repaint makes the post the latest, in the runtime and in what a reload reads back.
      await runtime.setWalls([{ index: FREE + 2, piece: 'wall-stone' }], null, NONE);
      expect(runtime.snapshot().wallOrder).toEqual([FREE, FREE + 1, FREE + 2]);
      await runtime.setWalls([{ index: FREE, piece: 'wall-brick' }], null, NONE);
      expect(runtime.snapshot().wallOrder).toEqual([FREE, FREE + 1, FREE + 2]);
      await runtime.setWalls([{ index: FREE + 1, piece: null }], null, NONE);
      expect(runtime.snapshot().wallOrder).toEqual([FREE, FREE + 2]);

      const reloaded = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await reloaded.load();
      expect(reloaded.snapshot().wallOrder).toEqual([FREE, FREE + 2]);
    });

    it('keeps the order through a block edit and drops the posts a void edit removes', async () => {
      const lawn = blockTileRect(W, LAWN);
      const inside = at(lawn.tx + 4, lawn.ty + 4);
      // On the west border the post keeps ground on one side, so a void edit of the block leaves it.
      const border = at(lawn.tx, lawn.ty + 4);
      const store = createMemoryTerrain([], [[inside, 'wall-brick'], [border, 'wall-stone']]);
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();
      expect(runtime.snapshot().wallOrder).toEqual([inside, border]);

      await runtime.setBlocks([{ index: LAWN, material: 'void' }], null, NONE);

      expect(runtime.walls()[inside]).toBeNull();
      expect(runtime.walls()[border]).toBe('wall-stone');
      expect(runtime.snapshot().wallOrder).toEqual([border]);
    });
  });

  describe('when blocks turn to void (#217)', () => {
    const lawn = blockTileRect(W, LAWN);
    const lake = blockTileRect(W, LAKE);
    /** A post with every tile around it inside the lawn block. */
    const inside = at(lawn.tx + 4, lawn.ty + 4);

    it('removes the posts left with void on every side in the same save as the blocks, keeping the border ones', async () => {
      // On the shared edge of two blocks erased together, on the west border, and over an older void.
      const shared = at(lawn.tx + BLOCK_TILES, lawn.ty + 4);
      const border = at(lawn.tx, lawn.ty + 4);
      const older = at(lake.tx + 4, lake.ty + 4);
      const store = createMemoryTerrain([[LAKE, 'void']], [[inside, 'wall-brick'], [inside + 1, 'wall-brick'], [shared, 'wall-plaster'], [border, 'wall-stone'], [older, 'wall-glass']]);
      const saveBlocks = vi.spyOn(store, 'saveBlocks');
      const saveWalls = vi.spyOn(store, 'saveWalls');
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();
      const listener = vi.fn();
      runtime.subscribe(listener);

      await runtime.setBlocks([{ index: LAWN, material: 'void' }, { index: LAWN + 1, material: 'void' }], 'admin-1', NONE);

      expect(new Map(await store.loadBlocks())).toEqual(new Map([[LAKE, 'void'], [LAWN, 'void'], [LAWN + 1, 'void']]));
      expect(store.actorOf(LAWN)).toBe('admin-1');
      expect(new Map(await store.loadWalls())).toEqual(new Map([[border, 'wall-stone'], [older, 'wall-glass']]));
      expect(saveBlocks).not.toHaveBeenCalled();
      expect(saveWalls).not.toHaveBeenCalled();
      expect(runtime.walls()[inside]).toBeNull();
      expect(runtime.walls()[inside + 1]).toBeNull();
      expect(runtime.walls()[shared]).toBeNull();
      expect(runtime.walls()[border]).toBe('wall-stone');
      expect(runtime.walls()[older]).toBe('wall-glass');
      expect(runtime.snapshot().walls).toEqual(runtime.walls());
      expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());
    });

    it('keeps the carpet color of a block saved in the same batch as a void that clears walls', async () => {
      const store = createMemoryTerrain([], [[inside, 'wall-brick']]);
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();

      await runtime.setBlocks([{ index: LAWN, material: 'void' }, { index: LAKE, material: 'carpet', color: '#a0b1c2' }], null, NONE);

      expect(runtime.walls()[inside]).toBeNull();
      expect([...(await store.loadWalls())]).toEqual([]);
      expect(runtime.blockColors().get(LAKE)).toBe('#a0b1c2');
      expect([...(await store.loadBlockColors())]).toEqual([[LAKE, '#a0b1c2']]);
    });

    it('keeps every wall when a block turns into anything but void', async () => {
      const store = createMemoryTerrain([], [[inside, 'wall-brick']]);
      const saveWalls = vi.spyOn(store, 'saveWalls');
      const saveBlocksClearingWalls = vi.spyOn(store, 'saveBlocksClearingWalls');
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();

      await runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, NONE);
      await runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, NONE);

      expect([...(await store.loadWalls())]).toEqual([[inside, 'wall-brick']]);
      expect(runtime.walls()[inside]).toBe('wall-brick');
      expect(runtime.blocks()[LAWN]).toBe('sand');
      expect(saveWalls).not.toHaveBeenCalled();
      expect(saveBlocksClearingWalls).not.toHaveBeenCalled();
    });

    it('keeps the old blocks and walls when the save fails', async () => {
      const store = createMemoryTerrain([], [[inside, 'wall-brick']]);
      vi.spyOn(store, 'saveBlocksClearingWalls').mockRejectedValue(new Error('connection lost'));
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();
      const listener = vi.fn();
      runtime.subscribe(listener);

      await expect(runtime.setBlock({ index: LAWN, material: 'void', actorId: null }, NONE)).rejects.toThrow('connection lost');

      expect(runtime.blocks()[LAWN]).toBe(BASE_LAYOUT.blocks[LAWN]);
      expect(runtime.walls()[inside]).toBe('wall-brick');
      expect(runtime.snapshot().walls[inside]).toBe('wall-brick');
      expect(isTileWalkable(runtime.snapshot(), 67, 22)).toBe(true);
      expect(listener).not.toHaveBeenCalled();
    });
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
  it('runs an exclusive task in the edit queue, with the snapshot the edits before it left', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createMemoryTerrain() });
    await runtime.load();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: (string | null)[] = [];

    const wall = runtime.setWalls([{ index: FREE, piece: 'wall-brick' }], null, NONE);
    const task = runtime.runExclusive(async (snapshot) => {
      seen.push(snapshot.walls[FREE] ?? null);
      await held;
      return 'written';
    });
    const erase = runtime.setWalls([{ index: FREE, piece: null }], null, NONE);
    await wall;
    // The edit queued after the task waits for it to finish.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.walls()[FREE]).toBe('wall-brick');

    release();
    expect(await task).toBe('written');
    await erase;
    expect(seen).toEqual(['wall-brick']);
    expect(runtime.walls()[FREE]).toBeNull();
  });

  it('keeps the queue going after an exclusive task fails, and runs one without a store too', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT });
    await runtime.load();

    await expect(runtime.runExclusive(async () => {
      throw new Error('desk refused');
    })).rejects.toThrow('desk refused');
    expect(await runtime.runExclusive(async (snapshot) => snapshot.width)).toBe(W);
  });
});

describe('createTerrainRuntime decor', () => {
  const W = BASE_LAYOUT.width;
  const at = (tx: number, ty: number) => ty * W + tx;
  /** A free lawn tile: no seat, furniture or spawn on it, nor on the tiles around it. */
  const FREE = at(67, 22);
  const DESK = { x: 66, y: 21, w: 3, h: 3 };
  const WOOD_DOWN = { piece: 'chair-wood', rotation: 0 } as const;
  const CATALOG = [
    { id: 'chair-wood', kind: 'chair', retired: false },
    { id: 'chair-metal', kind: 'chair', retired: false },
    { id: 'desk-wood', kind: 'desk', retired: false },
    { id: 'desk-painted', kind: 'desk', colorable: true, retired: false },
    { id: 'plant-ficus', kind: 'plant', footprint: { w: 1, h: 1 }, retired: false },
    { id: 'table-meeting', kind: 'table', footprint: { w: 7, h: 5 }, retired: false },
    { id: 'plant-gone', kind: 'plant', footprint: { w: 1, h: 1 }, retired: true },
    { id: 'tree-oak', kind: 'tree', footprint: { w: 1, h: 1 }, retired: false },
  ];
  const decorPieces = async () => CATALOG;
  const runtimeWith = (store = createMemoryTerrain(), pieces = vi.fn(decorPieces)) =>
    createTerrainRuntime({ layout: BASE_LAYOUT, store, seats: BASE_MAP_SEATS, decorPieces: pieces });

  it('serves no decor until it loads, and without a store for good', async () => {
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT });
    await runtime.load();

    expect(runtime.decor()).toEqual([]);
    await expect(runtime.setDecor([{ index: FREE, item: WOOD_DOWN }], null)).rejects.toThrow(/no terrain store/);
  });

  it('loads stored items, ignoring only those off the map: one on a static tile is kept and drawn', async () => {
    const seat = BASE_MAP_SEATS[0]!;
    const store = createMemoryTerrain([], [], [
      { index: FREE, piece: 'chair-metal', rotation: 270 },
      { index: W * BASE_LAYOUT.height, piece: 'chair-wood', rotation: 0 },
      { index: at(seat.tx, seat.ty), piece: 'chair-wood', rotation: 0 },
    ]);
    const runtime = runtimeWith(store);

    await runtime.load();

    expect(runtime.decor()).toEqual([
      { index: at(seat.tx, seat.ty), piece: 'chair-wood', rotation: 0 },
      { index: FREE, piece: 'chair-metal', rotation: 270 },
    ]);
  });

  it('resolves the pieces it places from the catalog, retired ones included, with a fallback by id', async () => {
    const runtime = runtimeWith();
    await runtime.load();

    expect(runtime.decorInfo('table-meeting')).toEqual({ kind: 'table', footprint: { w: 7, h: 5 } });
    expect(runtime.decorInfo('plant-gone')).toEqual({ kind: 'plant', footprint: { w: 1, h: 1 } });
    expect(runtime.decorInfo('tree-oak')).toBeNull();
    expect(runtime.decorInfo('desk-glass')).toEqual({ kind: 'desk', footprint: { w: 3, h: 1 } });
    expect(runtime.decorInfo('table-unknown')).toBeNull();
  });

  it('places, turns and removes items atomically, telling every subscriber once per edit', async () => {
    const store = createMemoryTerrain();
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    await runtime.setDecor([{ index: FREE, item: WOOD_DOWN }, { index: FREE + 2 * W, item: { piece: 'desk-wood', rotation: 180 } }], 'admin-1');

    expect(runtime.decor()).toEqual([{ index: FREE, ...WOOD_DOWN }, { index: FREE + 2 * W, piece: 'desk-wood', rotation: 180 }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(store.decorActorOf(FREE)).toBe('admin-1');
    expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());

    await runtime.setDecor([{ index: FREE, item: null }, { index: FREE + 2 * W, item: { piece: 'desk-wood', rotation: 90 } }], 'admin-1');
    expect(runtime.decor()).toEqual([{ index: FREE + 2 * W, piece: 'desk-wood', rotation: 90 }]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('saves nothing and tells nobody when every tile already holds what the edit asks', async () => {
    const store = createMemoryTerrain([], [], [{ index: FREE, ...WOOD_DOWN }]);
    const saveDecor = vi.spyOn(store, 'saveDecor');
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    await runtime.setDecor([{ index: FREE, item: WOOD_DOWN }, { index: FREE + 5, item: null }], null);

    expect(saveDecor).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown piece', { piece: 'chair-throne', rotation: 0 }],
    ['a retired piece', { piece: 'plant-gone', rotation: 0 }],
    ['a piece the layer does not place', { piece: 'tree-oak', rotation: 0 }],
    ['a turned plant', { piece: 'plant-ficus', rotation: 90 }],
    ['a room table turned 180 (symmetric: only 0 and 90)', { piece: 'table-meeting', rotation: 180 }],
    ['a room table turned 270', { piece: 'table-meeting', rotation: 270 }],
    ['a color on a piece that takes none', { piece: 'desk-wood', rotation: 0, color: '#c83c3c' }],
    ['a color on a chair', { piece: 'chair-wood', rotation: 0, color: '#c83c3c' }],
  ] as const)('refuses %s as an invalid edit', async (_name, item) => {
    const runtime = runtimeWith();
    await runtime.load();

    await expect(runtime.setDecor([{ index: FREE, item }], null)).rejects.toThrow(InvalidTerrainEditError);
    expect(runtime.decor()).toEqual([]);
  });

  it('places a room table vertical (90) on its swapped footprint', async () => {
    const runtime = runtimeWith();
    await runtime.load();

    await runtime.setDecor([{ index: at(70, 30), item: { piece: 'table-meeting', rotation: 90 } }], null);

    expect(runtime.decor()).toEqual([{ index: at(70, 30), piece: 'table-meeting', rotation: 90 }]);
    // 5x7 now: a chair two columns right of the anchor is beside it, not under it.
    await runtime.setDecor([{ index: at(73, 30), item: WOOD_DOWN }], null);
    await expect(runtime.setDecor([{ index: at(70, 33), item: WOOD_DOWN }], null)).rejects.toThrow(TerrainProtectedError);
  });

  it('paints a colorable piece in its own color, saved with it, and repaints it as a change', async () => {
    const store = createMemoryTerrain();
    const runtime = runtimeWith(store);
    await runtime.load();

    await runtime.setDecor([{ index: FREE, item: { piece: 'desk-painted', rotation: 0, color: '#c83c3c' } }], null);
    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'desk-painted', rotation: 0, color: '#c83c3c' }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());

    await runtime.setDecor([{ index: FREE, item: { piece: 'desk-painted', rotation: 0, color: '#3c5ac8' } }], null);
    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'desk-painted', rotation: 0, color: '#3c5ac8' }]);
    // Without a color it draws in its manifest default.
    await runtime.setDecor([{ index: FREE, item: { piece: 'desk-painted', rotation: 0 } }], null);
    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'desk-painted', rotation: 0 }]);
  });

  it('keeps an already placed retired piece and lets it be removed', async () => {
    const store = createMemoryTerrain([], [], [{ index: FREE, piece: 'plant-gone', rotation: 0 }]);
    const runtime = runtimeWith(store);
    await runtime.load();

    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'plant-gone', rotation: 0 }]);
    await runtime.setDecor([{ index: FREE, item: null }], null);
    expect(runtime.decor()).toEqual([]);
  });

  it('refuses the whole batch when one item lands on water, a wall, a static tile or another item, never because of a desk', async () => {
    const store = createMemoryTerrain([], [[at(70, 22), 'wall-brick']], [{ index: FREE + 4, ...WOOD_DOWN }]);
    const runtime = runtimeWith(store);
    await runtime.load();

    await expect(runtime.setDecor([{ index: at(30, 30), item: WOOD_DOWN }, { index: at(94, 58), item: WOOD_DOWN }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(70, 22), item: WOOD_DOWN }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(PLAYER_SPAWN_TX, PLAYER_SPAWN_TY), item: WOOD_DOWN }], null)).rejects.toThrow(TerrainProtectedError);
    // A desk table along a column whose top end lands on the stored chair.
    await expect(runtime.setDecor([{ index: FREE + 4 + W, item: { piece: 'desk-wood', rotation: 90 } }], null)).rejects.toThrow(TerrainProtectedError);
    expect(runtime.decor()).toEqual([{ index: FREE + 4, ...WOOD_DOWN }]);

    // Inside a desk zone is fine: a desk is only a zone.
    await runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'desk-wood', rotation: 0 } }], null);
    expect(runtime.decor()).toContainEqual({ index: at(DESK.x + 1, DESK.y + 2), piece: 'desk-wood', rotation: 0 });
  });

  it('only edits inside the area it is given, removals and replacements included', async () => {
    const outside = at(DESK.x + 5, DESK.y);
    const store = createMemoryTerrain([], [], [{ index: outside, ...WOOD_DOWN }, { index: at(DESK.x, DESK.y), ...WOOD_DOWN }]);
    const runtime = runtimeWith(store);
    await runtime.load();

    // A desk table on the middle of the bottom row fits; one on the left column's corner does not.
    await runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'desk-wood', rotation: 0 } }], 'user-1', DESK);
    await expect(runtime.setDecor([{ index: at(DESK.x, DESK.y + 2), item: { piece: 'desk-wood', rotation: 90 } }], 'user-1', DESK)).rejects.toThrow(DecorOutsideAreaError);
    await expect(runtime.setDecor([{ index: outside, item: null }], 'user-1', DESK)).rejects.toThrow(DecorOutsideAreaError);
    await expect(runtime.setDecor([{ index: outside, item: { piece: 'chair-metal', rotation: 0 } }], 'user-1', DESK)).rejects.toThrow(DecorOutsideAreaError);
    // Removing what stands inside is fine.
    await runtime.setDecor([{ index: at(DESK.x, DESK.y), item: null }], 'user-1', DESK);
    expect(runtime.decor()).toEqual([
      { index: outside, ...WOOD_DOWN },
      { index: at(DESK.x + 1, DESK.y + 2), piece: 'desk-wood', rotation: 0 },
    ]);
  });

  describe('desk rules', () => {
    const desks = async () => [DESK];
    const table = (tx: number, ty: number, rotation: 0 | 90 = 0) => ({ index: at(tx, ty), piece: 'desk-wood', rotation }) as const;

    it('a desk table placed on a desk removes every other desk table on it, saved in the same batch', async () => {
      const store = createMemoryTerrain([], [], [table(DESK.x + 1, DESK.y)]);
      const saveDecor = vi.spyOn(store, 'saveDecor');
      const runtime = runtimeWith(store);
      await runtime.load();

      await runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'desk-wood', rotation: 0 } }], 'admin-1', undefined, desks);

      expect(runtime.decor()).toEqual([table(DESK.x + 1, DESK.y + 2)]);
      expect(await store.loadDecor()).toEqual(runtime.decor());
      expect(saveDecor).toHaveBeenCalledOnce();
    });

    it('in a batch the last desk table placed on a desk stays', async () => {
      const runtime = runtimeWith();
      await runtime.load();

      await runtime.setDecor([
        { index: at(DESK.x + 1, DESK.y), item: { piece: 'desk-wood', rotation: 0 } },
        { index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'desk-wood', rotation: 0 } },
      ], 'admin-1', undefined, desks);

      expect(runtime.decor()).toEqual([table(DESK.x + 1, DESK.y + 2)]);
    });

    it('in desk scope it also removes a displaced table that is not wholly inside the desk', async () => {
      // Anchored one tile left of the desk: only its right end lies on it.
      const partly = table(DESK.x - 1, DESK.y + 1);
      const store = createMemoryTerrain([], [], [partly]);
      const runtime = runtimeWith(store);
      await runtime.load();

      await runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'desk-wood', rotation: 0 } }], 'user-1', DESK, desks);

      expect(runtime.decor()).toEqual([table(DESK.x + 1, DESK.y + 2)]);
    });

    it('keeps a desk table off every desk, and the others without desks to read', async () => {
      const away = table(DESK.x + 1, DESK.y + 6);
      const store = createMemoryTerrain([], [], [away, table(DESK.x + 1, DESK.y)]);
      const runtime = runtimeWith(store);
      await runtime.load();

      await runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'desk-wood', rotation: 0 } }], null);
      expect(runtime.decor()).toHaveLength(3);
    });

    it('refuses a chair that would make a desk hold more than three', async () => {
      const store = createMemoryTerrain([], [], [
        { index: at(DESK.x, DESK.y), ...WOOD_DOWN },
        { index: at(DESK.x + 1, DESK.y), ...WOOD_DOWN },
        { index: at(DESK.x + 2, DESK.y), ...WOOD_DOWN },
      ]);
      const runtime = runtimeWith(store);
      await runtime.load();

      await expect(runtime.setDecor([{ index: at(DESK.x, DESK.y + 2), item: WOOD_DOWN }], 'user-1', DESK, desks)).rejects.toThrow(DeskChairLimitError);
      expect(runtime.decor()).toHaveLength(3);
      // Turning one, or moving one inside the desk, adds no chair.
      await runtime.setDecor([{ index: at(DESK.x, DESK.y), item: { piece: 'chair-wood', rotation: 90 } }], 'user-1', DESK, desks);
      await runtime.setDecor([{ index: at(DESK.x + 2, DESK.y), item: null }, { index: at(DESK.x + 2, DESK.y + 2), item: WOOD_DOWN }], 'user-1', DESK, desks);
      expect(runtime.decor()).toHaveLength(3);
    });
  });

  it('protects every tile of every item from water, void and walls', async () => {
    const store = createMemoryTerrain([], [], [{ index: FREE, piece: 'desk-wood', rotation: 0 }]);
    const runtime = runtimeWith(store);
    await runtime.load();

    await expect(runtime.setBlock({ index: LAWN, material: 'water', actorId: null }, NONE)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setBlock({ index: LAWN, material: 'void', actorId: null }, NONE)).rejects.toThrow(TerrainProtectedError);
    // The post on the bottom-right corner of the table's last tile reaches into it.
    await expect(runtime.setWalls([{ index: FREE + W + 2, piece: 'wall-brick' }], null, NONE)).rejects.toThrow(TerrainProtectedError);
    expect(runtime.blocks()[LAWN]).toBe(BASE_LAYOUT.blocks[LAWN]);
    expect(runtime.walls()[FREE + W + 2]).toBeNull();

    // Without the table the same edits go through.
    await runtime.setDecor([{ index: FREE, item: null }], null);
    await runtime.setWalls([{ index: FREE + W + 2, piece: 'wall-brick' }], null, NONE);
    expect(runtime.walls()[FREE + W + 2]).toBe('wall-brick');
  });

  it('keeps the old decor when saving fails', async () => {
    const store = createMemoryTerrain();
    vi.spyOn(store, 'saveDecor').mockRejectedValue(new Error('connection lost'));
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    await expect(runtime.setDecor([{ index: FREE, item: WOOD_DOWN }], null)).rejects.toThrow('connection lost');

    expect(runtime.decor()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('runs decor edits in the same queue as walls and blocks', async () => {
    const runtime = runtimeWith();
    await runtime.load();

    const wall = runtime.setWalls([{ index: FREE, piece: 'wall-brick' }], null, NONE);
    // Checked against the wall queued before it: refused.
    const decor = runtime.setDecor([{ index: FREE, item: WOOD_DOWN }], null);
    const seen = runtime.runExclusive(async () => runtime.decor());

    await wall;
    await expect(decor).rejects.toThrow(TerrainProtectedError);
    expect(await seen).toEqual([]);
  });
});

describe('createTerrainRuntime doors (#223)', () => {
  const W = BASE_LAYOUT.width;
  const at = (tx: number, ty: number) => ty * W + tx;
  const CATALOG = [
    { id: 'chair-wood', kind: 'chair', retired: false },
    { id: 'door-wood', kind: 'door', retired: false },
  ];
  /** A brick wall along row 22, posts on vertices 65..68, and a glass post on 69. */
  const WALL: [number, 'wall-brick' | 'wall-glass'][] = [
    [at(65, 22), 'wall-brick'],
    [at(66, 22), 'wall-brick'],
    [at(67, 22), 'wall-brick'],
    [at(68, 22), 'wall-brick'],
    [at(69, 22), 'wall-glass'],
  ];
  const DOOR = { piece: 'door-wood', rotation: 0 } as const;
  const runtimeWith = (store = createMemoryTerrain([], WALL)) =>
    createTerrainRuntime({ layout: BASE_LAYOUT, store, seats: BASE_MAP_SEATS, decorPieces: async () => CATALOG });
  /** Whether a body center at (cx, cy) may stand in the runtime's snapshot. */
  const passes = (runtime: ReturnType<typeof runtimeWith>, cx: number, cy: number) => isPositionWalkable(runtime.snapshot(), cx, cy - 11);
  /** The middle of the edge between posts (tx, 22) and (tx + 1, 22). */
  const through = (tx: number) => [tx * TILE + TILE / 2, 22 * TILE] as const;

  it('places a door on the edge between two joined posts and opens the wall there, and only there', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);
    expect(passes(runtime, ...through(66))).toBe(false);

    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], 'admin-1');

    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...DOOR }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());
    expect(runtime.snapshot().openings).toEqual([{ col: 66, row: 22, axis: 'horizontal' }]);
    expect(passes(runtime, ...through(66))).toBe(true);
    expect(passes(runtime, ...through(65))).toBe(false);
    expect(passes(runtime, ...through(67))).toBe(false);
  });

  it('refuses a door off a wall, across two materials, on unwalkable ground, in a desk or over another item', async () => {
    const runtime = runtimeWith(createMemoryTerrain([], WALL, [{ index: at(67, 21), piece: 'chair-wood', rotation: 0 }]));
    await runtime.load();

    await expect(runtime.setDecor([{ index: at(66, 25), item: DOOR }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(68, 22), item: DOOR }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(66, 22), item: { piece: 'door-wood', rotation: 90 } }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(67, 22), item: DOOR }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(30, 30), item: DOOR }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(66, 22), item: DOOR }], null, { x: 65, y: 21, w: 3, h: 3 })).rejects.toThrow(InvalidTerrainEditError);
    expect(runtime.decor()).toEqual([{ index: at(67, 21), piece: 'chair-wood', rotation: 0 }]);
    expect(runtime.snapshot().openings).toEqual([]);
  });

  it('keeps a chair that replaces a door off the wall the door leaves closed, as with no door there', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    const chair = { piece: 'chair-wood', rotation: 0 } as const;
    // Baseline: the same chair on the same tiles with no door is refused.
    await expect(runtime.setDecor([{ index: at(66, 22), item: chair }], null)).rejects.toThrow(TerrainProtectedError);
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);

    await expect(runtime.setDecor([{ index: at(66, 22), item: chair }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(66, 22), item: null }, { index: at(66, 21), item: chair }], null)).rejects.toThrow(TerrainProtectedError);
    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...DOOR }]);
    expect(passes(runtime, ...through(66))).toBe(true);
  });

  it('moves and removes a door like any decor item, closing the wall it leaves', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);

    await runtime.setDecor([{ index: at(66, 22), item: null }, { index: at(65, 22), item: { piece: 'door-wood', rotation: 180 } }], null);
    expect(runtime.decor()).toEqual([{ index: at(65, 22), piece: 'door-wood', rotation: 180 }]);
    expect(passes(runtime, ...through(66))).toBe(false);
    expect(passes(runtime, ...through(65))).toBe(true);

    await runtime.setDecor([{ index: at(65, 22), item: null }], null);
    expect(runtime.decor()).toEqual([]);
    expect(runtime.snapshot().openings).toEqual([]);
    expect(passes(runtime, ...through(65))).toBe(false);
  });

  it('refuses to erase a post that ends a door, data unchanged, and lets the rest of the wall change', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);
    const before = { walls: [...runtime.walls()], saved: await store.loadWalls(), openings: runtime.snapshot().openings };

    await expect(runtime.setWalls([{ index: at(66, 22), piece: null }], null, NONE)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setWalls([{ index: at(68, 22), piece: null }, { index: at(67, 22), piece: null }], null, NONE)).rejects.toThrow(TerrainProtectedError);
    expect([...runtime.walls()]).toEqual(before.walls);
    expect(await store.loadWalls()).toEqual(before.saved);
    expect(runtime.snapshot().openings).toEqual(before.openings);

    await runtime.setWalls([{ index: at(69, 22), piece: null }], null, NONE);
    expect(runtime.walls()[at(69, 22)]).toBeNull();
    // The door stays open through the wall edit.
    expect(passes(runtime, ...through(66))).toBe(true);

    await runtime.setDecor([{ index: at(66, 22), item: null }], null);
    await runtime.setWalls([{ index: at(66, 22), piece: null }], null, NONE);
    expect(runtime.walls()[at(66, 22)]).toBeNull();
  });

  it('repaints the posts a door stands on and keeps the door: still open, still on its edge, across two materials', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);

    await runtime.setWalls([{ index: at(67, 22), piece: 'wall-stone' }], null, NONE);
    expect(runtime.walls()[at(67, 22)]).toBe('wall-stone');
    expect(runtime.walls()[at(66, 22)]).toBe('wall-brick');
    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...DOOR }]);
    expect(runtime.snapshot().openings).toEqual([{ col: 66, row: 22, axis: 'horizontal' }]);
    expect(passes(runtime, ...through(66))).toBe(true);
    expect(passes(runtime, ...through(65))).toBe(false);
    expect(await store.loadWalls()).toContainEqual([at(67, 22), 'wall-stone']);

    // Both posts, in one batch, with the wall around them: nothing in it is refused for the door.
    const run = [65, 66, 67, 68].map((tx) => ({ index: at(tx, 22), piece: 'wall-glass' as const }));
    await runtime.setWalls(run, null, NONE);
    expect([65, 66, 67, 68].map((tx) => runtime.walls()[at(tx, 22)])).toEqual(['wall-glass', 'wall-glass', 'wall-glass', 'wall-glass']);
    expect(runtime.snapshot().openings).toEqual([{ col: 66, row: 22, axis: 'horizontal' }]);
    expect(passes(runtime, ...through(66))).toBe(true);
    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...DOOR }]);
  });

  it('repaints a wall run that crosses a door end post in one batch: the posts beside the door are not refused for its tiles', async () => {
    const store = createMemoryTerrain([], [...WALL, [at(66, 21), 'wall-brick'], [at(66, 23), 'wall-brick']]);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);

    const column = [21, 22, 23].map((ty) => ({ index: at(66, ty), piece: 'wall-stone' as const }));
    await runtime.setWalls(column, null, NONE);

    expect([21, 22, 23].map((ty) => runtime.walls()[at(66, ty)])).toEqual(['wall-stone', 'wall-stone', 'wall-stone']);
    expect(passes(runtime, ...through(66))).toBe(true);
    // A post the wall does not stand on yet still may not cover the door's tiles.
    await expect(runtime.setWalls([{ index: at(67, 21), piece: 'wall-stone' }], null, NONE)).rejects.toThrow(TerrainProtectedError);
  });

  it('opens the stored doors at load, and keeps them open through a block edit', async () => {
    const runtime = runtimeWith(createMemoryTerrain([], WALL, [{ index: at(66, 22), ...DOOR }]));
    await runtime.load();
    expect(passes(runtime, ...through(66))).toBe(true);

    await runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, NONE);
    expect(passes(runtime, ...through(66))).toBe(true);
  });
});
