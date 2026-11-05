import { describe, expect, it, vi } from 'vitest';
import { TILE, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import { AVATAR_BODY_CENTER_OFFSET, BASE_LAYOUT as OFFICE_LAYOUT, BLOCK_TILES, blockIndexAt, blockTileRect, isPositionWalkable, isTileWalkable, withWalls, type LayoutMaterial } from '../../../src/game/officeLayout.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS as BASE_MAP_SEATS, LEGACY_TERRAIN as BASE_TERRAIN } from '../../../src/test/legacyOffice.ts';
import type { DirectoryPool } from '../directory/pgDirectory.ts';
import { createMemoryTerrain } from './memoryTerrain.ts';
import { createPgTerrain } from './pgTerrain.ts';
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
      loadBlockFloors: async () => new Map(),
      loadWalls: async () => new Map(),
      saveWalls: async () => { throw new Error('connection lost'); },
      loadDecor: async () => [],
      saveDecor: async () => { throw new Error('connection lost'); },
      saveWallsAndDecor: async () => { throw new Error('connection lost'); },
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

  it('loads cleanly over a database still holding a glass wall, a material that no longer exists (S17): that tile keeps the layout', async () => {
    const wallRows = [{ tile_index: FREE, piece_id: 'wall-glass' }, { tile_index: FREE + 1, piece_id: 'wall-brick' }];
    const run = async (text: string) => ({ rows: /from terrain_walls/i.test(text) ? wallRows : [], rowCount: 0 });
    const pool: DirectoryPool = { query: run, async connect() { return { query: run, release() {} }; }, async end() {} };
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store: createPgTerrain(pool) });

    await runtime.load();

    expect(runtime.walls()[FREE]).toBe(BASE_LAYOUT.walls[FREE]);
    expect(runtime.walls()[FREE + 1]).toBe('wall-brick');
  });

  it('loads stored walls over the layout ones, ignoring walls off the map or any of whose tiles touches the spawn area', async () => {
    const spawn = at(PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
    // Two rows below the spawn tile and one column right: the wall's upper tile is the corner of its ring.
    const nearSpawn = at(PLAYER_SPAWN_TX + 1, PLAYER_SPAWN_TY + 2);
    const store = createMemoryTerrain([], [[FREE, 'wall-plaster'], [W * BASE_LAYOUT.height, 'wall-brick'], [spawn, 'wall-stone'], [nearSpawn, 'wall-stone']]);
    const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });

    await runtime.load();

    expect(runtime.walls()[FREE]).toBe('wall-plaster');
    expect(runtime.walls()).toHaveLength(W * BASE_LAYOUT.height);
    expect(runtime.walls()[spawn]).toBe(BASE_LAYOUT.walls[spawn]);
    expect(runtime.walls()[nearSpawn]).toBe(BASE_LAYOUT.walls[nearSpawn]);
    // The wall stands on tile (67, 22) and covers rows 21 to 23 of its column, through its rectangle, never by tile.
    expect(isPositionWalkable(runtime.snapshot(), 67 * TILE, 22 * TILE - 11)).toBe(false);
    expect(isPositionWalkable(runtime.snapshot(), 67 * TILE + TILE / 2, 21 * TILE + TILE / 2 - 11)).toBe(false);
    expect(isPositionWalkable(runtime.snapshot(), 67 * TILE + TILE / 2, 24 * TILE + TILE / 2 - 11)).toBe(true);
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
    // A body center on the wall placed on (67, 22), on the line between its two upper tiles.
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
      const store = createMemoryTerrain([], [[FREE + 3, 'wall-plaster'], [FREE, 'wall-brick'], [FREE + 1, 'wall-stone']]);
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
      await runtime.setWalls([{ index: FREE + 1, piece: 'wall-plaster' }], null, NONE);
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
      // On the top row of the block the wall's upper tile stays on ground, so a void edit of the block leaves it.
      const border = at(lawn.tx + 4, lawn.ty);
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
    /** A wall with all three of its tiles inside the lawn block. */
    const inside = at(lawn.tx + 4, lawn.ty + 4);

    it('removes the walls left with void under all three tiles in the same save as the blocks, keeping the border ones', async () => {
      // In the next block erased together, on the top row (its upper tile on the block above), and over an older void.
      const shared = at(lawn.tx + BLOCK_TILES, lawn.ty + 4);
      const border = at(lawn.tx + 4, lawn.ty);
      const older = at(lake.tx + 4, lake.ty + 4);
      const store = createMemoryTerrain([[LAKE, 'void']], [[inside, 'wall-brick'], [inside + 1, 'wall-brick'], [shared, 'wall-plaster'], [border, 'wall-stone'], [older, 'wall-brick']]);
      const saveBlocks = vi.spyOn(store, 'saveBlocks');
      const saveWalls = vi.spyOn(store, 'saveWalls');
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();
      const listener = vi.fn();
      runtime.subscribe(listener);

      await runtime.setBlocks([{ index: LAWN, material: 'void' }, { index: LAWN + 1, material: 'void' }], 'admin-1', NONE);

      expect(new Map(await store.loadBlocks())).toEqual(new Map([[LAKE, 'void'], [LAWN, 'void'], [LAWN + 1, 'void']]));
      expect(store.actorOf(LAWN)).toBe('admin-1');
      expect(new Map(await store.loadWalls())).toEqual(new Map([[border, 'wall-stone'], [older, 'wall-brick']]));
      expect(saveBlocks).not.toHaveBeenCalled();
      expect(saveWalls).not.toHaveBeenCalled();
      expect(runtime.walls()[inside]).toBeNull();
      expect(runtime.walls()[inside + 1]).toBeNull();
      expect(runtime.walls()[shared]).toBeNull();
      expect(runtime.walls()[border]).toBe('wall-stone');
      expect(runtime.walls()[older]).toBe('wall-brick');
      expect(runtime.snapshot().walls).toEqual(runtime.walls());
      expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());
    });

    it('removes a wall that reaches into the block from the row above or below, over an older void', async () => {
      const above = LAWN - BASE_LAYOUT.width / BLOCK_TILES;
      const below = LAWN + BASE_LAYOUT.width / BLOCK_TILES;
      // Placed on the last row of the block above and on the first row of the block below: one tile of each is on the lawn.
      const fromAbove = at(lawn.tx + 2, lawn.ty - 1);
      const fromBelow = at(lawn.tx + 6, lawn.ty + BLOCK_TILES);
      const store = createMemoryTerrain([[above, 'void'], [below, 'void']], [[fromAbove, 'wall-brick'], [fromBelow, 'wall-stone']]);
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store });
      await runtime.load();
      expect(runtime.walls()[fromAbove]).toBe('wall-brick');
      expect(runtime.walls()[fromBelow]).toBe('wall-stone');

      await runtime.setBlocks([{ index: LAWN, material: 'void' }], null, NONE);

      expect(runtime.walls()[fromAbove]).toBeNull();
      expect(runtime.walls()[fromBelow]).toBeNull();
      expect([...(await store.loadWalls())]).toEqual([]);
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

    it('keeps the uploaded floor of a block saved in the same batch as a void that clears walls', async () => {
      const FLOOR = 'floor-upload-0123456789abcdef';
      const store = createMemoryTerrain([], [[inside, 'wall-brick']]);
      const runtime = createTerrainRuntime({ layout: BASE_LAYOUT, store, decorPieces: async () => [{ id: FLOOR, kind: 'floor', retired: false }] });
      await runtime.load();

      await runtime.setBlocks([{ index: LAWN, material: 'void' }, { index: LAKE, material: 'wood', floor: FLOOR }], null, NONE);

      expect(runtime.walls()[inside]).toBeNull();
      expect(runtime.blockFloors().get(LAKE)).toBe(FLOOR);
      expect([...(await store.loadBlockFloors())]).toEqual([[LAKE, FLOOR]]);
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
    const erase = runtime.setWalls([{ index: FREE, piece: null }, { index: FREE + 2, piece: 'wall-plaster' }], null, NONE);

    await Promise.all([wall, block, erase]);
    await expect(failed).rejects.toThrow('desks unavailable');
    expect(runtime.walls()[FREE]).toBeNull();
    expect(runtime.walls()[FREE + 1]).toBeNull();
    expect(runtime.walls()[FREE + 2]).toBe('wall-plaster');
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
    { id: 'tree-large', kind: 'tree', retired: false, footprint: { w: 1, h: 1 } },
    { id: 'chair-wood', kind: 'chair', retired: false },
    { id: 'chair-metal', kind: 'chair', retired: false },
    { id: 'chair-gamer', kind: 'chair', colorable: true, retired: false },
    { id: 'desk-wood', kind: 'desk', retired: false },
    { id: 'desk-painted', kind: 'desk', colorable: true, retired: false },
    { id: 'plant-bonsai', kind: 'plant', footprint: { w: 1, h: 1 }, retired: false },
    { id: 'table-meeting', kind: 'table', footprint: { w: 7, h: 5 }, retired: false },
    { id: 'plant-gone', kind: 'plant', footprint: { w: 1, h: 1 }, retired: true },
    { id: 'bridge-wood', kind: 'bridge', footprint: { w: 1, h: 1 }, retired: false },
    { id: 'sofa-leather-3', kind: 'sofa', footprint: { w: 3, h: 1 }, colorable: false, retired: false },
    { id: 'sofa-fabric-2', kind: 'sofa', footprint: { w: 2, h: 1 }, colorable: true, retired: false },
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
    expect(runtime.decorInfo('bridge-wood')).toBeNull();
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
    ['a piece the layer does not place', { piece: 'bridge-wood', rotation: 0 }],
    ['a turned plant', { piece: 'plant-bonsai', rotation: 90 }],
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

  it('paints the gamer chair in its own color, saved with it, and takes a color from no other chair', async () => {
    const store = createMemoryTerrain();
    const runtime = runtimeWith(store);
    await runtime.load();

    await runtime.setDecor([{ index: FREE, item: { piece: 'chair-gamer', rotation: 0, color: '#2a9d8f' } }], null);
    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'chair-gamer', rotation: 0, color: '#2a9d8f' }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());

    await expect(runtime.setDecor([{ index: FREE + 2, item: { piece: 'chair-metal', rotation: 0, color: '#2a9d8f' } }], null)).rejects.toThrow('this piece takes no color');
    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'chair-gamer', rotation: 0, color: '#2a9d8f' }]);
  });

  it('places a sofa over a tile per seat, turned four ways, painting only the fabric one', async () => {
    const store = createMemoryTerrain();
    const runtime = runtimeWith(store);
    await runtime.load();

    await runtime.setDecor([{ index: FREE, item: { piece: 'sofa-fabric-2', rotation: 270, color: '#2a9d8f' } }], null);
    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'sofa-fabric-2', rotation: 270, color: '#2a9d8f' }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    // Sideways it covers (67, 21..22): a chair on its other tile overlaps it.
    await expect(runtime.setDecor([{ index: at(67, 21), item: WOOD_DOWN }], null)).rejects.toThrow();

    await expect(runtime.setDecor([{ index: at(67, 26), item: { piece: 'sofa-leather-3', rotation: 0, color: '#2a9d8f' } }], null)).rejects.toThrow('this piece takes no color');
    await runtime.setDecor([{ index: at(67, 26), item: { piece: 'sofa-leather-3', rotation: 180 } }], null);
    expect(runtime.decor()).toHaveLength(2);
  });

  it('keeps an already placed retired piece and lets it be removed', async () => {
    const store = createMemoryTerrain([], [], [{ index: FREE, piece: 'plant-gone', rotation: 0 }]);
    const runtime = runtimeWith(store);
    await runtime.load();

    expect(runtime.decor()).toEqual([{ index: FREE, piece: 'plant-gone', rotation: 0 }]);
    await runtime.setDecor([{ index: FREE, item: null, layer: 'top' }], null);
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

  it('places no sofa from a desk, even one that fits it: sofas furnish the office', async () => {
    const runtime = runtimeWith();
    await runtime.load();

    await expect(runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'sofa-leather-3', rotation: 0 } }], 'user-1', DESK)).rejects.toThrow('a sofa is not for a desk');
    expect(runtime.decor()).toEqual([]);
    // The office scope places it on the same tiles.
    await runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 2), item: { piece: 'sofa-leather-3', rotation: 0 } }], null);
    expect(runtime.decor()).toEqual([{ index: at(DESK.x + 1, DESK.y + 2), piece: 'sofa-leather-3', rotation: 0 }]);
  });

  it('places no tree from a desk, only from the office scope, on its 1x1 base', async () => {
    const runtime = runtimeWith();
    await runtime.load();

    await expect(runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 1), item: { piece: 'tree-large', rotation: 0 } }], 'user-1', DESK)).rejects.toThrow('a tree is not for a desk');
    expect(runtime.decor()).toEqual([]);
    // A tree never turns.
    await expect(runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 1), item: { piece: 'tree-large', rotation: 90 } }], null)).rejects.toThrow('this piece does not turn that way');
    await runtime.setDecor([{ index: at(DESK.x + 1, DESK.y + 1), item: { piece: 'tree-large', rotation: 0 } }], null);
    expect(runtime.decor()).toEqual([{ index: at(DESK.x + 1, DESK.y + 1), piece: 'tree-large', rotation: 0 }]);
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
    // A wall placed right under the table's last tile reaches into it with its upper tile.
    const under = FREE + W + 1;
    await expect(runtime.setWalls([{ index: under, piece: 'wall-brick' }], null, NONE)).rejects.toThrow(TerrainProtectedError);
    expect(runtime.blocks()[LAWN]).toBe(BASE_LAYOUT.blocks[LAWN]);
    expect(runtime.walls()[under]).toBeNull();

    // Without the table the same edits go through.
    await runtime.setDecor([{ index: FREE, item: null }], null);
    await runtime.setWalls([{ index: under, piece: 'wall-brick' }], null, NONE);
    expect(runtime.walls()[under]).toBe('wall-brick');
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

describe('createTerrainRuntime doors and windows in tile walls (#223, #233, S6-S10)', () => {
  const W = BASE_LAYOUT.width;
  const at = (tx: number, ty: number) => ty * W + tx;
  /** The catalog the server reads: a door or window states its span along the wall as its footprint width. */
  const CATALOG = [
    { id: 'chair-wood', kind: 'chair', retired: false },
    { id: 'door-wood', kind: 'door', retired: false, footprint: { w: 2, h: 1 } },
    { id: 'door-wood-double', kind: 'door', retired: false, footprint: { w: 3, h: 1 } },
    { id: 'door-glass-window', kind: 'door', retired: false, footprint: { w: 2, h: 1 } },
  ];
  /**
   * A horizontal run on row 22, columns 65..71 (plaster from 69 on), and a vertical run down
   * column 65, rows 23..29: its dark top is rows 21..27, its face rows 28..30.
   */
  const WALL: [number, 'wall-brick' | 'wall-plaster'][] = [];
  for (let tx = 65; tx <= 71; tx += 1) WALL.push([at(tx, 22), tx >= 69 ? 'wall-plaster' : 'wall-brick']);
  for (let ty = 23; ty <= 29; ty += 1) WALL.push([at(65, ty), 'wall-brick']);
  const DOOR = { piece: 'door-wood', rotation: 0 } as const;
  const DOUBLE = { piece: 'door-wood-double', rotation: 0 } as const;
  const WINDOW = { piece: 'door-glass-window', rotation: 0 } as const;
  const VERTICAL = { piece: 'door-wood', rotation: 90 } as const;
  const runtimeWith = (store = createMemoryTerrain([], WALL)) =>
    createTerrainRuntime({ layout: BASE_LAYOUT, store, seats: BASE_MAP_SEATS, decorPieces: async () => CATALOG });
  /** Whether the room lets a body center stand on (cx, cy): what it checks a move by. */
  const centerWalkable = (runtime: ReturnType<typeof runtimeWith>, cx: number, cy: number) =>
    isPositionWalkable(runtime.snapshot(), cx - AVATAR_BODY_CENTER_OFFSET.x, cy - AVATAR_BODY_CENTER_OFFSET.y);
  /** The middle of tile (tx, ty), in world pixels. */
  const mid = (t: number) => t * TILE + TILE / 2;

  it('places a door between two walls of a horizontal run and lets people through its wall from the base up to the top (S7, S10)', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const wallsBefore = await store.loadWalls();
    // Before the door, every tile of the wall blocks.
    for (const ty of [21, 22, 23]) expect(centerWalkable(runtime, mid(66), mid(ty))).toBe(false);

    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], 'admin-1');

    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...DOOR }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(listener).toHaveBeenCalledExactlyOnceWith(runtime.blocks());
    expect(runtime.snapshot().openings).toEqual([{ axis: 'horizontal', tx: 66, ty: 22, span: 2, inset: 10 }]);
    for (const tx of [66, 67]) for (const ty of [21, 22, 23]) expect(centerWalkable(runtime, mid(tx), mid(ty)), `${tx},${ty}`).toBe(true);
    // The walls beside it still block, and the door adds and takes no wall.
    for (const tx of [65, 68]) expect(centerWalkable(runtime, mid(tx), mid(22))).toBe(false);
    expect(await store.loadWalls()).toEqual(wallsBefore);
  });

  it('places a double door as one item between two walls three tiles apart, across two materials', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    await runtime.setDecor([{ index: at(67, 22), item: DOUBLE }], null);
    expect(runtime.decor()).toEqual([{ index: at(67, 22), ...DOUBLE }]);
    expect(runtime.snapshot().openings).toEqual([{ axis: 'horizontal', tx: 67, ty: 22, span: 3 }]);
    expect(centerWalkable(runtime, mid(69), mid(22))).toBe(true);
  });

  it('places a door in a vertical run, in its dark top, and lets people across its own tiles only (S9)', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    await runtime.setDecor([{ index: at(65, 24), item: VERTICAL }], null);
    // One tile in a vertical run (L41).
    expect(runtime.snapshot().openings).toEqual([{ axis: 'vertical', tx: 65, ty: 24, span: 1 }]);
    expect([24].map((ty) => centerWalkable(runtime, mid(65), mid(ty)))).toEqual([true]);
    expect([23, 25].map((ty) => centerWalkable(runtime, mid(65), mid(ty)))).toEqual([false, false]);
  });

  it('places a window between two walls of a horizontal run without opening the wall (S7, S11)', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: WINDOW }], null);
    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...WINDOW }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(runtime.snapshot().openings).toEqual([]);
    for (const ty of [21, 22, 23]) expect(centerWalkable(runtime, mid(66), mid(ty))).toBe(false);
  });

  it('refuses a window in a vertical run or not between two walls, and a door off its wall, data unchanged (S7, S8)', async () => {
    const chair = { index: at(67, 24), piece: 'chair-wood', rotation: 0 } as const;
    const store = createMemoryTerrain([], WALL, [chair]);
    const runtime = runtimeWith(store);
    await runtime.load();
    const before = { decor: await store.loadDecor(), walls: await store.loadWalls() };

    const refused = [
      { index: at(65, 24), item: { piece: 'door-glass-window', rotation: 90 } },
      { index: at(65, 24), item: { piece: 'door-glass-window', rotation: 270 } },
      { index: at(65, 22), item: WINDOW },
      { index: at(70, 22), item: WINDOW },
      { index: at(66, 21), item: WINDOW },
      { index: at(65, 22), item: DOOR },
      { index: at(69, 22), item: DOUBLE },
      { index: at(65, 28), item: VERTICAL },
      { index: at(30, 30), item: DOOR },
      { index: at(W - 1, 22), item: DOOR },
    ] as const;
    for (const edit of refused) await expect(runtime.setDecor([edit], null), JSON.stringify(edit)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(66, 22), item: DOOR }], null, { x: 65, y: 21, w: 3, h: 3 })).rejects.toThrow(InvalidTerrainEditError);

    expect(runtime.decor()).toEqual([chair]);
    expect(await store.loadDecor()).toEqual(before.decor);
    expect(await store.loadWalls()).toEqual(before.walls);
    expect(runtime.snapshot().openings).toEqual([]);
  });

  it('replaces a window with a door and a door with a window in one save, the wall under them staying (S6)', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: WINDOW }], null);

    await runtime.setDecor([{ index: at(67, 22), item: DOOR }], 'admin-1');
    expect(runtime.decor()).toEqual([{ index: at(67, 22), ...DOOR }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(runtime.snapshot().openings).toEqual([{ axis: 'horizontal', tx: 67, ty: 22, span: 2, inset: 10 }]);

    await runtime.setDecor([{ index: at(66, 22), item: WINDOW }], 'admin-1');
    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...WINDOW }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(runtime.snapshot().openings).toEqual([]);
    expect([65, 66, 67, 68].map((tx) => runtime.walls()[at(tx, 22)])).toEqual(['wall-brick', 'wall-brick', 'wall-brick', 'wall-brick']);
  });

  it('refuses a door over another door, data unchanged: only a door and a window replace each other (S6)', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);
    const before = await store.loadDecor();
    await expect(runtime.setDecor([{ index: at(67, 22), item: DOOR }], 'admin-1')).rejects.toThrow(TerrainProtectedError);
    expect(await store.loadDecor()).toEqual(before);
    expect(runtime.decor()).toEqual(before);
  });

  it('refuses erasing the run under a vertical door down to its face, walls unchanged, so the door never stands in nothing', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(65, 24), item: VERTICAL }], null);
    const walls = await store.loadWalls();
    await expect(runtime.setWalls([26, 27, 28, 29].map((ty) => ({ index: at(65, ty), piece: null })), 'admin-1', NONE)).rejects.toThrow(TerrainProtectedError);
    expect(await store.loadWalls()).toEqual(walls);
    expect(runtime.snapshot().openings).toEqual([{ axis: 'vertical', tx: 65, ty: 24, span: 1 }]);
  });

  it('refuses a window over another window, data unchanged, and takes two side by side (L23)', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: WINDOW }], null);
    const before = await store.loadDecor();

    await expect(runtime.setDecor([{ index: at(67, 22), item: WINDOW }], 'admin-1')).rejects.toThrow(TerrainProtectedError);
    expect(await store.loadDecor()).toEqual(before);
    expect(runtime.decor()).toEqual(before);

    await runtime.setDecor([{ index: at(68, 22), item: WINDOW }], 'admin-1');
    expect(runtime.decor()).toEqual([
      { index: at(66, 22), ...WINDOW },
      { index: at(68, 22), ...WINDOW },
    ]);
  });

  it('takes a window right beside a door (L22)', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);

    // The door spans 66-67: a window on 68-69 stands right beside it.
    await runtime.setDecor([{ index: at(68, 22), item: WINDOW }], 'admin-1');
    expect(runtime.decor()).toEqual([
      { index: at(66, 22), ...DOOR },
      { index: at(68, 22), ...WINDOW },
    ]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
  });

  it('closes the wall of a door that goes: the wall it stood in stays whole, and keeps a chair off it', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);
    const walls = await store.loadWalls();

    await expect(runtime.setDecor([{ index: at(66, 22), item: null }, { index: at(66, 23), item: { piece: 'chair-wood', rotation: 0 } }], null)).rejects.toThrow(TerrainProtectedError);
    await runtime.setDecor([{ index: at(66, 22), item: null }], null);

    expect(runtime.decor()).toEqual([]);
    expect(runtime.snapshot().openings).toEqual([]);
    expect(await store.loadWalls()).toEqual(walls);
    expect(centerWalkable(runtime, mid(66), mid(22))).toBe(false);
  });

  it('refuses to erase any wall a door or window needs, data unchanged, and lets the rest of the run change', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);
    const before = { walls: [...runtime.walls()], saved: await store.loadWalls() };

    for (const tx of [65, 66, 67, 68]) await expect(runtime.setWalls([{ index: at(tx, 22), piece: null }], null, NONE)).rejects.toThrow(TerrainProtectedError);
    expect([...runtime.walls()]).toEqual(before.walls);
    expect(await store.loadWalls()).toEqual(before.saved);

    await runtime.setWalls([{ index: at(71, 22), piece: null }], null, NONE);
    expect(runtime.walls()[at(71, 22)]).toBeNull();
    expect(runtime.snapshot().openings).toEqual([{ axis: 'horizontal', tx: 66, ty: 22, span: 2, inset: 10 }]);
  });

  it('lets a wall a door needs go, with the tiles the door spans, once the door has left: the order the eraser sends them in', async () => {
    const runtime = runtimeWith(createMemoryTerrain([], WALL));
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);

    await runtime.setDecor([{ index: at(66, 22), item: null }], null);
    await runtime.setWalls([65, 66, 67].map((tx) => ({ index: at(tx, 22), piece: null })), null, NONE);

    for (const tx of [65, 66, 67]) expect(runtime.walls()[at(tx, 22)]).toBeNull();
    expect(runtime.walls()[at(68, 22)]).not.toBeNull();
    expect(runtime.snapshot().openings).toEqual([]);
  });

  it('repaints the walls a door stands in and keeps the door open, but refuses a new wall in its doorway', async () => {
    const store = createMemoryTerrain([], WALL);
    const runtime = runtimeWith(store);
    await runtime.load();
    await runtime.setDecor([{ index: at(66, 22), item: DOOR }], null);

    await runtime.setWalls([65, 66, 67, 68].map((tx) => ({ index: at(tx, 22), piece: 'wall-stone' as const })), null, NONE);
    expect([65, 66, 67, 68].map((tx) => runtime.walls()[at(tx, 22)])).toEqual(['wall-stone', 'wall-stone', 'wall-stone', 'wall-stone']);
    expect(runtime.snapshot().openings).toEqual([{ axis: 'horizontal', tx: 66, ty: 22, span: 2, inset: 10 }]);
    expect(await store.loadWalls()).toContainEqual([at(66, 22), 'wall-stone']);

    for (const index of [at(66, 20), at(67, 24)]) await expect(runtime.setWalls([{ index, piece: 'wall-brick' }], null, NONE)).rejects.toThrow(TerrainProtectedError);
  });

  it('opens the stored doors at load, and keeps them open through a block edit', async () => {
    const runtime = runtimeWith(createMemoryTerrain([], WALL, [{ index: at(66, 22), ...DOOR }, { index: at(65, 24), ...VERTICAL }, { index: at(69, 22), ...WINDOW }]));
    await runtime.load();
    const openings = [
      { axis: 'horizontal', tx: 66, ty: 22, span: 2, inset: 10 },
      { axis: 'vertical', tx: 65, ty: 24, span: 1 },
    ];
    expect(runtime.snapshot().openings).toEqual(openings);

    await runtime.setBlock({ index: LAWN, material: 'sand', actorId: null }, NONE);
    expect(runtime.snapshot().openings).toEqual(openings);
  });
});

/**
 * Moving a desk or a room carries what stands in it: the painted posts on or
 * inside its outline, the items inside it and the doors on its walls. The
 * terrain stays.
 */
describe('createTerrainRuntime carry', () => {
  const W = BASE_LAYOUT.width;
  const at = (tx: number, ty: number) => ty * W + tx;
  const CATALOG = [
    { id: 'chair-wood', kind: 'chair', retired: false },
    { id: 'door-wood', kind: 'door', retired: false, footprint: { w: 2, h: 1 } },
  ];
  /** A room of tiles 65..68 x 22..25 (walls placed on the ring 65..69 x 22..26, each covering a tile above and below), the top-right corner plaster. */
  const ROOM = { x: 65, y: 22, w: 4, h: 4 };
  const WALL: [number, 'wall-brick' | 'wall-plaster'][] = [];
  for (let tx = 65; tx <= 69; tx += 1) WALL.push([at(tx, 22), tx === 69 ? 'wall-plaster' : 'wall-brick'], [at(tx, 26), 'wall-brick']);
  for (let ty = 23; ty <= 25; ty += 1) WALL.push([at(65, ty), 'wall-brick'], [at(69, ty), 'wall-brick']);
  /** On row 24, the only row inside the room that its top and bottom walls leave free. */
  const CHAIR = { index: at(66, 24), piece: 'chair-wood', rotation: 90 } as const;
  const DOOR = { index: at(66, 22), piece: 'door-wood', rotation: 0 } as const;
  /** Outside the room: it stays. */
  const OUTSIDE = { index: at(71, 23), piece: 'chair-wood', rotation: 0 } as const;
  const runtimeWith = (store = createMemoryTerrain([], WALL, [CHAIR, DOOR, OUTSIDE])) =>
    createTerrainRuntime({ layout: BASE_LAYOUT, store, seats: BASE_MAP_SEATS, decorPieces: async () => CATALOG });
  /** Eight rows up: tiles 65..68 x 14..17, free lawn. */
  const UP = { from: ROOM, dx: 0, dy: -8 };

  it('carries the walls, the items and the doors of the area, saving them once and telling every subscriber once', async () => {
    const store = createMemoryTerrain([], WALL, [CHAIR, DOOR, OUTSIDE]);
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const write = vi.fn(async () => 'moved');

    await expect(runtime.carry(async () => UP, 'admin-1', NONE, write)).resolves.toBe('moved');

    const moved = (index: number) => index - 8 * W;
    for (const [index, piece] of WALL) {
      expect(runtime.walls()[index]).toBeNull();
      expect(runtime.walls()[moved(index)]).toBe(piece);
    }
    expect(runtime.decor()).toEqual([
      { ...DOOR, index: moved(DOOR.index) },
      { ...CHAIR, index: moved(CHAIR.index) },
      OUTSIDE,
    ]);
    expect(await store.loadWalls()).toEqual(new Map(WALL.map(([index, piece]) => [moved(index), piece])));
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(store.decorActorOf(moved(CHAIR.index))).toBe('admin-1');
    expect(store.wallActorOf(moved(at(65, 22)))).toBe('admin-1');
    // The door opens its wall where it now stands.
    expect(runtime.snapshot().openings).toEqual([{ axis: 'horizontal', tx: 66, ty: 14, span: 2, inset: 10 }]);
    expect(listener).toHaveBeenCalledOnce();
    // The write sees the layer the move leaves, before it is saved.
    expect(write).toHaveBeenCalledExactlyOnceWith({ width: W, walls: runtime.walls(), decor: runtime.decor() });
  });

  it('puts the desk or room back when saving its contents fails, keeping the layer as it was', async () => {
    const store = createMemoryTerrain([], WALL, [CHAIR, DOOR, OUTSIDE]);
    store.saveWallsAndDecor = async () => { throw new Error('connection lost'); };
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const walls = runtime.walls();
    const decor = runtime.decor();
    const steps: string[] = [];
    const write = vi.fn(async () => { steps.push('write'); return 'moved'; });
    const undo = vi.fn(async () => { steps.push('undo'); });

    await expect(runtime.carry(async () => UP, null, NONE, write, undo)).rejects.toThrow('connection lost');

    expect(steps).toEqual(['write', 'undo']);
    expect(runtime.walls()).toBe(walls);
    expect(runtime.decor()).toBe(decor);
    expect(listener).not.toHaveBeenCalled();
  });

  it('still answers the save failure when putting the desk or room back fails too', async () => {
    const store = createMemoryTerrain([], WALL, [CHAIR, DOOR, OUTSIDE]);
    store.saveWallsAndDecor = async () => { throw new Error('connection lost'); };
    const runtime = runtimeWith(store);
    await runtime.load();

    await expect(runtime.carry(async () => UP, null, NONE, async () => 'moved', async () => { throw new Error('undo failed'); })).rejects.toThrow('connection lost');
  });

  it('never puts back a move that saved, found nothing or was refused', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    const undo = vi.fn(async () => undefined);

    await runtime.carry(async () => ({ from: { x: 66, y: 23, w: 1, h: 1 }, dx: 0, dy: -8 }), null, NONE, async () => 'moved', undo);
    await runtime.carry(async () => UP, null, NONE, async () => null, undo);
    await expect(runtime.carry(async () => UP, null, NONE, async () => { throw new Error('overlap'); }, undo)).rejects.toThrow('overlap');

    expect(undo).not.toHaveBeenCalled();
  });

  it('saves nothing when the write finds nothing to move or fails', async () => {
    const store = createMemoryTerrain([], WALL, [CHAIR, DOOR, OUTSIDE]);
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const walls = runtime.walls();
    const decor = runtime.decor();

    await expect(runtime.carry(async () => UP, null, NONE, async () => null)).resolves.toBeNull();
    await expect(runtime.carry(async () => UP, null, NONE, async () => { throw new Error('overlap'); })).rejects.toThrow('overlap');

    expect(runtime.walls()).toBe(walls);
    expect(runtime.decor()).toBe(decor);
    expect(await store.loadWalls()).toEqual(new Map(WALL));
    expect(await store.loadDecor()).toEqual(decor);
    expect(listener).not.toHaveBeenCalled();
  });

  it('erases the items that stood where the area lands, carried ones replacing them, and saves it all once', async () => {
    const blocker = { index: CHAIR.index - 8 * W, piece: 'chair-wood', rotation: 0 } as const;
    const inside = { index: at(67, 16), piece: 'chair-wood', rotation: 180 } as const;
    const clear = { index: at(63, 16), piece: 'chair-wood', rotation: 0 } as const;
    const store = createMemoryTerrain([], WALL, [CHAIR, DOOR, OUTSIDE, blocker, inside, clear]);
    const runtime = runtimeWith(store);
    await runtime.load();
    const write = vi.fn(async () => 'moved');

    await expect(runtime.carry(async () => UP, 'admin-1', NONE, write)).resolves.toBe('moved');

    expect(runtime.decor()).toEqual([
      { ...DOOR, index: DOOR.index - 8 * W },
      clear,
      { ...CHAIR, index: CHAIR.index - 8 * W },
      OUTSIDE,
    ]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
  });

  it('lands an empty area empty: what stood there goes', async () => {
    const store = createMemoryTerrain([], [], [{ index: at(77, 20), piece: 'chair-wood', rotation: 0 }]);
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    await runtime.carry(async () => ({ from: { x: 75, y: 12, w: 3, h: 3 }, dx: 0, dy: 7 }), null, NONE, async () => 'moved');

    expect(runtime.decor()).toEqual([]);
    expect(await store.loadDecor()).toEqual([]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('refuses a move whose contents would land off the map, before writing', async () => {
    const store = createMemoryTerrain([], WALL, [CHAIR, DOOR, OUTSIDE]);
    const runtime = runtimeWith(store);
    await runtime.load();
    const write = vi.fn(async () => 'moved');

    await expect(runtime.carry(async () => ({ from: ROOM, dx: 0, dy: -30 }), null, NONE, write)).rejects.toThrow(TerrainProtectedError);

    expect(write).not.toHaveBeenCalled();
    expect(await store.loadWalls()).toEqual(new Map(WALL));
    expect(await store.loadDecor()).toEqual([DOOR, CHAIR, OUTSIDE].sort((a, b) => a.index - b.index));
  });

  it('refuses walls that would land on a desk, reading the protections only to carry walls', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    const protections = vi.fn(async (): Promise<TerrainProtections> => ({ placements: [], players: [], desks: [{ x: 66, y: 12, w: 3, h: 3 }] }));

    await expect(runtime.carry(async () => UP, null, protections, async () => 'moved')).rejects.toThrow(TerrainProtectedError);
    expect(protections).toHaveBeenCalledOnce();

    // A desk area holds no wall: its decor goes without asking.
    protections.mockClear();
    await runtime.carry(async () => ({ from: { x: 66, y: 24, w: 1, h: 1 }, dx: 0, dy: -8 }), null, protections, async () => 'moved');
    expect(protections).not.toHaveBeenCalled();
    expect(runtime.decor()).toContainEqual({ ...CHAIR, index: CHAIR.index - 8 * W });
  });

  it('leaves the posts the layout itself draws: removing one could not be stored', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    const walls = runtime.walls();
    // The layout's plaster wall runs along row 3.
    expect(walls[at(55, 3)]).toBe('wall-plaster');

    await expect(runtime.carry(async () => ({ from: { x: 55, y: 2, w: 2, h: 2 }, dx: 0, dy: 10 }), null, NONE, async () => 'moved')).resolves.toBe('moved');

    expect(runtime.walls()).toBe(walls);
  });

  it('just writes when there is nothing to carry or nowhere to carry it, without a store too', async () => {
    const runtime = runtimeWith();
    await runtime.load();
    const write = vi.fn(async () => 'moved');

    await expect(runtime.carry(async () => null, null, NONE, write)).resolves.toBe('moved');
    await expect(runtime.carry(async () => ({ from: { x: 75, y: 12, w: 3, h: 3 }, dx: 1, dy: 0 }), null, NONE, write)).resolves.toBe('moved');
    const bare = createTerrainRuntime({ layout: BASE_LAYOUT });
    await expect(bare.carry(async () => UP, null, NONE, write)).resolves.toBe('moved');

    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledWith({ width: W, walls: runtime.walls(), decor: runtime.decor() });
  });
});

describe('createTerrainRuntime top layer (#121)', () => {
  const W = BASE_LAYOUT.width;
  const at = (tx: number, ty: number) => ty * W + tx;
  /** A free lawn desk area; its desk table on (67, 22) covers (66..68, 22). */
  const DESK = { x: 66, y: 21, w: 3, h: 3 };
  const TABLE = { index: at(67, 22), piece: 'desk-wood', rotation: 0 } as const;
  const BONSAI = { piece: 'plant-bonsai', rotation: 0 } as const;
  const CATALOG = [
    { id: 'chair-wood', kind: 'chair', retired: false },
    { id: 'desk-wood', kind: 'desk', retired: false },
    { id: 'desk-glass', kind: 'desk', retired: false },
    { id: 'plant-bonsai', kind: 'plant', footprint: { w: 1, h: 1 }, retired: false },
    { id: 'plant-wide', kind: 'plant', footprint: { w: 2, h: 1 }, retired: false },
    // A catalog piece of a top kind whose id says the floor: no such piece may be placed.
    { id: 'chair-pot', kind: 'plant', footprint: { w: 1, h: 1 }, retired: false },
  ];
  const runtimeWith = (store = createMemoryTerrain([], [], [TABLE])) =>
    createTerrainRuntime({ layout: BASE_LAYOUT, store, seats: BASE_MAP_SEATS, decorPieces: async () => CATALOG });

  it('stands a piece on top of a desk table, on the desk table own anchor too, saved on its own layer', async () => {
    const store = createMemoryTerrain([], [], [TABLE]);
    const runtime = runtimeWith(store);
    await runtime.load();

    await runtime.setDecor([{ index: TABLE.index, item: BONSAI }, { index: at(66, 22), item: BONSAI }], 'user-1');

    expect(runtime.decor()).toEqual([{ index: at(66, 22), ...BONSAI }, TABLE, { index: TABLE.index, ...BONSAI }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(store.decorActorOf(TABLE.index, 'top')).toBe('user-1');
    expect(store.decorActorOf(TABLE.index)).toBeNull();
  });

  it('refuses a top piece off any surface, over another top piece, or of a top kind on the floor, saving nothing', async () => {
    const store = createMemoryTerrain([], [], [TABLE, { index: at(66, 22), ...BONSAI }]);
    const saveDecor = vi.spyOn(store, 'saveDecor');
    const runtime = runtimeWith(store);
    await runtime.load();

    await expect(runtime.setDecor([{ index: at(70, 22), item: BONSAI }], null)).rejects.toThrow(TerrainProtectedError);
    // 2x1 on (67, 22) covers (66..67, 22), over the bonsai; on (69, 22), (68..69, 22), off the desk table's end.
    await expect(runtime.setDecor([{ index: at(67, 22), item: { piece: 'plant-wide', rotation: 0 } }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(69, 22), item: { piece: 'plant-wide', rotation: 0 } }], null)).rejects.toThrow(TerrainProtectedError);
    await expect(runtime.setDecor([{ index: at(70, 22), item: { piece: 'chair-pot', rotation: 0 } }], null)).rejects.toThrow(InvalidTerrainEditError);
    expect(saveDecor).not.toHaveBeenCalled();
  });

  it('takes off what stands on a desk table removed or turned, in the same save, and keeps it on one replaced in place', async () => {
    const onTop = { index: at(66, 22), ...BONSAI };
    const elsewhere = { index: at(80, 22), piece: 'desk-wood', rotation: 0 } as const;
    const store = createMemoryTerrain([], [], [TABLE, onTop, elsewhere, { index: at(80, 22), ...BONSAI }]);
    const saveDecor = vi.spyOn(store, 'saveDecor');
    const runtime = runtimeWith(store);
    await runtime.load();
    const listener = vi.fn();
    runtime.subscribe(listener);

    // Another desk table of the same footprint keeps it standing.
    await runtime.setDecor([{ index: TABLE.index, item: { piece: 'desk-glass', rotation: 180 } }], null);
    expect(runtime.decor()).toContainEqual(onTop);

    // Turned vertical it covers (67, 21..23): the piece on (66, 22) falls with the turn.
    await runtime.setDecor([{ index: TABLE.index, item: { piece: 'desk-glass', rotation: 90 } }], 'admin-1');
    expect(saveDecor).toHaveBeenLastCalledWith([{ index: TABLE.index, item: { piece: 'desk-glass', rotation: 90 } }, { index: onTop.index, item: null, layer: 'top' }], 'admin-1');
    expect(runtime.decor()).not.toContainEqual(onTop);

    await runtime.setDecor([{ index: elsewhere.index, item: null }], null);
    expect(runtime.decor()).toEqual([{ index: TABLE.index, piece: 'desk-glass', rotation: 90 }]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('removes a top piece alone when the edit names its layer, and the floor item alone when it names none', async () => {
    const store = createMemoryTerrain([], [], [TABLE, { index: TABLE.index, ...BONSAI }]);
    const runtime = runtimeWith(store);
    await runtime.load();

    await runtime.setDecor([{ index: TABLE.index, item: null, layer: 'top' }], null);
    expect(runtime.decor()).toEqual([TABLE]);
    await runtime.setDecor([{ index: TABLE.index, item: BONSAI }], null);
    await runtime.setDecor([{ index: TABLE.index, item: null }], null);
    // The floor item goes, and with it what stood on it.
    expect(runtime.decor()).toEqual([]);
  });

  it('takes off what stood on a desk table another one displaces from the desk', async () => {
    const store = createMemoryTerrain([], [], [TABLE, { index: at(66, 22), ...BONSAI }]);
    const runtime = runtimeWith(store);
    await runtime.load();

    await runtime.setDecor([{ index: at(67, 23), item: { piece: 'desk-wood', rotation: 0 } }], null, undefined, async () => [DESK]);

    expect(runtime.decor()).toEqual([{ index: at(67, 23), piece: 'desk-wood', rotation: 0 }]);
  });

  it('carries what stands on a desk table with the desk, and drops what stood across onto a desk table left behind', async () => {
    const neighbour = { index: at(70, 22), piece: 'desk-wood', rotation: 0 } as const;
    const across = { index: at(69, 22), piece: 'plant-wide', rotation: 0 } as const;
    const onTop = { index: TABLE.index, ...BONSAI };
    const store = createMemoryTerrain([], [], [TABLE, onTop, neighbour, across]);
    const runtime = runtimeWith(store);
    await runtime.load();

    await expect(runtime.carry(async () => ({ from: DESK, dx: 0, dy: -8 }), 'admin-1', NONE, async () => 'moved')).resolves.toBe('moved');

    const up = (index: number) => index - 8 * W;
    expect(runtime.decor()).toEqual([{ ...TABLE, index: up(TABLE.index) }, { ...onTop, index: up(onTop.index) }, neighbour]);
    expect(await store.loadDecor()).toEqual(runtime.decor());
    expect(store.decorActorOf(up(onTop.index), 'top')).toBe('admin-1');
  });
});
