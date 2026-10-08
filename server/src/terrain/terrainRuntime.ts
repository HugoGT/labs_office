/**
 * The live terrain of the server (#123 phase 2): the persisted blocks and the
 * `TerrainSnapshot` built from them, kept in memory. `OfficeRoom` checks every
 * `move` against `snapshot()`, so a move never queries Postgres; the snapshot
 * is rebuilt once at `load()` and once per accepted edit.
 *
 * Edits run one at a time. Each one is checked against the terrain the
 * previous one left and against protections read at that moment, and the
 * snapshot only changes after the store saved it: a failed save leaves the
 * office exactly as it was.
 */

import {
  blockCount,
  blockIndexAt,
  encodeTerrainBlocks,
  newlyWateredTiles,
  terrainSnapshot,
  withBlock,
  type LayoutMaterial,
  type OfficeLayout,
  type TerrainSnapshot,
} from '../../../src/game/officeLayout.ts';
import { BASE_MAP_SEATS, type MapSeat } from '../../../src/game/seating.ts';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import type { TerrainStore } from './terrainPort.ts';
import {
  TerrainProtectedError,
  TerrainStaleError,
  parseTerrainBatch,
  findWaterConflict,
  staticProtectedTiles,
  type TerrainEdit,
  type TerrainProtections,
} from './terrainRules.ts';

export type TerrainListener = (blocks: readonly LayoutMaterial[]) => void;

export interface TerrainRuntime {
  /** Reads the persisted blocks. Called once, after the schema is applied. */
  load(): Promise<void>;
  blocks(): readonly LayoutMaterial[];
  snapshot(): TerrainSnapshot;
  /** False without a store (no `DATABASE_URL`): the terrain is the layout's for good. */
  readonly editable: boolean;
  /**
   * Applies one edit, or throws `TerrainProtectedError` when water would land
   * under something `protections` (read only if the edit floods a tile) or
   * the static layout protects.
   */
  setBlock(edit: TerrainEdit & { actorId: string | null }, protections: () => Promise<TerrainProtections>): Promise<readonly LayoutMaterial[]>;
  setBlocks(edits: readonly TerrainEdit[], actorId: string | null, protections: () => Promise<TerrainProtections>, expected?: string): Promise<readonly LayoutMaterial[]>;
  /** Called after each accepted edit with the whole new block list. */
  subscribe(listener: TerrainListener): () => void;
}

export function createTerrainRuntime({ layout, store, seats = BASE_MAP_SEATS }: { layout: OfficeLayout; store?: TerrainStore; seats?: readonly MapSeat[] }): TerrainRuntime {
  const spawn = blockIndexAt(layout.width, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
  const staticTiles = staticProtectedTiles(layout, seats);
  const listeners = new Set<TerrainListener>();
  let blocks: readonly LayoutMaterial[] = layout.blocks;
  let snapshot = terrainSnapshot(layout, blocks);
  let queue: Promise<unknown> = Promise.resolve();

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
    const nextSnapshot = terrainSnapshot(layout, next);
    const watered = newlyWateredTiles(snapshot, nextSnapshot);
    if (watered.length > 0) {
      const conflict = findWaterConflict(watered, layout.width, staticTiles, await protections());
      if (conflict !== null) throw new TerrainProtectedError(conflict);
    }
    await store.saveBlocks(changed, actorId);
    blocks = next;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return blocks;
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
      snapshot = terrainSnapshot(layout, blocks);
    },
    blocks: () => blocks,
    snapshot: () => snapshot,
    editable: store !== undefined,
    setBlock(edit, protections) {
      const run = queue.then(() => apply([edit], edit.actorId, protections));
      // The chain must survive a refused or failed edit; the caller still sees it.
      queue = run.catch(() => undefined);
      return run;
    },
    setBlocks(edits, actorId, protections, expected) {
      const run = queue.then(() => apply(edits, actorId, protections, expected));
      queue = run.catch(() => undefined);
      return run;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
