/**
 * The live terrain of the server (#123 phase 2): the persisted blocks and the
 * `TerrainSnapshot` built from them, kept in memory. `OfficeRoom` checks every
 * `move` against `snapshot()`, so a move never queries Postgres; the snapshot
 * is rebuilt once at `load()` and once per accepted edit.
 *
 * Edits run one at a time, block and wall edits in the same queue. Each one
 * is checked against the terrain the previous one left and against
 * protections read at that moment, and the snapshot only changes after the
 * store saved it: a failed save leaves the office exactly as it was.
 *
 * The runtime owns the painted walls too: they are one more layer of the
 * snapshot (`terrainSnapshot(layout, blocks, walls)`), so the room refuses
 * moves into them and relocates whoever stands where one lands exactly like
 * after a block edit.
 */

import {
  blockCount,
  blockIndexAt,
  encodeTerrainBlocks,
  newlyUnwalkableTiles,
  terrainSnapshot,
  withBlock,
  withWalls,
  type LayoutMaterial,
  type OfficeLayout,
  type TerrainSnapshot,
  type WallEdit,
} from '../../../src/game/officeLayout.ts';
import { BASE_MAP_SEATS, type MapSeat } from '../../../src/game/seating.ts';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import type { TerrainStore } from './terrainPort.ts';
import {
  TerrainProtectedError,
  TerrainStaleError,
  parseTerrainBatch,
  parseWallBatch,
  findUnwalkableConflict,
  findWallConflict,
  staticProtectedTiles,
  type TerrainEdit,
  type TerrainProtections,
} from './terrainRules.ts';

/**
 * Called after each accepted edit, block or wall, with the whole block list.
 * `snapshot()` already answers with the new terrain, live walls included.
 */
export type TerrainListener = (blocks: readonly LayoutMaterial[]) => void;

export interface TerrainRuntime {
  /** Reads the persisted blocks. Called once, after the schema is applied. */
  load(): Promise<void>;
  blocks(): readonly LayoutMaterial[];
  snapshot(): TerrainSnapshot;
  /** False without a store (no `DATABASE_URL`): the terrain is the layout's for good. */
  readonly editable: boolean;
  /**
   * Applies one edit, or throws `TerrainProtectedError` when water or void would land
   * under something `protections` (read only if the edit floods a tile) or
   * the static layout protects.
   */
  setBlock(edit: TerrainEdit & { actorId: string | null }, protections: () => Promise<TerrainProtections>): Promise<readonly LayoutMaterial[]>;
  setBlocks(edits: readonly TerrainEdit[], actorId: string | null, protections: () => Promise<TerrainProtections>, expected?: string): Promise<readonly LayoutMaterial[]>;
  /** The live wall piece of every tile, row major: the layout's, overridden by the stored ones. */
  walls(): readonly (string | null)[];
  /**
   * Places or removes walls atomically, or throws `TerrainProtectedError`
   * when one would stand on a desk (`protections`, read only when the edit
   * places a wall) or a tile the static layout protects.
   */
  setWalls(edits: readonly WallEdit[], actorId: string | null, protections: () => Promise<TerrainProtections>): Promise<readonly (string | null)[]>;
  /** Called after each accepted edit; see `TerrainListener`. */
  subscribe(listener: TerrainListener): () => void;
}

export function createTerrainRuntime({ layout, store, seats = BASE_MAP_SEATS }: { layout: OfficeLayout; store?: TerrainStore; seats?: readonly MapSeat[] }): TerrainRuntime {
  const spawn = blockIndexAt(layout.width, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
  const staticTiles = staticProtectedTiles(layout, seats);
  const listeners = new Set<TerrainListener>();
  let blocks: readonly LayoutMaterial[] = layout.blocks;
  let walls: readonly (string | null)[] = layout.walls;
  let snapshot = terrainSnapshot(layout, blocks, walls);
  let queue: Promise<unknown> = Promise.resolve();

  /** Runs `edit` after every edit queued before it; the chain survives a refused or failed one. */
  function enqueue<T>(edit: () => Promise<T>): Promise<T> {
    const run = queue.then(edit);
    queue = run.catch(() => undefined);
    return run;
  }

  async function apply(
    edits: readonly TerrainEdit[], actorId: string | null,
    protections: () => Promise<TerrainProtections>,
    expected?: string,
  ): Promise<readonly LayoutMaterial[]> {
    if (!store) throw new Error('no terrain store: the terrain cannot be edited');
    parseTerrainBatch({ edits, expected: expected ?? encodeTerrainBlocks(blocks) }, blocks.length);
    if (expected !== undefined && expected !== encodeTerrainBlocks(blocks)) throw new TerrainStaleError('terrain changed since preview');
    if (edits.some(({ index, material }) => index === spawn && material !== 'wood')) throw new TerrainProtectedError('placement');
    const changed = edits.filter(({ index, material }) => blocks[index] !== material);
    if (changed.length === 0) return blocks;
    let next = [...blocks];
    for (const { index, material } of changed) next = withBlock(next, index, material);
    const nextSnapshot = terrainSnapshot(layout, next, walls);
    const watered = newlyUnwalkableTiles(snapshot, nextSnapshot);
    if (watered.length > 0) {
      const conflict = findUnwalkableConflict(watered, layout.width, staticTiles, await protections());
      if (conflict !== null) throw new TerrainProtectedError(conflict);
    }
    await store.saveBlocks(changed, actorId);
    blocks = next;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return blocks;
  }

  async function applyWalls(
    edits: readonly WallEdit[], actorId: string | null,
    protections: () => Promise<TerrainProtections>,
  ): Promise<readonly (string | null)[]> {
    if (!store) throw new Error('no terrain store: the walls cannot be edited');
    parseWallBatch({ edits }, walls.length);
    const changed = edits.filter(({ index, piece }) => walls[index] !== piece);
    if (changed.length === 0) return walls;
    const placed = changed.flatMap(({ index, piece }) => (piece === null ? [] : [index]));
    if (placed.length > 0) {
      const conflict = findWallConflict(placed, layout.width, staticTiles, await protections());
      if (conflict !== null) throw new TerrainProtectedError(conflict);
    }
    const next = withWalls(walls, changed);
    const nextSnapshot = terrainSnapshot(layout, blocks, next);
    await store.saveWalls(changed, actorId);
    walls = next;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return walls;
  }

  return {
    async load() {
      if (!store) return;
      const saved = await store.loadBlocks();
      const count = blockCount(layout);
      let next = layout.blocks;
      for (const [index, material] of saved) {
        // Keep the default spawn safe without rewriting incompatible saved rows.
        if (index === spawn && material !== 'wood') continue;
        if (index >= 0 && index < count) next = withBlock(next, index, material);
      }
      blocks = next;
      const savedWalls = await store.loadWalls();
      const wallEdits: WallEdit[] = [];
      for (const [index, piece] of savedWalls) {
        // Same rule as the spawn block: a wall that may not stand there is
        // ignored, never rewritten.
        if (index >= 0 && index < layout.walls.length && !staticTiles.has(index)) wallEdits.push({ index, piece });
      }
      walls = withWalls(layout.walls, wallEdits);
      snapshot = terrainSnapshot(layout, blocks, walls);
    },
    blocks: () => blocks,
    walls: () => walls,
    snapshot: () => snapshot,
    editable: store !== undefined,
    setBlock(edit, protections) {
      return enqueue(() => apply([edit], edit.actorId, protections));
    },
    setBlocks(edits, actorId, protections, expected) {
      return enqueue(() => apply(edits, actorId, protections, expected));
    },
    setWalls(edits, actorId, protections) {
      return enqueue(() => applyWalls(edits, actorId, protections));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
